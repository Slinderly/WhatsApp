require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const wa      = require('./src/whatsapp');
const ai      = require('./src/ai');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── In-memory message log (demo) ───────────────────────────────────────────
const messageLog = [];
const MAX_LOG    = 200;

// ── Broadcast state ────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const SENT_FILE   = path.join(DATA_DIR, 'broadcast_sent.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const loadSent = () => {
    try { return new Set(JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'))); }
    catch { return new Set(); }
};
const saveSent = (set) => {
    fs.writeFileSync(SENT_FILE, JSON.stringify([...set]));
};

let broadcast = {
    running:   false,
    total:     0,
    sent:      0,
    skipped:   0,
    failed:    0,
    log:       [],
    stopFlag:  false,
};

// ── WA events ─────────────────────────────────────────────────────────────
wa.on('message', async (msg) => {
    console.log(`[WA] ${msg.from} (${msg.jid}): ${msg.text}`);
    messageLog.unshift({ direction: 'in', ...msg });
    if (messageLog.length > MAX_LOG) messageLog.length = MAX_LOG;

    const cfg = ai.getConfig();
    if (!cfg.enabled || !msg.text) return;
    if (msg.jid.endsWith('@g.us')) return;

    try {
        const reply = await ai.ask(msg.jid, msg.text);
        await wa.sendMessage(msg.accountId, msg.jid, reply);
        messageLog.unshift({
            direction: 'out',
            accountId: msg.accountId,
            sessionId: msg.sessionId,
            jid:       msg.jid,
            from:      'IA',
            text:      reply,
            timestamp: Date.now(),
        });
    } catch (err) {
        console.error('[AI] Error al responder:', err.message);
    }
});

wa.on('connected', ({ accountId, sessionId, phone }) => {
    console.log(`[WA] Conectado — cuenta: ${accountId} | sesión: ${sessionId} | tel: ${phone}`);
});

wa.on('disconnected', ({ accountId, sessionId, reason }) => {
    console.log(`[WA] Desconectado — cuenta: ${accountId} | sesión: ${sessionId} | razón: ${reason}`);
});

// ── WhatsApp API routes ────────────────────────────────────────────────────
app.get   ('/wa/sessions/:accountId',            wa.handlers.getSessions);
app.get   ('/wa/status/:accountId/:sessionId',   wa.handlers.getStatus);
app.post  ('/wa/connect/qr',                     wa.handlers.connectQR);
app.post  ('/wa/connect/pairing',                wa.handlers.connectPairing);
app.delete('/wa/sessions/:accountId/:sessionId', wa.handlers.disconnect);
app.post  ('/wa/send',                           wa.handlers.send);

app.get('/wa/messages', (req, res) => {
    const { accountId, limit = 50 } = req.query;
    const filtered = accountId
        ? messageLog.filter(m => m.accountId === accountId)
        : messageLog;
    res.json({ messages: filtered.slice(0, Number(limit)) });
});

// ── Groups routes ──────────────────────────────────────────────────────────
app.get('/wa/groups/:accountId', async (req, res) => {
    try {
        const groups = await wa.getGroups(req.params.accountId);
        res.json({ groups });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/wa/groups/:accountId/:groupId/members', async (req, res) => {
    try {
        const members = await wa.getGroupMembers(
            req.params.accountId,
            decodeURIComponent(req.params.groupId)
        );
        res.json({ members });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Broadcast routes ───────────────────────────────────────────────────────
app.post('/wa/broadcast', async (req, res) => {
    const { accountId, groupId, message, delayMs = 6000, resetSent = false } = req.body;
    if (!accountId || !groupId || !message)
        return res.status(400).json({ success: false, message: 'accountId, groupId y message son requeridos' });

    if (broadcast.running)
        return res.status(409).json({ success: false, message: 'Ya hay una difusión en curso' });

    const sentSet = resetSent ? new Set() : loadSent();

    let members;
    try { members = await wa.getGroupMembers(accountId, groupId); }
    catch (err) { return res.status(500).json({ success: false, message: err.message }); }

    const toSend = members.filter(m => !sentSet.has(m.phone));

    broadcast = {
        running:  true,
        total:    toSend.length,
        sent:     0,
        skipped:  members.length - toSend.length,
        failed:   0,
        log:      [],
        stopFlag: false,
        startedAt: new Date().toISOString(),
    };

    res.json({
        success: true,
        total:   toSend.length,
        skipped: broadcast.skipped,
        message: `Iniciando difusión a ${toSend.length} contactos`,
    });

    (async () => {
        for (const member of toSend) {
            if (broadcast.stopFlag) {
                broadcast.log.push({ phone: member.phone, status: 'detenido' });
                break;
            }
            try {
                await wa.sendMessage(accountId, member.jid, message);
                sentSet.add(member.phone);
                saveSent(sentSet);
                broadcast.sent++;
                broadcast.log.push({ phone: member.phone, status: 'enviado', ts: new Date().toISOString() });
            } catch (err) {
                broadcast.failed++;
                broadcast.log.push({ phone: member.phone, status: 'error', error: err.message });
            }
            if (!broadcast.stopFlag)
                await new Promise(r => setTimeout(r, Math.max(delayMs, 3000)));
        }
        broadcast.running  = false;
        broadcast.finishedAt = new Date().toISOString();
    })();
});

app.get('/wa/broadcast/status', (_req, res) => {
    res.json(broadcast);
});

app.post('/wa/broadcast/stop', (_req, res) => {
    broadcast.stopFlag = true;
    res.json({ success: true, message: 'Señal de parada enviada' });
});

app.post('/wa/broadcast/reset', (_req, res) => {
    if (fs.existsSync(SENT_FILE)) fs.unlinkSync(SENT_FILE);
    res.json({ success: true, message: 'Registro de enviados limpiado' });
});

// ── AI settings routes ─────────────────────────────────────────────────────
app.get('/ai/settings', (_req, res) => {
    res.json(ai.getConfig());
});

app.post('/ai/settings', (req, res) => {
    const { apiKey, enabled, systemPrompt, model, maxHistory } = req.body;
    const updates = {};
    if (apiKey      !== undefined) updates.apiKey      = apiKey;
    if (enabled     !== undefined) updates.enabled     = enabled;
    if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
    if (model       !== undefined) updates.model       = model;
    if (maxHistory  !== undefined) updates.maxHistory  = Number(maxHistory);
    ai.setConfig(updates);
    res.json({ success: true, config: ai.getConfig() });
});

app.get('/ai/models', (_req, res) => {
    const ai = require('./src/ai');
    res.json({ models: ai.getModels() });
});

// ── Arranque ───────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[WA Framework] Servidor en http://0.0.0.0:${PORT}`);
    wa.restoreSessions();
});
