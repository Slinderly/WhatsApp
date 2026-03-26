const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
} = require('@whiskeysockets/baileys');
const { Boom }   = require('@hapi/boom');
const pino       = require('pino');
const path       = require('path');
const fs         = require('fs');
const QRCode     = require('qrcode');
const { EventEmitter } = require('events');

// ── Event bus — escucha mensajes entrantes desde afuera ───────────────────
const bus = new EventEmitter();
bus.setMaxListeners(100);

// ── Estado global — clave = `${accountId}:${sessionId}` ──────────────────
const sockets       = {};
const statuses      = {};
const qrMap         = {};
const deviceMap     = {};
const everConn      = {};
const accountSets   = {};   // accountId -> Set<sessionId>
const activePairing = {};

const SESSIONS_DIR = path.join(__dirname, '../sessions');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const makeKey  = (a, s) => `${a}:${s}`;
const authDir  = (a, s) => path.join(SESSIONS_DIR, `auth_${a}_${s}`);
const sleep    = (ms) => new Promise(r => setTimeout(r, ms));

// ── Versión WA — se cachea para no pedir en cada conexión ─────────────────
let cachedVersion = null;
const getVersion = async () => {
    if (cachedVersion) return cachedVersion;
    try {
        const { version } = await fetchLatestBaileysVersion();
        cachedVersion = version;
    } catch (_) {
        cachedVersion = [2, 3000, 1015901307];
    }
    return cachedVersion;
};

// ── Matar socket limpiamente ───────────────────────────────────────────────
const killSocket = (kk, preventReconnect = false) => {
    if (preventReconnect) everConn[kk] = false;
    try { if (sockets[kk]) sockets[kk].end(); } catch (_) {}
    delete sockets[kk];
    delete qrMap[kk];
};

// ── Crear socket ───────────────────────────────────────────────────────────
const buildSocket = async (accountId, sessionId) => {
    const kk     = makeKey(accountId, sessionId);
    const folder = authDir(accountId, sessionId);

    if (sockets[kk]) killSocket(kk, true);

    if (fs.existsSync(folder) && !fs.existsSync(path.join(folder, 'creds.json')))
        fs.rmSync(folder, { recursive: true, force: true });
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(folder);
    const version = await getVersion();

    statuses[kk] = 'connecting';

    const sock = makeWASocket({
        version,
        auth:                   state,
        logger:                 pino({ level: 'silent' }),
        printQRInTerminal:      false,
        browser:                Browsers.ubuntu('Chrome'),
        syncFullHistory:        false,
        connectTimeoutMs:       60_000,
        defaultQueryTimeoutMs:  0,
    });

    sockets[kk] = sock;
    sock.ev.on('creds.update', saveCreds);

    // ── Entrante: emitir evento para que el app lo maneje ─────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (sockets[kk] !== sock) return;
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg?.message || msg.key.fromMe) continue;

            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption || '';

            const jid  = msg.key.remoteJid;
            const from = msg.pushName || jid.split('@')[0];

            bus.emit('message', {
                accountId,
                sessionId,
                jid,
                from,
                text,
                timestamp: msg.messageTimestamp
                    ? Number(msg.messageTimestamp) * 1000
                    : Date.now(),
                raw: msg,
            });
        }
    });

    return sock;
};

// ── Flujo QR ───────────────────────────────────────────────────────────────
const connectQR = async (accountId, sessionId) => {
    const kk     = makeKey(accountId, sessionId);
    const folder = authDir(accountId, sessionId);
    const isNew  = !fs.existsSync(path.join(folder, 'creds.json'));

    if (!accountSets[accountId]) accountSets[accountId] = new Set();
    accountSets[accountId].add(sessionId);

    let sock;
    try { sock = await buildSocket(accountId, sessionId); }
    catch (_) { statuses[kk] = 'disconnected'; return; }

    let qrTimer = null;
    if (isNew) {
        qrTimer = setTimeout(() => {
            if (statuses[kk] !== 'connected') {
                statuses[kk] = 'timeout';
                delete qrMap[kk];
                killSocket(kk, true);
            }
        }, 120_000);
    }

    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (sockets[kk] !== sock) return;

        if (qr) qrMap[kk] = qr;

        if (connection === 'close') {
            clearTimeout(qrTimer);
            delete qrMap[kk];
            const code = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : lastDisconnect?.error?.statusCode;

            if (code === DisconnectReason.loggedOut) {
                statuses[kk] = 'disconnected';
                everConn[kk] = false;
                delete deviceMap[kk];
                if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
                accountSets[accountId]?.delete(sessionId);
                bus.emit('disconnected', { accountId, sessionId, reason: 'logged_out' });

            } else if (everConn[kk]) {
                statuses[kk] = 'disconnected';
                bus.emit('disconnected', { accountId, sessionId, reason: 'connection_lost' });
                setTimeout(() => connectQR(accountId, sessionId), 5_000);

            } else if (code === DisconnectReason.restartRequired) {
                statuses[kk] = 'connecting';
                setTimeout(() => connectQR(accountId, sessionId), 1_500);

            } else {
                statuses[kk] = 'disconnected';
            }

        } else if (connection === 'open') {
            clearTimeout(qrTimer);
            delete qrMap[kk];
            everConn[kk]  = true;
            statuses[kk]  = 'connected';
            const me      = sock.authState?.creds?.me;
            const phone   = me?.id?.split(':')[0]?.split('@')[0] ?? 'Desconocido';
            deviceMap[kk] = { phone, name: me?.name ?? null, connectedAt: new Date().toISOString() };
            bus.emit('connected', { accountId, sessionId, phone, name: me?.name ?? null });
        }
    });
};

// ── Flujo Código de Emparejamiento ─────────────────────────────────────────
const connectPairing = (accountId, sessionId, phoneNumber) => {
    const kk     = makeKey(accountId, sessionId);
    const folder = authDir(accountId, sessionId);

    if (activePairing[accountId]) activePairing[accountId].cancel();

    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });

    if (!accountSets[accountId]) accountSets[accountId] = new Set();
    for (const sid of [...(accountSets[accountId])]) {
        if (statuses[makeKey(accountId, sid)] !== 'connected')
            accountSets[accountId].delete(sid);
    }
    accountSets[accountId].add(sessionId);

    return new Promise(async (resolve, reject) => {
        let codeObtained = false;
        let cancelled    = false;
        let aliveTimer, noQRTimer;
        let currentSock  = null;

        const cleanup = () => {
            clearTimeout(aliveTimer);
            clearTimeout(noQRTimer);
            if (currentSock && sockets[kk] === currentSock) killSocket(kk, true);
            statuses[kk] = 'disconnected';
            accountSets[accountId]?.delete(sessionId);
            if (activePairing[accountId]?.sessionId === sessionId) delete activePairing[accountId];
        };

        aliveTimer = setTimeout(() => {
            if (statuses[kk] !== 'connected') {
                cleanup();
                statuses[kk] = 'timeout';
                reject(new Error('Tiempo agotado. Solicita un nuevo código.'));
            }
        }, 120_000);

        noQRTimer = setTimeout(() => {
            if (!codeObtained) {
                cleanup();
                reject(new Error('Sin respuesta de WhatsApp. Intenta de nuevo.'));
            }
        }, 30_000);

        activePairing[accountId] = {
            sessionId,
            cancel: () => {
                if (cancelled) return;
                cancelled = true;
                cleanup();
                reject(new Error('Se inició una nueva solicitud de vinculación.'));
            },
        };

        const attachHandler = (sock) => {
            sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
                if (cancelled || sockets[kk] !== sock) return;

                if (qr && !codeObtained) {
                    codeObtained = true;
                    clearTimeout(noQRTimer);
                    const clean = phoneNumber.replace(/\D/g, '');
                    try {
                        const code = await sock.requestPairingCode(clean);
                        resolve(code);
                    } catch (err) { cleanup(); reject(err); }
                }

                if (connection === 'close') {
                    const code = lastDisconnect?.error instanceof Boom
                        ? lastDisconnect.error.output.statusCode
                        : lastDisconnect?.error?.statusCode;

                    if (code === DisconnectReason.restartRequired && codeObtained && !cancelled) {
                        statuses[kk] = 'connecting';
                        try {
                            const newSock = await buildSocket(accountId, sessionId);
                            currentSock   = newSock;
                            attachHandler(newSock);
                        } catch (err) { cleanup(); reject(err); }
                        return;
                    }

                    clearTimeout(aliveTimer);
                    clearTimeout(noQRTimer);
                    delete qrMap[kk];

                    if (everConn[kk]) {
                        statuses[kk] = 'disconnected';
                        if (activePairing[accountId]?.sessionId === sessionId) delete activePairing[accountId];
                        setTimeout(() => connectQR(accountId, sessionId), 5_000);
                    } else {
                        cleanup();
                        if (!codeObtained) reject(new Error('Conexión cerrada antes de obtener código.'));
                    }

                } else if (connection === 'open') {
                    clearTimeout(aliveTimer);
                    clearTimeout(noQRTimer);
                    everConn[kk]  = true;
                    statuses[kk]  = 'connected';
                    delete qrMap[kk];
                    if (activePairing[accountId]?.sessionId === sessionId) delete activePairing[accountId];
                    const me      = sock.authState?.creds?.me;
                    const phone   = me?.id?.split(':')[0]?.split('@')[0] ?? phoneNumber;
                    deviceMap[kk] = { phone, name: me?.name ?? null, connectedAt: new Date().toISOString() };
                    bus.emit('connected', { accountId, sessionId, phone, name: me?.name ?? null });
                }
            });
        };

        try {
            currentSock = await buildSocket(accountId, sessionId);
            attachHandler(currentSock);
        } catch (err) { cleanup(); reject(err); }
    });
};

// ── Desconectar sesión ─────────────────────────────────────────────────────
const disconnectSession = (accountId, sessionId) => {
    const kk     = makeKey(accountId, sessionId);
    const folder = authDir(accountId, sessionId);
    everConn[kk] = false;
    killSocket(kk);
    statuses[kk]  = 'disconnected';
    delete deviceMap[kk];
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    accountSets[accountId]?.delete(sessionId);
};

// ── Enviar mensaje ─────────────────────────────────────────────────────────
const sendMessage = async (accountId, jid, text) => {
    const sessions = [...(accountSets[accountId] || [])];
    for (const sessionId of sessions) {
        const kk = makeKey(accountId, sessionId);
        if (statuses[kk] === 'connected' && sockets[kk]) {
            await sockets[kk].sendMessage(jid, { text });
            return;
        }
    }
    throw new Error('No hay ninguna sesión activa para esta cuenta');
};

// ── Enviar mensaje por sesión específica ───────────────────────────────────
const sendMessageFromSession = async (accountId, sessionId, jid, text) => {
    const kk = makeKey(accountId, sessionId);
    if (statuses[kk] !== 'connected' || !sockets[kk])
        throw new Error('Sesión no conectada');
    await sockets[kk].sendMessage(jid, { text });
};

// ── Obtener estado de sesiones de una cuenta ───────────────────────────────
const getSessions = (accountId) => {
    return [...(accountSets[accountId] || [])].map(sessionId => {
        const kk = makeKey(accountId, sessionId);
        return {
            sessionId,
            status: statuses[kk] || 'disconnected',
            device: deviceMap[kk] || null,
        };
    });
};

// ── Obtener estado de una sesión ───────────────────────────────────────────
const getSessionStatus = (accountId, sessionId) => {
    const kk = makeKey(accountId, sessionId);
    return {
        sessionId,
        status:  statuses[kk] || 'idle',
        device:  deviceMap[kk] || null,
        hasQR:   !!qrMap[kk],
    };
};

// ── Obtener QR como data URL ───────────────────────────────────────────────
const getQRDataUrl = async (accountId, sessionId) => {
    const kk = makeKey(accountId, sessionId);
    if (!qrMap[kk]) return null;
    try {
        return await QRCode.toDataURL(qrMap[kk], { margin: 1, width: 220 });
    } catch (_) { return null; }
};

// ── Auto-reconectar sesiones guardadas al iniciar ──────────────────────────
const restoreSessions = () => {
    if (!fs.existsSync(SESSIONS_DIR)) return;
    fs.readdirSync(SESSIONS_DIR).forEach(folder => {
        if (!folder.startsWith('auth_')) return;
        if (!fs.existsSync(path.join(SESSIONS_DIR, folder, 'creds.json'))) return;
        const inner = folder.slice(5);
        const sep   = inner.indexOf('_');
        if (sep === -1) return;
        const accountId = inner.slice(0, sep);
        const sessionId = inner.slice(sep + 1);
        connectQR(accountId, sessionId);
    });
};

// ── Express route handlers ─────────────────────────────────────────────────
const handlers = {

    // GET /wa/sessions/:accountId
    getSessions: (req, res) => {
        res.json({ sessions: getSessions(req.params.accountId) });
    },

    // GET /wa/status/:accountId/:sessionId
    getStatus: async (req, res) => {
        const { accountId, sessionId } = req.params;
        const info   = getSessionStatus(accountId, sessionId);
        const qrUrl  = info.status !== 'connected' ? await getQRDataUrl(accountId, sessionId) : null;
        res.json({ ...info, qr: qrUrl });
    },

    // POST /wa/connect/qr
    // body: { accountId, sessionId? }
    connectQR: (req, res) => {
        const { accountId, sessionId } = req.body;
        if (!accountId) return res.status(400).json({ success: false, message: 'accountId requerido' });
        const sid = sessionId || Date.now().toString(36);
        const kk  = makeKey(accountId, sid);
        if (!sockets[kk] || statuses[kk] === 'disconnected' || statuses[kk] === 'timeout')
            connectQR(accountId, sid);
        res.json({ success: true, sessionId: sid });
    },

    // POST /wa/connect/pairing
    // body: { accountId, sessionId?, phoneNumber }
    connectPairing: async (req, res) => {
        const { accountId, sessionId, phoneNumber } = req.body;
        if (!accountId || !phoneNumber)
            return res.status(400).json({ success: false, message: 'accountId y phoneNumber requeridos' });
        const sid = sessionId || Date.now().toString(36);
        try {
            const code = await connectPairing(accountId, sid, phoneNumber);
            res.json({ success: true, sessionId: sid, code });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },

    // DELETE /wa/sessions/:accountId/:sessionId
    disconnect: (req, res) => {
        const { accountId, sessionId } = req.params;
        disconnectSession(accountId, sessionId);
        res.json({ success: true });
    },

    // POST /wa/send
    // body: { accountId, jid, text, sessionId? }
    send: async (req, res) => {
        const { accountId, jid, text, sessionId } = req.body;
        if (!accountId || !jid || !text)
            return res.status(400).json({ success: false, message: 'accountId, jid y text requeridos' });
        try {
            if (sessionId) await sendMessageFromSession(accountId, sessionId, jid, text);
            else           await sendMessage(accountId, jid, text);
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    },
};

module.exports = {
    // Core API
    connectQR,
    connectPairing,
    disconnectSession,
    sendMessage,
    sendMessageFromSession,
    getSessions,
    getSessionStatus,
    getQRDataUrl,
    restoreSessions,

    // Express route handlers (listos para usar con router.get / router.post)
    handlers,

    // Event bus
    // Eventos: 'message', 'connected', 'disconnected'
    on:  (event, fn) => bus.on(event, fn),
    off: (event, fn) => bus.off(event, fn),
};
