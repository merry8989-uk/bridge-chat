/**
 * Bridge Chat - Frontend App
 * Cross-platform WhatsApp & Telegram bridge
 *
 * Modes:
 * - "backend": Connects to Node.js API + WebSocket
 * - "demo": Local-only with localStorage + BroadcastChannel for cross-tab demo
 */

const APP = (() => {
  // ============================================
  // CONFIG
  // ============================================
  const CONFIG = {
    API_BASE: window.location.origin, // Same-origin by default
    WS_URL: window.location.origin.replace(/^http/, 'ws'),
    DEMO_MODE: true, // Toggle for demo vs backend
    POLL_INTERVAL: 1500,
  };

  // ============================================
  // STATE
  // ============================================
  const state = {
    me: null,
    chats: [],
    users: [],
    messages: {},         // chatId -> [messages]
    activeChatId: null,
    filter: 'all',
    searchQuery: '',
    qrSession: null,
    qrTimer: null,
    pollInterval: null,
    ws: null,
    channel: null,        // BroadcastChannel for demo
  };

  // ============================================
  // DEMO DATA (for local-only mode)
  // ============================================
  const DEMO_USERS = [
    { id: 'wa_001', platform: 'whatsapp', platformId: '+14155552671', displayName: 'Alice Johnson', crossPlatformId: '@alice_wa', avatar: 'AJ', online: true },
    { id: 'wa_002', platform: 'whatsapp', platformId: '+14155552672', displayName: 'Bob Smith', crossPlatformId: '@bob_wa', avatar: 'BS', online: false },
    { id: 'tg_001', platform: 'telegram', platformId: '@charlie_tg', displayName: 'Charlie Davis', crossPlatformId: '+1-415-555-2673', avatar: 'CD', online: true },
    { id: 'tg_002', platform: 'telegram', platformId: '@diana_tg', displayName: 'Diana Prince', crossPlatformId: '+1-415-555-2674', avatar: 'DP', online: true },
    { id: 'wa_003', platform: 'whatsapp', platformId: '+14155552675', displayName: 'Ethan Hunt', crossPlatformId: '@ethan_wa', avatar: 'EH', online: true },
    { id: 'tg_003', platform: 'telegram', platformId: '@fiona_tg', displayName: 'Fiona Chen', crossPlatformId: '+1-415-555-2676', avatar: 'FC', online: false },
  ];

  // ============================================
  // DEMO STORE (localStorage)
  // ============================================
  const demoStore = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(`bc_${key}`)); }
      catch { return null; }
    },
    set(key, value) {
      localStorage.setItem(`bc_${key}`, JSON.stringify(value));
    },
    remove(key) {
      localStorage.removeItem(`bc_${key}`);
    }
  };

  // ============================================
  // UTILITIES
  // ============================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'onclick') node.onclick = v;
      else if (k.startsWith('on')) node.addEventListener(k.substring(2).toLowerCase(), v);
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    });
    children.forEach(c => node.appendChild(c));
    return node;
  };

  const fmtTime = (ts) => {
    const d = new Date(ts);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return d.toLocaleDateString();
  };

  const fmtClock = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const fmtDateDivider = (ts) => {
    const d = new Date(ts);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString();
  };

  const uid = (prefix = 'id') => `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  const generateCrossId = (platform) => {
    const r = Math.random().toString(36).substring(2, 8);
    return platform === 'whatsapp' ? `@user_${r}` : `+1${Math.floor(2000000000 + Math.random() * 999999999)}`.substring(0, 12);
  };

  const generateTempCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  const toast = (msg, type = '') => {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    setTimeout(() => t.className = 'toast', 2500);
  };

  // ============================================
  // API LAYER (with demo fallback)
  // ============================================
  const api = {
    async checkBackend() {
      try {
        const r = await fetch(`${CONFIG.API_BASE}/api/health`, { method: 'GET' });
        if (!r.ok) return false;
        // Verify the response is actually JSON from our backend
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) return false;
        const data = await r.json();
        return data.status === 'ok';
      } catch { return false; }
    },

    async whatsappLogin() {
      if (CONFIG.DEMO_MODE) return this._demoLogin('whatsapp');
      // Real backend flow
      const r1 = await fetch(`${CONFIG.API_BASE}/api/auth/whatsapp/qr`, { method: 'POST' });
      const { sessionId, qrDataUrl, expiresIn } = await r1.json();
      return { sessionId, qrDataUrl, expiresIn, platform: 'whatsapp' };
    },

    async telegramLogin() {
      if (CONFIG.DEMO_MODE) return this._demoLogin('telegram');
      const r1 = await fetch(`${CONFIG.API_BASE}/api/auth/telegram/qr`, { method: 'POST' });
      const { sessionId, qrDataUrl, expiresIn } = await r1.json();
      return { sessionId, qrDataUrl, expiresIn, platform: 'telegram' };
    },

    _demoLogin(platform) {
      const sessionId = uid('sess');
      const qrData = `bridge://${platform}?session=${sessionId}`;
      // Generate a local SVG QR code as fallback (always works)
      const qrDataUrl = this._generateLocalQR(qrData);
      return { sessionId, qrDataUrl, expiresIn: 60, platform, demo: true };
    },

    _generateLocalQR(data) {
      // Simple visual placeholder QR - a deterministic pattern based on data hash
      // For demo purposes only - shows a QR-like pattern
      const hash = data.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
      const size = 21; // 21x21 QR grid
      const cells = [];
      // Create a pseudo-QR pattern with corners
      const isCorner = (x, y) => (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
      const isCornerBorder = (x, y) => {
        if (!isCorner(x, y)) return false;
        if (x === 0 || y === 0 || x === size - 1 || y === size - 1) return true;
        if (isCorner(x, y) && (x === 6 || y === 6)) return true;
        return false;
      };
      const isCornerInner = (x, y) => {
        if (!isCorner(x, y)) return false;
        return (x >= 2 && x <= 4 && y >= 2 && y <= 4) ||
               (x >= size - 5 && x <= size - 3 && y >= 2 && y <= 4) ||
               (x >= 2 && x <= 4 && y >= size - 5 && y <= size - 3);
      };
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const seed = Math.abs((hash * (x + 1) * (y + 1)) % 100);
          let fill = false;
          if (isCornerInner(x, y)) fill = true;
          else if (isCorner(x, y)) fill = (x === 1 || x === 5 || x === size - 2 || x === size - 6 ||
                                            y === 1 || y === 5 || y === size - 2 || y === size - 6);
          else if (isCornerBorder(x, y)) fill = true;
          else fill = seed > 50;
          if (fill) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
        }
      }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="300" height="300" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#000">${cells.join('')}</g></svg>`;
      return 'data:image/svg+xml;base64,' + btoa(svg);
    },

    async checkSession(sessionId) {
      if (CONFIG.DEMO_MODE) {
        return demoStore.get(`session_${sessionId}`) || { status: 'pending' };
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/auth/session/${sessionId}`);
      return r.json();
    },

    async simulateScan(sessionId, platform) {
      if (CONFIG.DEMO_MODE) {
        // Create the user
        const userId = `${platform === 'whatsapp' ? 'wa' : 'tg'}_${Date.now()}`;
        const crossId = generateCrossId(platform);
        const user = {
          id: userId,
          platform,
          platformId: platform === 'whatsapp'
            ? `+1${Math.floor(2000000000 + Math.random() * 999999999)}`.substring(0, 12)
            : `@user_${Math.random().toString(36).substring(2, 8)}`,
          displayName: `User ${userId.substring(3, 7)}`,
          crossPlatformId: crossId,
          avatar: userId.substring(3, 5).toUpperCase(),
          online: true,
          createdAt: Date.now(),
        };
        demoStore.set(`session_${sessionId}`, { status: 'authenticated', platform, userId });
        return { user, sessionId };
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/auth/session/${sessionId}/scan`, { method: 'POST' });
      return r.json();
    },

    async phoneLogin(phone, platform) {
      if (CONFIG.DEMO_MODE) {
        const userId = `${platform === 'whatsapp' ? 'wa' : 'tg'}_${Date.now()}`;
        const crossId = generateCrossId(platform);
        const user = {
          id: userId,
          platform,
          platformId: platform === 'whatsapp' ? phone : `@user_${phone.slice(-6)}`,
          displayName: `User ${userId.substring(3, 7)}`,
          crossPlatformId: crossId,
          avatar: userId.substring(3, 5).toUpperCase(),
          online: true,
          createdAt: Date.now(),
        };
        return { user };
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/auth/phone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, platform }),
      });
      return r.json();
    },

    async getChats() {
      if (CONFIG.DEMO_MODE) {
        const userId = state.me.id;
        const chats = demoStore.get('chats') || [];
        return chats.filter(c => c.participants.includes(userId));
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/chats`, { headers: { 'x-user-id': state.me.id } });
      return r.json();
    },

    async getMessages(chatId) {
      if (CONFIG.DEMO_MODE) {
        return demoStore.get(`msgs_${chatId}`) || [];
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/chats/${chatId}/messages`);
      return r.json();
    },

    async sendMessage(chatId, text) {
      if (CONFIG.DEMO_MODE) {
        const msg = {
          id: uid('msg'),
          chatId,
          senderId: state.me.id,
          text,
          timestamp: Date.now(),
          status: 'sent',
        };
        const msgs = demoStore.get(`msgs_${chatId}`) || [];
        msgs.push(msg);
        demoStore.set(`msgs_${chatId}`, msgs);
        // Update chat's last message
        const chats = demoStore.get('chats') || [];
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
          chat.lastMessage = text;
          chat.lastMessageAt = msg.timestamp;
          demoStore.set('chats', chats);
        }
        // Broadcast to other tabs
        broadcastEvent('new_message', { chatId, message: msg });
        return msg;
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/chats/${chatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': state.me.id },
        body: JSON.stringify({ text }),
      });
      return r.json();
    },

    async createChat(participantId) {
      if (CONFIG.DEMO_MODE) {
        const chats = demoStore.get('chats') || [];
        const existing = chats.find(c =>
          c.participants.includes(state.me.id) &&
          c.participants.includes(participantId) &&
          !c.tempId
        );
        if (existing) return existing;
        const chat = {
          id: uid('chat'),
          participants: [state.me.id, participantId],
          type: 'direct',
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
        };
        chats.push(chat);
        demoStore.set('chats', chats);
        return chat;
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': state.me.id },
        body: JSON.stringify({ participantId }),
      });
      return r.json();
    },

    async createTempChat(durationMinutes = 60) {
      const tempId = generateTempCode();
      const chatId = uid('chat');
      const expiresAt = Date.now() + durationMinutes * 60 * 1000;
      const chat = {
        id: chatId,
        participants: [state.me.id],
        type: 'temp',
        tempId,
        expiresAt,
        createdAt: Date.now(),
      };
      if (CONFIG.DEMO_MODE) {
        const chats = demoStore.get('chats') || [];
        chats.push(chat);
        demoStore.set('chats', chats);
        // Seed welcome message
        const welcomeMsg = {
          id: uid('msg'),
          chatId,
          senderId: 'system',
          text: `🔒 Temp chat created. Code: ${tempId}. Expires in ${durationMinutes} minutes. Share the code to invite participants.`,
          timestamp: Date.now(),
          status: 'sent',
        };
        demoStore.set(`msgs_${chatId}`, [welcomeMsg]);
        chat.lastMessage = welcomeMsg.text;
        chat.lastMessageAt = welcomeMsg.timestamp;
        demoStore.set('chats', chats);
        broadcastEvent('new_chat', { chat });
      }
      return { tempId, chatId, expiresAt, shareUrl: `/temp/${tempId}` };
    },

    async joinTempChat(tempId) {
      if (CONFIG.DEMO_MODE) {
        const chats = demoStore.get('chats') || [];
        const chat = chats.find(c => c.tempId === tempId);
        if (!chat) throw new Error('Temp room not found');
        if (Date.now() > chat.expiresAt) throw new Error('Temp room expired');
        if (!chat.participants.includes(state.me.id)) {
          chat.participants.push(state.me.id);
          demoStore.set('chats', chats);
          // System message
          const sysMsg = {
            id: uid('msg'),
            chatId: chat.id,
            senderId: 'system',
            text: `${state.me.displayName} joined the temp chat`,
            timestamp: Date.now(),
            status: 'sent',
          };
          const msgs = demoStore.get(`msgs_${chat.id}`) || [];
          msgs.push(sysMsg);
          demoStore.set(`msgs_${chat.id}`, msgs);
          chat.lastMessage = sysMsg.text;
          chat.lastMessageAt = sysMsg.timestamp;
          demoStore.set('chats', chats);
          broadcastEvent('new_chat', { chat });
        }
        return chat;
      }
      const r = await fetch(`${CONFIG.API_BASE}/api/temp/${tempId}/join`, {
        method: 'POST',
        headers: { 'x-user-id': state.me.id },
      });
      return r.json();
    },
  };

  // ============================================
  // BROADCAST CHANNEL (cross-tab demo)
  // ============================================
  const initBroadcast = () => {
    if (typeof BroadcastChannel === 'undefined') return;
    state.channel = new BroadcastChannel('bridge_chat');
    state.channel.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'login') {
        // Another tab logged in - load their session
        toast('New login detected - refreshing');
        location.reload();
      } else if (type === 'new_message' && state.activeChatId === payload.chatId) {
        loadMessages(payload.chatId);
      } else if (type === 'new_chat' || type === 'new_message') {
        loadChats();
      } else if (type === 'user_status') {
        const u = state.users.find(x => x.id === payload.userId);
        if (u) { u.online = payload.online; renderChatList(); }
      }
    };
  };

  const broadcastEvent = (type, payload) => {
    if (state.channel) state.channel.postMessage({ type, payload });
  };

  // ============================================
  // LOGIN FLOW
  // ============================================
  const initLogin = () => {
    // Tab switching
    $$('.login-tabs .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.login-tabs .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        $$('.login-panel').forEach(p => p.classList.remove('active'));
        $(`#${target}Panel`).classList.add('active');
      });
    });

    // Platform buttons
    $$('.platform-btn').forEach(btn => {
      btn.addEventListener('click', () => startQRLogin(btn.dataset.platform));
    });

    // Phone login
    $('#phoneLoginBtn').addEventListener('click', async () => {
      const phone = $('#phoneInput').value.trim();
      const platform = document.querySelector('input[name="phonePlatform"]:checked').value;
      if (!phone) { toast('Please enter a phone number', 'error'); return; }
      try {
        const { user } = await api.phoneLogin(phone, platform);
        completeLogin(user);
      } catch (err) {
        toast('Login failed: ' + err.message, 'error');
      }
    });

    // QR modal
    $('#qrModalClose').addEventListener('click', cancelQRLogin);
    $('#qrSimulateBtn').addEventListener('click', () => {
      if (state.qrSession) simulateQRScan(state.qrSession.sessionId, state.qrSession.platform);
    });
  };

  const startQRLogin = async (platform) => {
    try {
      const session = await (platform === 'whatsapp' ? api.whatsappLogin() : api.telegramLogin());
      state.qrSession = session;

      // Show modal
      const modal = $('#qrModal');
      const title = $('#qrModalTitle');
      title.textContent = `Scan with ${platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'}`;
      const display = $('#qrDisplay');
      display.innerHTML = `<img src="${session.qrDataUrl}" alt="QR Code">`;

      modal.classList.add('active');

      // Start countdown
      let remaining = session.expiresIn;
      const timerEl = $('#qrTimer');
      const updateTimer = () => {
        timerEl.innerHTML = `Expires in <strong>${remaining}</strong>s`;
        if (remaining <= 0) {
          clearInterval(state.qrTimer);
          $('#qrStatus').innerHTML = '<div class="status-dot"></div><span>Expired</span>';
        }
        remaining--;
      };
      updateTimer();
      state.qrTimer = setInterval(updateTimer, 1000);

      // Poll for session status (or simulate)
      if (!session.demo) {
        state.pollInterval = setInterval(async () => {
          const status = await api.checkSession(session.sessionId);
          if (status.status === 'authenticated') {
            clearInterval(state.pollInterval);
            // Get user
            const user = state.users.find(u => u.id === status.userId) || DEMO_USERS[0];
            completeLogin(user);
          }
        }, CONFIG.POLL_INTERVAL);
      }
    } catch (err) {
      toast('Failed to start login: ' + err.message, 'error');
    }
  };

  const simulateQRScan = async (sessionId, platform) => {
    try {
      const { user } = await api.simulateScan(sessionId, platform);
      completeLogin(user);
    } catch (err) {
      toast('Scan failed: ' + err.message, 'error');
    }
  };

  const cancelQRLogin = () => {
    $('#qrModal').classList.remove('active');
    if (state.qrTimer) clearInterval(state.qrTimer);
    if (state.pollInterval) clearInterval(state.pollInterval);
    state.qrSession = null;
  };

  const completeLogin = (user) => {
    state.me = user;
    demoStore.set('me', user);
    cancelQRLogin();
    broadcastEvent('login', { userId: user.id });
    showApp();
    toast(`Welcome, ${user.displayName}!`, 'success');
  };

  // ============================================
  // APP INIT
  // ============================================
  const showApp = () => {
    $('#loginScreen').classList.remove('active');
    $('#appScreen').classList.add('active');
    renderMe();
    initAppHandlers();
    initDemoData();
    loadChats();
  };

  const renderMe = () => {
    if (!state.me) return;
    $('#meAvatar').textContent = state.me.avatar;
    $('#meName').textContent = state.me.displayName;
    $('#mePlatform').textContent = state.me.platform;
    $('#xidValue').textContent = state.me.crossPlatformId;
  };

  const initDemoData = () => {
    // Seed demo users (visible to everyone)
    if (!demoStore.get('users')) {
      demoStore.set('users', DEMO_USERS);
    }
    state.users = demoStore.get('users') || DEMO_USERS;

    // Seed a welcome chat with a demo user if no chats exist
    const chats = demoStore.get('chats') || [];
    if (chats.length === 0 && state.me) {
      const demoUser = state.users.find(u => u.id !== state.me.id) || state.users[0];
      if (demoUser) {
        const chat = {
          id: uid('chat'),
          participants: [state.me.id, demoUser.id],
          type: 'direct',
          createdAt: Date.now(),
          lastMessageAt: Date.now(),
        };
        chats.push(chat);
        demoStore.set('chats', chats);

        const welcome = {
          id: uid('msg'),
          chatId: chat.id,
          senderId: demoUser.id,
          text: `Hi ${state.me.displayName}! 👋 I'm ${demoUser.displayName} from ${demoUser.platform === 'whatsapp' ? 'WhatsApp' : 'Telegram'}. Your cross-platform ID is ${state.me.crossPlatformId}. Try sending me a message!`,
          timestamp: Date.now(),
          status: 'delivered',
        };
        demoStore.set(`msgs_${chat.id}`, [welcome]);
        chat.lastMessage = welcome.text;
        chat.lastMessageAt = welcome.timestamp;
        demoStore.set('chats', chats);
      }
    }
  };

  // ============================================
  // CHAT LIST
  // ============================================
  const loadChats = async () => {
    state.chats = await api.getChats();
    renderChatList();
  };

  const getChatPartner = (chat) => {
    const otherId = chat.participants.find(p => p !== state.me.id);
    return state.users.find(u => u.id === otherId) || { id: otherId, displayName: 'Unknown', avatar: '?', platform: chat.participants.length > 2 ? 'group' : 'unknown' };
  };

  const renderChatList = () => {
    const list = $('#chatList');
    const query = state.searchQuery.toLowerCase().trim();
    const filter = state.filter;

    let filtered = state.chats.slice();

    // Filter
    if (filter !== 'all') {
      filtered = filtered.filter(chat => {
        if (filter === 'temp') return chat.type === 'temp';
        if (chat.type === 'temp') return false;
        const partner = getChatPartner(chat);
        return partner.platform === filter;
      });
    }

    // Search
    if (query) {
      filtered = filtered.filter(chat => {
        const partner = getChatPartner(chat);
        return partner.displayName.toLowerCase().includes(query) ||
               (partner.crossPlatformId || '').toLowerCase().includes(query) ||
               (chat.lastMessage || '').toLowerCase().includes(query);
      });
    }

    // Sort by last message time
    filtered.sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty-chats">No chats yet.<br>Start a new conversation!</div>`;
      return;
    }

    list.innerHTML = '';
    filtered.forEach(chat => {
      const partner = getChatPartner(chat);
      const item = el('div', {
        class: `chat-item ${state.activeChatId === chat.id ? 'active' : ''}`,
        onclick: () => openChat(chat.id),
      });

      const avatarClass = chat.type === 'temp' ? 'temp' : partner.platform;
      const onlineDot = partner.online ? '<div class="online-indicator"></div>' : '';
      const platformBadge = chat.type === 'temp'
        ? '<span class="platform-badge temp">TEMP</span>'
        : `<span class="platform-badge ${partner.platform}">${partner.platform === 'whatsapp' ? 'WA' : 'TG'}</span>`;

      item.innerHTML = `
        <div class="chat-avatar ${avatarClass}">${partner.avatar || '?'}${onlineDot}</div>
        <div class="chat-info">
          <div class="chat-top">
            <div class="chat-name">${escapeHtml(partner.displayName)} ${platformBadge}</div>
            <div class="chat-time">${chat.lastMessageAt ? fmtTime(chat.lastMessageAt) : ''}</div>
          </div>
          <div class="chat-bottom">
            <div class="chat-preview">${escapeHtml(chat.lastMessage || 'No messages yet')}</div>
          </div>
        </div>
      `;
      list.appendChild(item);
    });
  };

  const escapeHtml = (s) => {
    if (!s) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  // ============================================
  // CHAT VIEW
  // ============================================
  const openChat = async (chatId) => {
    state.activeChatId = chatId;
    $('#emptyState').classList.add('hidden');
    $('#chatView').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('chat-open');

    const chat = state.chats.find(c => c.id === chatId);
    if (!chat) return;

    const partner = getChatPartner(chat);
    $('#chatAvatar').textContent = partner.avatar || '?';
    $('#chatAvatar').className = `chat-avatar ${chat.type === 'temp' ? 'temp' : partner.platform}`;
    $('#chatName').textContent = partner.displayName;
    const status = partner.online ? '<span class="online">online</span>' : 'offline';
    $('#chatStatus').innerHTML = status;

    // Add temp banner if needed
    const existingBanner = $('.temp-banner');
    if (existingBanner) existingBanner.remove();
    if (chat.type === 'temp') {
      const banner = el('div', { class: 'temp-banner' });
      const minutes = Math.max(0, Math.round((chat.expiresAt - Date.now()) / 60000));
      banner.innerHTML = `🔒 <strong>Temp Chat</strong> — Code: <strong>${chat.tempId}</strong> · Expires in ${minutes}m`;
      $('#messages').prepend(banner);
    }

    renderChatList(); // Re-render to show active state
    await loadMessages(chatId);
  };

  const loadMessages = async (chatId) => {
    const msgs = await api.getMessages(chatId);
    state.messages[chatId] = msgs;
    renderMessages(chatId);
  };

  const renderMessages = (chatId) => {
    const container = $('#messages');
    const msgs = state.messages[chatId] || [];
    container.innerHTML = '';

    // Re-add temp banner if applicable
    const chat = state.chats.find(c => c.id === chatId);
    if (chat && chat.type === 'temp') {
      const banner = el('div', { class: 'temp-banner' });
      const minutes = Math.max(0, Math.round((chat.expiresAt - Date.now()) / 60000));
      banner.innerHTML = `🔒 <strong>Temp Chat</strong> — Code: <strong>${chat.tempId}</strong> · Expires in ${minutes}m`;
      container.appendChild(banner);
    }

    let lastDate = '';
    msgs.forEach(msg => {
      if (msg.senderId === 'system') return; // hide system msgs in main view
      const d = new Date(msg.timestamp);
      const dateStr = d.toDateString();
      if (dateStr !== lastDate) {
        const divider = el('div', { class: 'date-divider' }, []);
        divider.textContent = fmtDateDivider(msg.timestamp);
        container.appendChild(divider);
        lastDate = dateStr;
      }

      const isOut = msg.senderId === state.me.id;
      const wrap = el('div', { class: `message ${isOut ? 'out' : 'in'}` });

      const bubble = el('div', { class: 'bubble' });
      bubble.textContent = msg.text;

      const meta = el('div', { class: 'message-time' });
      meta.textContent = fmtClock(msg.timestamp);
      if (isOut) {
        const checkSvg = msg.status === 'read'
          ? '<svg viewBox="0 0 18 18" fill="currentColor"><path d="M17.4 4.2L7.6 14L4.2 10.6L5.2 9.6L7.6 12L16.4 3.2zM11.4 4.2L1.6 14L0 12.4L9.8 2.6z"/></svg>'
          : '<svg viewBox="0 0 18 18" fill="currentColor"><path d="M17.4 4.2L7.6 14L4.2 10.6L5.2 9.6L7.6 12L16.4 3.2z"/></svg>';
        meta.innerHTML = `${fmtClock(msg.timestamp)} <span class="message-status ${msg.status}">${checkSvg}</span>`;
      }

      wrap.appendChild(bubble);
      wrap.appendChild(meta);
      container.appendChild(wrap);
    });

    // Scroll to bottom
    requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
  };

  const sendCurrentMessage = async () => {
    const input = $('#messageInput');
    const text = input.value.trim();
    if (!text || !state.activeChatId) return;
    input.value = '';
    input.focus();

    const msg = await api.sendMessage(state.activeChatId, text);
    if (!state.messages[state.activeChatId]) state.messages[state.activeChatId] = [];
    state.messages[state.activeChatId].push(msg);
    renderMessages(state.activeChatId);
    loadChats(); // Update last message preview

    // Simulate reply after delay (for demo)
    setTimeout(simulateReply, 1500 + Math.random() * 1500);
  };

  const simulateReply = async () => {
    if (!state.activeChatId) return;
    const chat = state.chats.find(c => c.id === state.activeChatId);
    if (!chat) return;
    const partner = getChatPartner(chat);
    if (!partner || partner.id === 'system') return;

    const replies = [
      'Got it! 👍',
      'Interesting, tell me more',
      'Haha that\'s funny 😂',
      'I agree!',
      'Let me think about that...',
      'Sounds good!',
      'Will check and get back to you',
      'Thanks for the message',
      'OK 👍',
      'Cool!',
      'Working on it',
      'Yes absolutely!',
    ];
    const reply = replies[Math.floor(Math.random() * replies.length)];

    const msg = {
      id: uid('msg'),
      chatId: chat.id,
      senderId: partner.id,
      text: reply,
      timestamp: Date.now(),
      status: 'delivered',
    };
    const msgs = demoStore.get(`msgs_${chat.id}`) || [];
    msgs.push(msg);
    demoStore.set(`msgs_${chat.id}`, msgs);
    chat.lastMessage = reply;
    chat.lastMessageAt = msg.timestamp;
    const chats = demoStore.get('chats');
    const idx = chats.findIndex(c => c.id === chat.id);
    if (idx >= 0) chats[idx] = chat;
    demoStore.set('chats', chats);
    broadcastEvent('new_message', { chatId: chat.id, message: msg });

    if (state.activeChatId === chat.id) {
      if (!state.messages[chat.id]) state.messages[chat.id] = [];
      state.messages[chat.id].push(msg);
      renderMessages(chat.id);
    }
    loadChats();
  };

  // ============================================
  // HANDLERS
  // ============================================
  const initAppHandlers = () => {
    // Search
    $('#searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderChatList();
    });

    // Filter
    $$('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.filter = chip.dataset.filter;
        renderChatList();
      });
    });

    // Logout
    $('#logoutBtn').addEventListener('click', () => {
      if (confirm('Logout and clear local data?')) {
        demoStore.remove('me');
        state.me = null;
        location.reload();
      }
    });

    // Theme toggle
    $('#themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      demoStore.set('theme', next);
    });

    // Restore theme
    const theme = demoStore.get('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', theme);

    // XID copy
    $('#xidCopy').addEventListener('click', () => {
      const xid = state.me?.crossPlatformId || '';
      navigator.clipboard.writeText(xid).then(() => toast('Copied to clipboard', 'success'));
    });

    // Profile click
    $('#meBtn').addEventListener('click', () => {
      $('#profileAvatar').textContent = state.me.avatar;
      $('#profileName').textContent = state.me.displayName;
      $('#profilePlatform').textContent = state.me.platform;
      $('#profileXid').textContent = state.me.crossPlatformId;
      $('#profileModal').classList.add('active');
    });
    $('#profileMessageBtn').addEventListener('click', () => {
      $('#profileModal').classList.remove('active');
      // Open chat with self (or just close)
    });

    // New chat
    $('#newChatBtn').addEventListener('click', openNewChatModal);
    $('#emptyNewChat').addEventListener('click', openNewChatModal);
    $('#newChatSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = state.users.filter(u =>
        u.id !== state.me.id &&
        (u.displayName.toLowerCase().includes(q) ||
         u.crossPlatformId.toLowerCase().includes(q) ||
         (u.platformId || '').toLowerCase().includes(q))
      );
      renderNewChatList(filtered);
    });

    // New temp chat
    $('#newTempBtn').addEventListener('click', openNewTempModal);
    $('#emptyNewTemp').addEventListener('click', openNewTempModal);

    // Temp duration
    $$('.duration-chip').forEach(c => {
      c.addEventListener('click', () => {
        $$('.duration-chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
      });
    });

    // Temp create
    $('#tempOpenBtn')?.addEventListener('click', async () => {
      // Re-find the chat and open
      const tempId = $('#tempIdValue').textContent;
      const chat = state.chats.find(c => c.tempId === tempId);
      if (chat) {
        $('#newTempModal').classList.remove('active');
        await loadChats();
        openChat(chat.id);
      }
    });

    $('#tempCopyBtn')?.addEventListener('click', () => {
      const tempId = $('#tempIdValue').textContent;
      navigator.clipboard.writeText(tempId).then(() => toast('Code copied!', 'success'));
    });

    // Temp join
    $('#tempJoinBtn').addEventListener('click', async () => {
      const code = $('#tempJoinInput').value.trim().toUpperCase();
      if (!code) { toast('Enter a code', 'error'); return; }
      try {
        const chat = await api.joinTempChat(code);
        $('#newTempModal').classList.remove('active');
        await loadChats();
        openChat(chat.id);
        toast('Joined temp chat', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    // Message composer
    const msgInput = $('#messageInput');
    const sendBtn = $('#sendBtn');
    const voiceBtn = $('#voiceBtn');
    msgInput.addEventListener('input', () => {
      if (msgInput.value.trim()) {
        sendBtn.classList.remove('hidden');
        voiceBtn.classList.add('hidden');
      } else {
        sendBtn.classList.add('hidden');
        voiceBtn.classList.remove('hidden');
      }
    });
    msgInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); sendCurrentMessage(); }
    });
    sendBtn.addEventListener('click', sendCurrentMessage);

    // Back button (mobile)
    $('#backBtn').addEventListener('click', () => {
      state.activeChatId = null;
      $('#chatView').classList.add('hidden');
      $('#emptyState').classList.remove('hidden');
      document.getElementById('appScreen').classList.remove('chat-open');
      renderChatList();
    });

    // Modal close
    $$('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.modalClose;
        $(`#${id}`).classList.remove('active');
      });
    });
    $$('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    });
  };

  // ============================================
  // MODALS
  // ============================================
  const openNewChatModal = () => {
    renderNewChatList(state.users.filter(u => u.id !== state.me.id));
    $('#newChatSearch').value = '';
    $('#newChatModal').classList.add('active');
  };

  const renderNewChatList = (users) => {
    const list = $('#newChatUserList');
    list.innerHTML = '';
    if (users.length === 0) {
      list.innerHTML = '<div class="empty-chats">No users found</div>';
      return;
    }
    users.forEach(u => {
      const item = el('div', { class: 'chat-item', onclick: async () => {
        const chat = await api.createChat(u.id);
        $('#newChatModal').classList.remove('active');
        await loadChats();
        openChat(chat.id);
      }});
      item.innerHTML = `
        <div class="chat-avatar ${u.platform}">${u.avatar}${u.online ? '<div class="online-indicator"></div>' : ''}</div>
        <div class="chat-info">
          <div class="chat-top">
            <div class="chat-name">${escapeHtml(u.displayName)} <span class="platform-badge ${u.platform}">${u.platform === 'whatsapp' ? 'WA' : 'TG'}</span></div>
          </div>
          <div class="chat-preview">${escapeHtml(u.crossPlatformId || u.platformId)}</div>
        </div>
      `;
      list.appendChild(item);
    });
  };

  const openNewTempModal = () => {
    $('#newTempModal').classList.add('active');
    $('#tempResult').classList.add('hidden');
    $('#tempJoinInput').value = '';
    // Create immediately on open (or wait for user to click create?)
    // For UX, let's auto-create with default duration
    createAndShowTemp();
  };

  const createAndShowTemp = async () => {
    const activeChip = Array.from($$('.duration-chip')).find(c => c.classList.contains('active'));
    const minutes = parseInt(activeChip?.dataset.minutes || 60);
    const { tempId, chatId } = await api.createTempChat(minutes);
    $('#tempIdValue').textContent = tempId;
    $('#tempResult').classList.remove('hidden');
    await loadChats();
  };

  // ============================================
  // INIT
  // ============================================
  const init = async () => {
    // Check if backend is available
    const backendAvailable = await api.checkBackend();
    if (backendAvailable) {
      CONFIG.DEMO_MODE = false;
      console.log('✓ Backend connected');
    } else {
      console.log('ℹ Running in demo mode (localStorage)');
    }

    initBroadcast();
    initLogin();

    // Auto-login if session exists
    const savedMe = demoStore.get('me');
    if (savedMe) {
      state.me = savedMe;
      showApp();
    }
  };

  return { init };
})();

document.addEventListener('DOMContentLoaded', APP.init);