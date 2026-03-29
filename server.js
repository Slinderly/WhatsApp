require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const wa      = require('./src/whatsapp');
const ai      = require('./src/ai');

const app    = express();
const PORT   = process.env.PORT || 5000;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── WA events ─────────────────────────────────────────────────────────────
wa.on('message', async (msg) => {
    if (!msg.text || msg.jid.endsWith('@g.us')) return;
    const cfg = ai.getConfig();
    if (!cfg.enabled) return;
    try {
        const reply = await ai.ask(msg.jid, msg.text);
        await wa.sendText(msg.jid, reply);
    } catch (err) {
        console.error('[AI]', err.message);
    }
});

wa.on('connected',    (d) => console.log(`[WA] Conectado: ${d.phone}`));
wa.on('disconnected', (d) => console.log(`[WA] Desconectado: ${d.reason}`));

// ── Status ─────────────────────────────────────────────────────────────────
app.get('/status', async (_req, res) => {
    const qr = await wa.getQR();
    res.json({ status: wa.getStatus(), device: wa.getDevice(), qr });
});

// ── Connect QR ─────────────────────────────────────────────────────────────
app.post('/connect/qr', (_req, res) => {
    const s = wa.getStatus();
    if (s !== 'connected') wa.connectQR();
    res.json({ success: true });
});

// ── Connect pairing ────────────────────────────────────────────────────────
app.post('/connect/pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ success: false, message: 'phoneNumber requerido' });
    try {
        const code = await wa.connectPairing(phoneNumber);
        res.json({ success: true, code });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Disconnect ─────────────────────────────────────────────────────────────
app.delete('/disconnect', (_req, res) => {
    wa.disconnect();
    res.json({ success: true });
});

// ── Send text ──────────────────────────────────────────────────────────────
app.post('/send', async (req, res) => {
    const { jid, text } = req.body;
    if (!jid || !text) return res.status(400).json({ success: false, message: 'jid y text requeridos' });
    try {
        await wa.sendText(jid, text);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Send image by URL ──────────────────────────────────────────────────────
app.post('/send/image', async (req, res) => {
    const { jid, imageUrl, caption = '' } = req.body;
    if (!jid || !imageUrl) return res.status(400).json({ success: false, message: 'jid e imageUrl requeridos' });
    try {
        await wa.sendImage(jid, imageUrl, caption);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Send image upload ──────────────────────────────────────────────────────
app.post('/send/image/upload', upload.single('image'), async (req, res) => {
    const { jid, caption = '' } = req.body;
    if (!jid || !req.file) return res.status(400).json({ success: false, message: 'jid e imagen requeridos' });
    try {
        await wa.sendImageBuffer(jid, req.file.buffer, req.file.mimetype, caption);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Bot config ─────────────────────────────────────────────────────────────
app.get('/bot/config', (_req, res) => {
    res.json(ai.getConfig());
});

app.post('/bot/config', (req, res) => {
    const { apiKey, enabled, model, systemPrompt, maxHistory } = req.body;
    const updates = {};
    if (apiKey       !== undefined) updates.apiKey       = apiKey;
    if (enabled      !== undefined) updates.enabled      = enabled;
    if (model        !== undefined) updates.model        = model;
    if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
    if (maxHistory   !== undefined) updates.maxHistory   = Number(maxHistory);
    ai.setConfig(updates);
    res.json({ success: true, config: ai.getConfig() });
});

app.get('/bot/models', (_req, res) => {
    res.json({ models: ai.getModels() });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[wibc.ai] Servidor en http://0.0.0.0:${PORT}`);
    wa.restoreSession();
});
