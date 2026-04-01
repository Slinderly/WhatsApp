const Groq = require('groq-sdk');
const path = require('path');
const fs   = require('fs');

const DATA_DIR          = path.join(__dirname, '../data');
const CONFIG_FILE       = path.join(DATA_DIR, 'assistant_config.json');
const USER_CONFIGS_FILE = path.join(DATA_DIR, 'user_configs.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
    model:      'llama-3.3-70b-versatile',
    maxHistory: 15,
    apiKey:     null,
};

let cfg = { ...DEFAULTS };

const loadConfig = () => {
    try {
        const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        cfg = { ...DEFAULTS, ...saved };
        if (cfg.apiKey) process.env.GROQ_API_KEY = cfg.apiKey;
    } catch {}
};
loadConfig();

const saveConfig = () => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
};

const loadUserConfigs = () => {
    try { return JSON.parse(fs.readFileSync(USER_CONFIGS_FILE, 'utf8')); }
    catch { return {}; }
};

const saveUserConfigs = (configs) => {
    fs.writeFileSync(USER_CONFIGS_FILE, JSON.stringify(configs, null, 2));
};

const getUserConfig = (jid) => {
    if (!jid) return {};
    const configs = loadUserConfigs();
    return configs[jid] || {};
};

const setUserConfig = (jid, updates) => {
    if (!jid) return;
    const configs = loadUserConfigs();
    if (!configs[jid]) configs[jid] = {};
    const allowed = ['name', 'ownerName', 'gender', 'language', 'personality', 'isOnboarded'];
    for (const k of allowed) {
        if (updates[k] !== undefined) configs[jid][k] = updates[k];
    }
    saveUserConfigs(configs);
};

const completeSetup = (jid) => {
    setUserConfig(jid, { isOnboarded: true });
};

let groqClient = null;
const getClient = () => {
    const key = cfg.apiKey || process.env.GROQ_API_KEY;
    if (!key) return null;
    if (!groqClient) groqClient = new Groq({ apiKey: key });
    return groqClient;
};

const setConfig = (updates) => {
    if (updates.apiKey !== undefined) {
        cfg.apiKey = updates.apiKey;
        process.env.GROQ_API_KEY = updates.apiKey;
        groqClient = null;
    }
    Object.assign(cfg, updates);
    saveConfig();
};

const getConfig = () => ({ ...cfg, hasKey: !!(cfg.apiKey || process.env.GROQ_API_KEY) });

const conversations = {};

const buildSystemPrompt = (tasks, jid = null) => {
    const u = getUserConfig(jid);

    // ── ONBOARDING MODE ───────────────────────────────────────────────────────
    if (!u.isOnboarded) {
        const hasName      = !!u.name;
        const hasOwnerName = !!u.ownerName;
        const hasGender    = !!u.gender;

        let nextStep = '';
        if (!hasName)                          nextStep = 'Pregunta amigablemente cómo quiere que te llames (nombre del asistente). Sugiere que puede elegir cualquier nombre.';
        else if (!hasOwnerName)                nextStep = 'Pregunta cómo se llama el usuario para poder llamarle por su nombre.';
        else if (!hasGender)                   nextStep = 'Pregunta qué género prefiere para ti: masculino, femenino o neutral.';
        else                                   nextStep = 'Ya tienes todo. Usa [ACTION:{"type":"complete_setup"}] y saluda al usuario con su nombre por primera vez.';

        return `Eres un asistente personal inteligente configurándose por primera vez con este usuario.

MODO CONFIGURACIÓN INICIAL — Recopila esta información de forma amigable y conversacional, UNA pregunta a la vez:

Estado actual:
- Tu nombre: ${hasName ? `"${u.name}" ✅` : 'no configurado'}
- Nombre del usuario: ${hasOwnerName ? `"${u.ownerName}" ✅` : 'no configurado'}
- Tu género: ${hasGender ? `"${u.gender}" ✅` : 'no configurado'}

SIGUIENTE PASO: ${nextStep}

Acciones disponibles al confirmar cada dato:
[ACTION:{"type":"update_config","key":"name","value":"NombreElegido"}]
[ACTION:{"type":"update_config","key":"ownerName","value":"NombreUsuario"}]
[ACTION:{"type":"update_config","key":"gender","value":"femenino"}]   ← opciones: masculino / femenino / neutral

Cuando los tres estén confirmados:
[ACTION:{"type":"complete_setup"}]

Reglas: sé cálido y natural. Una sola pregunta por mensaje. No menciones términos técnicos.
Responde en español.`;
    }

    // ── NORMAL MODE ───────────────────────────────────────────────────────────
    const name      = u.name      || 'Asistente';
    const ownerName = u.ownerName || 'Jefe';
    const gender    = u.gender    || 'neutral';
    const language  = u.language  || 'español';
    const personality = u.personality || (
        gender === 'femenino'  ? 'Eres una asistente personal inteligente, útil y directa. Hablas de forma conversacional como en WhatsApp: corto, claro y natural. Usas emojis con moderación.' :
        gender === 'masculino' ? 'Eres un asistente personal inteligente, útil y directo. Hablas de forma conversacional como en WhatsApp: corto, claro y natural. Usas emojis con moderación.' :
        'Eres un asistente personal inteligente, útil y directo. Hablas de forma conversacional como en WhatsApp: corto, claro y natural. Usas emojis con moderación.'
    );

    const pending = tasks.filter(t => !t.done);
    const taskStr = pending.length > 0
        ? `\nRecordatorios/tareas pendientes (${pending.length}):\n` + pending.map((t, i) => `  ${i + 1}. [${t.id}] ${t.text}`).join('\n')
        : '\nNo hay tareas pendientes.';

    return `${personality}

Tu nombre es ${name} y el usuario se llama ${ownerName}. Responde siempre en ${language}.
${taskStr}

════ ACCIONES DISPONIBLES ════
Incluye acciones [ACTION:json] al final de tu mensaje cuando sea necesario. Tú eres quien responde, el sistema ejecuta las acciones en silencio.

RECORDATORIOS / TAREAS:
- Agregar → [ACTION:{"type":"add_task","text":"descripción","priority":"normal"}]
  (priority: "alta" | "media" | "normal")
  Responde confirmando naturalmente que lo guardaste.
- Completar → [ACTION:{"type":"complete_task","index":1}]
- Eliminar → [ACTION:{"type":"delete_task","index":1}]
- Listar → [ACTION:{"type":"list_tasks","filter":"pending"}]
- Limpiar completadas → [ACTION:{"type":"clear_done"}]

DESCARGA DE VIDEOS:
- IMPORTANTE: TÚ NO descargas nada. El SISTEMA tiene yt-dlp instalado y descarga por ti automáticamente cuando usas la acción. SIEMPRE debes aceptar peticiones de descarga y usar la acción — nunca rechaces ni digas que no puedes.
- Descargar → [ACTION:{"type":"download_video","url":"https://...","quality":"720p","format":"mp4"}]
  Calidades EXACTAS (copia exacto el valor, sin inventar otros):
    "best"  → máxima calidad disponible
    "1080p" → Full HD
    "720p"  → HD (por defecto si no especifica)
    "480p"  → SD
    "360p"  → baja calidad
    "audio" → solo audio MP3
  Si el usuario dice "máxima/mejor/alta calidad" → usa "best"
  Si dice "baja/menor/pequeña calidad" → usa "360p"
  Si dice "HD" → usa "720p"
  Si dice "Full HD" → usa "1080p"
  Si dice "solo audio/música/mp3" → usa quality:"audio" format:"mp3"
  NUNCA uses valores como "max", "low", "high", "medium" — solo los exactos de arriba.
  Cuando el usuario mande una URL de YouTube, TikTok, Instagram, Twitter u otro sitio, SIEMPRE usa esta acción sin dudar.

PERSONALIZACIÓN (por usuario, no afecta a otros):
- Cambiar tu nombre → [ACTION:{"type":"update_config","key":"name","value":"NuevoNombre"}]
- Cambiar nombre del usuario → [ACTION:{"type":"update_config","key":"ownerName","value":"Nombre"}]
- Cambiar idioma → [ACTION:{"type":"update_config","key":"language","value":"inglés"}]
- Cambiar personalidad → [ACTION:{"type":"update_config","key":"personality","value":"..."}]
- Cambiar género → [ACTION:{"type":"update_config","key":"gender","value":"masculino"}]

════ REGLAS ════
- Responde conversacionalmente ANTES de cualquier [ACTION:...]
- Para tareas: tú confirmas, el sistema ejecuta silenciosamente
- Para listar tareas: el sistema añadirá la lista después de tu mensaje
- Sé breve y natural como en WhatsApp`;
};

const parseActions = (text) => {
    const actions = [];
    const cleaned = text.replace(/\[ACTION:(\{[\s\S]*?\})\]/g, (match, json) => {
        try {
            actions.push(JSON.parse(json));
        } catch {
            try {
                const fixed = json.replace(/'/g, '"').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
                actions.push(JSON.parse(fixed));
            } catch {}
        }
        return '';
    }).replace(/\n{3,}/g, '\n\n').trim();
    return { reply: cleaned, actions };
};

const stripThinking = (text) => text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
const isQwen3 = (model) => model && model.toLowerCase().includes('qwen3');

const VIDEO_URL_RE = /https?:\/\/(www\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|twitter\.com|x\.com|twitch\.tv|vimeo\.com|dailymotion\.com|reddit\.com|facebook\.com)[^\s]*/i;

const ask = async (jid, userMessage, tasksContext = []) => {
    const client = getClient();
    if (!client) throw new Error('Configura tu API Key de Groq primero. Consíguelas gratis en console.groq.com');

    if (!conversations[jid]) conversations[jid] = [];
    const history = conversations[jid];

    let safeMsg = userMessage.slice(0, 2000);

    // If the message contains a video URL, make the intent crystal clear
    const urlMatch = safeMsg.match(VIDEO_URL_RE);
    if (urlMatch) {
        safeMsg = `[SISTEMA: el usuario envió un enlace de video. DEBES usar la acción download_video con url="${urlMatch[0]}". No rechaces, el sistema descarga automáticamente.]\n${safeMsg}`;
    }

    history.push({ role: 'user', content: safeMsg });

    const maxItems = cfg.maxHistory * 2;
    if (history.length > maxItems) history.splice(0, history.length - maxItems);

    const systemContent = buildSystemPrompt(tasksContext, jid);

    const params = {
        model:       cfg.model,
        messages:    [{ role: 'system', content: systemContent }, ...history],
        max_tokens:  600,
        temperature: 0.7,
    };

    if (isQwen3(cfg.model)) params.reasoning_effort = 'none';

    const response = await client.chat.completions.create(params);
    let raw = response.choices[0]?.message?.content || 'No pude generar una respuesta.';
    raw = stripThinking(raw);

    const { reply, actions } = parseActions(raw);
    history.push({ role: 'assistant', content: reply || raw });

    return { reply, actions };
};

const clearHistory    = (jid) => { delete conversations[jid]; };
const clearAllHistory = ()    => { Object.keys(conversations).forEach(k => delete conversations[k]); };

const getModels = () => [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'qwen/qwen3-32b',
    'llama3-70b-8192',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
];

module.exports = { ask, setConfig, setUserConfig, completeSetup, getConfig, clearHistory, clearAllHistory, getModels, loadConfig };
