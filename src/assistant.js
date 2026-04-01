const Groq = require('groq-sdk');
const path = require('path');
const fs   = require('fs');

const DATA_DIR     = path.join(__dirname, '../data');
const CONFIG_FILE  = path.join(DATA_DIR, 'assistant_config.json');

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

const buildSystemPrompt = (tasks) => {
    const pending = tasks.filter(t => !t.done);
    const taskStr = pending.length > 0
        ? `\nTareas pendientes actuales (${pending.length}):\n` + pending.map((t, i) => `  ${i + 1}. [${t.id}] ${t.text}`).join('\n')
        : '\nNo hay tareas pendientes actualmente.';

    return `${cfg.personality}

Tu nombre es ${cfg.name} y tu dueño se llama ${cfg.ownerName}. Responde siempre en ${cfg.language}.
${taskStr}

════ ACCIONES DISPONIBLES ════
Cuando el usuario pide alguna de estas cosas, DEBES incluir al final de tu mensaje una o más líneas de acción con el formato exacto [ACTION:json]. Solo incluye el ACTION si realmente se necesita ejecutar algo.

GESTIÓN DE TAREAS:
- Agregar tarea → [ACTION:{"type":"add_task","text":"descripción de la tarea","priority":"normal"}]
  (priority puede ser: "alta", "media", "normal")
- Completar tarea → [ACTION:{"type":"complete_task","index":1}] (usa el número de la lista)
- Eliminar tarea → [ACTION:{"type":"delete_task","index":1}]
- Ver tareas pendientes → [ACTION:{"type":"list_tasks","filter":"pending"}]
- Ver todas las tareas → [ACTION:{"type":"list_tasks","filter":"all"}]
- Limpiar completadas → [ACTION:{"type":"clear_done"}]

DESCARGA DE VIDEOS:
- Descargar video → [ACTION:{"type":"download_video","url":"https://..."}]
  Solo cuando el usuario envíe una URL válida y pida descargarla.

CONFIGURACIÓN DEL ASISTENTE (solo si el usuario pide cambiar algo):
- Cambiar nombre del asistente → [ACTION:{"type":"update_config","key":"name","value":"NuevoNombre"}]
- Cambiar nombre del dueño → [ACTION:{"type":"update_config","key":"ownerName","value":"Nombre"}]
- Cambiar idioma → [ACTION:{"type":"update_config","key":"language","value":"inglés"}]
- Cambiar personalidad → [ACTION:{"type":"update_config","key":"personality","value":"Nueva personalidad..."}]
- Cambiar modelo → [ACTION:{"type":"update_config","key":"model","value":"llama-3.3-70b-versatile"}]
- Cambiar API Key → [ACTION:{"type":"update_config","key":"apiKey","value":"gsk_..."}]

════ REGLAS IMPORTANTES ════
- Siempre responde el texto conversacional ANTES de las líneas [ACTION:...]
- Si no se necesita ejecutar ninguna acción, no incluyas [ACTION:...]
- Sé natural y amigable como en una conversación de WhatsApp
- Para tareas: si el usuario dice "lista mis tareas" o similar, simplemente usa el ACTION y di que las estás trayendo
- El usuario puede pedirte varias acciones en un mensaje, ejecuta todas las necesarias`;
};

const parseActions = (text) => {
    const actions = [];
    const cleaned = text.replace(/\[ACTION:(\{[^}]+\}(?:\})?)\]/g, (match, json) => {
        try {
            const action = JSON.parse(json);
            actions.push(action);
        } catch {}
        return '';
    }).trim();
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

    const systemContent = buildSystemPrompt(tasksContext);

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

module.exports = { ask, setConfig, getConfig, clearHistory, clearAllHistory, getModels, loadConfig };
