// Anonymous Vibrant Chat - Client-side JavaScript
class AnonymousChatApp {
    constructor() {
        this.socket = null;
        this.currentUser = '';
        this.privateChats = new Map();
        this.likedUsers = new Set();
        this.isTyping = false;
        this.typingTimeout = null;

        this.init();
    }

    init() {
        // Hide loading screen after 2 seconds
        setTimeout(() => {
            document.getElementById('loadingScreen').style.display = 'none';
        }, 2000);

        this.setupEventListeners();
        this.setupKeyboardShortcuts();
    }

    setupEventListeners() {
        // Nickname entry
        document.getElementById('joinButton').addEventListener('click', () => this.joinChat());
        document.getElementById('nicknameInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.joinChat();
        });

        // Message sending
        document.getElementById('sendButton').addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });

        // Private message sending
        document.getElementById('sendPrivateButton').addEventListener('click', () => this.sendPrivateMessage());
        document.getElementById('privateMessageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendPrivateMessage();
        });

        // Typing indicators
        document.getElementById('messageInput').addEventListener('input', () => this.handleTyping());

        // UI toggles
        document.getElementById('toggleUsers').addEventListener('click', () => this.toggleUsersSidebar());
        document.getElementById('toggleSettings').addEventListener('click', () => this.showSettings());

        // Admin panel (hidden feature - triple click logo)
        let clickCount = 0;
        document.querySelector('.logo-small').addEventListener('click', () => {
            clickCount++;
            if (clickCount === 3) {
                this.toggleAdminPanel();
                clickCount = 0;
            }
            setTimeout(() => clickCount = 0, 1000);
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+U to toggle users
            if (e.ctrlKey && e.key === 'u') {
                e.preventDefault();
                this.toggleUsersSidebar();
            }

            // Escape to close modals
            if (e.key === 'Escape') {
                this.closePrivateChat();
                this.hideAdminPanel();
            }
        });
    }

    joinChat() {
        const nickname = document.getElementById('nicknameInput').value.trim();

        if (!nickname) {
            this.showError('Please enter a nickname');
            return;
        }

        if (nickname.length < 2) {
            this.showError('Nickname must be at least 2 characters');
            return;
        }

        if (nickname.length > 20) {
            this.showError('Nickname must be less than 20 characters');
            return;
        }

        // Initialize socket connection
        this.socket = io();
        this.setupSocketListeners();

        // Join chat
        this.socket.emit('joinChat', { nickname });
        this.currentUser = nickname;

        // Show loading
        document.getElementById('joinButton').innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...';
        document.getElementById('joinButton').disabled = true;
    }

    setupSocketListeners() {
        // Join responses
        this.socket.on('joinSuccess', (data) => {
            document.getElementById('nicknameScreen').style.display = 'none';
            document.getElementById('chatInterface').classList.remove('hidden');
            document.getElementById('currentUser').textContent = data.nickname;
            this.showNotification(`Welcome, ${data.nickname}!`, 'success');
        });

        this.socket.on('nicknameError', (data) => {
            this.showError(data.message);
            document.getElementById('joinButton').innerHTML = '<i class="fas fa-sign-in-alt"></i> Join Chat';
            document.getElementById('joinButton').disabled = false;
        });

        // Messages
        this.socket.on('recentMessages', (messages) => {
            messages.forEach(message => this.displayMessage(message));
        });

        this.socket.on('newMessage', (message) => {
            this.displayMessage(message);
            this.playNotificationSound();
        });

        // Users
        this.socket.on('userList', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('userListUpdate', (users) => {
            this.updateUsersList(users);
        });

        this.socket.on('userJoined', (data) => {
            this.showNotification(`${data.nickname} joined the chat`, 'success');
        });

        this.socket.on('userLeft', (data) => {
            this.showNotification(`${data.nickname} left the chat`, 'warning');
        });

        // Private chat
        this.socket.on('newPrivateMessage', (message) => {
            this.displayPrivateMessage(message);
            this.playNotificationSound();
        });

        this.socket.on('likeReceived', (data) => {
            this.showNotification(`${data.from} likes you! ❤️`, 'success');
        });

        this.socket.on('mutualLike', (data) => {
            this.showNotification(`Mutual like with ${data.nickname}! 💕 Private chat opened`, 'success');
            this.openPrivateChat(data.nickname, data.chatRoomId);
        });

        // Typing indicators
        this.socket.on('userTyping', (data) => {
            this.showTypingIndicator(data.nickname, data.isTyping);
        });

        // Admin
        this.socket.on('messageRemoved', (data) => {
            this.removeMessage(data.messageId);
        });

        // Connection status
        this.socket.on('connect', () => {
            this.showNotification('Connected to chat', 'success');
        });

        this.socket.on('disconnect', () => {
            this.showNotification('Disconnected from chat', 'error');
        });
    }

    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        const content = messageInput.value.trim();

        if (!content) return;

        this.socket.emit('sendMessage', { content });
        messageInput.value = '';

        // Stop typing indicator
        this.socket.emit('typing', { isTyping: false });
    }

    sendPrivateMessage() {
        const messageInput = document.getElementById('privateMessageInput');
        const content = messageInput.value.trim();

        if (!content || !this.activePrivateChat) return;

        this.socket.emit('sendPrivateMessage', {
            targetNickname: this.activePrivateChat,
            content
        });

        messageInput.value = '';
    }

    displayMessage(message) {
        const messagesContainer = document.getElementById('messagesContainer');

        // Remove welcome message if it exists
        const welcomeMessage = messagesContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }

        const messageElement = document.createElement('div');
        messageElement.className = `message ${message.nickname === this.currentUser ? 'own' : ''}`;
        messageElement.setAttribute('data-message-id', message.id);

        const time = new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageElement.innerHTML = `
            <div class="message-header">
                <div class="message-avatar">${message.nickname.charAt(0).toUpperCase()}</div>
                <span class="message-author">${message.nickname}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${this.escapeHtml(message.content)}</div>
        `;

        // Add admin controls if admin is authenticated
        if (this.isAdminAuthenticated && message.nickname !== this.currentUser) {
            const adminControls = document.createElement('div');
            adminControls.className = 'admin-controls';
            adminControls.innerHTML = `
                <button onclick="chatApp.removeMessage('${message.id}')" class="admin-remove-btn">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            messageElement.appendChild(adminControls);
        }

        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Animate message appearance
        messageElement.style.opacity = '0';
        messageElement.style.transform = 'translateY(20px)';
        setTimeout(() => {
            messageElement.style.transition = 'all 0.3s ease';
            messageElement.style.opacity = '1';
            messageElement.style.transform = 'translateY(0)';
        }, 50);
    }

    displayPrivateMessage(message) {
        const isOwnMessage = message.from === this.currentUser;
        const chatPartner = isOwnMessage ? message.to : message.from;

        // Ensure private chat modal is open
        if (!this.activePrivateChat || this.activePrivateChat !== chatPartner) {
            this.openPrivateChat(chatPartner);
        }

        const messagesContainer = document.getElementById('privateChatMessages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isOwnMessage ? 'own' : ''}`;

        const time = new Date(message.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });

        messageElement.innerHTML = `
            <div class="message-header">
                <div class="message-avatar">${message.from.charAt(0).toUpperCase()}</div>
                <span class="message-author">${message.from}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${this.escapeHtml(message.content)}</div>
        `;

        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    updateUsersList(users) {
        const usersList = document.getElementById('usersList');
        const userCount = document.getElementById('userCount');

        usersList.innerHTML = '';
        userCount.textContent = users.length;

        users.forEach(user => {
            if (user.nickname === this.currentUser) return; // Don't show self

            const userElement = document.createElement('div');
            userElement.className = `user-item ${this.likedUsers.has(user.nickname) ? 'liked' : ''}`;

            userElement.innerHTML = `
                <div class="user-info-item">
                    <div class="user-avatar">${user.nickname.charAt(0).toUpperCase()}</div>
                    <div>
                        <div class="user-nickname">${user.nickname}</div>
                        <div class="user-status"></div>
                    </div>
                </div>
                <button class="like-btn ${this.likedUsers.has(user.nickname) ? 'liked' : ''}" 
                        onclick="chatApp.likeUser('${user.nickname}')" 
                        title="Like ${user.nickname}">
                    <i class="fas fa-heart"></i>
                </button>
            `;

            usersList.appendChild(userElement);
        });
    }

    likeUser(nickname) {
        if (this.likedUsers.has(nickname)) {
            this.showNotification('You already liked this user', 'warning');
            return;
        }

        this.socket.emit('likeUser', { targetNickname: nickname });
        this.likedUsers.add(nickname);

        // Update UI
        const userElement = document.querySelector(`.user-item .user-nickname`);
        if (userElement && userElement.textContent === nickname) {
            const likeBtn = userElement.closest('.user-item').querySelector('.like-btn');
            likeBtn.classList.add('liked');
            userElement.closest('.user-item').classList.add('liked');
        }

        this.showNotification(`You liked ${nickname} ❤️`, 'success');
    }

    openPrivateChat(nickname, chatRoomId = null) {
        this.activePrivateChat = nickname;
        this.activeChatRoomId = chatRoomId;

        document.getElementById('privateChatTitle').textContent = `Private chat with ${nickname}`;
        document.getElementById('privateChatMessages').innerHTML = '';
        document.getElementById('privateChatModal').classList.remove('hidden');

        // Focus on input
        setTimeout(() => {
            document.getElementById('privateMessageInput').focus();
        }, 100);
    }

    closePrivateChat() {
        document.getElementById('privateChatModal').classList.add('hidden');
        this.activePrivateChat = null;
        this.activeChatRoomId = null;
    }

    handleTyping() {
        if (!this.isTyping) {
            this.isTyping = true;
            this.socket.emit('typing', { isTyping: true });
        }

        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
            this.isTyping = false;
            this.socket.emit('typing', { isTyping: false });
        }, 1000);
    }

    showTypingIndicator(nickname, isTyping) {
        const indicator = document.getElementById('typingIndicator');

        if (isTyping) {
            indicator.textContent = `${nickname} is typing...`;
            indicator.classList.add('pulse');
        } else {
            indicator.textContent = '';
            indicator.classList.remove('pulse');
        }
    }

    toggleUsersSidebar() {
        const sidebar = document.getElementById('usersSidebar');
        sidebar.classList.toggle('hidden');

        const toggleBtn = document.getElementById('toggleUsers');
        const icon = toggleBtn.querySelector('i');

        if (sidebar.classList.contains('hidden')) {
            icon.className = 'fas fa-users-slash';
        } else {
            icon.className = 'fas fa-users';
        }
    }

    showSettings() {
        this.showNotification('Settings panel coming soon!', 'info');
    }

    toggleAdminPanel() {
        const panel = document.getElementById('adminPanel');
        panel.classList.toggle('hidden');
    }

    hideAdminPanel() {
        document.getElementById('adminPanel').classList.add('hidden');
    }

    authenticateAdmin() {
        const password = document.getElementById('adminPassword').value;

        if (password === 'admin123') {
            this.isAdminAuthenticated = true;
            this.showNotification('Admin authenticated', 'success');
            this.hideAdminPanel();
        } else {
            this.showNotification('Invalid admin password', 'error');
        }
    }

    removeMessage(messageId) {
        if (!this.isAdminAuthenticated) {
            this.showNotification('Admin authentication required', 'error');
            return;
        }

        fetch(`/api/messages/${messageId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                adminPassword: 'admin123'
            })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                this.showNotification('Message removed', 'success');
            } else {
                this.showNotification('Failed to remove message', 'error');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            this.showNotification('Error removing message', 'error');
        });

        // Remove from UI immediately
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.style.transition = 'all 0.3s ease';
            messageElement.style.opacity = '0';
            messageElement.style.transform = 'translateX(-100%)';
            setTimeout(() => messageElement.remove(), 300);
        }
    }

    showNotification(message, type = 'info') {
        const toast = document.getElementById('notificationToast');
        const messageElement = document.getElementById('toastMessage');

        toast.className = `notification-toast ${type}`;
        messageElement.textContent = message;
        toast.classList.remove('hidden');

        // Auto hide after 3 seconds
        setTimeout(() => {
            toast.classList.add('hidden');
        }, 3000);
    }

    showError(message) {
        const errorElement = document.getElementById('nicknameError');
        errorElement.textContent = message;
        errorElement.style.display = 'block';

        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 3000);
    }

    playNotificationSound() {
        // Create a subtle notification sound
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.1);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Global functions for HTML onclick handlers
function closePrivateChat() {
    chatApp.closePrivateChat();
}

function toggleAdmin() {
    chatApp.toggleAdminPanel();
}

function authenticateAdmin() {
    chatApp.authenticateAdmin();
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new AnonymousChatApp();
});

// Handle page visibility for better performance
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden, reduce activity
        console.log('Chat app backgrounded');
    } else {
        // Page is visible, resume normal activity
        console.log('Chat app foregrounded');
    }
});

// Handle beforeunload to clean up
window.addEventListener('beforeunload', () => {
    if (chatApp && chatApp.socket) {
        chatApp.socket.disconnect();
    }
});
