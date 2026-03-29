const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
} = require('@whiskeysockets/baileys');
const { Boom }         = require('@hapi/boom');
const pino             = require('pino');
const path             = require('path');
const fs               = require('fs');
const QRCode           = require('qrcode');
const { EventEmitter } = require('events');

const bus = new EventEmitter();
bus.setMaxListeners(20);

const AUTH_DIR = path.join(__dirname, '../sessions/auth_main');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

let sock       = null;
let status     = 'idle';      // idle | connecting | connected | disconnected | timeout
let qrRaw      = null;
let device     = null;        // { phone, name, connectedAt }
let everConn   = false;
let reconnectTimer = null;

const clearReconnect = () => { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } };

let cachedVersion = null;
const getVersion  = async () => {
    if (cachedVersion) return cachedVersion;
    try { const { version } = await fetchLatestBaileysVersion(); cachedVersion = version; }
    catch (_) { cachedVersion = [2, 3000, 1015901307]; }
    return cachedVersion;
};

const killSocket = (preventReconnect = false) => {
    if (preventReconnect) everConn = false;
    try { if (sock) sock.end(); } catch (_) {}
    sock   = null;
    qrRaw  = null;
};

const buildSocket = async () => {
    if (sock) killSocket(true);

    if (fs.existsSync(AUTH_DIR) && !fs.existsSync(path.join(AUTH_DIR, 'creds.json')))
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const version              = await getVersion();

    status = 'connecting';

    const s = makeWASocket({
        version,
        auth:                  state,
        logger:                pino({ level: 'silent' }),
        printQRInTerminal:     false,
        browser:               Browsers.ubuntu('Chrome'),
        syncFullHistory:       false,
        connectTimeoutMs:      60_000,
        defaultQueryTimeoutMs: 0,
    });

    sock = s;
    s.ev.on('creds.update', saveCreds);

    s.ev.on('messages.upsert', async ({ messages, type }) => {
        if (sock !== s || type !== 'notify') return;
        for (const msg of messages) {
            if (!msg?.message || msg.key.fromMe) continue;
            const text =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption || '';
            bus.emit('message', {
                jid:       msg.key.remoteJid,
                from:      msg.pushName || msg.key.remoteJid.split('@')[0],
                text,
                timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
                raw:       msg,
            });
        }
    });

    return s;
};

// ── Connect via QR ──────────────────────────────────────────────────────────
const connectQR = async () => {
    clearReconnect();
    const isNew = !fs.existsSync(path.join(AUTH_DIR, 'creds.json'));
    let s;
    try { s = await buildSocket(); } catch (_) { status = 'disconnected'; return; }

    let qrTimer = null;
    if (isNew) {
        qrTimer = setTimeout(() => {
            if (status !== 'connected') { status = 'timeout'; qrRaw = null; killSocket(true); }
        }, 120_000);
    }

    s.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (sock !== s) return;
        if (qr) qrRaw = qr;

        if (connection === 'close') {
            clearTimeout(qrTimer);
            qrRaw = null;
            const code = lastDisconnect?.error instanceof Boom
                ? lastDisconnect.error.output.statusCode
                : lastDisconnect?.error?.statusCode;

            if (code === DisconnectReason.loggedOut) {
                status   = 'disconnected';
                everConn = false;
                device   = null;
                if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                bus.emit('disconnected', { reason: 'logged_out' });
            } else if (everConn) {
                status = 'disconnected';
                bus.emit('disconnected', { reason: 'connection_lost' });
                reconnectTimer = setTimeout(() => connectQR(), 5_000);
            } else if (code === DisconnectReason.restartRequired) {
                status = 'connecting';
                reconnectTimer = setTimeout(() => connectQR(), 1_500);
            } else {
                status = 'disconnected';
            }
        } else if (connection === 'open') {
            clearTimeout(qrTimer);
            qrRaw    = null;
            everConn = true;
            status   = 'connected';
            const me = s.authState?.creds?.me;
            device   = {
                phone:       me?.id?.split(':')[0]?.split('@')[0] ?? 'Desconocido',
                name:        me?.name ?? null,
                connectedAt: new Date().toISOString(),
            };
            bus.emit('connected', device);
        }
    });
};

// ── Connect via pairing code ────────────────────────────────────────────────
const connectPairing = (phoneNumber) => new Promise(async (resolve, reject) => {
    clearReconnect();
    if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });

    let codeObtained = false;
    let cancelled    = false;
    let aliveTimer, noQRTimer, currentSock;

    const cleanup = () => {
        clearTimeout(aliveTimer);
        clearTimeout(noQRTimer);
        if (currentSock && sock === currentSock) killSocket(true);
        status = 'disconnected';
    };

    aliveTimer = setTimeout(() => {
        if (status !== 'connected') { cleanup(); status = 'timeout'; reject(new Error('Tiempo agotado. Solicita un nuevo código.')); }
    }, 120_000);

    noQRTimer = setTimeout(() => {
        if (!codeObtained) { cleanup(); reject(new Error('Sin respuesta de WhatsApp. Intenta de nuevo.')); }
    }, 30_000);

    const attach = (s) => {
        s.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
            if (cancelled || sock !== s) return;
            if (qr && !codeObtained) {
                codeObtained = true;
                clearTimeout(noQRTimer);
                try {
                    const code = await s.requestPairingCode(phoneNumber.replace(/\D/g, ''));
                    resolve(code);
                } catch (err) { cleanup(); reject(err); }
            }
            if (connection === 'close') {
                const code = lastDisconnect?.error instanceof Boom
                    ? lastDisconnect.error.output.statusCode
                    : lastDisconnect?.error?.statusCode;
                if (code === DisconnectReason.restartRequired && codeObtained && !cancelled) {
                    status = 'connecting';
                    try { currentSock = await buildSocket(); attach(currentSock); } catch (e) { cleanup(); reject(e); }
                    return;
                }
                clearTimeout(aliveTimer); clearTimeout(noQRTimer);
                if (everConn) {
                    status = 'disconnected';
                    reconnectTimer = setTimeout(() => connectQR(), 5_000);
                } else { cleanup(); if (!codeObtained) reject(new Error('Conexión cerrada antes de obtener código.')); }
            } else if (connection === 'open') {
                clearTimeout(aliveTimer); clearTimeout(noQRTimer);
                everConn = true; status = 'connected'; qrRaw = null;
                const me = s.authState?.creds?.me;
                device   = { phone: me?.id?.split(':')[0]?.split('@')[0] ?? phoneNumber, name: me?.name ?? null, connectedAt: new Date().toISOString() };
                bus.emit('connected', device);
            }
        });
    };

    try { currentSock = await buildSocket(); attach(currentSock); } catch (e) { cleanup(); reject(e); }
});

// ── Disconnect ──────────────────────────────────────────────────────────────
const disconnect = () => {
    clearReconnect();
    everConn = false;
    device   = null;
    status   = 'idle';
    if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    killSocket(true);
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
};

// ── Send text ───────────────────────────────────────────────────────────────
const sendText = async (jid, text) => {
    if (!sock || status !== 'connected') throw new Error('WhatsApp no conectado');
    await sock.sendMessage(jid, { text });
};

// ── Send image ──────────────────────────────────────────────────────────────
const sendImage = async (jid, imageUrl, caption = '') => {
    if (!sock || status !== 'connected') throw new Error('WhatsApp no conectado');
    await sock.sendMessage(jid, { image: { url: imageUrl }, caption });
};

// ── Send image from buffer ──────────────────────────────────────────────────
const sendImageBuffer = async (jid, buffer, mimetype, caption = '') => {
    if (!sock || status !== 'connected') throw new Error('WhatsApp no conectado');
    await sock.sendMessage(jid, { image: buffer, mimetype, caption });
};

// ── Get QR as data URL ──────────────────────────────────────────────────────
const getQR = async () => {
    if (!qrRaw) return null;
    try { return await QRCode.toDataURL(qrRaw, { margin: 1, width: 220 }); } catch (_) { return null; }
};

// ── Restore session on startup ──────────────────────────────────────────────
const restoreSession = () => {
    if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) connectQR();
};

// ── Public getters ──────────────────────────────────────────────────────────
const getStatus = () => status;
const getDevice = () => device;

module.exports = {
    connectQR, connectPairing, disconnect,
    sendText, sendImage, sendImageBuffer,
    getQR, getStatus, getDevice, restoreSession,
    on:  (e, fn) => bus.on(e, fn),
    off: (e, fn) => bus.off(e, fn),
};
