const Groq = require('groq-sdk');

let groqClient = null;

const config = {
    enabled:      false,
    model:        'llama-3.3-70b-versatile',
    systemPrompt: `Eres Wibi, el asistente de soporte de wibc.ai 🤖

════ ¿QUÉ ES WIBC.AI? ════
wibc.ai es una plataforma para crear bots de ventas con IA para WhatsApp. 100% gratis en open beta.
Tu WhatsApp se convierte en vendedor 24/7: atiende clientes, responde preguntas, cierra ventas y detecta pedidos solo.
Sin código, sin servidores, sin tarjeta de crédito. Activo en 5 minutos ⚡
Entra en: wibc.oneapp.dev

Sirve para: tiendas online, restaurantes, salones, gimnasios, inmobiliarias, boutiques, farmacias, academias y más 🏪

════ CÓMO EMPEZAR ════
1️⃣ Crea tu cuenta en wibc.oneapp.dev (solo usuario y contraseña, sin email)
2️⃣ Conecta tu WhatsApp:
   • QR: ve a WhatsApp → Ajustes → Dispositivos vinculados → Vincular dispositivo → escanea
   • Código: ve a Dispositivos vinculados → Vincular con número → ingresa el código de 8 dígitos
3️⃣ Agrega tus productos en la sección "Productos"
4️⃣ Escribe o genera el prompt de tu bot en "Perfil → Personalización"
5️⃣ Consigue tu API Key gratis en console.groq.com → pégala en "Perfil → IA"
6️⃣ Activa el bot con el botón verde en Inicio ✅

════ MODELOS DISPONIBLES ════
• Qwen 3 32B — RECOMENDADO ⭐
• Llama 3.3 70B — máximo razonamiento
• Llama 3.1 8B — más rápido
• Gemma 2 9B, Mixtral 8x7B

════ SECCIONES DEL DASHBOARD ════
• Inicio — estado del bot ON/OFF, dispositivo conectado
• Vincular — conectar WhatsApp por QR o código
• Imágenes — sube imágenes con etiquetas para que el bot las envíe
• Configurar — prompt, modelo, API Key

════ FAQ ════
¿Costo? → ¡Gratis! open beta 🎁
¿Instalar algo? → No, todo en el navegador
¿Varios WhatsApp? → Sí
¿WhatsApp Business? → Sí
¿Detecta pedidos? → Sí, automáticamente
¿El bot habla otro idioma? → Responde en el idioma del cliente
¿Groq qué es? → Proveedor de IA gratuito. Key gratis en console.groq.com

════ PROBLEMAS COMUNES ════
QR no carga → espera y vuelve a intentar, o usa código de emparejamiento
Bot no responde → verifica que esté activo (verde), API Key correcta y WhatsApp conectado
Se desconectó → se reconecta solo; si no, re-escanea el QR

════ CÓMO RESPONDER ════
- Responde SIEMPRE en el idioma del usuario
- Respuestas MUY cortas, máximo 2-3 oraciones 📏
- Usa emojis de forma natural como un humano 😊
- Tono amigable y cercano, como un amigo
- Precio → "¡Es gratis! 🎁"
- Quieren empezar → mándalos a wibc.oneapp.dev
- No sabes algo → "No tengo ese dato, escríbenos al +591 64770568 🙌"
- Nunca digas que eres IA salvo que pregunten directamente`,
    maxHistory: 10,
};

// Per-JID conversation history
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
    Object.assign(config, updates);
};

const getConfig = () => ({
    ...config,
    hasKey: !!(process.env.GROQ_API_KEY),
    activeConversations: Object.keys(conversations).length,
});

// Build image context string for the system prompt
const buildImageContext = (images) => {
    if (!images || images.length === 0) return '';
    const list = images.map(img => `• ID:${img.id} — "${img.label}"`).join('\n');
    return `\n\n════ IMÁGENES DISPONIBLES ════\nPuedes enviar estas imágenes cuando sean relevantes para la conversación. Escribe [IMG:id] en tu respuesta para enviar una imagen. Puedes enviar varias.\n${list}\n\nEjemplo: si el cliente pregunta por el catálogo y tienes una imagen etiquetada "Catálogo de productos", incluye [IMG:abc123] en tu respuesta.`;
};

// Parse [IMG:id] tags from the AI response
const parseImageTags = (text) => {
    const imageIds = [];
    const cleaned  = text.replace(/\[IMG:([^\]]+)\]/g, (_match, id) => {
        imageIds.push(id.trim());
        return '';
    }).trim();
    return { reply: cleaned, imageIds };
};

const ask = async (jid, userMessage, images = []) => {
    const client = getClient();
    if (!client)         throw new Error('API key de Groq no configurada');
    if (!config.enabled) throw new Error('IA desactivada');

    if (!conversations[jid]) conversations[jid] = [];
    const history = conversations[jid];

    const safeMsg = userMessage.slice(0, 1500);
    history.push({ role: 'user', content: safeMsg });

    const maxItems = config.maxHistory * 2;
    if (history.length > maxItems) history.splice(0, history.length - maxItems);

    const systemContent = config.systemPrompt + buildImageContext(images);

    const response = await client.chat.completions.create({
        model:       config.model,
        messages:    [{ role: 'system', content: systemContent }, ...history],
        max_tokens:  512,
        temperature: 0.75,
    });

    const raw   = response.choices[0]?.message?.content || 'No pude generar una respuesta.';
    const { reply, imageIds } = parseImageTags(raw);

    history.push({ role: 'assistant', content: reply || raw });
    return { reply, imageIds };
};

const clearHistory    = (jid) => { delete conversations[jid]; };
const clearAllHistory = ()    => { Object.keys(conversations).forEach(k => delete conversations[k]); };

const getModels = () => [
    'qwen/qwen3-32b',
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'llama3-70b-8192',
    'llama3-8b-8192',
    'gemma2-9b-it',
    'mixtral-8x7b-32768',
];

module.exports = { ask, setConfig, getConfig, clearHistory, clearAllHistory, getModels };
