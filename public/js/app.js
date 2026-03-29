// ── State ───────────────────────────────────────────────────────────────────
let currentStatus = 'idle';
let qrPollingInterval    = null;
let statusPollingInterval = null;

// ── Tab navigation ──────────────────────────────────────────────────────────
function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn, .bnav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === name);
    });
    const section = document.getElementById('tab-' + name);
    if (section) section.classList.add('active');
}

document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Toast ───────────────────────────────────────────────────────────────────
function toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = 'toast show ' + type;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 3200);
}

function setStatus(id, msg, type = '') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent   = msg;
    el.className     = 'card-status' + (type ? ' ' + type : '');
    el.style.display = msg ? '' : 'none';
}

// ── Status polling ──────────────────────────────────────────────────────────
async function fetchStatus() {
    try {
        const r = await fetch('/status');
        const d = await r.json();
        updateUI(d);
    } catch (_) {}
}

function updateUI({ status, device, qr }) {
    currentStatus = status;

    // Sidebar dot
    const wrap  = document.getElementById('sidebarStatus');
    const dot   = wrap.querySelector('.dot');
    const label = wrap.querySelector('.dot-label');
    dot.className = 'dot dot-' + status;
    const statusLabels = {
        idle:         'Sin conectar',
        connecting:   'Conectando…',
        connected:    'Conectado',
        disconnected: 'Desconectado',
        timeout:      'Tiempo agotado',
    };
    label.textContent = statusLabels[status] || status;

    // Device cards
    const deviceCard   = document.getElementById('deviceCard');
    const noDeviceCard = document.getElementById('noDeviceCard');
    if (status === 'connected' && device) {
        deviceCard.style.display   = '';
        noDeviceCard.style.display = 'none';
        document.getElementById('deviceInfo').innerHTML =
            `<div class="device-row"><strong>📱 ${device.phone}</strong>${device.name ? ' · ' + device.name : ''}</div>` +
            `<div class="device-row sub">Conectado el ${new Date(device.connectedAt).toLocaleString()}</div>`;
    } else {
        deviceCard.style.display   = 'none';
        noDeviceCard.style.display = '';
    }

    // QR box
    const qrBox = document.getElementById('qrBox');
    if (qr) {
        qrBox.innerHTML = `<img src="${qr}" alt="QR Code">`;
        setStatus('qrStatus', 'Escanea el QR desde tu WhatsApp', 'info');
    } else if (status === 'connected') {
        qrBox.innerHTML = '<span>✅ Conectado</span>';
        setStatus('qrStatus', '', '');
        stopQRPolling();
    } else if (status === 'connecting') {
        qrBox.innerHTML = '<span class="spinner"></span>';
        setStatus('qrStatus', 'Generando QR…', 'info');
    } else if (status === 'timeout') {
        qrBox.innerHTML = '<span>⏱ Tiempo agotado</span>';
        setStatus('qrStatus', 'El QR expiró. Vuelve a intentar.', 'error');
        stopQRPolling();
    }
}

function startStatusPolling() {
    fetchStatus();
    if (!statusPollingInterval)
        statusPollingInterval = setInterval(fetchStatus, 3000);
}

function stopQRPolling() {
    if (qrPollingInterval) { clearInterval(qrPollingInterval); qrPollingInterval = null; }
}

// ── Bot toggle ──────────────────────────────────────────────────────────────
async function loadBotState() {
    try {
        const r = await fetch('/bot/config');
        const d = await r.json();
        applyBotState(d.enabled);
    } catch (_) {}
}

function applyBotState(enabled) {
    const btn   = document.getElementById('powerBtn');
    const title = document.getElementById('powerTitle');
    const sub   = document.getElementById('powerSub');
    if (enabled) {
        btn.className     = 'power-btn on';
        title.textContent = 'Bot encendido';
        sub.textContent   = 'Respondiendo automáticamente a los mensajes';
    } else {
        btn.className     = 'power-btn off';
        title.textContent = 'Bot apagado';
        sub.textContent   = 'Activa el bot para responder automáticamente';
    }
}

async function toggleBot() {
    try {
        const r        = await fetch('/bot/config');
        const d        = await r.json();
        const newState = !d.enabled;

        if (newState && currentStatus !== 'connected') {
            toast('Primero vincula tu WhatsApp', 'error');
            return;
        }

        await fetch('/bot/config', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ enabled: newState }),
        });
        applyBotState(newState);
        setStatus('powerStatus', '', '');
        toast(newState ? '✅ Bot activado' : '⏹ Bot desactivado', newState ? 'success' : 'info');
    } catch (err) {
        toast('Error al cambiar estado', 'error');
    }
}

// ── Disconnect ──────────────────────────────────────────────────────────────
async function doDisconnect() {
    if (!confirm('¿Desconectar WhatsApp? Tendrás que volver a vincular.')) return;
    await fetch('/disconnect', { method: 'DELETE' });
    await fetch('/bot/config', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled: false }),
    });
    applyBotState(false);
    toast('WhatsApp desconectado');
    fetchStatus();
}

// ── Connect QR ──────────────────────────────────────────────────────────────
async function startQR() {
    if (currentStatus === 'connected') { toast('Ya estás conectado', 'info'); return; }
    const qrBox = document.getElementById('qrBox');
    qrBox.innerHTML = '<span class="spinner"></span>';
    setStatus('qrStatus', 'Iniciando…', 'info');
    await fetch('/connect/qr', { method: 'POST' });
    stopQRPolling();
    qrPollingInterval = setInterval(fetchStatus, 2500);
    fetchStatus();
}

// ── Connect pairing ─────────────────────────────────────────────────────────
async function startPairing() {
    const phone = document.getElementById('pairPhone').value.trim();
    if (!phone) { toast('Ingresa tu número de teléfono', 'error'); return; }

    setStatus('pairStatus', 'Solicitando código…', 'info');
    document.getElementById('pairingCode').style.display = 'none';

    try {
        const r = await fetch('/connect/pairing', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ phoneNumber: phone }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);

        const codeEl = document.getElementById('pairingCode');
        codeEl.style.display = '';
        codeEl.textContent   = d.code;
        setStatus('pairStatus', 'Ingresa este código en WhatsApp → Dispositivos vinculados → Vincular con número', 'info');
        stopQRPolling();
        qrPollingInterval = setInterval(fetchStatus, 2500);
        fetchStatus();
    } catch (err) {
        setStatus('pairStatus', err.message, 'error');
    }
}

// ── Send message ─────────────────────────────────────────────────────────────
async function sendMsg() {
    const jid      = document.getElementById('sendJid').value.trim();
    const text     = document.getElementById('sendText').value.trim();
    const imageUrl = document.getElementById('sendImageUrl').value.trim();
    const file     = document.getElementById('sendImageFile').files[0];
    const caption  = document.getElementById('sendCaption').value.trim();

    if (!jid)                              { toast('Ingresa el número destino', 'error'); return; }
    if (!text && !imageUrl && !file)       { toast('Escribe un mensaje o selecciona una imagen', 'error'); return; }

    setStatus('sendStatus', 'Enviando…', 'info');

    try {
        if (text) {
            const r = await fetch('/send', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ jid, text }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message);
        }

        if (file) {
            const form = new FormData();
            form.append('jid',     jid);
            form.append('caption', caption);
            form.append('image',   file);
            const r = await fetch('/send/image/upload', { method: 'POST', body: form });
            const d = await r.json();
            if (!d.success) throw new Error(d.message);
        } else if (imageUrl) {
            const r = await fetch('/send/image', {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ jid, imageUrl, caption }),
            });
            const d = await r.json();
            if (!d.success) throw new Error(d.message);
        }

        setStatus('sendStatus', '✅ Enviado correctamente', 'success');
        document.getElementById('sendText').value      = '';
        document.getElementById('sendImageUrl').value  = '';
        document.getElementById('sendImageFile').value = '';
        document.getElementById('sendCaption').value   = '';
        toast('Mensaje enviado ✅', 'success');
    } catch (err) {
        setStatus('sendStatus', '❌ ' + err.message, 'error');
    }
}

// ── Config page ─────────────────────────────────────────────────────────────
async function loadConfig() {
    try {
        const [cfgRes, modRes] = await Promise.all([fetch('/bot/config'), fetch('/bot/models')]);
        const cfg = await cfgRes.json();
        const mod = await modRes.json();

        const sel = document.getElementById('aiModel');
        sel.innerHTML = '';
        mod.models.forEach(m => {
            const opt       = document.createElement('option');
            opt.value       = m;
            opt.textContent = m;
            if (m === cfg.model) opt.selected = true;
            sel.appendChild(opt);
        });

        document.getElementById('systemPrompt').value = cfg.systemPrompt || '';
        document.getElementById('maxHistory').value   = cfg.maxHistory   || 10;
        if (cfg.hasKey) document.getElementById('apiKey').placeholder = '● clave guardada';
    } catch (_) {}
}

async function saveConfig() {
    const apiKey       = document.getElementById('apiKey').value.trim();
    const model        = document.getElementById('aiModel').value;
    const systemPrompt = document.getElementById('systemPrompt').value;
    const maxHistory   = document.getElementById('maxHistory').value;

    const body = { model, systemPrompt, maxHistory: Number(maxHistory) };
    if (apiKey) body.apiKey = apiKey;

    setStatus('configStatus', 'Guardando…', 'info');
    try {
        const r = await fetch('/bot/config', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        const d = await r.json();
        if (!d.success) throw new Error('Error al guardar');
        if (apiKey) {
            document.getElementById('apiKey').value       = '';
            document.getElementById('apiKey').placeholder = '● clave guardada';
        }
        setStatus('configStatus', '✅ Configuración guardada', 'success');
        toast('Configuración guardada ✅', 'success');
    } catch (err) {
        setStatus('configStatus', '❌ ' + err.message, 'error');
    }
}

function toggleKey() {
    const input = document.getElementById('apiKey');
    input.type  = input.type === 'password' ? 'text' : 'password';
}

// ── Init ────────────────────────────────────────────────────────────────────
startStatusPolling();
loadBotState();
loadConfig();
