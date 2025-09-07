import os
import json
import math
from flask import Flask, request, jsonify, render_template, session
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, current_user, login_required
from flask_bcrypt import Bcrypt
from groq import Groq  # Sử dụng Groq API
from flask_cors import CORS

# --- App Configuration ---
app = Flask(__name__)
basedir = os.path.abspath(os.path.dirname(__file__))

# Cấu hình để đọc biến môi trường, có giá trị dự phòng cho local development
app.config['SECRET_KEY'] = os.environ.get('FLASK_SECRET_KEY', 'default_fallback_secret_key_for_dev')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL',
                                                       'sqlite:///' + os.path.join(basedir, 'chat_app.db'))
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# --- Initialize Extensions ---
db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login_page'

CORS(app)

# --- Groq Client Initialization ---
# API key sẽ được đọc từ biến môi trường của server hosting
try:
    groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
except Exception as e:
    print(f"Lỗi khởi tạo Groq client: {e}")
    groq_client = None


# --- Database Models ---

class User(db.Model, UserMixin):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    conversations = db.relationship('Conversation', backref='owner', lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)


class Conversation(db.Model):
    __tablename__ = 'conversation'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(200), nullable=True)  # Tiêu đề tùy chỉnh sau khi rename
    messages = db.Column(db.Text, nullable=False, default='[]')  # Lưu tin nhắn dạng JSON string

with app.app_context():
    db.create_all()

# --- Flask-Login User Loader ---
@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# --- Frontend Rendering Route ---
@app.route("/")
def home():
    """Render the main chat application page."""
    return render_template("index.html")


# --- Authentication API Routes ---

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    if not username or not password:
        return jsonify({"success": False, "error": "Missing username or password"}), 400
    if len(password) < 6:
        return jsonify({"success": False, "error": "Password must be at least 6 characters long"}), 400

    existing_user = User.query.filter_by(username=username).first()
    if existing_user:
        return jsonify({"success": False, "error": "Username already exists"}), 409

    new_user = User(username=username)
    new_user.set_password(password)
    db.session.add(new_user)
    db.session.commit()

    login_user(new_user)
    return jsonify({"success": True, "message": "Registration successful"}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')

    user = User.query.filter_by(username=username).first()

    if user and user.check_password(password):
        login_user(user)
        return jsonify({"success": True, "message": "Login successful"}), 200

    return jsonify({"success": False, "error": "Invalid username or password"}), 401


@app.route("/api/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return jsonify({"success": True, "message": "Logout successful"}), 200


@app.route("/api/check_session")
def check_session():
    if current_user.is_authenticated:
        return jsonify({"logged_in": True, "username": current_user.username})
    return jsonify({"logged_in": False})


# --- Chat and History API Routes ---

@app.route("/api/history", methods=["GET"])
@login_required
def get_history():
    conversations_db = Conversation.query.filter_by(user_id=current_user.id).order_by(Conversation.id.desc()).all()
    history_list = []
    for conv in conversations_db:
        messages_preview = json.loads(conv.messages or "[]")
        first_user_message_text = next((msg['text'] for msg in messages_preview if msg['sender'] == 'user'), "New Chat")

        history_list.append({
            "id": conv.id,
            "title": conv.title or first_user_message_text,
        })
    return jsonify(history_list)


@app.route("/api/chat", methods=["POST"])
@login_required
def chat():
    if not groq_client:
        return jsonify({"error": "AI service is not configured."}), 503

    data = request.get_json()
    user_message_text = data.get("message", "")
    conversation_id = data.get("conversation_id")

    # 1. Chuẩn bị ngữ cảnh từ tin nhắn cũ
    messages_history = []
    conversation_to_save = None
    if conversation_id:
        conversation_to_save = db.session.get(Conversation, conversation_id)
        if conversation_to_save and conversation_to_save.user_id == current_user.id:
            messages_history = json.loads(conversation_to_save.messages or '[]')
        else:
            return jsonify({"error": "Conversation not found or unauthorized"}), 404

    # Định dạng lại tin nhắn cho Groq API, dịch "bot" thành "assistant"
    formatted_messages = []
    for msg in messages_history:
        role = "assistant" if msg["sender"] == "bot" else "user"
        formatted_messages.append({"role": role, "content": msg["text"]})

    formatted_messages.append({"role": "user", "content": user_message_text})

    # 2. Gọi API Groq
    try:
        chat_completion = groq_client.chat.completions.create(
            messages=formatted_messages,
            model="llama-3.1-8b-instant",  # Bạn có thể đổi model khác nếu muốn, ví dụ llama3-70b-8192
            temperature=0.7,
            max_tokens=1024,
        )
        response_text = chat_completion.choices[0].message.content
    except Exception as e:
        print(f"Groq API error: {e}")
        return jsonify({"error": "AI service provider error."}), 503

    # 3. Lưu cuộc hội thoại vào database
    try:
        if not conversation_to_save:
            conversation_to_save = Conversation(user_id=current_user.id)
            db.session.add(conversation_to_save)

        # Cập nhật mảng tin nhắn với tin mới
        messages_history.append({"sender": "user", "text": user_message_text})
        messages_history.append({"sender": "bot", "text": response_text.strip()})
        conversation_to_save.messages = json.dumps(messages_history)

        db.session.commit()

        return jsonify({
            "reply": response_text.strip(),
            "conversation_id": conversation_to_save.id,
        })
    except Exception as e:
        db.session.rollback()
        print(f"Database error details: {e}")
        return jsonify({"error": "Database processing error"}), 500


@app.route("/api/conversation/<int:conv_id>/messages", methods=["GET"])
@login_required
def get_conversation_messages(conv_id):
    conversation = db.session.get(Conversation, conv_id)
    if not conversation or conversation.user_id != current_user.id:
        return jsonify({"error": "Conversation not found or unauthorized"}), 404

    try:
        page = int(request.args.get('page', 1))
        limit = int(request.args.get('limit', 20))
    except ValueError:
        page = 1
        limit = 20

    all_messages = json.loads(conversation.messages or '[]')
    total_messages = len(all_messages)
    total_pages = math.ceil(total_messages / limit)

    start_index = total_messages - (page * limit)
    end_index = total_messages - ((page - 1) * limit)
    if start_index < 0:
        start_index = 0

    paginated_messages = all_messages[start_index:end_index]

    return jsonify({
        "messages": paginated_messages,
        "pagination": {
            "page": page,
            "total_pages": total_pages,
            "has_more": page < total_pages
        }
    })


@app.route("/api/conversation/<int:conv_id>/rename", methods=["POST"])
@login_required
def rename_conversation(conv_id):
    conversation = db.session.get(Conversation, conv_id)
    if not conversation or conversation.user_id != current_user.id:
        return jsonify({"success": False, "error": "Conversation not found or unauthorized"}), 404
    new_title = request.json.get('title')
    if not new_title:
        return jsonify({"success": False, "error": "New title required"}), 400
    conversation.title = new_title
    db.session.commit()
    return jsonify({"success": True, "message": "Rename successful"})


@app.route("/api/conversation/<int:conv_id>/delete", methods=["DELETE"])
@login_required
def delete_conversation(conv_id):
    conversation = db.session.get(Conversation, conv_id)
    if not conversation or conversation.user_id != current_user.id:
        return jsonify({"success": False, "error": "Conversation not found or unauthorized"}), 404
    db.session.delete(conversation)
    db.session.commit()
    return jsonify({"success": True, "message": "Delete successful"})


# --- Main execution ---
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)