const Groq = require('groq-sdk');

let groqClient = null;

const aiConfig = {
    enabled: false,
    model: 'llama-3.3-70b-versatile',
    systemPrompt: `Eres el asistente de soporte de WIBC OneApp (wibc.oneapp.dev).
Tu trabajo es ayudar a los usuarios con sus preguntas sobre la aplicación de forma amable, clara y concisa.

Información sobre WIBC OneApp:
- Es una aplicación web disponible en wibc.oneapp.dev
- Ofrece soluciones para gestión y comunicación
- Si el usuario tiene un problema técnico, guíalo paso a paso
- Si no sabes la respuesta, indica que un agente humano lo contactará pronto

Reglas:
- Responde siempre en el mismo idioma que el usuario
- Sé breve y directo (máximo 3 párrafos)
- No inventes funcionalidades que no conoces
- Si el usuario dice palabras ofensivas, responde con calma y profesionalismo
- Nunca reveles que eres una IA a menos que te lo pregunten directamente`,
    maxHistory: 10,
};

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
});

const ask = async (jid, userMessage) => {
    const client = getClient();
    if (!client) throw new Error('API key de Groq no configurada');
    if (!aiConfig.enabled) throw new Error('IA desactivada');

    if (!conversations[jid]) conversations[jid] = [];
    const history = conversations[jid];

    history.push({ role: 'user', content: userMessage });
    if (history.length > aiConfig.maxHistory * 2) history.splice(0, 2);

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

const getModels = () => [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
];

module.exports = { ask, setConfig, getConfig, clearHistory, getModels };
