gsap.registerPlugin(ScrollTrigger);

function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
    return null;
}

class AuthMiddleware {
    constructor() {
        this.isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
        this.currentUser = localStorage.getItem('currentUser') || null;
        this.users = JSON.parse(localStorage.getItem('users')) || {
            'user': { password: 'pass123', createdAt: new Date().toISOString() }
        };
    }

    login(username, password) {
        if (this.users[username] && this.users[username].password === password) {
            this.isAuthenticated = true;
            this.currentUser = username;
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('currentUser', username);
            sessionStorage.setItem('sessionActive', 'true');
            return true;
        }
        return false;
    }

    logout() {
        this.isAuthenticated = false;
        this.currentUser = null;
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('currentUser');
        sessionStorage.removeItem('sessionActive');
    }

    checkAuth() {
        return this.isAuthenticated && sessionStorage.getItem('sessionActive') === 'true';
    }

    getUser() {
        return this.currentUser;
    }
}

class ChatHistoryManager {
    constructor(user) {
        this.user = user;
        this.chats = JSON.parse(localStorage.getItem(`chatHistory_${user}`)) || {};
        this.save();
    }

    addChat(title, messages = []) {
        const id = Date.now().toString();
        this.chats[id] = { id, title, messages, timestamp: new Date().toISOString(), questionCount: 0 };
        this.save();
        return id;
    }

    renameChat(id, newTitle) {
        if (this.chats[id]) {
            this.chats[id].title = newTitle;
            this.save();
        }
    }

    deleteChat(id) {
        delete this.chats[id];
        this.save();
    }

    getChat(id) {
        return this.chats[id];
    }

    save() {
        localStorage.setItem(`chatHistory_${this.user}`, JSON.stringify(this.chats));
    }

    generateTitle(messages) {
        if (!messages.length) return '🌿 New Chat';
        const firstMessage = messages[0].message;
        const keywords = firstMessage.toLowerCase().split(' ').filter(word => word.length > 3);
        return '🌿 ' + (keywords[0] || 'Chat');
    }

    clearChats() {
        this.chats = {};
        this.save();
    }

    getDailyChatCount(date) {
        return Object.values(this.chats).filter(chat => 
            new Date(chat.timestamp).toDateString() === date.toDateString()
        ).length;
    }

    incrementQuestionCount(chatId) {
        if (this.chats[chatId]) {
            this.chats[chatId].questionCount = (this.chats[chatId].questionCount || 0) + 1;
            this.save();
        }
    }
}

class ContextTracker {
    constructor() {
        this.messages = [];
        this.rainforestRelated = false;
    }

    addMessage(message, type) {
        const msgObj = {
            id: Date.now(),
            message,
            type,
            timestamp: new Date().toISOString(),
            relatedTo: this.findRelatedMessages(message)
        };
        this.messages.push(msgObj);
        if (['rainforest', 'jungle', 'amazon'].some(k => message.toLowerCase().includes(k))) {
            this.rainforestRelated = true;
        }
        return msgObj;
    }

    findRelatedMessages(message) {
        return this.messages
            .filter(m => m.message.toLowerCase().split(' ').some(word => 
                message.toLowerCase().includes(word) && word.length > 3))
            .map(m => m.id);
    }

    getContext() {
        return {
            messages: this.messages,
            rainforestRelated: this.rainforestRelated,
            connections: this.getConnections()
        };
    }

    getConnections() {
        return this.messages
            .filter(m => m.relatedTo.length > 0)
            .map(m => ({
                current: m.message.substring(0, 30) + '...',
                related: m.relatedTo.map(id => 
                    this.messages.find(msg => msg.id === id)?.message.substring(0, 30) + '...')
            }));
    }

    reset() {
        this.messages = [];
        this.rainforestRelated = false;
    }
}

class NextAiAIApp {
    constructor() {
        this.authMiddleware = new AuthMiddleware();
        this.currentChatId = null;
        this.isSidebarCollapsed = false;
        this.maxChatsPerDay = 5; // Changed to 5 sessions
        this.maxQuestionsPerChat = 5;
        this.cooldownPeriod = 60 * 60 * 1000; // 1 hour in milliseconds
        this.initElements();
        this.setupEventListeners();
        this.initializeTheme();
        this.checkAuthentication();

        const today = new Date().toDateString();
        if (!getCookie('lastChatDate') || getCookie('lastChatDate') !== today) {
            setCookie('lastChatDate', today, 1);
            setCookie('dailyChatCount', '0', 1);
            setCookie('cooldownStart', '', 1);
        }

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                }
            });
        }, { threshold: 0.1 });
    }

    initElements() {
        this.sidebarEl = document.getElementById('sidebar');
        this.chatContainerEl = document.getElementById('chatContainer');
        this.chatMessagesEl = document.getElementById('chatMessages');
        this.messageInputEl = document.getElementById('userInput');
        this.chatTitleEl = document.createElement('h2');
        this.chatHistoryEl = document.getElementById('chatHistory');
        this.contextModalEl = document.getElementById('contextModal');
        this.loginModalEl = document.getElementById('loginModal');
        this.loginFormEl = document.getElementById('loginForm');
        this.loginErrorEl = document.getElementById('loginError');
        this.hamburgerBtn = document.getElementById('sidebarToggle');
        this.logoutBtn = document.getElementById('logoutBtn');
        this.chatInputEl = document.getElementById('chatForm');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.newChatBtn = document.getElementById('newChatBtn');
        this.themeToggle = document.getElementById('themeToggle');

        // Add hover style for newChatBtn
        this.newChatBtn.classList.add('cursor-pointer');
    }

    setupEventListeners() {
        this.hamburgerBtn.addEventListener('click', () => this.toggleSidebarMobile());
        this.themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            this.applyTheme(currentTheme === 'light' ? 'dark' : 'light');
            gsap.fromTo('body', { opacity: 0.8 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
        });
        this.newChatBtn.addEventListener('click', () => this.startNewChat());
        this.contextModalEl.querySelector('.close-modal').addEventListener('click', () => {
            gsap.to(this.contextModalEl, { opacity: 0, duration: 0.2, ease: 'power2.in', onComplete: () => this.contextModalEl.classList.add('hidden') });
        });
        this.chatInputEl.addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });
        this.messageInputEl.addEventListener('input', function() {
            this.style.height = 'auto';
            const newHeight = Math.min(this.scrollHeight, 150);
            this.style.height = newHeight + 'px';
        });
        this.messageInputEl.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                this.sendMessage();
            }
        });
        this.logoutBtn.addEventListener('click', () => {
            this.authMiddleware.logout();
            this.chatHistoryManager.clearChats();
            this.showLoginModal();
        });
        this.loginFormEl.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });
        this.chatHistoryEl.addEventListener('click', (e) => {
            const chatItem = e.target.closest('.chat-item');
            if (!chatItem) return;
            const chatId = chatItem.dataset.chatId;
            if (e.target.closest('.rename-btn')) {
                this.renameChat(chatId);
            } else if (e.target.closest('.delete-btn')) {
                this.deleteChat(chatId);
            } else {
                this.loadChat(chatId);
            }
        });
    }

    initializeTheme() {
        const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        this.applyTheme(savedTheme);
    }

    applyTheme(theme) {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        localStorage.setItem('theme', theme);
    }

    checkAuthentication() {
        if (this.authMiddleware.checkAuth()) {
            this.chatHistoryManager = new ChatHistoryManager(this.authMiddleware.getUser());
            this.contextTracker = new ContextTracker();
            this.showChatInterface();
            this.renderChatHistory();
            if (!this.currentChatId) this.startNewChat();
        } else {
            this.showLoginModal();
        }
    }

    showChatInterface() {
        this.sidebarEl.style.display = 'block';
        this.chatContainerEl.style.display = 'flex';
        this.loginModalEl.classList.add('hidden');
    }

    showLoginModal() {
        this.sidebarEl.style.display = 'none';
        this.chatContainerEl.style.display = 'none';
        this.loginModalEl.classList.remove('hidden');
    }

    handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        if (this.authMiddleware.login(username, password)) {
            const previousUser = localStorage.getItem('currentUser');
            if (previousUser && previousUser !== username) {
                localStorage.removeItem(`chatHistory_${previousUser}`);
            }
            this.chatHistoryManager = new ChatHistoryManager(username);
            this.contextTracker = new ContextTracker();
            this.showChatInterface();
            this.renderChatHistory();
        } else {
            this.loginErrorEl.classList.remove('hidden');
        }
    }

    toggleSidebarMobile() {
        if (window.innerWidth <= 1024) {
            this.sidebarEl.classList.toggle('open');
            this.isSidebarCollapsed = !this.sidebarEl.classList.contains('open');
            if (this.sidebarEl.classList.contains('open')) {
                gsap.to(this.sidebarEl, { x: 0, duration: 0.3, ease: 'power2.out' });
            } else {
                gsap.to(this.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
            }
        }
    }

    renderChatHistory() {
        const chats = Object.values(this.chatHistoryManager.chats)
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        this.chatHistoryEl.innerHTML = '<h2 class="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold mb-2">Recent Chats</h2>';
        const chatList = document.createElement('div');
        chatList.className = 'space-y-1';
        chats.forEach(chat => {
            const chatItem = document.createElement('div');
            chatItem.className = 'chat-item w-full text-left p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-100 transition-colors duration-150 truncate flex justify-between items-center cursor-pointer';
            chatItem.dataset.chatId = chat.id;
            chatItem.innerHTML = `
                <span>${chat.title} (${chat.questionCount}/${this.maxQuestionsPerChat})</span>
                <div class="chat-actions flex gap-2">
                    <button class="rename-btn text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                    </button>
                    <button class="delete-btn text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5-4h4M9 7h6" />
                        </svg>
                    </button>
                </div>
            `;
            chatList.appendChild(chatItem);
        });
        this.chatHistoryEl.appendChild(chatList);
    }

    async sendMessage() {
        if (!this.authMiddleware.checkAuth()) {
            this.showLoginModal();
            return;
        }

        const message = this.messageInputEl.value.trim();
        if (!message || !this.currentChatId) return;

        const chat = this.chatHistoryManager.getChat(this.currentChatId);
        if (chat.questionCount >= this.maxQuestionsPerChat) {
            this.addMessage(`You've reached the limit of ${this.maxQuestionsPerChat} questions for this chat. Start a new chat!`, 'ai');
            this.showNewChatPrompt();
            return;
        }

        if (chat.questionCount === this.maxQuestionsPerChat - 1) {
            this.addMessage(`Warning: This is your last question for this chat session. Only 1 question left!`, 'system');
        }

        this.addMessage(message, 'user');
        const userMsg = this.contextTracker.addMessage(message, 'user');
        this.messageInputEl.value = '';
        this.messageInputEl.style.height = 'auto';
        this.showTypingIndicator();

        try {
            const aiResponse = await this.generateAIResponse(message);
            this.hideTypingIndicator();
            this.addMessage(aiResponse, 'ai', this.contextTracker.rainforestRelated);
            const aiMsg = this.contextTracker.addMessage(aiResponse, 'ai');

            chat.messages.push(userMsg, aiMsg);
            this.chatHistoryManager.incrementQuestionCount(this.currentChatId);
            if (chat.messages.length === 2) {
                chat.title = this.chatHistoryManager.generateTitle(chat.messages);
            }
            this.chatHistoryManager.save();
            this.renderChatHistory();

            if (chat.questionCount === this.maxQuestionsPerChat) {
                this.showNewChatPrompt();
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    async generateAIResponse(message) {
        const API_KEY = 'AIzaSyDzCA-X2BzVlJo9A7n6lI8PXKCZtCBN1Oc'; // Replace with your Gemini API key
        if (!API_KEY) {
            return "API key missing. Here's a placeholder response...";
        }

        const context = this.contextTracker.getContext();
        let prompt = message;
        if (context.messages.length > 0) {
            prompt = `Previous conversation:\n${context.messages.map(m => 
                `${m.type === 'user' ? 'Q' : 'A'}: ${m.message}`).join('\n')}\nCurrent question: ${message}`;
        }
        if (context.rainforestRelated) {
            prompt += '\nFocus on rainforest-related information.';
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });
        const data = await response.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
    }

    addMessage(content, type, isRainforest = false) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-bubble flex items-start gap-4 ${type === 'user' ? 'justify-end' : ''}`;
        if (isRainforest) messageDiv.classList.add('rainforest-message');
        if (type === 'system') messageDiv.classList.add('text-center');

        if (type === 'user') {
            messageDiv.innerHTML = `
                <div class="flex-1 max-w-[80%]">
                    <div class="bg-primary-600 text-white p-4 rounded-lg shadow-sm">
                        <p>${content}</p>
                    </div>
                </div>
                <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-700 dark:text-gray-300">
                    <span class="text-sm font-medium">U</span>
                </div>
            `;
        } else if (type === 'system') {
            messageDiv.innerHTML = `
                <div class="flex-1 text-center">
                    <div class="bg-yellow-200 dark:bg-yellow-800 p-4 rounded-lg shadow-sm">
                        <p class="text-yellow-800 dark:text-yellow-200">${content}</p>
                    </div>
                </div>
            `;
        } else {
            messageDiv.innerHTML = `
                <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                </div>
                <div class="flex-1">
                    <div class="bg-gray-100 dark:bg-dark-200 p-4 rounded-lg shadow-sm">
                        <p class="text-gray-800 dark:text-gray-200 typing-animation">${content}</p>
                    </div>
                </div>
            `;
            setTimeout(() => {
                const messageText = messageDiv.querySelector('.typing-animation');
                if (messageText) applyTypingAnimation(messageText);
            }, 100);
        }

        if (this.loadingIndicator.parentNode === this.chatMessagesEl) {
            this.chatMessagesEl.insertBefore(messageDiv, this.loadingIndicator);
        } else {
            this.chatMessagesEl.appendChild(messageDiv);
        }
        this.observer.observe(messageDiv);
        this.scrollToBottom();
    }

    showNewChatPrompt() {
        const promptDiv = document.createElement('div');
        promptDiv.className = 'message-bubble flex justify-center gap-4';
        promptDiv.innerHTML = `
            <button id="promptNewChatBtn" class="p-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors duration-200 cursor-pointer">
                Start New Chat
            </button>
        `;
        this.chatMessagesEl.appendChild(promptDiv);
        this.scrollToBottom();
        document.getElementById('promptNewChatBtn').addEventListener('click', () => this.startNewChat());
    }

    startNewChat() {
        if (!this.authMiddleware.checkAuth()) {
            this.showLoginModal();
            return;
        }

        const today = new Date();
        let dailyChatCount = parseInt(getCookie('dailyChatCount') || '0');
        const storedChatCount = this.chatHistoryManager.getDailyChatCount(today);
        const cooldownStart = getCookie('cooldownStart');
        const now = Date.now();

        if (cooldownStart && (now - parseInt(cooldownStart)) < this.cooldownPeriod) {
            const remainingTime = Math.ceil((this.cooldownPeriod - (now - parseInt(cooldownStart))) / 1000 / 60);
            this.addMessage(`You've used all ${this.maxChatsPerDay} chat sessions. Please wait ${remainingTime} minutes before starting a new chat.`, 'system');
            return;
        }

        if (dailyChatCount >= this.maxChatsPerDay || storedChatCount >= this.maxChatsPerDay) {
            setCookie('cooldownStart', now.toString(), 1);
            this.addMessage(`You've reached the daily limit of ${this.maxChatsPerDay} chat sessions. Please wait 1 hour to start a new chat!`, 'system');
            return;
        }

        if (this.currentChatId && this.contextTracker.messages.length > 0) {
            const chat = this.chatHistoryManager.chats[this.currentChatId];
            chat.title = this.chatHistoryManager.generateTitle(chat.messages);
            this.chatHistoryManager.save();
        }

        const newChatId = this.chatHistoryManager.addChat('🌿 New Chat');
        this.currentChatId = newChatId;
        this.contextTracker.reset();
        this.chatMessagesEl.innerHTML = `
            <div class="message-bubble flex items-start gap-4">
                <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center text-white">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                </div>
                <div class="flex-1">
                    <div class="bg-gray-100 dark:bg-dark-200 p-4 rounded-lg shadow-sm">
                        <p class="text-gray-800 dark:text-gray-200">Hello! I'm NextAiAI. Ask me up to ${this.maxQuestionsPerChat} questions in this chat!</p>
                    </div>
                </div>
            </div>
        `;
        dailyChatCount++;
        setCookie('dailyChatCount', dailyChatCount.toString(), 1);
        this.renderChatHistory();
        if (window.innerWidth <= 1024) {
            this.sidebarEl.classList.remove('open');
            gsap.to(this.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
        }
    }

    loadChat(chatId) {
        if (!this.authMiddleware.checkAuth()) {
            this.showLoginModal();
            return;
        }

        const chat = this.chatHistoryManager.getChat(chatId);
        if (!chat) return;

        this.currentChatId = chatId;
        this.contextTracker.reset();
        this.chatMessagesEl.innerHTML = '';
        chat.messages.forEach(msg => {
            this.addMessage(msg.message, msg.type, this.contextTracker.rainforestRelated);
            this.contextTracker.addMessage(msg.message, msg.type);
        });

        if (chat.questionCount >= this.maxQuestionsPerChat) {
            this.showNewChatPrompt();
        } else if (chat.questionCount === this.maxQuestionsPerChat - 1) {
            this.addMessage(`Warning: Only 1 question left in this chat session!`, 'system');
        }

        if (window.innerWidth <= 1024) {
            this.sidebarEl.classList.remove('open');
            gsap.to(this.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
        }
    }

    renameChat(chatId) {
        if (!this.authMiddleware.checkAuth()) {
            this.showLoginModal();
            return;
        }

        const chat = this.chatHistoryManager.getChat(chatId);
        if (!chat) return;

        const newTitle = prompt('Enter new chat title:', chat.title);
        if (newTitle && newTitle.trim()) {
            this.chatHistoryManager.renameChat(chatId, newTitle.trim());
            this.renderChatHistory();
        }
    }

    deleteChat(chatId) {
        if (!this.authMiddleware.checkAuth()) {
            this.showLoginModal();
            return;
        }

        const chat = this.chatHistoryManager.getChat(chatId);
        if (!chat) return;

        this.chatHistoryManager.deleteChat(chatId);
        this.renderChatHistory();
        if (this.currentChatId === chatId) {
            this.currentChatId = null;
            this.contextTracker.reset();
            this.chatMessagesEl.innerHTML = `
                <div class="message-bubble flex items-start gap-4">
                    <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                    </div>
                    <div class="flex-1">
                        <div class="bg-gray-100 dark:bg-dark-200 p-4 rounded-lg shadow-sm">
                            <p class="text-gray-800 dark:text-gray-200">Welcome to NextAiAI! Start a new chat!</p>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    showContextModal() {
        if (!this.authMiddleware.checkAuth()) {
            this.showLoginModal();
            return;
        }

        const context = this.contextTracker.getContext();
        document.getElementById('contextDetails').innerHTML = `
            <h4>Conversation Context</h4>
            <p>Messages: ${context.messages.length}</p>
            ${context.rainforestRelated ? '<p>Rainforest Context Active</p>' : ''}
            <h5>Connections:</h5>
            <ul>${context.connections.map(c => `
                <li>${c.current} → ${c.related.join(', ')}</li>
            `).join('')}</ul>
        `;
        this.contextModalEl.classList.remove('hidden');
        gsap.fromTo(this.contextModalEl, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
    }

    showTypingIndicator() {
        this.loadingIndicator.style.display = 'flex';
        setTimeout(() => this.loadingIndicator.classList.add('visible'), 10);
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        this.loadingIndicator.style.display = 'none';
        this.loadingIndicator.classList.remove('visible');
    }

    scrollToBottom() {
        this.chatContainerEl.scrollTop = this.chatContainerEl.scrollHeight;
    }

    handleError(error) {
        console.error('Error:', error);
        this.hideTypingIndicator();
        this.addMessage('Oops! Something went wrong. Try again?', 'ai');
    }
}

function applyTypingAnimation(element) {
    const text = element.textContent;
    element.textContent = '';
    element.classList.remove('typing-animation');
    let i = 0;
    const typingSpeed = 20;

    function typeChar() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            setTimeout(typeChar, typingSpeed);
            if (i % 3 === 0) window.NextAiApp.scrollToBottom();
        } else {
            const cursor = document.createElement('span');
            cursor.className = 'typing-cursor';
            element.appendChild(cursor);
            setTimeout(() => cursor.parentNode?.removeChild(cursor), 3000);
        }
    }
    typeChar();
}

document.addEventListener('DOMContentLoaded', () => {
    window.NextAiApp = new NextAiAIApp();
    window.NextAiApp.messageInputEl.focus();
    gsap.from('.message-bubble', {
        y: 20,
        opacity: 0,
        duration: 0.5,
        stagger: 0.2,
        ease: 'power2.out'
    });
});

document.addEventListener('click', (e) => {
    if (window.innerWidth < 1024 && 
        window.NextAiApp.sidebarEl.classList.contains('open') && 
        !window.NextAiApp.sidebarEl.contains(e.target) && 
        e.target !== window.NextAiApp.hamburgerBtn &&
        !window.NextAiApp.hamburgerBtn.contains(e.target)) {
        window.NextAiApp.sidebarEl.classList.remove('open');
        gsap.to(window.NextAiApp.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
    }
});
// gsap.registerPlugin(ScrollTrigger);

// function setCookie(name, value, days) {
//     const expires = new Date();
//     expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
//     document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
// }

// function getCookie(name) {
//     const value = `; ${document.cookie}`;
//     const parts = value.split(`; ${name}=`);
//     if (parts.length === 2) return decodeURIComponent(parts.pop().split(';').shift());
//     return null;
// }

// class AuthMiddleware {
//     constructor() {
//         this.isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
//         this.currentUser = localStorage.getItem('currentUser') || null;
//         this.users = JSON.parse(localStorage.getItem('users')) || {
//             'user': { password: 'pass123', createdAt: new Date().toISOString() }
//         };
//     }

//     login(username, password) {
//         if (this.users[username] && this.users[username].password === password) {
//             this.isAuthenticated = true;
//             this.currentUser = username;
//             localStorage.setItem('isAuthenticated', 'true');
//             localStorage.setItem('currentUser', username);
//             sessionStorage.setItem('sessionActive', 'true');
//             return true;
//         }
//         return false;
//     }

//     logout() {
//         this.isAuthenticated = false;
//         this.currentUser = null;
//         localStorage.removeItem('isAuthenticated');
//         localStorage.removeItem('currentUser');
//         sessionStorage.removeItem('sessionActive');
//     }

//     checkAuth() {
//         return this.isAuthenticated && sessionStorage.getItem('sessionActive') === 'true';
//     }

//     getUser() {
//         return this.currentUser;
//     }
// }

// class ChatHistoryManager {
//     constructor(user) {
//         this.user = user;
//         this.chats = JSON.parse(localStorage.getItem(`chatHistory_${user}`)) || {};
//         this.save();
//     }

//     addChat(title, messages = []) {
//         const id = Date.now().toString();
//         this.chats[id] = { id, title, messages, timestamp: new Date().toISOString(), questionCount: 0 };
//         this.save();
//         return id;
//     }

//     renameChat(id, newTitle) {
//         if (this.chats[id]) {
//             this.chats[id].title = newTitle;
//             this.save();
//         }
//     }

//     deleteChat(id) {
//         delete this.chats[id];
//         this.save();
//     }

//     getChat(id) {
//         return this.chats[id];
//     }

//     save() {
//         localStorage.setItem(`chatHistory_${this.user}`, JSON.stringify(this.chats));
//     }

//     generateTitle(messages) {
//         if (!messages.length) return '🌿 New Chat';
//         const firstMessage = messages[0].message;
//         const keywords = firstMessage.toLowerCase().split(' ').filter(word => word.length > 3);
//         return '🌿 ' + (keywords[0] || 'Chat');
//     }

//     clearChats() {
//         this.chats = {};
//         this.save();
//     }

//     getDailyChatCount(date) {
//         return Object.values(this.chats).filter(chat => 
//             new Date(chat.timestamp).toDateString() === date.toDateString()
//         ).length;
//     }

//     incrementQuestionCount(chatId) {
//         if (this.chats[chatId]) {
//             this.chats[chatId].questionCount = (this.chats[chatId].questionCount || 0) + 1;
//             this.save();
//         }
//     }
// }

// class ContextTracker {
//     constructor() {
//         this.messages = [];
//         this.rainforestRelated = false;
//     }

//     addMessage(message, type) {
//         const msgObj = {
//             id: Date.now(),
//             message,
//             type,
//             timestamp: new Date().toISOString(),
//             relatedTo: this.findRelatedMessages(message)
//         };
//         this.messages.push(msgObj);
//         if (['rainforest', 'jungle', 'amazon'].some(k => message.toLowerCase().includes(k))) {
//             this.rainforestRelated = true;
//         }
//         return msgObj;
//     }

//     findRelatedMessages(message) {
//         return this.messages
//             .filter(m => m.message.toLowerCase().split(' ').some(word => 
//                 message.toLowerCase().includes(word) && word.length > 3))
//             .map(m => m.id);
//     }

//     getContext() {
//         return {
//             messages: this.messages,
//             rainforestRelated: this.rainforestRelated,
//             connections: this.getConnections()
//         };
//     }

//     getConnections() {
//         return this.messages
//             .filter(m => m.relatedTo.length > 0)
//             .map(m => ({
//                 current: m.message.substring(0, 30) + '...',
//                 related: m.relatedTo.map(id => 
//                     this.messages.find(msg => msg.id === id)?.message.substring(0, 30) + '...')
//             }));
//     }

//     reset() {
//         this.messages = [];
//         this.rainforestRelated = false;
//     }
// }

// class NextAiAIApp {
//     constructor() {
//         this.authMiddleware = new AuthMiddleware();
//         this.currentChatId = null;
//         this.isSidebarCollapsed = false;
//         this.maxChatsPerDay = 4;
//         this.maxQuestionsPerChat = 5;
//         this.initElements();
//         this.setupEventListeners();
//         this.initializeTheme();
//         this.checkAuthentication();

//         const today = new Date().toDateString();
//         if (!getCookie('lastChatDate') || getCookie('lastChatDate') !== today) {
//             setCookie('lastChatDate', today, 1);
//             setCookie('dailyChatCount', '0', 1);
//         }

//         this.observer = new IntersectionObserver((entries) => {
//             entries.forEach(entry => {
//                 if (entry.isIntersecting) {
//                     entry.target.classList.add('visible');
//                 }
//             });
//         }, { threshold: 0.1 });
//     }

//     initElements() {
//         this.sidebarEl = document.getElementById('sidebar');
//         this.chatContainerEl = document.getElementById('chatContainer');
//         this.chatMessagesEl = document.getElementById('chatMessages');
//         this.messageInputEl = document.getElementById('userInput');
//         this.chatTitleEl = document.createElement('h2');
//         this.chatHistoryEl = document.getElementById('chatHistory');
//         this.contextModalEl = document.getElementById('contextModal');
//         this.loginModalEl = document.getElementById('loginModal');
//         this.loginFormEl = document.getElementById('loginForm');
//         this.loginErrorEl = document.getElementById('loginError');
//         this.hamburgerBtn = document.getElementById('sidebarToggle');
//         this.logoutBtn = document.getElementById('logoutBtn');
//         this.chatInputEl = document.getElementById('chatForm');
//         this.loadingIndicator = document.getElementById('loadingIndicator');
//         this.newChatBtn = document.getElementById('newChatBtn');
//         this.themeToggle = document.getElementById('themeToggle');
//     }

//     setupEventListeners() {
//         this.hamburgerBtn.addEventListener('click', () => this.toggleSidebarMobile());
//         this.themeToggle.addEventListener('click', () => {
//             const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
//             this.applyTheme(currentTheme === 'light' ? 'dark' : 'light');
//             gsap.fromTo('body', { opacity: 0.8 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
//         });
//         this.newChatBtn.addEventListener('click', () => this.startNewChat());
//         this.contextModalEl.querySelector('.close-modal').addEventListener('click', () => {
//             gsap.to(this.contextModalEl, { opacity: 0, duration: 0.2, ease: 'power2.in', onComplete: () => this.contextModalEl.classList.add('hidden') });
//         });
//         this.chatInputEl.addEventListener('submit', (e) => {
//             e.preventDefault();
//             this.sendMessage();
//         });
//         this.messageInputEl.addEventListener('input', function() {
//             this.style.height = 'auto';
//             const newHeight = Math.min(this.scrollHeight, 150);
//             this.style.height = newHeight + 'px';
//         });
//         this.logoutBtn.addEventListener('click', () => {
//             this.authMiddleware.logout();
//             this.chatHistoryManager.clearChats();
//             this.showLoginModal();
//         });
//         this.loginFormEl.addEventListener('submit', (e) => {
//             e.preventDefault();
//             this.handleLogin();
//         });
//         this.chatHistoryEl.addEventListener('click', (e) => {
//             const chatItem = e.target.closest('.chat-item');
//             if (!chatItem) return;
//             const chatId = chatItem.dataset.chatId;
//             if (e.target.closest('.rename-btn')) {
//                 this.renameChat(chatId);
//             } else if (e.target.closest('.delete-btn')) {
//                 this.deleteChat(chatId);
//             } else {
//                 this.loadChat(chatId);
//             }
//         });
//     }

//     initializeTheme() {
//         const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
//         this.applyTheme(savedTheme);
//     }

//     applyTheme(theme) {
//         document.documentElement.classList.toggle('dark', theme === 'dark');
//         localStorage.setItem('theme', theme);
//     }

//     checkAuthentication() {
//         if (this.authMiddleware.checkAuth()) {
//             this.chatHistoryManager = new ChatHistoryManager(this.authMiddleware.getUser());
//             this.contextTracker = new ContextTracker();
//             this.showChatInterface();
//             this.renderChatHistory();
//             if (!this.currentChatId) this.startNewChat();
//         } else {
//             this.showLoginModal();
//         }
//     }

//     showChatInterface() {
//         this.sidebarEl.style.display = 'block';
//         this.chatContainerEl.style.display = 'flex';
//         this.loginModalEl.classList.add('hidden');
//     }

//     showLoginModal() {
//         this.sidebarEl.style.display = 'none';
//         this.chatContainerEl.style.display = 'none';
//         this.loginModalEl.classList.remove('hidden');
//     }

//     handleLogin() {
//         const username = document.getElementById('username').value;
//         const password = document.getElementById('password').value;
//         if (this.authMiddleware.login(username, password)) {
//             const previousUser = localStorage.getItem('currentUser');
//             if (previousUser && previousUser !== username) {
//                 localStorage.removeItem(`chatHistory_${previousUser}`);
//             }
//             this.chatHistoryManager = new ChatHistoryManager(username);
//             this.contextTracker = new ContextTracker();
//             this.showChatInterface();
//             this.renderChatHistory();
//         } else {
//             this.loginErrorEl.classList.remove('hidden');
//         }
//     }

//     toggleSidebarMobile() {
//         if (window.innerWidth <= 1024) {
//             this.sidebarEl.classList.toggle('open');
//             this.isSidebarCollapsed = !this.sidebarEl.classList.contains('open');
//             if (this.sidebarEl.classList.contains('open')) {
//                 gsap.to(this.sidebarEl, { x: 0, duration: 0.3, ease: 'power2.out' });
//             } else {
//                 gsap.to(this.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
//             }
//         }
//     }

//     renderChatHistory() {
//         const chats = Object.values(this.chatHistoryManager.chats)
//             .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
//         this.chatHistoryEl.innerHTML = '<h2 class="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400 font-semibold mb-2">Recent Chats</h2>';
//         const chatList = document.createElement('div');
//         chatList.className = 'space-y-1';
//         chats.forEach(chat => {
//             const chatItem = document.createElement('div');
//             chatItem.className = 'chat-item w-full text-left p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-dark-100 transition-colors duration-150 truncate flex justify-between items-center';
//             chatItem.dataset.chatId = chat.id;
//             chatItem.innerHTML = `
//                 <span>${chat.title} (${chat.questionCount}/${this.maxQuestionsPerChat})</span>
//                 <div class="chat-actions flex gap-2">
//                     <button class="rename-btn text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
//                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
//                         </svg>
//                     </button>
//                     <button class="delete-btn text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
//                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5-4h4M9 7h6" />
//                         </svg>
//                     </button>
//                 </div>
//             `;
//             chatList.appendChild(chatItem);
//         });
//         this.chatHistoryEl.appendChild(chatList);
//     }

//     async sendMessage() {
//         if (!this.authMiddleware.checkAuth()) {
//             this.showLoginModal();
//             return;
//         }

//         const message = this.messageInputEl.value.trim();
//         if (!message || !this.currentChatId) return;

//         const chat = this.chatHistoryManager.getChat(this.currentChatId);
//         if (chat.questionCount >= this.maxQuestionsPerChat) {
//             this.addMessage(`You've reached the limit of ${this.maxQuestionsPerChat} questions for this chat. Start a new chat!`, 'ai');
//             return;
//         }

//         this.addMessage(message, 'user');
//         const userMsg = this.contextTracker.addMessage(message, 'user');
//         this.messageInputEl.value = '';
//         this.messageInputEl.style.height = 'auto';
//         this.showTypingIndicator();

//         try {
//             const aiResponse = await this.generateAIResponse(message);
//             this.hideTypingIndicator();
//             this.addMessage(aiResponse, 'ai', this.contextTracker.rainforestRelated);
//             const aiMsg = this.contextTracker.addMessage(aiResponse, 'ai');

//             chat.messages.push(userMsg, aiMsg);
//             this.chatHistoryManager.incrementQuestionCount(this.currentChatId);
//             if (chat.messages.length === 2) {
//                 chat.title = this.chatHistoryManager.generateTitle(chat.messages);
//             }
//             this.chatHistoryManager.save();
//             this.renderChatHistory();
//         } catch (error) {
//             this.handleError(error);
//         }
//     }

//     async generateAIResponse(message) {
//         const API_KEY = 'AIzaSyDzCA-X2BzVlJo9A7n6lI8PXKCZtCBN1Oc'; // Replace with your Gemini API key
//         if (!API_KEY) {
//             return "API key missing. Here's a placeholder response...";
//         }

//         const context = this.contextTracker.getContext();
//         let prompt = message;
//         if (context.messages.length > 0) {
//             prompt = `Previous conversation:\n${context.messages.map(m => 
//                 `${m.type === 'user' ? 'Q' : 'A'}: ${m.message}`).join('\n')}\nCurrent question: ${message}`;
//         }
//         if (context.rainforestRelated) {
//             prompt += '\nFocus on rainforest-related information.';
//         }

//         const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`, {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({
//                 contents: [{ parts: [{ text: prompt }] }]
//             })
//         });
//         const data = await response.json();
//         return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response generated';
//     }

//     addMessage(content, type, isRainforest = false) {
//         const messageDiv = document.createElement('div');
//         messageDiv.className = `message-bubble flex items-start gap-4 ${type === 'user' ? 'justify-end' : ''}`;
//         if (isRainforest) messageDiv.classList.add('rainforest-message');

//         if (type === 'user') {
//             messageDiv.innerHTML = `
//                 <div class="flex-1 max-w-[80%]">
//                     <div class="bg-primary-600 text-white p-4 rounded-lg shadow-sm">
//                         <p>${content}</p>
//                     </div>
//                 </div>
//                 <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-700 dark:text-gray-300">
//                     <span class="text-sm font-medium">U</span>
//                 </div>
//             `;
//         } else {
//             messageDiv.innerHTML = `
//                 <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center text-white">
//                     <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
//                     </svg>
//                 </div>
//                 <div class="flex-1">
//                     <div class="bg-gray-100 dark:bg-dark-200 p-4 rounded-lg shadow-sm">
//                         <p class="text-gray-800 dark:text-gray-200 typing-animation">${content}</p>
//                     </div>
//                 </div>
//             `;
//             setTimeout(() => {
//                 const messageText = messageDiv.querySelector('.typing-animation');
//                 if (messageText) applyTypingAnimation(messageText);
//             }, 100);
//         }

//         if (this.loadingIndicator.parentNode === this.chatMessagesEl) {
//             this.chatMessagesEl.insertBefore(messageDiv, this.loadingIndicator);
//         } else {
//             this.chatMessagesEl.appendChild(messageDiv);
//         }
//         this.observer.observe(messageDiv);
//         this.scrollToBottom();
//     }

//     startNewChat() {
//         if (!this.authMiddleware.checkAuth()) {
//             this.showLoginModal();
//             return;
//         }

//         const today = new Date();
//         let dailyChatCount = parseInt(getCookie('dailyChatCount') || '0');
//         const storedChatCount = this.chatHistoryManager.getDailyChatCount(today);

//         if (dailyChatCount >= this.maxChatsPerDay || storedChatCount >= this.maxChatsPerDay) {
//             this.addMessage(`You've reached the daily limit of ${this.maxChatsPerDay} new chats. Try again tomorrow!`, 'ai');
//             return;
//         }

//         if (this.currentChatId && this.contextTracker.messages.length > 0) {
//             const chat = this.chatHistoryManager.chats[this.currentChatId];
//             chat.title = this.chatHistoryManager.generateTitle(chat.messages);
//             this.chatHistoryManager.save();
//         }

//         const newChatId = this.chatHistoryManager.addChat('🌿 New Chat');
//         this.currentChatId = newChatId;
//         this.contextTracker.reset();
//         this.chatMessagesEl.innerHTML = `
//             <div class="message-bubble flex items-start gap-4">
//                 <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center text-white">
//                     <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                         <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
//                     </svg>
//                 </div>
//                 <div class="flex-1">
//                     <div class="bg-gray-100 dark:bg-dark-200 p-4 rounded-lg shadow-sm">
//                         <p class="text-gray-800 dark:text-gray-200">Hello! I'm NextAiAI. Ask me up to ${this.maxQuestionsPerChat} questions in this chat!</p>
//                     </div>
//                 </div>
//             </div>
//         `;
//         dailyChatCount++;
//         setCookie('dailyChatCount', dailyChatCount.toString(), 1);
//         this.renderChatHistory();
//         if (window.innerWidth <= 1024) {
//             this.sidebarEl.classList.remove('open');
//             gsap.to(this.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
//         }
//     }

//     loadChat(chatId) {
//         if (!this.authMiddleware.checkAuth()) {
//             this.showLoginModal();
//             return;
//         }

//         const chat = this.chatHistoryManager.getChat(chatId);
//         if (!chat) return;

//         this.currentChatId = chatId;
//         this.contextTracker.reset();
//         this.chatMessagesEl.innerHTML = '';
//         chat.messages.forEach(msg => {
//             this.addMessage(msg.message, msg.type, this.contextTracker.rainforestRelated);
//             this.contextTracker.addMessage(msg.message, msg.type);
//         });

//         if (window.innerWidth <= 1024) {
//             this.sidebarEl.classList.remove('open');
//             gsap.to(this.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
//         }
//     }

//     renameChat(chatId) {
//         if (!this.authMiddleware.checkAuth()) {
//             this.showLoginModal();
//             return;
//         }

//         const chat = this.chatHistoryManager.getChat(chatId);
//         if (!chat) return;

//         const newTitle = prompt('Enter new chat title:', chat.title);
//         if (newTitle && newTitle.trim()) {
//             this.chatHistoryManager.renameChat(chatId, newTitle.trim());
//             this.renderChatHistory();
//         }
//     }

//     deleteChat(chatId) {
//         if (!this.authMiddleware.checkAuth()) {
//             this.showLoginModal();
//             return;
//         }

//         const chat = this.chatHistoryManager.getChat(chatId);
//         if (!chat) return;

//         this.chatHistoryManager.deleteChat(chatId);
//         this.renderChatHistory();
//         if (this.currentChatId === chatId) {
//             this.currentChatId = null;
//             this.contextTracker.reset();
//             this.chatMessagesEl.innerHTML = `
//                 <div class="message-bubble flex items-start gap-4">
//                     <div class="w-8 h-8 rounded-full flex-shrink-0 bg-gradient-to-r from-primary-500 to-secondary-500 flex items-center justify-center text-white">
//                         <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//                             <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
//                         </svg>
//                     </div>
//                     <div class="flex-1">
//                         <div class="bg-gray-100 dark:bg-dark-200 p-4 rounded-lg shadow-sm">
//                             <p class="text-gray-800 dark:text-gray-200">Welcome to NextAiAI! Start a new chat!</p>
//                         </div>
//                     </div>
//                 </div>
//             `;
//         }
//     }

//     showContextModal() {
//         if (!this.authMiddleware.checkAuth()) {
//             this.showLoginModal();
//             return;
//         }

//         const context = this.contextTracker.getContext();
//         document.getElementById('contextDetails').innerHTML = `
//             <h4>Conversation Context</h4>
//             <p>Messages: ${context.messages.length}</p>
//             ${context.rainforestRelated ? '<p>Rainforest Context Active</p>' : ''}
//             <h5>Connections:</h5>
//             <ul>${context.connections.map(c => `
//                 <li>${c.current} → ${c.related.join(', ')}</li>
//             `).join('')}</ul>
//         `;
//         this.contextModalEl.classList.remove('hidden');
//         gsap.fromTo(this.contextModalEl, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out' });
//     }

//     showTypingIndicator() {
//         this.loadingIndicator.style.display = 'flex';
//         setTimeout(() => this.loadingIndicator.classList.add('visible'), 10);
//         this.scrollToBottom();
//     }

//     hideTypingIndicator() {
//         this.loadingIndicator.style.display = 'none';
//         this.loadingIndicator.classList.remove('visible');
//     }

//     scrollToBottom() {
//         this.chatContainerEl.scrollTop = this.chatContainerEl.scrollHeight;
//     }

//     handleError(error) {
//         console.error('Error:', error);
//         this.hideTypingIndicator();
//         this.addMessage('Oops! Something went wrong. Try again?', 'ai');
//     }
// }

// function applyTypingAnimation(element) {
//     const text = element.textContent;
//     element.textContent = '';
//     element.classList.remove('typing-animation');
//     let i = 0;
//     const typingSpeed = 20;

//     function typeChar() {
//         if (i < text.length) {
//             element.textContent += text.charAt(i);
//             i++;
//             setTimeout(typeChar, typingSpeed);
//             if (i % 3 === 0) window.NextAiApp.scrollToBottom();
//         } else {
//             const cursor = document.createElement('span');
//             cursor.className = 'typing-cursor';
//             element.appendChild(cursor);
//             setTimeout(() => cursor.parentNode?.removeChild(cursor), 3000);
//         }
//     }
//     typeChar();
// }

// document.addEventListener('DOMContentLoaded', () => {
//     window.NextAiApp = new NextAiAIApp();
//     window.NextAiApp.messageInputEl.focus();
//     gsap.from('.message-bubble', {
//         y: 20,
//         opacity: 0,
//         duration: 0.5,
//         stagger: 0.2,
//         ease: 'power2.out'
//     });
// });

// document.addEventListener('click', (e) => {
//     if (window.innerWidth < 1024 && 
//         window.NextAiApp.sidebarEl.classList.contains('open') && 
//         !window.NextAiApp.sidebarEl.contains(e.target) && 
//         e.target !== window.NextAiApp.hamburgerBtn &&
//         !window.NextAiApp.hamburgerBtn.contains(e.target)) {
//         window.NextAiApp.sidebarEl.classList.remove('open');
//         gsap.to(window.NextAiApp.sidebarEl, { x: '-100%', duration: 0.3, ease: 'power2.in' });
//     }
// });