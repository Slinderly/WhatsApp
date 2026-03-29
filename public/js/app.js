// ── State ───────────────────────────────────────────────────────────────────
let currentStatus = 'idle';
let qrPollingInterval     = null;
let statusPollingInterval = null;
let pendingFiles = []; // { file, label }

// ── Tab navigation ──────────────────────────────────────────────────────────
function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.nav-btn, .bnav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === name);
    });
    const section = document.getElementById('tab-' + name);
    if (section) section.classList.add('active');
    if (name === 'images') loadImages();
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
    const labels = {
        idle: 'Sin conectar', connecting: 'Conectando…',
        connected: 'Conectado', disconnected: 'Desconectado', timeout: 'Tiempo agotado',
    };
    label.textContent = labels[status] || status;

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
    btn.className     = 'power-btn ' + (enabled ? 'on' : 'off');
    title.textContent = enabled ? 'Bot encendido' : 'Bot apagado';
    sub.textContent   = enabled
        ? 'Respondiendo automáticamente a los mensajes'
        : 'Activa el bot para responder automáticamente';
}

async function toggleBot() {
    try {
        const r        = await fetch('/bot/config');
        const d        = await r.json();
        const newState = !d.enabled;

        if (newState && currentStatus !== 'connected') {
            toast('Primero vincula tu WhatsApp 📱', 'error');
            return;
        }
        await fetch('/bot/config', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: newState }),
        });
        applyBotState(newState);
        toast(newState ? '✅ Bot activado' : '⏹ Bot desactivado', newState ? 'success' : 'info');
    } catch { toast('Error al cambiar estado', 'error'); }
}

// ── Disconnect ──────────────────────────────────────────────────────────────
async function doDisconnect() {
    if (!confirm('¿Desconectar WhatsApp? Tendrás que volver a vincular.')) return;
    await fetch('/disconnect', { method: 'DELETE' });
    await fetch('/bot/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
    applyBotState(false);
    toast('WhatsApp desconectado');
    fetchStatus();
}

// ── Connect QR ──────────────────────────────────────────────────────────────
async function startQR() {
    if (currentStatus === 'connected') { toast('Ya estás conectado ✅', 'info'); return; }
    document.getElementById('qrBox').innerHTML = '<span class="spinner"></span>';
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
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phone }),
        });
        const d = await r.json();
        if (!d.success) throw new Error(d.message);
        const el = document.getElementById('pairingCode');
        el.style.display = '';
        el.textContent   = d.code;
        setStatus('pairStatus', 'Ingresa este código en WhatsApp → Dispositivos vinculados → Vincular con número', 'info');
        stopQRPolling();
        qrPollingInterval = setInterval(fetchStatus, 2500);
        fetchStatus();
    } catch (err) {
        setStatus('pairStatus', err.message, 'error');
    }
}

// ── Image library ────────────────────────────────────────────────────────────

// Drop zone drag events
const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    onFilesSelected(e.dataTransfer.files);
});

function onFilesSelected(files) {
    pendingFiles = [];
    const list = document.getElementById('previewList');
    list.innerHTML = '';
    list.style.display = '';

    Array.from(files).forEach((file, i) => {
        pendingFiles.push({ file, label: '' });
        const reader = new FileReader();
        reader.onload = (e) => {
            const item = document.createElement('div');
            item.className = 'preview-item';
            item.innerHTML = `
                <img src="${e.target.result}" alt="preview" class="preview-thumb">
                <div class="preview-meta">
                    <div class="preview-filename">${file.name}</div>
                    <input class="preview-label" type="text" placeholder="Etiqueta descriptiva (ej: Catálogo de precios 2024)" data-index="${i}">
                    <small>${(file.size / 1024).toFixed(0)} KB</small>
                </div>`;
            list.appendChild(item);

            item.querySelector('.preview-label').addEventListener('input', (ev) => {
                pendingFiles[ev.target.dataset.index].label = ev.target.value;
            });
        };
        reader.readAsDataURL(file);
    });

    document.getElementById('uploadBtn').style.display = '';
    setStatus('uploadStatus', '', '');
}

async function uploadImages() {
    if (pendingFiles.length === 0) { toast('Selecciona imágenes primero', 'error'); return; }

    setStatus('uploadStatus', 'Subiendo…', 'info');
    document.getElementById('uploadBtn').disabled = true;

    const form   = new FormData();
    const labels = pendingFiles.map(p => p.label || p.file.name);
    form.append('labels', JSON.stringify(labels));
    pendingFiles.forEach(p => form.append('images', p.file));

    try {
        const r = await fetch('/images/upload', { method: 'POST', body: form });
        const d = await r.json();
        if (!d.success) throw new Error(d.message || 'Error al subir');

        setStatus('uploadStatus', `✅ ${d.added.length} imagen(es) subida(s)`, 'success');
        document.getElementById('previewList').style.display = 'none';
        document.getElementById('uploadBtn').style.display  = 'none';
        document.getElementById('fileInput').value = '';
        pendingFiles = [];
        loadImages();
        toast(`✅ ${d.added.length} imagen(es) guardada(s)`, 'success');
    } catch (err) {
        setStatus('uploadStatus', '❌ ' + err.message, 'error');
    }
    document.getElementById('uploadBtn').disabled = false;
}

async function loadImages() {
    const gallery = document.getElementById('imageGallery');
    gallery.innerHTML = '<div class="empty">Cargando…</div>';
    try {
        const r = await fetch('/images');
        const d = await r.json();
        renderGallery(d.images || []);
    } catch {
        gallery.innerHTML = '<div class="empty">Error al cargar imágenes</div>';
    }
}

function renderGallery(images) {
    const gallery = document.getElementById('imageGallery');
    if (images.length === 0) {
        gallery.innerHTML = '<div class="empty">No hay imágenes aún. Sube la primera arriba.</div>';
        return;
    }
    gallery.innerHTML = '';
    images.forEach(img => {
        const card = document.createElement('div');
        card.className = 'img-card';
        card.innerHTML = `
            <img src="/images/${img.id}/file" alt="${img.label}" class="img-thumb" loading="lazy">
            <div class="img-info">
                <div class="img-label" id="label-${img.id}" onclick="editLabel('${img.id}')" title="Clic para editar">${img.label}</div>
                <div class="img-date">${new Date(img.createdAt).toLocaleDateString()}</div>
            </div>
            <button class="img-delete" onclick="deleteImage('${img.id}', this)" title="Eliminar">✕</button>`;
        gallery.appendChild(card);
    });
}

async function editLabel(id) {
    const el       = document.getElementById('label-' + id);
    const current  = el.textContent;
    const newLabel = prompt('Nueva etiqueta para esta imagen:', current);
    if (!newLabel || newLabel === current) return;
    try {
        const r = await fetch(`/images/${id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: newLabel }),
        });
        const d = await r.json();
        if (d.success) { el.textContent = newLabel; toast('Etiqueta actualizada ✅', 'success'); }
    } catch { toast('Error al actualizar', 'error'); }
}

async function deleteImage(id, btn) {
    if (!confirm('¿Eliminar esta imagen?')) return;
    btn.disabled = true;
    try {
        const r = await fetch(`/images/${id}`, { method: 'DELETE' });
        const d = await r.json();
        if (d.success) { loadImages(); toast('Imagen eliminada', 'info'); }
        else throw new Error(d.message);
    } catch (err) {
        toast('Error: ' + err.message, 'error');
        btn.disabled = false;
    }
}

// ── Config ──────────────────────────────────────────────────────────────────
async function loadConfig() {
    try {
        const [cfgRes, modRes] = await Promise.all([fetch('/bot/config'), fetch('/bot/models')]);
        const cfg = await cfgRes.json();
        const mod = await modRes.json();

        const sel = document.getElementById('aiModel');
        sel.innerHTML = '';
        mod.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = opt.textContent = m;
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
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!d.success) throw new Error('Error al guardar');
        if (apiKey) { document.getElementById('apiKey').value = ''; document.getElementById('apiKey').placeholder = '● clave guardada'; }
        setStatus('configStatus', '✅ Configuración guardada', 'success');
        toast('Guardado ✅', 'success');
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
