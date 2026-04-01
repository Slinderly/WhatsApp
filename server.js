require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');

const wa         = require('./src/whatsapp');
const assistant  = require('./src/assistant');
const tasks      = require('./src/tasks');
const downloader = require('./src/downloader');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── WhatsApp message handler ──────────────────────────────────────────────────
wa.on('message', async (msg) => {
    if (!msg.text || msg.jid.endsWith('@g.us')) return;

    try {
        await wa.sendPresence(msg.jid, 'composing');

        const allTasks = tasks.getTasks('all');
        const { reply, actions } = await assistant.ask(msg.jid, msg.text, allTasks);

        let finalReply = reply;

        for (const action of actions) {
            const result = await handleAction(action, msg.jid);
            if (result) finalReply = finalReply ? `${finalReply}\n\n${result}` : result;
        }

        await wa.sendPresence(msg.jid, 'paused');

        if (finalReply && finalReply.trim()) {
            await wa.sendText(msg.jid, finalReply.trim());
        }

    } catch (err) {
        console.error('[Asistente]', err.message);
        await wa.sendText(msg.jid, `❌ ${err.message}`);
    }
});

// ── Action executor ───────────────────────────────────────────────────────────
async function handleAction(action, jid) {
    switch (action.type) {

        case 'add_task': {
            tasks.addTask(action.text, action.priority || 'normal');
            return null;
        }

        case 'complete_task': {
            const done = tasks.completeTask(action.index);
            if (!done) return '❌ No encontré esa tarea.';
            return null;
        }

        case 'delete_task': {
            const del = tasks.deleteTask(action.index);
            if (!del) return '❌ No encontré esa tarea.';
            return null;
        }

        case 'list_tasks': {
            return tasks.formatTaskList(action.filter || 'all');
        }

        case 'clear_done': {
            tasks.clearDone();
            return null;
        }

        case 'download_video': {
            if (!action.url) return '❌ No encontré la URL del video.';
            try {
                const opts = { quality: action.quality || '720p', format: action.format || 'mp4' };
                const qualityPresets = downloader.getQualities();
                const qLabel = qualityPresets.find(q => q.id === opts.quality)?.label || opts.quality;
                await wa.sendText(jid, `⏳ Descargando en ${qLabel}... espera un momento.`);
                const entry = await downloader.download(action.url, opts);
                const buf   = fs.readFileSync(entry.filepath);
                const isAudio = entry.ext === 'mp3' || entry.ext === 'm4a';
                if (isAudio) {
                    await wa.sendAudio(jid, buf, entry.filename);
                } else {
                    await wa.sendVideo(jid, buf, entry.filename, `📹 ${entry.title || 'Video'} · ${qLabel} · ${downloader.formatSize(entry.size)}`);
                }
                downloader.deleteDownload(entry.id);
                return null;
            } catch (err) {
                return `❌ Error al descargar: ${err.message}`;
            }
        }

        case 'update_config': {
            const userAllowed  = ['name', 'ownerName', 'language', 'personality'];
            const globalAllowed = ['model', 'apiKey', 'maxHistory'];
            if (userAllowed.includes(action.key)) {
                assistant.setUserConfig(jid, { [action.key]: action.value });
            } else if (globalAllowed.includes(action.key)) {
                assistant.setConfig({ [action.key]: action.value });
            } else {
                return '❌ Opción de configuración no válida.';
            }
            return null;
        }

        default:
            return null;
    }
}

wa.on('connected', (d) => console.log(`[WA] Conectado: ${d.phone}`));
wa.on('disconnected', (d) => console.log(`[WA] Desconectado: ${d.reason}`));

// ── REST API ──────────────────────────────────────────────────────────────────

// Status
app.get('/api/status', async (_req, res) => {
    const qr = await wa.getQR();
    res.json({ status: wa.getStatus(), device: wa.getDevice(), qr });
});

// Connect
app.post('/api/connect/qr', (_req, res) => {
    if (wa.getStatus() !== 'connected') wa.connectQR();
    res.json({ success: true });
});

app.post('/api/connect/pairing', async (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) return res.status(400).json({ success: false, message: 'phoneNumber requerido' });
    try {
        const code = await wa.connectPairing(phoneNumber);
        res.json({ success: true, code });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/disconnect', (_req, res) => {
    wa.disconnect();
    res.json({ success: true });
});

// ── Simulator API ─────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
    const { message, sessionId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'message requerido' });
    const jid = `simulator_${sessionId || 'default'}@dashboard`;
    try {
        const allTasks = tasks.getTasks('all');
        const { reply, actions } = await assistant.ask(jid, message.trim(), allTasks);

        let finalReply = reply;
        for (const action of actions) {
            const result = await handleAction(action, jid);
            if (result) finalReply = finalReply ? `${finalReply}\n\n${result}` : result;
        }

        res.json({ success: true, reply: finalReply || '...' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/chat/history', (req, res) => {
    const { sessionId } = req.body;
    const jid = `simulator_${sessionId || 'default'}@dashboard`;
    assistant.clearHistory(jid);
    res.json({ success: true });
});

// ── Tasks API ─────────────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => {
    const filter = req.query.filter || 'all';
    res.json({ tasks: tasks.getTasks(filter) });
});

app.post('/api/tasks', (req, res) => {
    const { text, priority } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'text requerido' });
    const task = tasks.addTask(text, priority);
    res.json({ success: true, task });
});

app.patch('/api/tasks/:id/complete', (req, res) => {
    const task = tasks.completeTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'No encontrada' });
    res.json({ success: true, task });
});

app.delete('/api/tasks/:id', (req, res) => {
    const task = tasks.deleteTask(req.params.id);
    if (!task) return res.status(404).json({ success: false, message: 'No encontrada' });
    res.json({ success: true, task });
});

app.delete('/api/tasks/done/clear', (_req, res) => {
    const remaining = tasks.clearDone();
    res.json({ success: true, remaining });
});

// ── Downloads API ─────────────────────────────────────────────────────────────
app.get('/api/downloads', (_req, res) => {
    res.json({ downloads: downloader.getHistory() });
});

app.post('/api/downloads', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, message: 'url requerida' });
    try {
        const entry = await downloader.download(url);
        res.json({ success: true, entry });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/downloads/:id/file', (req, res) => {
    const history = downloader.getHistory();
    const entry   = history.find(e => e.id === req.params.id);
    if (!entry || !fs.existsSync(entry.filepath)) return res.status(404).end();
    res.download(entry.filepath, entry.filename);
});

app.delete('/api/downloads/:id', (req, res) => {
    const ok = downloader.deleteDownload(req.params.id);
    res.json({ success: ok });
});

// ── Assistant config API ──────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
    res.json(assistant.getConfig());
});

app.post('/api/config', (req, res) => {
    const allowed = ['name', 'ownerName', 'language', 'personality', 'model', 'apiKey', 'maxHistory'];
    const updates = {};
    for (const k of allowed) {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    assistant.setConfig(updates);
    res.json({ success: true, config: assistant.getConfig() });
});

app.get('/api/models', (_req, res) => {
    res.json({ models: assistant.getModels() });
});

app.post('/api/clear-history', (_req, res) => {
    assistant.clearAllHistory();
    res.json({ success: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Asistente] Servidor en http://0.0.0.0:${PORT}`);
    wa.restoreSession();
});
