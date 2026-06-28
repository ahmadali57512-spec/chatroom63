const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Restrict to your Vercel URL in production
    methods: ["GET", "POST"]
  }
});

// Hardcoded 4 users (username: password)
const VALID_USERS = {
  saad: 'password123',
  daniyal: 'password123',
  abdullah: 'password123',
  farhan: 'password123'
};

// In-memory state
const onlineUsers = new Map(); // socketId -> { username }

function getOnlineUsers() {
  return Array.from(onlineUsers.entries()).map(([socketId, data]) => ({
    socketId,
    username: data.username
  }));
}

function findSocketByUsername(username) {
  for (const [socketId, data] of onlineUsers) {
    if (data.username === username) {
      return io.sockets.sockets.get(socketId);
    }
  }
  return null;
}

io.on('connection', (socket) => {
  console.log(`🟢 New connection: ${socket.id}`);

  // ---- LOGIN ----
  socket.on('login', ({ username, password }) => {
    if (!VALID_USERS[username] || VALID_USERS[username] !== password) {
      socket.emit('login_failed', { message: 'Invalid credentials' });
      return;
    }

    // Kick existing session
    let existingSocketId = null;
    for (const [id, data] of onlineUsers) {
      if (data.username === username) {
        existingSocketId = id;
        break;
      }
    }
    if (existingSocketId) {
      const oldSocket = io.sockets.sockets.get(existingSocketId);
      if (oldSocket) {
        oldSocket.emit('kicked', { message: 'Logged in elsewhere' });
        oldSocket.disconnect(true);
      }
      onlineUsers.delete(existingSocketId);
    }

    onlineUsers.set(socket.id, { username });
    socket.data.username = username;

    socket.emit('login_success', {
      username,
      onlineUsers: getOnlineUsers()
    });
    io.emit('users_online', getOnlineUsers());
    console.log(`✅ ${username} logged in`);
  });

  // ---- PRIVATE MESSAGES (already encrypted) ----
  socket.on('private_message', ({ to, encryptedMessage, iv }) => {
    const targetSocket = findSocketByUsername(to);
    if (targetSocket) {
      targetSocket.emit('new_message', {
        from: socket.data.username,
        encryptedMessage,
        iv,
        timestamp: Date.now()
      });
      socket.emit('message_delivered', { to, timestamp: Date.now() });
    } else {
      socket.emit('message_undelivered', { to });
    }
  });
// ---- GROUP MESSAGES ----
socket.on('group_message', ({ encryptedMessage, iv }) => {
  const sender = socket.data.username;
  // Broadcast to ALL online users except sender
  for (const [socketId, data] of onlineUsers) {
    if (data.username !== sender) {
      const targetSocket = io.sockets.sockets.get(socketId);
      if (targetSocket) {
        targetSocket.emit('new_group_message', {
          from: sender,
          encryptedMessage,
          iv,
          timestamp: Date.now()
        });
      }
    }
  }
});
  // ---- READ RECEIPT ----
  socket.on('message_read', ({ from, messageId }) => {
    const targetSocket = findSocketByUsername(from);
    if (targetSocket) {
      targetSocket.emit('message_read_receipt', {
        from: socket.data.username,
        messageId
      });
    }
  });

  // ---- WEBRTC SIGNALING ----
  socket.on('call_user', ({ to, offer }) => {
    const targetSocket = findSocketByUsername(to);
    if (targetSocket) {
      targetSocket.emit('incoming_call', {
        from: socket.data.username,
        offer
      });
    }
  });

  socket.on('answer_call', ({ to, answer }) => {
    const targetSocket = findSocketByUsername(to);
    if (targetSocket) {
      targetSocket.emit('call_answered', {
        from: socket.data.username,
        answer
      });
    }
  });

  socket.on('ice_candidate', ({ to, candidate }) => {
    const targetSocket = findSocketByUsername(to);
    if (targetSocket) {
      targetSocket.emit('ice_candidate', {
        from: socket.data.username,
        candidate
      });
    }
  });

  socket.on('end_call', ({ to }) => {
    const targetSocket = findSocketByUsername(to);
    if (targetSocket) {
      targetSocket.emit('call_ended', { from: socket.data.username });
    }
  });

  // ---- DISCONNECT ----
  socket.on('disconnect', () => {
    const username = socket.data.username;
    if (username) {
      onlineUsers.delete(socket.id);
      io.emit('users_online', getOnlineUsers());
      console.log(`🔴 ${username} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
});