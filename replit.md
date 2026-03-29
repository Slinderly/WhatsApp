# wibc.ai — WhatsApp Framework

A WhatsApp multi-session framework built on Baileys with an AI auto-reply feature powered by Groq. Provides a web UI for managing WhatsApp connections, groups, broadcasting, and AI settings.

---

## Architecture

Single-process Node.js/Express server that serves:
- Static frontend from `public/` (HTML + CSS + JS, no framework)
- REST API for WhatsApp session management and AI configuration

Everything runs on **port 5000**.

---

## Technologies

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 (CommonJS) |
| Backend | Express 5 |
| WhatsApp | @whiskeysockets/baileys |
| AI | Groq SDK (llama models) |
| Frontend | Vanilla HTML + CSS + JS |
| QR generation | qrcode |
| Logging | pino (silent in production) |

---

## Project Structure

```
├── server.js               # Entry point: Express app, routes, WA event handlers
├── package.json
├── src/
│   ├── whatsapp.js         # WhatsApp engine: QR/pairing, reconnect, group utils, presence
│   ├── ai.js               # Groq AI: per-JID conversation history, config, image context
│   └── prospecting.js      # Auto-prospecting: scan groups, anti-ban delays, contacted tracking
├── public/                 # Static frontend assets
│   ├── index.html
│   ├── css/
│   └── js/
├── sessions/               # Auto-created: Baileys auth files per session
└── data/                   # Auto-created: images, contacted list, prospect config
```

---

## Running

```bash
npm install
node server.js
```

Server starts on `http://0.0.0.0:5000` and auto-restores saved WhatsApp sessions.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `GROQ_API_KEY` | Groq API key for AI replies | (none, AI disabled) |

---

## API Endpoints

### WhatsApp Sessions
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/wa/sessions/:accountId` | List sessions for account |
| GET | `/wa/status/:accountId/:sessionId` | Session status + QR |
| POST | `/wa/connect/qr` | Start QR-based connection |
| POST | `/wa/connect/pairing` | Start pairing-code connection |
| DELETE | `/wa/sessions/:accountId/:sessionId` | Disconnect session |
| POST | `/wa/send` | Send a message |
| GET | `/wa/messages` | Recent message log |

### Groups & Broadcast
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/wa/groups/:accountId` | List groups |
| GET | `/wa/groups/:accountId/:groupId/members` | Group members |
| POST | `/wa/broadcast` | Start broadcast to group members |
| GET | `/wa/broadcast/status` | Broadcast progress |
| POST | `/wa/broadcast/stop` | Stop broadcast |
| POST | `/wa/broadcast/reset` | Clear sent history |

### AI Settings
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/ai/settings` | Get AI config |
| POST | `/ai/settings` | Update AI config |
| GET | `/ai/models` | List available Groq models |

---

## Deployment

- **Target**: VM (always-running — needed for persistent WhatsApp WebSocket connections)
- **Run**: `node server.js`
- Sessions stored in `sessions/` directory (filesystem-persisted)
