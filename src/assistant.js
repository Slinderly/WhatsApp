const Groq = require('groq-sdk');
const path = require('path');
const fs   = require('fs');

const DATA_DIR          = path.join(__dirname, '../data');
const CONFIG_FILE       = path.join(DATA_DIR, 'assistant_config.json');
const USER_CONFIGS_FILE = path.join(DATA_DIR, 'user_configs.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
    name:        'Asistente',
    ownerName:   'Jefe',
    language:    'español',
    personality: 'Eres un asistente personal inteligente, útil y directo. Respondes de forma conversacional como en WhatsApp: corto, claro y natural. Usas emojis con moderación.',
    model:       'llama-3.3-70b-versatile',
    maxHistory:  15,
    apiKey:      null,
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
    const allowed = ['name', 'ownerName', 'language', 'personality'];
    for (const k of allowed) {
        if (updates[k] !== undefined) configs[jid][k] = updates[k];
    }
    saveUserConfigs(configs);
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
    const userCfg = getUserConfig(jid);
    const name        = userCfg.name        || cfg.name;
    const ownerName   = userCfg.ownerName   || cfg.ownerName;
    const language    = userCfg.language    || cfg.language;
    const personality = userCfg.personality || cfg.personality;

    const pending = tasks.filter(t => !t.done);
    const taskStr = pending.length > 0
        ? `\nTareas pendientes (${pending.length}):\n` + pending.map((t, i) => `  ${i + 1}. [${t.id}] ${t.text}`).join('\n')
        : '\nNo hay tareas pendientes.';

    return `${personality}

Tu nombre es ${name} y tu dueño se llama ${ownerName}. Responde siempre en ${language}.
${taskStr}

════ ACCIONES DISPONIBLES ════
Cuando el usuario pida algo, incluye al final de tu mensaje la línea [ACTION:json] necesaria. El sistema ejecutará la acción silenciosamente — TÚ eres quien responde al usuario, no el sistema.

GESTIÓN DE TAREAS:
- Agregar tarea/recordatorio → [ACTION:{"type":"add_task","text":"descripción","priority":"normal"}]
  (priority: "alta", "media", "normal")
  Cuando agregues una tarea, responde naturalmente confirmando que la guardaste, sin esperar confirmación del sistema.
- Completar tarea → [ACTION:{"type":"complete_task","index":1}]
- Eliminar tarea → [ACTION:{"type":"delete_task","index":1}]
- Ver tareas pendientes → [ACTION:{"type":"list_tasks","filter":"pending"}]
- Ver todas → [ACTION:{"type":"list_tasks","filter":"all"}]
- Limpiar completadas → [ACTION:{"type":"clear_done"}]

DESCARGA DE VIDEOS:
- Descargar video → [ACTION:{"type":"download_video","url":"https://...","quality":"720p","format":"mp4"}]
  Solo cuando el usuario envíe una URL válida y pida descargarla.
  Calidades: "best", "2160p", "1080p", "720p", "480p", "360p", "audio"
  Si no especifica calidad, usa "720p". Si dice "máxima calidad" usa "best". Si dice "solo audio" usa quality "audio" y format "mp3".

CONFIGURACIÓN PERSONAL (cada usuario puede configurar su propia experiencia):
- Cambiar nombre del asistente → [ACTION:{"type":"update_config","key":"name","value":"Mia"}]
- Cambiar cómo te llama → [ACTION:{"type":"update_config","key":"ownerName","value":"Carlos"}]
- Cambiar idioma → [ACTION:{"type":"update_config","key":"language","value":"inglés"}]
- Cambiar personalidad → [ACTION:{"type":"update_config","key":"personality","value":"Eres..."}]

════ REGLAS ════
- SIEMPRE responde conversacionalmente ANTES de cualquier [ACTION:...]
- Para tareas y recordatorios: responde TÚ confirmando. No esperes al sistema.
- Para lista de tareas: di que las traes y usa el ACTION — el sistema enviará la lista.
- Sé natural, breve y amigable como en WhatsApp.`;
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

const ask = async (jid, userMessage, tasksContext = []) => {
    const client = getClient();
    if (!client) throw new Error('Configura tu API Key de Groq primero. Consíguelas gratis en console.groq.com');

    if (!conversations[jid]) conversations[jid] = [];
    const history = conversations[jid];

    const safeMsg = userMessage.slice(0, 2000);
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

module.exports = { ask, setConfig, setUserConfig, getConfig, clearHistory, clearAllHistory, getModels, loadConfig };
