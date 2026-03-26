const express = require('express');
const cors    = require('cors');
const path    = require('path');
const wa      = require('./src/whatsapp');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory message log (demo) — en producción usa tu propia DB ──────────
const messageLog = [];
const MAX_LOG    = 200;

wa.on('message', (msg) => {
    console.log(`[WA] Mensaje de ${msg.from} (${msg.jid}): ${msg.text}`);
    messageLog.unshift({ direction: 'in', ...msg });
    if (messageLog.length > MAX_LOG) messageLog.length = MAX_LOG;
});

wa.on('connected', ({ accountId, sessionId, phone }) => {
    console.log(`[WA] Conectado — cuenta: ${accountId} | sesión: ${sessionId} | tel: ${phone}`);
});

wa.on('disconnected', ({ accountId, sessionId, reason }) => {
    console.log(`[WA] Desconectado — cuenta: ${accountId} | sesión: ${sessionId} | razón: ${reason}`);
});

// ── WhatsApp API routes ────────────────────────────────────────────────────
app.get   ('/wa/sessions/:accountId',          wa.handlers.getSessions);
app.get   ('/wa/status/:accountId/:sessionId', wa.handlers.getStatus);
app.post  ('/wa/connect/qr',                   wa.handlers.connectQR);
app.post  ('/wa/connect/pairing',              wa.handlers.connectPairing);
app.delete('/wa/sessions/:accountId/:sessionId', wa.handlers.disconnect);
app.post  ('/wa/send',                         wa.handlers.send);

// ── Endpoint adicional: logs de mensajes (demo) ────────────────────────────
app.get('/wa/messages', (req, res) => {
    const { accountId, limit = 50 } = req.query;
    const filtered = accountId
        ? messageLog.filter(m => m.accountId === accountId)
        : messageLog;
    res.json({ messages: filtered.slice(0, Number(limit)) });
});

// ── Arranque ───────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[WA Framework] Servidor en http://0.0.0.0:${PORT}`);
    wa.restoreSessions();
});
