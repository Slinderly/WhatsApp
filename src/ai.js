const Groq = require('groq-sdk');

let groqClient = null;

const aiConfig = {
    enabled: false,
    model: 'llama-3.3-70b-versatile',
    systemPrompt: `Eres el asistente de soporte de wibc.ai 🤖, un bot de ventas con IA para WhatsApp. Hablas de forma cercana, cálida y natural, como un amigo que te ayuda.

LO QUE ES WIBC.AI:
- Bot de ventas con IA para WhatsApp, 100% gratis en open beta 🎉
- Tu WhatsApp se convierte en vendedor 24/7: atiende clientes, responde preguntas y cierra ventas solo
- Sin código, sin servidores, sin tarjeta de crédito
- Activo en menos de 5 minutos ⚡

CÓMO EMPEZAR (3 pasos):
1. Crea tu cuenta en wibca.up.railway.app (sin email, solo usuario y contraseña)
2. Escanea el QR con tu WhatsApp
3. Configura la info de tu negocio y activa la IA

SIRVE PARA: tiendas online, restaurantes, salones de belleza, gimnasios, inmobiliarias, boutiques, farmacias, academias, talleres y más 🏪

PRÓXIMAMENTE: integración con Shopify y Hotmart 🔥

REGLAS DE RESPUESTA (MUY IMPORTANTE):
- Responde SIEMPRE en el idioma del usuario
- Usa emojis de forma natural, no exagerada 😊
- Respuestas MUY cortas: máximo 2 oraciones
- Tono amigable y cercano, como un amigo
- Si preguntan el precio: "¡Es gratis! 🎁"
- Si quieren empezar: mándales a wibca.up.railway.app
- Si no sabes algo: "Déjame consultarlo con el equipo y te aviso 🙌"
- Nunca digas que eres IA salvo que pregunten directamente`,
    maxHistory: 10,
};

// Conversaciones separadas por JID — cada usuario tiene su propio historial
const conversations = {};

const getClient = () => {
    const key = process.env.GROQ_API_KEY;
    if (!key) return null;
    if (!groqClient) groqClient = new Groq({ apiKey: key });
    return groqClient;
};

const setConfig = (updates) => {
    if (updates.apiKey !== undefined) {
        process.env.GROQ_API_KEY = updates.apiKey;
        groqClient = null;
        delete updates.apiKey;
    }
    Object.assign(aiConfig, updates);
};

const getConfig = () => ({
    ...aiConfig,
    hasKey: !!(process.env.GROQ_API_KEY),
    activeConversations: Object.keys(conversations).length,
});

const ask = async (jid, userMessage) => {
    const client = getClient();
    if (!client) throw new Error('API key de Groq no configurada');
    if (!aiConfig.enabled) throw new Error('IA desactivada');

    // Cada JID tiene su propio historial — nunca se mezclan usuarios
    if (!conversations[jid]) conversations[jid] = [];
    const history = conversations[jid];

    history.push({ role: 'user', content: userMessage });

    // Mantener máximo maxHistory turnos (entrada + respuesta = 2 items por turno)
    const maxItems = aiConfig.maxHistory * 2;
    if (history.length > maxItems) history.splice(0, history.length - maxItems);

    const response = await client.chat.completions.create({
        model: aiConfig.model,
        messages: [
            { role: 'system', content: aiConfig.systemPrompt },
            ...history,
        ],
        max_tokens: 1024,
        temperature: 0.7,
    });

    const reply = response.choices[0]?.message?.content || 'No pude generar una respuesta.';
    history.push({ role: 'assistant', content: reply });
    return reply;
};

const clearHistory = (jid) => { delete conversations[jid]; };
const clearAllHistory = () => { Object.keys(conversations).forEach(k => delete conversations[k]); };

const getModels = () => [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
];

module.exports = { ask, setConfig, getConfig, clearHistory, clearAllHistory, getModels };
