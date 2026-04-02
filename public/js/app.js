// ── State ─────────────────────────────────────────────────────────────────────
let qrInterval   = null;
let simSessionId = 'session_' + Math.random().toString(36).slice(2, 10);
let simBusy      = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initNav();
    startStatusPolling();
});

// ── Navigation ────────────────────────────────────────────────────────────────
function initNav() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`)?.classList.add('active');
    document.querySelectorAll(`[data-tab="${name}"]`).forEach(b => b.classList.add('active'));
    if (name === 'simulator') document.getElementById('simInput')?.focus();
    if (name === 'config') loadConfigPanel();
}

// ── Status polling ────────────────────────────────────────────────────────────
function startStatusPolling() {
    fetchStatus();
    setInterval(fetchStatus, 4000);
}

async function fetchStatus() {
    try {
        const d = await api('/api/status');
        updateStatusUI(d);
    } catch {}
}

function updateStatusUI(d) {
    const dot  = document.querySelector('#sidebarStatus .dot');
    const lbl  = document.querySelector('#sidebarStatus .dot-label');
    const dCard = document.getElementById('deviceCard');
    const opts  = document.getElementById('connectOptions');
    const dInfo = document.getElementById('deviceInfo');
    const status = d.status;

    dot.className = 'dot dot-' + (status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected');
    lbl.textContent = status === 'connected' ? `+${d.device?.phone || ''}` : status === 'connecting' ? 'Conectando...' : 'Sin conectar';

    if (status === 'connected' && d.device) {
        dCard.style.display = 'flex';
        opts.style.display  = 'none';
        dInfo.innerHTML = `
            <div class="device-row"><strong>Número:</strong> +${d.device.phone}</div>
            ${d.device.name ? `<div class="device-row"><strong>Nombre:</strong> ${d.device.name}</div>` : ''}
            <div class="device-row"><strong>Conectado:</strong> ${new Date(d.device.connectedAt).toLocaleString()}</div>`;
        if (qrInterval) { clearInterval(qrInterval); qrInterval = null; }
    } else {
        dCard.style.display = 'none';
        opts.style.display  = 'block';
        if (d.qr) {
            document.getElementById('qrBox').innerHTML = `<img src="${d.qr}" width="210" height="210">`;
        }
    }
}

// ── Connect ───────────────────────────────────────────────────────────────────
async function startQR() {
    setStatus('qrStatus', 'Iniciando conexión QR...', 'info');
    document.getElementById('qrBox').innerHTML = '<span>Generando QR...</span>';
    await api('/api/connect/qr', { method: 'POST' });
    if (qrInterval) clearInterval(qrInterval);
    qrInterval = setInterval(fetchStatus, 2000);
    setStatus('qrStatus', 'Escanea el QR con tu WhatsApp', 'info');
}

async function startPairing() {
    const phone = document.getElementById('pairPhone').value.trim();
    if (!phone) return showToast('Ingresa tu número de teléfono');
    setStatus('pairStatus', 'Solicitando código...', 'info');
    document.getElementById('pairingCode').style.display = 'none';
    try {
        const d = await api('/api/connect/pairing', { method: 'POST', body: { phoneNumber: phone } });
        if (d.success) {
            document.getElementById('pairingCode').textContent = d.code;
            document.getElementById('pairingCode').style.display = 'block';
            setStatus('pairStatus', 'Ingresa este código en tu WhatsApp', 'success');
            if (qrInterval) clearInterval(qrInterval);
            qrInterval = setInterval(fetchStatus, 2000);
        } else {
            setStatus('pairStatus', d.message || 'Error', 'error');
        }
    } catch (e) {
        setStatus('pairStatus', e.message, 'error');
    }
}

async function doDisconnect() {
    if (!confirm('¿Desconectar WhatsApp?')) return;
    await api('/api/disconnect', { method: 'DELETE' });
    showToast('WhatsApp desconectado');
    fetchStatus();
}

// ── Simulator ─────────────────────────────────────────────────────────────────
function simNow() {
    return new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}

function addSimBubble(text, type) {
    const box = document.getElementById('simMessages');
    const div = document.createElement('div');
    div.className = `wa-bubble wa-bubble-${type}`;
    div.innerHTML = `<span>${simFormatText(text)}</span><span class="wa-time">${simNow()}</span>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

function simFormatText(text) {
    return escHtml(text).replace(
        /(https?:\/\/[^\s]+|\/api\/downloads\/[^\s/]+\/file)/g,
        (url) => {
            const label = url.includes('/api/downloads/') ? '⬇ Descargar video' : url;
            return `<a href="${url}" target="_blank" style="color:#075e54;font-weight:600;text-decoration:underline">${label}</a>`;
        }
    );
}

function addTypingIndicator() {
    const box = document.getElementById('simMessages');
    const div = document.createElement('div');
    div.className = 'wa-bubble wa-bubble-typing';
    div.id = 'simTyping';
    div.textContent = 'escribiendo...';
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function removeTypingIndicator() {
    document.getElementById('simTyping')?.remove();
}

async function sendSimMessage() {
    if (simBusy) return;
    const input = document.getElementById('simInput');
    const text  = input.value.trim();
    if (!text) return;

    simBusy = true;
    input.value = '';
    document.getElementById('simSendBtn').disabled = true;

    addSimBubble(text, 'out');
    addTypingIndicator();

    try {
        const d = await api('/api/chat', { method: 'POST', body: { message: text, sessionId: simSessionId } });
        removeTypingIndicator();
        addSimBubble(d.success ? d.reply : '❌ ' + d.message, 'in');
    } catch (e) {
        removeTypingIndicator();
        addSimBubble('❌ ' + e.message, 'in');
    } finally {
        simBusy = false;
        document.getElementById('simSendBtn').disabled = false;
        input.focus();
    }
}

async function clearSimulator() {
    if (!confirm('¿Reiniciar la conversación?')) return;
    await api('/api/chat/history', { method: 'DELETE', body: { sessionId: simSessionId } });
    simSessionId = 'session_' + Math.random().toString(36).slice(2, 10);
    const box = document.getElementById('simMessages');
    box.innerHTML = `<div class="wa-date-sep">Hoy</div>`;
}

// ── Config panel ──────────────────────────────────────────────────────────────
async function loadConfigPanel() {
    try {
        const [cfg, modelsData] = await Promise.all([api('/api/config'), api('/api/models')]);
        const keyInput = document.getElementById('cfgApiKey');
        const modelSel = document.getElementById('cfgModel');
        const keyStatus = document.getElementById('cfgKeyStatus');

        if (cfg.hasKey) {
            keyInput.placeholder = '••••••••••••••••••••••••••••••••';
            keyStatus.textContent = '✅ API Key configurada';
            keyStatus.style.color = 'var(--green, #25d366)';
        }

        modelSel.innerHTML = modelsData.models
            .map(m => `<option value="${m}" ${m === cfg.model ? 'selected' : ''}>${m}</option>`)
            .join('');
    } catch {}
}

async function saveConfig() {
    const key   = document.getElementById('cfgApiKey').value.trim();
    const model = document.getElementById('cfgModel').value;
    const body  = { model };
    if (key) body.apiKey = key;

    try {
        await api('/api/config', { method: 'POST', body });
        setStatus('cfgSaveStatus', '✅ Configuración guardada', 'success');
        if (key) {
            document.getElementById('cfgApiKey').value = '';
            document.getElementById('cfgApiKey').placeholder = '••••••••••••••••••••••••••••••••';
            document.getElementById('cfgKeyStatus').textContent = '✅ API Key configurada';
            document.getElementById('cfgKeyStatus').style.color = 'var(--green, #25d366)';
        }
    } catch (e) {
        setStatus('cfgSaveStatus', '❌ ' + e.message, 'error');
    }
}

function toggleApiKeyVisibility() {
    const input = document.getElementById('cfgApiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
}

async function uploadCookies() {
    const fileInput = document.getElementById('cookiesFile');
    if (!fileInput.files.length) return setStatus('cookiesStatus', 'Selecciona un archivo primero', 'error');
    const text = await fileInput.files[0].text();
    try {
        await api('/api/cookies', { method: 'POST', body: { content: text } });
        setStatus('cookiesStatus', '✅ Cookies subidas correctamente', 'success');
        fileInput.value = '';
    } catch (e) {
        setStatus('cookiesStatus', '❌ ' + e.message, 'error');
    }
}


async function api(url, opts = {}) {
    const res = await fetch(url, {
        method:  opts.method || 'GET',
        headers: opts.body ? { 'Content-Type': 'application/json' } : {},
        body:    opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
    return data;
}

function setStatus(id, msg, type = 'info') {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className   = 'card-status ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : '');
    el.style.display = 'block';
}

let toastTimer = null;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
