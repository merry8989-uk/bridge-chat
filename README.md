# Bridge Chat — WhatsApp × Telegram Cross-Platform Messenger

A unified chat platform that bridges **WhatsApp** and **Telegram** users in a single inbox.

## ✨ Features

- **Unified inbox** — Chat with users from both platforms from one interface
- **QR login** — Scan-to-sign-in for both WhatsApp and Telegram (simulated for demo)
- **Cross-platform IDs** — WhatsApp users auto-get a `@telegram_handle`; Telegram users auto-get a `+phone_number` style ID
- **Temp chats** — Ephemeral rooms with auto-expiry (15m / 1h / 6h / 24h), shareable via 6-char code
- **Fusion theme** — WhatsApp's brand colors + Telegram's clean layout
- **Real-time messaging** — WebSocket-based live delivery
- **Demo mode** — Works standalone in any browser (no backend required)

## 📸 Screenshots

### Authentication & Setup
![Login](screenshots/01-login.png)
![QR Modal](screenshots/02-qr-modal.png)

### Main Interface
![App Dashboard](screenshots/03-app.png)
![Chat Open](screenshots/04-chat-open.png)

### Messaging Features
![Message Sent](screenshots/05-message-sent.png)
![New Chat](screenshots/06-new-chat.png)

### Advanced Features
![Temp Chat](screenshots/07-temp-chat.png)
![Temp Chat Open](screenshots/08-temp-open.png)

### Customization & Platforms
![Light Theme](screenshots/09-light-theme.png)
![Telegram Filter](screenshots/10-telegram-filter.png)
![Mobile View](screenshots/11-mobile.png)

## 🚀 Quick Start

### Option 1: Demo Mode (Zero Setup)

The frontend is fully functional on its own using `localStorage` + `BroadcastChannel` for cross-tab sync. Just open the deployed URL.

### Option 2: Full Stack (Backend + Frontend)

```bash
# 1. Install backend dependencies
cd backend
npm install

# 2. Start backend (runs on port 3000)
npm start

# 3. Open http://localhost:3000 in your browser
#    The frontend will auto-detect the backend and switch to multi-user mode.
```

## 🏗️ Architecture

```
bridge-chat/
├── backend/                 # Node.js API + WebSocket server
│   ├── server.js           # Express + WebSocket + in-memory store
│   └── package.json
└── frontend/               # Static web app (deployable)
    ├── index.html
    ├── css/styles.css
    └── js/app.js
```

### Backend API Endpoints

| Endpoint | Description |
|---|---|
| `POST /api/auth/whatsapp/qr` | Generate WhatsApp QR session |
| `POST /api/auth/telegram/qr` | Generate Telegram QR session |
| `GET  /api/auth/session/:id` | Poll session status |
| `POST /api/auth/session/:id/scan` | Simulate scan & login |
| `POST /api/auth/phone` | Phone-based login |
| `GET  /api/users` | List all users |
| `GET  /api/chats` | Get user's chats |
| `POST /api/chats` | Create direct chat |
| `POST /api/chats/:id/messages` | Send message |
| `POST /api/temp` | Create temp chat |
| `POST /api/temp/:id/join` | Join temp chat |

### WebSocket Events

- `auth` — Authenticate socket
- `new_message` — Real-time message delivery
- `typing` — Typing indicators
- `user_status` — Online/offline updates
- `temp_expired` — Temp chat expiry notification

## ⚠️ Legal Note

**WhatsApp does not officially support QR-based user login or personal message routing.** A true production version would require:
- **WhatsApp Business API** approval (paid, business-only)
- **Telegram MTProto/TDLib** for user-style login
- Or partnership with both platforms

This project is a **functional prototype** demonstrating the UX and architecture, using simulated data. It is **not affiliated with WhatsApp/Meta or Telegram**.

## 🎨 Theme

The design fuses:
- **Telegram's layout** — Clean spacing, rounded bubbles, smooth animations
- **WhatsApp's colors** — Green (#00A884) for primary actions, brand teal accents
- **Cross-brand gradients** — Green→Blue gradient on primary buttons and avatars
