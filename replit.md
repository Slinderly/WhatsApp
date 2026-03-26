# WA Framework — WhatsApp Web Multi-Session

## Overview
A standalone, reusable WhatsApp Web framework built on [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys). Supports multiple accounts and sessions, QR code and pairing-code connection, message sending/receiving via EventEmitter, and auto-reconnection. Comes with a demo UI and a REST API ready to plug into any project.

## Architecture
- **Runtime**: Node.js (CommonJS)
- **Framework**: Express.js (v5)
- **WhatsApp**: @whiskeysockets/baileys
- **Frontend**: Static HTML/CSS/JS in `public/` (dark theme demo UI)

## Project Structure
```
├── server.js           Entry point — Express server + event listeners (demo)
├── src/
│   └── whatsapp.js     Core framework — all WhatsApp logic
├── public/
│   ├── index.html      Demo UI (Connect · Send · Messages · API Docs)
│   ├── css/style.css   Dark theme styles
│   └── js/app.js       Demo UI JavaScript
├── sessions/           Auth credentials per session (auto-created, gitignored)
└── package.json
```

## Core Module — src/whatsapp.js

### Exported API
```js
const wa = require('./src/whatsapp');

// Connect
await wa.connectQR(accountId, sessionId)
await wa.connectPairing(accountId, sessionId, phoneNumber)  // returns pairing code string
wa.disconnectSession(accountId, sessionId)

// Send
await wa.sendMessage(accountId, jid, text)                  // any connected session
await wa.sendMessageFromSession(accountId, sessionId, jid, text)

// Status
wa.getSessions(accountId)                                    // array of session info
wa.getSessionStatus(accountId, sessionId)
await wa.getQRDataUrl(accountId, sessionId)                  // PNG data URL or null

// Startup
wa.restoreSessions()                                         // reconnect saved sessions

// Events
wa.on('message',      (msg) => { ... })     // { accountId, sessionId, jid, from, text, timestamp, raw }
wa.on('connected',    ({ accountId, sessionId, phone }) => { ... })
wa.on('disconnected', ({ accountId, sessionId, reason }) => { ... })
wa.off(event, fn)
```

### Express route handlers (ready to mount)
```js
app.get   ('/wa/sessions/:accountId',            wa.handlers.getSessions)
app.get   ('/wa/status/:accountId/:sessionId',   wa.handlers.getStatus)
app.post  ('/wa/connect/qr',                     wa.handlers.connectQR)
app.post  ('/wa/connect/pairing',                wa.handlers.connectPairing)
app.delete('/wa/sessions/:accountId/:sessionId', wa.handlers.disconnect)
app.post  ('/wa/send',                           wa.handlers.send)
```

## REST API
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/wa/sessions/:accountId` | List all sessions for an account |
| GET | `/wa/status/:accountId/:sessionId` | Session status + QR data URL |
| POST | `/wa/connect/qr` | Start QR connection |
| POST | `/wa/connect/pairing` | Start pairing-code connection |
| DELETE | `/wa/sessions/:accountId/:sessionId` | Disconnect & delete session |
| POST | `/wa/send` | Send a text message |
| GET | `/wa/messages` | In-memory message log (demo only) |

## Key Design Decisions
- **accountId** groups multiple sessions — one account can have many WhatsApp numbers
- **Sessions persist** in `sessions/` folder; `restoreSessions()` reconnects them on startup
- **Auto-reconnect**: on unexpected disconnection, automatically retries after 5 seconds
- **QR timeout**: 120 seconds — session is cleaned up if not scanned in time
- **Pairing timeout**: 30 seconds to receive response from WhatsApp, 120 seconds total
- **EventEmitter**: `wa.on('message', fn)` is the hook to add any business logic (AI, DB, etc.)

## Dependencies
- `@whiskeysockets/baileys` — WhatsApp Web protocol
- `@hapi/boom` — error handling for Baileys
- `express` — HTTP server
- `qrcode` — QR code PNG generation
- `pino` — logger (set to silent in production socket)
- `cors`, `dotenv`

## Port
Server runs on port `5000` (configurable via `PORT` env var).
