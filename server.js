/**
 * Bridge Chat Backend
 * Cross-platform WhatsApp & Telegram bridge API
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

// ============================================
// In-Memory Data Store
// ============================================
const store = {
  users: new Map(),          // userId -> user
  sessions: new Map(),       // sessionId -> { platform, status, qrData, userId, expiresAt }
  chats: new Map(),          // chatId -> chat
  messages: new Map(),       // chatId -> [messages]
  tempRooms: new Map(),      // tempRoomId -> { id, expiresAt, createdBy, participants }
};

// Seed some demo users
const seedUsers = () => {
  const demoUsers = [
    { id: 'wa_001', platform: 'whatsapp', platformId: '+14155552671', displayName: 'Alice Johnson', crossPlatformId: '@alice_wa', avatar: 'AJ', online: true },
    { id: 'wa_002', platform: 'whatsapp', platformId: '+14155552672', displayName: 'Bob Smith', crossPlatformId: '@bob_wa', avatar: 'BS', online: false },
    { id: 'tg_001', platform: 'telegram', platformId: '@alice_tg', displayName: 'Charlie Davis', crossPlatformId: '+1-415-555-2673', avatar: 'CD', online: true },
    { id: 'tg_002', platform: 'telegram', platformId: '@bob_tg', displayName: 'Diana Prince', crossPlatformId: '+1-415-555-2674', avatar: 'DP', online: true },
  ];
  demoUsers.forEach(u => store.users.set(u.id, u));
};
seedUsers();

// ============================================
// Helper Functions
// ============================================
const generateCrossPlatformId = (platform) => {
  const random = Math.random().toString(36).substring(2, 8);
  if (platform === 'whatsapp') {
    return `@user_${random}`; // Telegram-style handle
  } else {
    return `+1${Math.floor(2000000000 + Math.random() * 999999999)}`.substring(0, 12); // WhatsApp-style phone
  }
};

const generateSessionId = () => uuidv4();
const generateChatId = () => `chat_${uuidv4().substring(0, 8)}`;
const generateTempId = () => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
};

// WebSocket connections
const wsClients = new Map(); // userId -> ws

const broadcast = (event, data, excludeUserId = null) => {
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.userId !== excludeUserId) {
      client.send(JSON.stringify({ event, data, timestamp: Date.now() }));
    }
  });
};

const sendToUser = (userId, event, data) => {
  wss.clients.forEach(client => {
    if (client.readyState === 1 && client.userId === userId) {
      client.send(JSON.stringify({ event, data, timestamp: Date.now() }));
    }
  });
};

// ============================================
// REST API Routes
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', users: store.users.size, chats: store.chats.size });
});

// ---- Auth / Session ----

// Generate QR for WhatsApp login
app.post('/api/auth/whatsapp/qr', async (req, res) => {
  try {
    const sessionId = generateSessionId();
    const qrToken = `wa://login?session=${sessionId}&t=${Date.now()}`;
    const qrDataUrl = await QRCode.toDataURL(qrToken, { width: 300, margin: 2 });

    store.sessions.set(sessionId, {
      platform: 'whatsapp',
      status: 'pending',
      qrToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000, // 60 seconds
    });

    res.json({ sessionId, qrDataUrl, expiresIn: 60 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate QR for Telegram login
app.post('/api/auth/telegram/qr', async (req, res) => {
  try {
    const sessionId = generateSessionId();
    const qrToken = `tg://login?session=${sessionId}&t=${Date.now()}`;
    const qrDataUrl = await QRCode.toDataURL(qrToken, { width: 300, margin: 2 });

    store.sessions.set(sessionId, {
      platform: 'telegram',
      status: 'pending',
      qrToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    });

    res.json({ sessionId, qrDataUrl, expiresIn: 60 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check session status (for QR polling)
app.get('/api/auth/session/:sessionId', (req, res) => {
  const session = store.sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  // Auto-expire
  if (Date.now() > session.expiresAt && session.status === 'pending') {
    session.status = 'expired';
  }

  res.json({ status: session.status, platform: session.platform, userId: session.userId });
});

// Simulate scan & login (for demo)
app.post('/api/auth/session/:sessionId/scan', (req, res) => {
  const session = store.sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.status === 'expired') return res.status(400).json({ error: 'Session expired' });

  // Create or get a demo user
  const platform = session.platform;
  const userId = `${platform === 'whatsapp' ? 'wa' : 'tg'}_${Date.now()}`;
  const crossId = generateCrossPlatformId(platform);
  const platformId = platform === 'whatsapp'
    ? `+1${Math.floor(2000000000 + Math.random() * 999999999)}`.substring(0, 12)
    : `@user_${Math.random().toString(36).substring(2, 8)}`;

  const user = {
    id: userId,
    platform,
    platformId,
    displayName: `User ${userId.substring(3, 7)}`,
    crossPlatformId: crossId,
    avatar: userId.substring(3, 5).toUpperCase(),
    online: true,
    createdAt: Date.now(),
  };

  store.users.set(userId, user);
  session.status = 'authenticated';
  session.userId = userId;

  res.json({ user, sessionId });
});

// Phone number login
app.post('/api/auth/phone', (req, res) => {
  const { phone, platform } = req.body;
  if (!phone || !platform) return res.status(400).json({ error: 'phone and platform required' });

  const userId = `${platform === 'whatsapp' ? 'wa' : 'tg'}_${Date.now()}`;
  const crossId = generateCrossPlatformId(platform);

  const user = {
    id: userId,
    platform,
    platformId: platform === 'whatsapp' ? phone : `@user_${phone.substring(-6)}`,
    displayName: `User ${userId.substring(3, 7)}`,
    crossPlatformId: crossId,
    avatar: userId.substring(3, 5).toUpperCase(),
    online: true,
    createdAt: Date.now(),
  };

  store.users.set(userId, user);
  res.json({ user });
});

// ---- Users ----
app.get('/api/users/me', (req, res) => {
  const userId = req.headers['x-user-id'];
  const user = store.users.get(userId);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  res.json(user);
});

app.get('/api/users', (req, res) => {
  res.json(Array.from(store.users.values()));
});

app.get('/api/users/:id', (req, res) => {
  const user = store.users.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.put('/api/users/:id/online', (req, res) => {
  const user = store.users.get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.online = req.body.online;
  broadcast('user_status', { userId: user.id, online: user.online });
  res.json(user);
});

// ---- Chats ----
app.get('/api/chats', (req, res) => {
  const userId = req.headers['x-user-id'];
  const userChats = Array.from(store.chats.values()).filter(c =>
    c.participants.includes(userId)
  );
  // Sort by last message
  userChats.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));
  res.json(userChats);
});

app.get('/api/chats/:id/messages', (req, res) => {
  const messages = store.messages.get(req.params.id) || [];
  res.json(messages);
});

app.post('/api/chats/:id/messages', (req, res) => {
  const chatId = req.params.id;
  const chat = store.chats.get(chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  const userId = req.headers['x-user-id'];
  const { text, type = 'text' } = req.body;

  const message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    chatId,
    senderId: userId,
    text,
    type,
    timestamp: Date.now(),
    status: 'sent',
  };

  if (!store.messages.has(chatId)) store.messages.set(chatId, []);
  store.messages.get(chatId).push(message);
  chat.lastMessageAt = message.timestamp;
  chat.lastMessage = text;

  // Broadcast via WebSocket
  chat.participants.forEach(participantId => {
    if (participantId !== userId) {
      sendToUser(participantId, 'new_message', { chatId, message });
    }
  });

  res.json(message);
});

app.post('/api/chats', (req, res) => {
  const userId = req.headers['x-user-id'];
  const { participantId } = req.body;

  // Check if chat exists
  const existing = Array.from(store.chats.values()).find(c =>
    c.participants.includes(userId) &&
    c.participants.includes(participantId) &&
    !c.tempId
  );

  if (existing) return res.json(existing);

  const chat = {
    id: generateChatId(),
    participants: [userId, participantId],
    type: 'direct',
    createdAt: Date.now(),
    lastMessageAt: Date.now(),
  };
  store.chats.set(chat.id, chat);
  res.json(chat);
});

// ---- Temp Chats ----
app.post('/api/temp', (req, res) => {
  const userId = req.headers['x-user-id'];
  const { durationMinutes = 60 } = req.body;

  const tempId = generateTempId();
  const chatId = generateChatId();
  const expiresAt = Date.now() + durationMinutes * 60 * 1000;

  const chat = {
    id: chatId,
    participants: [userId],
    type: 'temp',
    tempId,
    expiresAt,
    createdAt: Date.now(),
  };

  store.chats.set(chatId, chat);
  store.tempRooms.set(tempId, { id: tempId, chatId, expiresAt, createdBy: userId, participants: [userId] });

  res.json({ tempId, chatId, expiresAt, shareUrl: `/temp/${tempId}` });
});

app.get('/api/temp/:tempId', (req, res) => {
  const room = store.tempRooms.get(req.params.tempId);
  if (!room) return res.status(404).json({ error: 'Temp room not found' });
  if (Date.now() > room.expiresAt) return res.status(410).json({ error: 'Temp room expired' });
  res.json(room);
});

app.post('/api/temp/:tempId/join', (req, res) => {
  const userId = req.headers['x-user-id'];
  const room = store.tempRooms.get(req.params.tempId);
  if (!room) return res.status(404).json({ error: 'Temp room not found' });
  if (Date.now() > room.expiresAt) return res.status(410).json({ error: 'Temp room expired' });

  if (!room.participants.includes(userId)) {
    room.participants.push(userId);
    const chat = store.chats.get(room.chatId);
    if (chat && !chat.participants.includes(userId)) {
      chat.participants.push(userId);
    }
  }

  res.json(room);
});

// ============================================
// WebSocket Connection
// ============================================
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const { event, data } = JSON.parse(raw);
      if (event === 'auth') {
        ws.userId = data.userId;
        const user = store.users.get(data.userId);
        if (user) {
          user.online = true;
          broadcast('user_status', { userId: user.id, online: true });
        }
      } else if (event === 'typing') {
        const { chatId, isTyping } = data;
        const chat = store.chats.get(chatId);
        if (chat) {
          chat.participants.forEach(pid => {
            if (pid !== ws.userId) sendToUser(pid, 'typing', { chatId, userId: ws.userId, isTyping });
          });
        }
      }
    } catch (err) {
      console.error('WS message error:', err);
    }
  });

  ws.on('close', () => {
    if (ws.userId) {
      const user = store.users.get(ws.userId);
      if (user) {
        user.online = false;
        broadcast('user_status', { userId: user.id, online: false });
      }
    }
  });
});

// Clean expired temp rooms
setInterval(() => {
  const now = Date.now();
  store.tempRooms.forEach((room, id) => {
    if (now > room.expiresAt) {
      const chat = store.chats.get(room.chatId);
      if (chat) {
        broadcast('temp_expired', { chatId: room.chatId, tempId: id });
        store.chats.delete(room.chatId);
      }
      store.tempRooms.delete(id);
    }
  });
}, 30000);

// Serve frontend (when deployed together)
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🌉 Bridge Chat API running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready`);
});