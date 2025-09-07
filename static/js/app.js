document.addEventListener("DOMContentLoaded", () => {

    // --- DOM Elements Selection ---
    const authContainer = document.getElementById('auth-container');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const showRegisterLink = document.getElementById('show-register-link');
    const showLoginLink = document.getElementById('show-login-link');
    const authMessageArea = document.getElementById('auth-message-area'); // Sẽ không dùng nhiều nữa, thay bằng SweetAlert
    const appContainer = document.getElementById('app-container');
    const usernameDisplay = document.getElementById('username-display');
    const logoutBtn = document.getElementById('logout-btn');
    const chatBox = document.getElementById("chatBox");
    const userInput = document.getElementById("userInput");
    const sendBtn = document.getElementById("sendBtn");
    const newChatBtn = document.getElementById("newChatBtn");
    const newChatPrompt = document.getElementById("newChatPrompt");
    const historyContainer = document.getElementById("historyContainer");
    const toggleDarkBtn = document.getElementById("toggleDarkBtn");

    // --- Global State ---
    let currentConversationId = null;
    let currentMessagesPage = 1;
    let isLoadingMoreMessages = false;
    let hasMoreMessages = true;

    // --- 1. Authentication and Initialization ---

    /**
     * Checks login status with the server on page load.
     */
    async function checkLoginStatus() {
        try {
            const response = await fetch('/api/check_session');
            const data = await response.json();
            if (data.logged_in) {
                showAppUI(data.username);
                await fetchHistoryAndRender();
                resetToNewChatView();
            } else {
                showAuthUI();
            }
        } catch (error) {
            console.error('Session check failed:', error);
            showAuthUI();
        }
    }

    /**
     * Handles login form submission with SweetAlert notifications.
     */
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = loginForm.querySelector('#login-username').value;
        const password = loginForm.querySelector('#login-password').value;

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                await checkLoginStatus();
                Swal.fire({
                    toast: true,
                    position: 'top-end',
                    icon: 'success',
                    title: 'Logged in successfully!',
                    showConfirmButton: false,
                    timer: 2000,
                    background: getSwalBackground(),
                    color: getSwalColor()
                });
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Login Failed',
                    text: data.error || 'Please check your username and password.',
                    background: getSwalBackground(),
                    color: getSwalColor()
                });
            }
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'Connection Error',
                text: 'Could not reach server.',
                background: getSwalBackground(),
                color: getSwalColor()
            });
        }
    });

    /**
     * Handles registration form submission with SweetAlert notifications.
     */
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = registerForm.querySelector('#register-username').value;
        const password = registerForm.querySelector('#register-password').value;

        try {
            const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (response.ok && data.success) {
                await checkLoginStatus(); // Tải lại UI sau khi đăng ký thành công
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Registration Failed',
                    text: data.error || 'Please try again later.',
                    background: getSwalBackground(),
                    color: getSwalColor()
                });
            }
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'Connection Error',
                text: 'Could not reach server.',
                background: getSwalBackground(),
                color: getSwalColor()
            });
        }
    });

    /**
     * Handles logout button click with SweetAlert confirmation.
     */
    logoutBtn.addEventListener('click', () => {
        Swal.fire({
            title: 'Log out?',
            text: "Are you sure you want to log out?",
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#aaa',
            confirmButtonText: 'Logout',
            background: getSwalBackground(),
            color: getSwalColor()
        }).then(async (result) => {
            if (result.isConfirmed) {
                await fetch('/api/logout', { method: 'POST' });
                currentConversationId = null;
                showAuthUI();
            }
        });
    });

    // --- UI Toggles ---
    function showAppUI(username) {
        authContainer.style.display = 'none';
        appContainer.style.display = 'flex';
        usernameDisplay.textContent = username;
    }

    function showAuthUI() {
        authContainer.style.display = 'none';
        appContainer.style.display = 'none';
        authContainer.style.display = 'flex';
    }

    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
    });

    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'block';
        registerForm.style.display = 'none';
    });

    // --- 2. Chat Core Logic ---

    function resetToNewChatView() {
        currentConversationId = null;
        chatBox.innerHTML = '';
        userInput.value = '';
        newChatPrompt.classList.remove('hidden');
        sendBtn.disabled = false;
        if (appContainer.style.display === 'flex') {
             userInput.focus();
        }
    }

    async function sendMessage() {
        const msgText = userInput.value.trim();
        if (!msgText) return;

        newChatPrompt.classList.add('hidden');
        renderMessage({ sender: 'user', text: msgText }, false, false);
        userInput.value = "";
        sendBtn.disabled = true;

        showThinkingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: msgText,
                    conversation_id: currentConversationId
                })
            });

            hideThinkingIndicator();
            if (!response.ok) throw new Error('Server error');
            const data = await response.json();
            renderMessage({ sender: 'bot', text: data.reply }, false, false);

            if (!currentConversationId) {
                currentConversationId = data.conversation_id;
            }
            await fetchHistoryAndRender();

        } catch (err) {
            hideThinkingIndicator();
            renderMessage({ sender: 'bot', text: "⚠️ Unable to connect to server!" }, false, false);
            console.error("Error sending message:", err);
        } finally {
            sendBtn.disabled = false;
            if (appContainer.style.display === 'flex') {
                userInput.focus();
            }
        }
    }

    newChatBtn.addEventListener("click", resetToNewChatView);

    // --- 3. History Management ---

    async function fetchHistoryAndRender() {
        try {
            const response = await fetch('/api/history');
            if (!response.ok) throw new Error('Failed to fetch history');
            const conversations = await response.json();
            renderHistoryList(conversations);
        } catch (error) {
            console.error(error);
        }
    }

    function renderHistoryList(conversations) {
        historyContainer.innerHTML = '';
        if (conversations.length === 0) {
            historyContainer.innerHTML = '<div class="no-history-item">No chat history.</div>';
            return;
        }

        conversations.forEach((conversation) => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.dataset.id = conversation.id;

            const displayTitle = conversation.title || "New Conversation";

            historyItem.innerHTML = `
                <span class="history-title">${displayTitle.substring(0, 30) + (displayTitle.length > 30 ? '...' : '')}</span>
                <div class="history-menu-container">
                    <button class="history-menu-btn material-symbols-outlined">more_horiz</button>
                    <div class="history-dropdown">
                        <button class="rename-btn">Rename</button>
                        <button class="delete-btn">Delete</button>
                    </div>
                </div>
            `;
            historyContainer.appendChild(historyItem);
        });
    }

    async function loadConversation(chatId) {
        currentConversationId = Number(chatId);
        currentMessagesPage = 1;
        hasMoreMessages = true;
        chatBox.innerHTML = '';
        newChatPrompt.classList.add('hidden');
        userInput.focus();

        await fetchAndRenderMessages(chatId, currentMessagesPage, false);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    async function fetchAndRenderMessages(chatId, page, prepend = false) {
        if (isLoadingMoreMessages) return;
        isLoadingMoreMessages = true;

        try {
            const response = await fetch(`/api/conversation/${chatId}/messages?page=${page}&limit=20`);
            if (!response.ok) throw new Error('Failed to fetch messages');
            const data = await response.json();

            hasMoreMessages = data.pagination.has_more;

            if (data.messages && data.messages.length > 0) {
                const oldScrollHeight = chatBox.scrollHeight;
                data.messages.forEach(message => renderMessage(message, true, prepend));
                if (prepend) {
                    chatBox.scrollTop = chatBox.scrollHeight - oldScrollHeight;
                }
            }
        } catch (error) {
            console.error('Error loading messages:', error);
        } finally {
            isLoadingMoreMessages = false;
        }
    }

    // --- 4. History Item Actions (Rename/Delete/Load) ---

    historyContainer.addEventListener('click', async (event) => {
        const target = event.target;
        const historyItem = target.closest('.history-item');
        if (!historyItem) return;

        const chatId = historyItem.dataset.id;

        if (target.closest('.history-menu-btn')) {
            event.stopPropagation();
            toggleMenu(historyItem);
        } else if (target.closest('.delete-btn')) {
            event.stopPropagation();
            Swal.fire({
                title: 'Delete Conversation?',
                text: "You won't be able to revert this!",
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#aaa',
                confirmButtonText: 'Yes, delete it!',
                background: getSwalBackground(),
                color: getSwalColor()
            }).then(async (result) => {
                if (result.isConfirmed) {
                    await deleteChatLogic(chatId);
                }
            });
        } else if (target.closest('.rename-btn')) {
            event.stopPropagation();
            startRename(historyItem, chatId);
        } else {
            loadConversation(chatId);
            closeAllMenus();
        }
    });

    async function deleteChatLogic(chatId) {
        try {
            await fetch(`/api/conversation/${chatId}/delete`, { method: 'DELETE' });
            await fetchHistoryAndRender();
            if (String(currentConversationId) === String(chatId)) {
                resetToNewChatView();
            }
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'Conversation deleted',
                showConfirmButton: false,
                timer: 2000,
                background: getSwalBackground(),
                color: getSwalColor()
            });
        } catch (error) {
            console.error('Failed to delete chat:', error);
        }
    }

    async function startRename(historyItem, chatId) {
        const titleElement = historyItem.querySelector('.history-title');
        const currentTitleText = titleElement.textContent.replace(/\.\.\.$/, '');

        const inputElement = document.createElement('input');
        inputElement.type = 'text';
        inputElement.value = currentTitleText;
        inputElement.className = 'rename-input';

        historyItem.replaceChild(inputElement, titleElement);
        inputElement.focus();
        closeAllMenus();

        const saveRename = async () => {
            const newTitle = inputElement.value.trim();
            if (newTitle && newTitle !== currentTitleText) {
                try {
                    await fetch(`/api/conversation/${chatId}/rename`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: newTitle })
                    });
                    titleElement.textContent = newTitle.substring(0, 30) + (newTitle.length > 30 ? '...' : '');
                } catch (error) {
                    console.error('Rename failed:', error);
                    historyItem.replaceChild(titleElement, inputElement);
                }
            } else {
                historyItem.replaceChild(titleElement, inputElement);
            }
        };

        inputElement.addEventListener('blur', saveRename);
        inputElement.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') inputElement.blur();
            else if (e.key === 'Escape') historyItem.replaceChild(titleElement, inputElement);
        });
    }

    // --- 5. Utilities and Event Listeners ---

    function renderMessage(messageObject, isInstant = false, prepend = false) {
        const { sender, text } = messageObject;
        const messageDiv = document.createElement("div");
        messageDiv.classList.add("message", sender === "user" ? "user-message" : "bot-message");

        const avatar = `<div class="avatar ${sender}-avatar">${sender === "user" ? "U" : "B"}</div>`;
        const formattedText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const bubble = `<div class="bubble ${sender}-bubble">${formattedText}</div>`;

        messageDiv.innerHTML = sender === "user" ? bubble + avatar : avatar + bubble;

        if (prepend) {
            chatBox.prepend(messageDiv);
        } else {
            chatBox.appendChild(messageDiv);
            if (!isInstant) chatBox.scrollTop = chatBox.scrollHeight;
        }
    }

    function showThinkingIndicator() {
        if (document.getElementById('thinking-indicator')) return;
        const messageDiv = document.createElement("div");
        messageDiv.id = 'thinking-indicator';
        messageDiv.classList.add("message", "bot-message");
        messageDiv.innerHTML = `<div class="avatar bot-avatar">B</div><div class="bubble bot-bubble thinking-bubble">Bot is thinking...</div>`;
        chatBox.appendChild(messageDiv);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function hideThinkingIndicator() {
        const indicator = document.getElementById('thinking-indicator');
        if (indicator) indicator.remove();
    }

    function toggleMenu(selectedItem) {
        const dropdown = selectedItem.querySelector('.history-dropdown');
        document.querySelectorAll('.history-dropdown.show').forEach(openDropdown => {
            if (openDropdown !== dropdown) openDropdown.classList.remove('show');
        });
        dropdown.classList.toggle('show');
    }

    function closeAllMenus() {
        document.querySelectorAll('.history-dropdown.show').forEach(openDropdown => {
            openDropdown.classList.remove('show');
        });
    }

    // SweetAlert theme helpers
    function getSwalBackground() {
        return document.body.classList.contains('dark') ? '#252525' : '#ffffff';
    }
    function getSwalColor() {
        return document.body.classList.contains('dark') ? '#e0e0e0' : '#1a1a1a';
    }

    window.addEventListener('click', (event) => {
        if (!event.target.closest('.history-menu-container')) {
            closeAllMenus();
        }
    });

    chatBox.addEventListener('scroll', async () => {
        if (chatBox.scrollTop === 0 && !isLoadingMoreMessages && hasMoreMessages) {
            currentMessagesPage++;
            await fetchAndRenderMessages(currentConversationId, currentMessagesPage, true);
        }
    });

    sendBtn.addEventListener("click", sendMessage);
    userInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !sendBtn.disabled) sendMessage();
    });

    toggleDarkBtn.addEventListener("click", () => {
        document.body.classList.toggle("dark");
        document.body.classList.toggle("light");
    });

    // --- Initial Application Load ---
    initializeApp();
});