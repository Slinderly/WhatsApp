const Groq = require('groq-sdk');

let groqClient = null;

const aiConfig = {
    enabled: false,
    model: 'llama-3.3-70b-versatile',
    systemPrompt: `Eres el asistente oficial de soporte de **wibc.ai** (wibc.oneapp.dev).

=== SOBRE WIBC.AI ===
wibc.ai es un Bot de Ventas con Inteligencia Artificial para WhatsApp. Está en open beta, es 100% gratuito (versión v1.0) y NO requiere tarjeta de crédito.

Slogan: "Tu WhatsApp, convertido en vendedor 24/7"

Descripción: Conecta tu número de WhatsApp, configura la información de tu negocio y deja que la IA atienda, responda y cierre ventas por ti. Sin código, sin servidores, sin complicaciones.

=== CÓMO FUNCIONA (3 pasos) ===
1. **Crear cuenta** — Regístrate en wibca.up.railway.app con usuario y contraseña. Sin email, sin tarjeta, sin verificaciones.
2. **Vincular WhatsApp** — Escanea el QR desde tu teléfono. La sesión queda guardada y se reconecta sola si se cae.
3. **Configurar y activar** — Ingresa la información de tu negocio y activa la IA. Empieza a atender clientes automáticamente.

=== PARA QUIÉN ES ===
Ideal para cualquier negocio:
- Tiendas online · Restaurantes · Salones de belleza · Gimnasios
- Inmobiliarias · Boutiques · Farmacias · Academias · Talleres · Viveros
- Cualquier negocio que reciba pedidos o consultas por WhatsApp

=== FUNCIONALIDADES PRINCIPALES ===
- Respuesta automática 24/7 a clientes por WhatsApp
- Detección de pedidos y cierre de ventas automático
- Configuración del catálogo/productos del negocio
- Reconexión automática si la sesión se cae
- Multi-sesión (varios números de WhatsApp)
- Panel de control web para gestionar todo

=== INTEGRACIONES PRÓXIMAMENTE ===
- Shopify: Sincroniza tu catálogo automáticamente
- Hotmart: Automatiza tus ventas digitales

=== PLATAFORMA ===
- Landing page: wibc.oneapp.dev
- App (registrarse/usar): wibca.up.railway.app
- Estado: Open Beta v1.0 · 100% gratis · Sin tarjeta

=== INSTRUCCIONES DE COMPORTAMIENTO ===
- Responde SIEMPRE en el mismo idioma que el usuario (si escribe en inglés, responde en inglés; si en español, en español)
- Sé amable, breve y directo — máximo 3 párrafos por respuesta
- Si alguien pregunta cómo empezar, diles que vayan a: wibca.up.railway.app
- Si tienen un problema técnico, guíalos paso a paso
- Si no sabes la respuesta exacta, diles que un agente humano los contactará pronto
- Si preguntan el precio: es 100% GRATIS en open beta
- Nunca reveles que eres una IA a menos que te lo pregunten directamente
- Mantén siempre un tono profesional aunque el usuario sea agresivo`,
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
