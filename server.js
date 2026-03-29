require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const wa          = require('./src/whatsapp');
const ai          = require('./src/ai');
const prospecting = require('./src/prospecting');

prospecting.init(wa);

const app    = express();
const PORT   = process.env.PORT || 5000;

// Image storage
const IMGS_DIR   = path.join(__dirname, 'data/imgs');
const IMGS_META  = path.join(__dirname, 'data/images.json');
if (!fs.existsSync(IMGS_DIR)) fs.mkdirSync(IMGS_DIR, { recursive: true });

const loadImages = () => {
    try { return JSON.parse(fs.readFileSync(IMGS_META, 'utf8')); }
    catch { return []; }
};
const saveImages = (arr) => fs.writeFileSync(IMGS_META, JSON.stringify(arr, null, 2));

const imgStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, IMGS_DIR),
    filename:    (_req, file, cb)  => cb(null, uuidv4() + path.extname(file.originalname)),
});
const upload = multer({ storage: imgStorage, limits: { fileSize: 15 * 1024 * 1024 } });

const singleUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── WA events ─────────────────────────────────────────────────────────────
wa.on('message', async (msg) => {
    if (!msg.text || msg.jid.endsWith('@g.us')) return;
    const cfg = ai.getConfig();
    if (!cfg.enabled) return;

    try {
        const images   = loadImages();
        const { reply, imageIds } = await ai.ask(msg.jid, msg.text, images);

        // Send any images the AI decided to send
        for (const imgId of imageIds) {
            const img = images.find(i => i.id === imgId);
            if (!img) continue;
            const imgPath = path.join(IMGS_DIR, img.filename);
            if (!fs.existsSync(imgPath)) continue;
            const buffer = fs.readFileSync(imgPath);
            await wa.sendImageBuffer(msg.jid, buffer, img.mimetype, '');
            await new Promise(r => setTimeout(r, 800));
        }

        if (reply.trim()) await wa.sendText(msg.jid, reply);
    } catch (err) {
        console.error('[AI]', err.message);
    }
});

wa.on('connected', (d) => {
    console.log(`[WA] Conectado: ${d.phone}`);
    const cfg = prospecting.getStats().config;
    if (cfg.enabled) {
        setTimeout(() => prospecting.start(), 5000);
    }
});

wa.on('disconnected', (d) => {
    console.log(`[WA] Desconectado: ${d.reason}`);
    prospecting.stop();
});

// ── Status ─────────────────────────────────────────────────────────────────
app.get('/status', async (_req, res) => {
    const qr = await wa.getQR();
    res.json({ status: wa.getStatus(), device: wa.getDevice(), qr });
});

// ── Connect QR ─────────────────────────────────────────────────────────────
app.post('/connect/qr', (_req, res) => {
    if (wa.getStatus() !== 'connected') wa.connectQR();
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

// ── Images: list ───────────────────────────────────────────────────────────
app.get('/images', (_req, res) => {
    res.json({ images: loadImages() });
});

// ── Images: upload multiple ────────────────────────────────────────────────
app.post('/images/upload', upload.array('images', 20), (req, res) => {
    const labels = req.body.labels;  // JSON string array or comma-separated
    let labelArr = [];
    try { labelArr = JSON.parse(labels); } catch { labelArr = (labels || '').split('||'); }

    if (!req.files || req.files.length === 0)
        return res.status(400).json({ success: false, message: 'No se recibieron imágenes' });

    const images = loadImages();
    const added  = [];

    req.files.forEach((file, i) => {
        const entry = {
            id:        uuidv4(),
            filename:  file.filename,
            label:     (labelArr[i] || `Imagen ${images.length + i + 1}`).trim(),
            mimetype:  file.mimetype,
            size:      file.size,
            createdAt: new Date().toISOString(),
        };
        images.push(entry);
        added.push(entry);
    });

    saveImages(images);
    res.json({ success: true, added });
});

// ── Images: delete ─────────────────────────────────────────────────────────
app.delete('/images/:id', (req, res) => {
    let images = loadImages();
    const img  = images.find(i => i.id === req.params.id);
    if (!img) return res.status(404).json({ success: false, message: 'No encontrada' });

    const filePath = path.join(IMGS_DIR, img.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    images = images.filter(i => i.id !== req.params.id);
    saveImages(images);
    res.json({ success: true });
});

// ── Images: update label ───────────────────────────────────────────────────
app.patch('/images/:id', (req, res) => {
    const { label } = req.body;
    const images    = loadImages();
    const img       = images.find(i => i.id === req.params.id);
    if (!img) return res.status(404).json({ success: false, message: 'No encontrada' });
    img.label = label;
    saveImages(images);
    res.json({ success: true, image: img });
});

// ── Serve image file ───────────────────────────────────────────────────────
app.get('/images/:id/file', (req, res) => {
    const images = loadImages();
    const img    = images.find(i => i.id === req.params.id);
    if (!img) return res.status(404).end();
    const filePath = path.join(IMGS_DIR, img.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.setHeader('Content-Type', img.mimetype);
    res.sendFile(filePath);
});

// ── Prospecting: stats & config ────────────────────────────────────────────
app.get('/prospect/stats', (_req, res) => {
    res.json(prospecting.getStats());
});

app.post('/prospect/start', async (_req, res) => {
    if (wa.getStatus() !== 'connected')
        return res.status(400).json({ success: false, message: 'WhatsApp no conectado' });
    await prospecting.start();
    res.json({ success: true, stats: prospecting.getStats() });
});

app.post('/prospect/stop', (_req, res) => {
    prospecting.stop();
    res.json({ success: true, stats: prospecting.getStats() });
});

app.post('/prospect/reset', (_req, res) => {
    prospecting.resetContacted();
    res.json({ success: true, stats: prospecting.getStats() });
});

app.post('/prospect/config', (req, res) => {
    const { delayMin, delayMax, maxPerHour, template } = req.body;
    const updates = {};
    if (delayMin  !== undefined) updates.delayMin  = Number(delayMin);
    if (delayMax  !== undefined) updates.delayMax  = Number(delayMax);
    if (maxPerHour !== undefined) updates.maxPerHour = Number(maxPerHour);
    if (template  !== undefined) updates.template  = template;
    prospecting.setProspectConfig(updates);
    res.json({ success: true, config: prospecting.getStats().config });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[wibc.ai] Servidor en http://0.0.0.0:${PORT}`);
    wa.restoreSession();
});
