# WA Framework

Framework de WhatsApp Web multi-sesión listo para producción, basado en [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys). Conéctalo a tu proyecto con 3 líneas de código.

```js
const wa = require('./src/whatsapp');

wa.on('message', (msg) => {
    console.log(`${msg.from}: ${msg.text}`);
    // Aquí va tu IA, base de datos, lógica de negocio...
});

wa.restoreSessions();
```

---

## Características

- **Multi-cuenta y multi-sesión** — cada cuenta puede tener múltiples números de WhatsApp conectados simultáneamente
- **QR y código de emparejamiento** — dos métodos de vinculación listos para usar
- **Reconexión automática** — si se cae la conexión, reconecta solo; al reiniciar el servidor, restaura todas las sesiones guardadas
- **EventEmitter limpio** — escucha `message`, `connected` y `disconnected` y añade tu lógica sin tocar el framework
- **REST API completa** — endpoints listos para montar en cualquier servidor Express
- **Demo UI incluida** — interfaz dark para probar todo sin escribir código

---

## Instalación

```bash
git clone https://github.com/tu-usuario/wa-framework.git
cd wa-framework
npm install
node server.js
```

Abre `http://localhost:5000` para ver la UI de demo.

---

## Estructura

```
├── server.js           Servidor de demo (Express + event listeners)
├── src/
│   └── whatsapp.js     ← El framework. Solo copia este archivo a tu proyecto
├── public/
│   ├── index.html      Demo UI
│   ├── css/style.css
│   └── js/app.js
├── sessions/           Credenciales de sesión (auto-generado, en .gitignore)
└── package.json
```

---

## Uso del módulo

### Conectar

```js
const wa = require('./src/whatsapp');

// Por QR — luego haz polling a getQRDataUrl() para mostrar el código
await wa.connectQR('mi-cuenta', 'sesion-1');

// Por código de emparejamiento — devuelve el código directamente
const code = await wa.connectPairing('mi-cuenta', 'sesion-2', '+5219991234567');
console.log('Código:', code); // "ABCD-1234"

// Desconectar (borra archivos de sesión)
wa.disconnectSession('mi-cuenta', 'sesion-1');
```

### Enviar mensajes

```js
// Usa cualquier sesión activa de la cuenta
await wa.sendMessage('mi-cuenta', '5219991234567@s.whatsapp.net', 'Hola!');

// Usa una sesión específica
await wa.sendMessageFromSession('mi-cuenta', 'sesion-1', jid, texto);
```

### Escuchar eventos

```js
// Mensaje entrante
wa.on('message', (msg) => {
    // msg.accountId  — tu identificador de cuenta
    // msg.sessionId  — qué sesión recibió el mensaje
    // msg.jid        — número completo (5219991234567@s.whatsapp.net)
    // msg.from       — nombre del contacto o número
    // msg.text       — texto del mensaje
    // msg.timestamp  — timestamp en ms
    // msg.raw        — objeto completo de Baileys
});

wa.on('connected',    ({ accountId, sessionId, phone }) => { ... });
wa.on('disconnected', ({ accountId, sessionId, reason }) => { ... });

// Quitar listener
wa.off('message', miHandler);
```

### Consultar estado

```js
const sessions = wa.getSessions('mi-cuenta');
// [{ sessionId, status, device: { phone, name, connectedAt } }]

const status = wa.getSessionStatus('mi-cuenta', 'sesion-1');
// { sessionId, status, device, hasQR }

const qrDataUrl = await wa.getQRDataUrl('mi-cuenta', 'sesion-1');
// "data:image/png;base64,..." o null
```

### Al iniciar tu servidor

```js
wa.restoreSessions(); // reconecta todas las sesiones guardadas en /sessions
```

---

## REST API

### Montar las rutas en Express

```js
const wa = require('./src/whatsapp');

app.get   ('/wa/sessions/:accountId',            wa.handlers.getSessions);
app.get   ('/wa/status/:accountId/:sessionId',   wa.handlers.getStatus);
app.post  ('/wa/connect/qr',                     wa.handlers.connectQR);
app.post  ('/wa/connect/pairing',                wa.handlers.connectPairing);
app.delete('/wa/sessions/:accountId/:sessionId', wa.handlers.disconnect);
app.post  ('/wa/send',                           wa.handlers.send);
```

### Referencia de endpoints

| Método | Endpoint | Body / Query | Descripción |
|--------|----------|--------------|-------------|
| `GET` | `/wa/sessions/:accountId` | — | Lista sesiones con estado y dispositivo |
| `GET` | `/wa/status/:accountId/:sessionId` | — | Estado + QR como data URL |
| `POST` | `/wa/connect/qr` | `{ accountId, sessionId? }` | Inicia conexión por QR |
| `POST` | `/wa/connect/pairing` | `{ accountId, phoneNumber, sessionId? }` | Inicia conexión por código |
| `DELETE` | `/wa/sessions/:accountId/:sessionId` | — | Desconecta y elimina sesión |
| `POST` | `/wa/send` | `{ accountId, jid, text, sessionId? }` | Envía mensaje de texto |

### Respuestas de estado (`status`)

| Valor | Significado |
|-------|-------------|
| `idle` | No iniciada |
| `connecting` | Conectando con WhatsApp |
| `qr_ready` | QR disponible para escanear |
| `connected` | Conectada y operativa |
| `disconnected` | Desconectada (intentará reconectar si ya estuvo conectada) |
| `timeout` | QR expirado (120 s sin escanear) |

---

## Integración típica

```js
const express = require('express');
const wa      = require('./src/whatsapp');

const app = express();
app.use(express.json());

// Montar API
app.get   ('/wa/sessions/:accountId',            wa.handlers.getSessions);
app.get   ('/wa/status/:accountId/:sessionId',   wa.handlers.getStatus);
app.post  ('/wa/connect/qr',                     wa.handlers.connectQR);
app.post  ('/wa/connect/pairing',                wa.handlers.connectPairing);
app.delete('/wa/sessions/:accountId/:sessionId', wa.handlers.disconnect);
app.post  ('/wa/send',                           wa.handlers.send);

// Tu lógica de negocio
wa.on('message', async (msg) => {
    const reply = await miIA.responder(msg.text);
    await wa.sendMessage(msg.accountId, msg.jid, reply);
});

app.listen(3000, () => {
    wa.restoreSessions();
});
```

---

## Dependencias

| Paquete | Para qué |
|---------|----------|
| `@whiskeysockets/baileys` | Protocolo WhatsApp Web |
| `@hapi/boom` | Manejo de errores de Baileys |
| `qrcode` | Generación de QR como PNG/data URL |
| `pino` | Logger (silent en sockets) |
| `express` | Servidor HTTP de la demo |
| `cors` | CORS para la demo |

---

## Notas

- Las sesiones se guardan en `/sessions/auth_{accountId}_{sessionId}/` y sobreviven reinicios del servidor.
- El folder `/sessions/` está en `.gitignore` — nunca subas credenciales al repo.
- Un `accountId` puede tener N sesiones (números de WhatsApp) activas al mismo tiempo.
- Al enviar con `sendMessage()` sin `sessionId`, usa la primera sesión conectada del `accountId`.
