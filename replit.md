# Asistente Personal — WhatsApp AI

Un asistente personal controlado 100% desde WhatsApp. Escríbele y él gestiona tus tareas, descarga videos, y puede personalizarse al instante.

---

## Arquitectura

Servidor único Node.js/Express que sirve:
- Frontend estático desde `public/` (HTML + CSS + JS, sin frameworks)
- REST API para WhatsApp, tareas, descargas y configuración del asistente

Todo corre en **puerto 5000**.

---

## Tecnologías

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20 (CommonJS) |
| Backend | Express 5 |
| WhatsApp | @whiskeysockets/baileys |
| IA | Groq SDK (llama / qwen models) |
| Descarga de videos | yt-dlp (sistema) + ffmpeg |
| Frontend | Vanilla HTML + CSS + JS |
| QR | qrcode |

---

## Estructura del proyecto

```
├── server.js               # Entry point: rutas API, manejador de eventos WA, ejecutor de acciones
├── package.json
├── src/
│   ├── whatsapp.js         # Motor WhatsApp: QR/pairing, reconexión, presencia, envío de video
│   ├── assistant.js        # Asistente IA: prompt dinámico con tareas, parseo de [ACTION:json]
│   ├── tasks.js            # Gestor de tareas: CRUD, prioridades, formateo
│   └── downloader.js       # Descargador de videos con yt-dlp, historial
├── public/                 # Frontend
│   ├── index.html          # Tabs: Inicio, Vincular, Tareas, Descargas, Configurar
│   ├── css/style.css
│   └── js/app.js
├── sessions/               # Auth Baileys (auto-generado)
└── data/                   # tasks.json, downloads_history.json, assistant_config.json, downloads/
```

---

## Cómo funciona el asistente

La IA recibe cada mensaje de WhatsApp y genera una respuesta + acciones opcionales.

**Formato de acciones** (la IA las incluye en su respuesta):
```
[ACTION:{"type":"add_task","text":"ir al gym","priority":"alta"}]
[ACTION:{"type":"download_video","url":"https://..."}]
[ACTION:{"type":"update_config","key":"name","value":"Mia"}]
```

**Acciones disponibles:**
- `add_task` — agrega tarea
- `complete_task` — completa tarea por índice
- `delete_task` — elimina tarea
- `list_tasks` — lista tareas
- `clear_done` — limpia completadas
- `download_video` — descarga con yt-dlp y envía el video
- `update_config` — modifica configuración del asistente

---

## Configuración persistente (`data/assistant_config.json`)

| Campo | Descripción | Default |
|-------|-------------|---------|
| `name` | Nombre del asistente | Asistente |
| `ownerName` | Tu nombre | Jefe |
| `language` | Idioma de respuestas | español |
| `personality` | Prompt de personalidad | ... |
| `model` | Modelo Groq | llama-3.3-70b-versatile |
| `maxHistory` | Mensajes de historial | 15 |
| `apiKey` | API Key Groq | null |

---

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `PORT` | Puerto del servidor (default: 5000) |
| `GROQ_API_KEY` | Clave API de Groq (también configurable desde UI/WhatsApp) |

---

## Deployment

- **Target**: VM (always-running — conexión WebSocket persistente de WhatsApp)
- **Run**: `node server.js`
- Sesiones guardadas en `sessions/`, datos en `data/`
