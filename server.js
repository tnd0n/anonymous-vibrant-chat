const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// In-memory database (JSON file for persistence)
const dbPath = path.join(__dirname, 'database.json');
let chatData = {
    users: new Map(),
    messages: [],
    privateChats: new Map(),
    likes: new Map()
};

// Load existing data if available
function loadDatabase() {
    try {
        if (fs.existsSync(dbPath)) {
            const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            chatData.messages = data.messages || [];
            chatData.likes = new Map(data.likes || []);
            chatData.privateChats = new Map(data.privateChats || []);
        }
    } catch (error) {
        console.log('Starting with fresh database');
    }
}

// Save data to file
function saveDatabase() {
    try {
        const dataToSave = {
            messages: chatData.messages.slice(-100), // Keep last 100 messages
            likes: Array.from(chatData.likes.entries()),
            privateChats: Array.from(chatData.privateChats.entries())
        };
        fs.writeFileSync(dbPath, JSON.stringify(dataToSave, null, 2));
    } catch (error) {
        console.error('Failed to save database:', error);
    }
}

// Initialize database
loadDatabase();

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Serve main page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/messages', (req, res) => {
    res.json(chatData.messages.slice(-50)); // Last 50 messages
});

app.get('/api/users', (req, res) => {
    const users = Array.from(chatData.users.values()).map(user => ({
        nickname: user.nickname,
        status: user.status,
        joinTime: user.joinTime
    }));
    res.json(users);
});

// Admin route to remove messages (simple password protection)
app.delete('/api/messages/:messageId', (req, res) => {
    const { messageId } = req.params;
    const { adminPassword } = req.body;

    if (adminPassword !== 'admin123') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    chatData.messages = chatData.messages.filter(msg => msg.id !== messageId);
    saveDatabase();

    // Notify all clients about message removal
    io.emit('messageRemoved', { messageId });

    res.json({ success: true });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // User joins with nickname
    socket.on('joinChat', (data) => {
        const { nickname } = data;

        // Check if nickname is already taken
        const existingUser = Array.from(chatData.users.values()).find(user => user.nickname === nickname);
        if (existingUser) {
            socket.emit('nicknameError', { message: 'Nickname already taken' });
            return;
        }

        // Add user to active users
        chatData.users.set(socket.id, {
            nickname,
            socketId: socket.id,
            status: 'online',
            joinTime: new Date().toISOString()
        });

        socket.nickname = nickname;

        // Notify user of successful join
        socket.emit('joinSuccess', { nickname });

        // Send recent messages to new user
        socket.emit('recentMessages', chatData.messages.slice(-50));

        // Send current user list
        const users = Array.from(chatData.users.values()).map(user => ({
            nickname: user.nickname,
            status: user.status
        }));
        socket.emit('userList', users);

        // Notify all users about new user
        socket.broadcast.emit('userJoined', { nickname });
        io.emit('userListUpdate', users);

        console.log(`${nickname} joined the chat`);
    });

    // Handle public messages
    socket.on('sendMessage', (data) => {
        if (!socket.nickname) return;

        const message = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            nickname: socket.nickname,
            content: data.content,
            timestamp: new Date().toISOString(),
            type: 'public'
        };

        chatData.messages.push(message);
        saveDatabase();

        // Broadcast message to all users
        io.emit('newMessage', message);

        console.log(`${socket.nickname}: ${data.content}`);
    });

    // Handle private messages
    socket.on('sendPrivateMessage', (data) => {
        if (!socket.nickname) return;

        const { targetNickname, content } = data;
        const targetUser = Array.from(chatData.users.values()).find(user => user.nickname === targetNickname);

        if (!targetUser) return;

        const message = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            from: socket.nickname,
            to: targetNickname,
            content,
            timestamp: new Date().toISOString(),
            type: 'private'
        };

        // Send to both users
        socket.emit('newPrivateMessage', message);
        io.to(targetUser.socketId).emit('newPrivateMessage', message);

        console.log(`Private: ${socket.nickname} to ${targetNickname}: ${content}`);
    });

    // Handle likes
    socket.on('likeUser', (data) => {
        if (!socket.nickname) return;

        const { targetNickname } = data;
        const likeKey = `${socket.nickname}_${targetNickname}`;
        const reverseKey = `${targetNickname}_${socket.nickname}`;

        // Add like
        chatData.likes.set(likeKey, true);

        // Check if it's a mutual like
        if (chatData.likes.has(reverseKey)) {
            // Create private chat room
            const chatRoomId = [socket.nickname, targetNickname].sort().join('_');
            chatData.privateChats.set(chatRoomId, {
                users: [socket.nickname, targetNickname],
                createdAt: new Date().toISOString()
            });

            // Notify both users about mutual like
            const targetUser = Array.from(chatData.users.values()).find(user => user.nickname === targetNickname);
            if (targetUser) {
                socket.emit('mutualLike', { nickname: targetNickname, chatRoomId });
                io.to(targetUser.socketId).emit('mutualLike', { nickname: socket.nickname, chatRoomId });
            }

            console.log(`Mutual like: ${socket.nickname} and ${targetNickname}`);
        } else {
            // Just notify about the like
            const targetUser = Array.from(chatData.users.values()).find(user => user.nickname === targetNickname);
            if (targetUser) {
                io.to(targetUser.socketId).emit('likeReceived', { from: socket.nickname });
            }
        }

        saveDatabase();
    });

    // Handle typing indicators
    socket.on('typing', (data) => {
        if (!socket.nickname) return;
        socket.broadcast.emit('userTyping', { nickname: socket.nickname, isTyping: data.isTyping });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        if (socket.nickname) {
            chatData.users.delete(socket.id);

            // Notify all users about user leaving
            socket.broadcast.emit('userLeft', { nickname: socket.nickname });

            // Send updated user list
            const users = Array.from(chatData.users.values()).map(user => ({
                nickname: user.nickname,
                status: user.status
            }));
            io.emit('userListUpdate', users);

            console.log(`${socket.nickname} left the chat`);
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Anonymous Chat Server running on port ${PORT}`);
    console.log(`📱 Access at: http://localhost:${PORT}`);
});

// Save database periodically
setInterval(saveDatabase, 30000); // Save every 30 seconds
