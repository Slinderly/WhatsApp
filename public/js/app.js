// ── State ─────────────────────────────────────────────────────────────────────
let statusInterval = null;
let qrInterval     = null;
let taskFilter     = 'all';
let simSessionId   = 'session_' + Math.random().toString(36).slice(2, 10);
let simBusy        = false;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initNav();
    startStatusPolling();
    loadTasks();
    loadDownloads();
    loadSummary();
    loadSimAssistantName();
});

// ── Navigation ────────────────────────────────────────────────────────────────
function initNav() {
    const allBtns = document.querySelectorAll('[data-tab]');
    allBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
}

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab-${name}`)?.classList.add('active');
    document.querySelectorAll(`[data-tab="${name}"]`).forEach(b => b.classList.add('active'));

    if (name === 'tasks')     loadTasks();
    if (name === 'downloads') loadDownloads();
    if (name === 'simulator') { loadSimAssistantName(); document.getElementById('simInput')?.focus(); }
}

// ── Status polling ────────────────────────────────────────────────────────────
function startStatusPolling() {
    fetchStatus();
    statusInterval = setInterval(fetchStatus, 4000);
}

async function fetchStatus() {
    try {
        const d = await api('/api/status');
        updateStatusUI(d);
    } catch {}
}

function updateStatusUI(d) {
    const status = d.status;

    const dot  = document.querySelector('#sidebarStatus .dot');
    const lbl  = document.querySelector('#sidebarStatus .dot-label');
    const dCard = document.getElementById('deviceCard');
    const nCard = document.getElementById('noDeviceCard');
    const dInfo = document.getElementById('deviceInfo');

    dot.className = 'dot dot-' + (status === 'connected' ? 'connected' : status === 'connecting' ? 'connecting' : 'disconnected');
    lbl.textContent = status === 'connected' ? `+${d.device?.phone || ''}` : status === 'connecting' ? 'Conectando...' : 'Sin conectar';

    if (status === 'connected' && d.device) {
        dCard.style.display = 'flex';
        nCard.style.display = 'none';
        dInfo.innerHTML = `
            <div class="device-row"><strong>Número:</strong> +${d.device.phone}</div>
            ${d.device.name ? `<div class="device-row"><strong>Nombre:</strong> ${d.device.name}</div>` : ''}
            <div class="device-row"><strong>Conectado:</strong> ${new Date(d.device.connectedAt).toLocaleString()}</div>`;

        if (qrInterval) { clearInterval(qrInterval); qrInterval = null; }
    } else {
        dCard.style.display = 'none';
        nCard.style.display = 'block';
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

// ── Tasks ─────────────────────────────────────────────────────────────────────
async function loadTasks() {
    try {
        const d = await api(`/api/tasks?filter=${taskFilter}`);
        renderTasks(d.tasks);
        loadSummary();
    } catch {}
}

function renderTasks(taskArr) {
    const el = document.getElementById('taskList');
    if (!taskArr || taskArr.length === 0) {
        el.innerHTML = '<div class="empty">No hay tareas aquí.</div>';
        return;
    }
    el.innerHTML = taskArr.map(t => {
        const prio = t.priority === 'alta' ? '🔴' : t.priority === 'media' ? '🟡' : '';
        return `<div class="task-item ${t.done ? 'task-done' : ''}" data-id="${t.id}">
            <div class="task-check" onclick="toggleTask('${t.id}',${t.done})">${t.done ? '✓' : ''}</div>
            <div class="task-text">${escHtml(t.text)} <span class="task-prio">${prio}</span></div>
            <div class="task-actions">
                ${!t.done ? `<button class="btn btn-ghost btn-sm" onclick="toggleTask('${t.id}',false)">✓</button>` : ''}
                <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="removeTask('${t.id}')">🗑</button>
            </div>
        </div>`;
    }).join('');
}

async function addTaskUI() {
    const input = document.getElementById('newTaskInput');
    const text  = input.value.trim();
    const prio  = document.getElementById('newTaskPriority').value;
    if (!text) return;
    try {
        await api('/api/tasks', { method: 'POST', body: { text, priority: prio } });
        input.value = '';
        showToast('Tarea agregada ✅');
        loadTasks();
    } catch (e) { showToast(e.message); }
}

async function toggleTask(id, isDone) {
    if (isDone) return;
    try {
        await api(`/api/tasks/${id}/complete`, { method: 'PATCH' });
        loadTasks();
    } catch {}
}

async function removeTask(id) {
    try {
        await api(`/api/tasks/${id}`, { method: 'DELETE' });
        showToast('Tarea eliminada');
        loadTasks();
    } catch {}
}

async function clearDoneTasks() {
    if (!confirm('¿Limpiar todas las tareas completadas?')) return;
    await api('/api/tasks/done/clear', { method: 'DELETE' });
    showToast('Completadas eliminadas 🧹');
    loadTasks();
}

function setTaskFilter(filter, btn) {
    taskFilter = filter;
    document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadTasks();
}

// ── Downloads ─────────────────────────────────────────────────────────────────
async function loadDownloads() {
    try {
        const d = await api('/api/downloads');
        renderDownloads(d.downloads);
        loadSummary();
    } catch {}
}

function renderDownloads(list) {
    const el = document.getElementById('downloadList');
    if (!list || list.length === 0) {
        el.innerHTML = '<div class="empty">No hay descargas todavía. Envía una URL desde WhatsApp o desde aquí.</div>';
        return;
    }
    el.innerHTML = list.map(e => `
        <div class="dl-item">
            <div class="dl-icon">🎬</div>
            <div class="dl-info">
                <div class="dl-title">${escHtml(e.title || e.filename)}</div>
                <div class="dl-meta">${e.ext?.toUpperCase() || 'MP4'} · ${formatSize(e.size)} · ${new Date(e.createdAt).toLocaleDateString()}</div>
            </div>
            <div class="dl-actions">
                <a href="/api/downloads/${e.id}/file" class="btn btn-ghost btn-sm" download>⬇</a>
                <button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="deleteDownload('${e.id}')">🗑</button>
            </div>
        </div>`).join('');
}

async function startDownload() {
    const url = document.getElementById('dlUrl').value.trim();
    if (!url) return showToast('Pega una URL primero');
    const btn = document.getElementById('dlBtn');
    btn.disabled = true;
    setStatus('dlStatus', '⏳ Descargando... esto puede tomar un minuto.', 'info');
    try {
        const d = await api('/api/downloads', { method: 'POST', body: { url } });
        if (d.success) {
            setStatus('dlStatus', `✅ Descargado: ${d.entry.title || d.entry.filename}`, 'success');
            document.getElementById('dlUrl').value = '';
            loadDownloads();
        } else {
            setStatus('dlStatus', d.message, 'error');
        }
    } catch (e) {
        setStatus('dlStatus', `❌ ${e.message}`, 'error');
    } finally {
        btn.disabled = false;
    }
}

async function deleteDownload(id) {
    await api(`/api/downloads/${id}`, { method: 'DELETE' });
    showToast('Eliminado');
    loadDownloads();
}

// ── Simulator ─────────────────────────────────────────────────────────────────
async function loadSimAssistantName() {
    try {
        const cfg = await api('/api/config');
        const name = cfg.name || 'Asistente';
        document.getElementById('simAssistantName').textContent = name;
        document.getElementById('sidebarName').textContent = name;
    } catch {}
}

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
        /(https?:\/\/[^\s]+|\/api\/downloads\/[^\s]+)/g,
        (url) => {
            const href = url.startsWith('/') ? url : url;
            const label = url.startsWith('/api/downloads/') ? '⬇ Descargar video' : url;
            return `<a href="${href}" target="_blank" style="color:#075e54;font-weight:600;text-decoration:underline">${label}</a>`;
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
        if (d.success) {
            addSimBubble(d.reply, 'in');
            loadSummary();
        } else {
            addSimBubble('❌ ' + d.message, 'in');
        }
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
    if (!confirm('¿Limpiar la conversación?')) return;
    await api('/api/chat/history', { method: 'DELETE', body: { sessionId: simSessionId } });
    simSessionId = 'session_' + Math.random().toString(36).slice(2, 10);
    const box = document.getElementById('simMessages');
    box.innerHTML = `
        <div class="wa-date-sep">Hoy</div>
        <div class="wa-bubble wa-bubble-in">
            <span>¡Hola! Conversación reiniciada. ¿En qué te puedo ayudar?</span>
            <span class="wa-time">${simNow()}</span>
        </div>`;
}

// ── Summary ───────────────────────────────────────────────────────────────────
async function loadSummary() {
    try {
        const [taskRes, dlRes] = await Promise.all([api('/api/tasks?filter=all'), api('/api/downloads')]);
        const pending  = taskRes.tasks.filter(t => !t.done).length;
        const done     = taskRes.tasks.filter(t => t.done).length;
        document.getElementById('statPending').textContent   = pending;
        document.getElementById('statDone').textContent      = done;
        document.getElementById('statDownloads').textContent = dlRes.downloads.length;
    } catch {}
}

// ── Utils ─────────────────────────────────────────────────────────────────────
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
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(bytes) {
    if (!bytes) return '?';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
