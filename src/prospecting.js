const path = require('path');
const fs   = require('fs');
const ai   = require('./ai');

const DATA_DIR          = path.join(__dirname, '../data');
const CONTACTED_FILE    = path.join(DATA_DIR, 'contacted.json');
const CONFIG_FILE       = path.join(DATA_DIR, 'prospect_config.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Persistence ──────────────────────────────────────────────────────────────
const loadContacted = () => {
    try { return new Set(JSON.parse(fs.readFileSync(CONTACTED_FILE, 'utf8'))); }
    catch { return new Set(); }
};
const saveContacted = (set) =>
    fs.writeFileSync(CONTACTED_FILE, JSON.stringify([...set], null, 2));

const defaultConfig = {
    enabled:    false,
    delayMin:   25,
    delayMax:   55,
    maxPerHour: 20,
    template:   'Hola {nombre} 👋 Somos wibc.ai, una plataforma SaaS enfocada en la implementación de bots de ventas con IA 🤖 para automatizar la atención y convertir mensajes en ventas 💰. ¿Te gustaría conocer cómo funciona en tu negocio?',
};

let prospectConfig = { ...defaultConfig };
try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    prospectConfig = { ...defaultConfig, ...saved };
} catch {}

const saveConfig = () =>
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(prospectConfig, null, 2));

// ── State ────────────────────────────────────────────────────────────────────
let contacted    = loadContacted();
let queue        = [];
let isRunning    = false;
let hourCount    = 0;
let hourTimer    = null;
let scanTimer    = null;
let sendTimer    = null;
let waModule     = null;

let stats = {
    totalSent:    0,
    sentThisHour: 0,
    lastSentAt:   null,
    status:       'idle',
};

// ── Hour limiter ─────────────────────────────────────────────────────────────
const resetHour = () => {
    hourCount            = 0;
    stats.sentThisHour   = 0;
    if (hourTimer) clearTimeout(hourTimer);
    hourTimer = setTimeout(resetHour, 3_600_000);
    if (isRunning && prospectConfig.enabled && queue.length > 0) scheduleNext();
};
resetHour();

// ── Helpers ──────────────────────────────────────────────────────────────────
const randomDelay = () => {
    const min = prospectConfig.delayMin * 1000;
    const max = prospectConfig.delayMax * 1000;
    return Math.floor(Math.random() * (max - min) + min);
};

// Strip emojis and non-letter characters, return null if nothing useful remains
const sanitizeName = (raw) => {
    if (!raw) return null;
    // Remove emoji ranges and symbols, keep letters, numbers and spaces
    const clean = raw
        .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')  // emoji block
        .replace(/[\u{2600}-\u{27BF}]/gu, '')     // misc symbols
        .replace(/[^\p{L}\p{N}\s'-]/gu, '')       // keep letters, numbers, space, hyphen, apostrophe
        .trim();
    // Must have at least 2 meaningful characters
    if (clean.length < 2) return null;
    // Reject if it's all the same character repeated (e.g. "...", "---")
    if (/^(.)\1+$/.test(clean)) return null;
    // Reject if it's purely numeric (phone number used as name)
    if (/^\d+$/.test(clean)) return null;
    // Reject if less than half the characters are actual letters
    const letters = clean.match(/\p{L}/gu) || [];
    if (letters.length < 2) return null;
    return clean;
};

const buildMessage = (rawName) => {
    const name = sanitizeName(rawName);
    if (name) {
        return prospectConfig.template.replace('{nombre}', name);
    }
    // No valid name: remove {nombre} and any leading/trailing space around it
    return prospectConfig.template
        .replace(/\{nombre\}\s*/g, '')
        .replace(/\s*\{nombre\}/g, '')
        .trim();
};

// ── Core: scan groups and fill queue ────────────────────────────────────────
const scanGroups = async () => {
    if (!waModule) return;
    stats.status = 'scanning';
    try {
        const groups = await waModule.getGroups();
        const myJid  = waModule.getMyJid();
        let added    = 0;

        for (const group of groups) {
            try {
                const members = await waModule.getGroupParticipants(group.id);
                for (const p of members) {
                    const jid = p.id;
                    if (!jid || jid === myJid)           continue;
                    if (jid.endsWith('@g.us'))            continue;
                    if (contacted.has(jid))               continue;
                    if (queue.some(q => q.jid === jid))   continue;
                    queue.push({ jid, name: p.name || jid.split('@')[0].split(':')[0] });
                    added++;
                }
            } catch (err) {
                console.error('[PROSPECT] Error en grupo', group.id, err.message);
            }
        }
        console.log(`[PROSPECT] Scan: ${groups.length} grupos, ${added} nuevos en cola (total cola: ${queue.length})`);
    } catch (err) {
        console.error('[PROSPECT] Error escaneando grupos:', err.message);
    }
};

// ── Core: send to next contact ───────────────────────────────────────────────
const processNext = async () => {
    if (!prospectConfig.enabled || !isRunning || !waModule) return;

    if (hourCount >= prospectConfig.maxPerHour) {
        stats.status = 'paused';
        console.log('[PROSPECT] Límite de hora alcanzado. Reanuda en el próximo ciclo.');
        return;
    }

    if (queue.length === 0) {
        stats.status = 'idle';
        scanTimer = setTimeout(async () => {
            if (!prospectConfig.enabled || !isRunning) return;
            await scanGroups();
            scheduleNext();
        }, 10 * 60_000);
        return;
    }

    const contact = queue.shift();

    try {
        const msg = buildMessage(contact.name);

        await waModule.sendPresence(contact.jid, 'composing');
        await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        await waModule.sendPresence(contact.jid, 'paused');

        await waModule.sendText(contact.jid, msg);

        // Seed AI memory so the bot knows what was already sent to this user
        ai.primeHistory(contact.jid, msg);

        contacted.add(contact.jid);
        saveContacted(contacted);

        hourCount++;
        stats.totalSent++;
        stats.sentThisHour = hourCount;
        stats.lastSentAt   = new Date().toISOString();
        stats.status       = 'sending';

        console.log(`[PROSPECT] ✓ Enviado a ${contact.name} (${contact.jid.split('@')[0]})`);
    } catch (err) {
        console.error(`[PROSPECT] Error enviando a ${contact.jid}:`, err.message);
        contacted.add(contact.jid);
        saveContacted(contacted);
    }

    scheduleNext();
};

const scheduleNext = () => {
    if (!prospectConfig.enabled || !isRunning) return;
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }

    if (queue.length === 0) { processNext(); return; }

    const delay = randomDelay();
    console.log(`[PROSPECT] Próximo en ${Math.round(delay / 1000)}s — cola: ${queue.length}`);
    stats.status = 'sending';
    sendTimer = setTimeout(processNext, delay);
};

// ── Public API ───────────────────────────────────────────────────────────────
const init = (wa) => { waModule = wa; };

const start = async () => {
    if (isRunning) return;
    isRunning              = true;
    prospectConfig.enabled = true;
    saveConfig();
    console.log('[PROSPECT] Iniciando prospección...');
    await scanGroups();
    scheduleNext();
};

const stop = () => {
    isRunning              = false;
    prospectConfig.enabled = false;
    saveConfig();
    if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
    stats.status = 'stopped';
    console.log('[PROSPECT] Prospección detenida.');
};

const resetContacted = () => {
    contacted.clear();
    saveContacted(contacted);
    queue        = [];
    stats.totalSent = 0;
    stats.sentThisHour = 0;
    console.log('[PROSPECT] Lista de contactados reiniciada.');
};

const getStats = () => ({
    ...stats,
    queueSize:      queue.length,
    totalContacted: contacted.size,
    config:         { ...prospectConfig },
});

const setProspectConfig = (updates) => {
    Object.assign(prospectConfig, updates);
    saveConfig();
};

module.exports = { init, start, stop, resetContacted, getStats, setProspectConfig };
