(() => {
    // ── Toast ─────────────────────────────────────────────────────────────
    const toastEl = document.getElementById('toast');
    const toast = (msg, type = '') => {
        toastEl.textContent = msg;
        toastEl.className = 'toast show' + (type ? ' ' + type : '');
        setTimeout(() => toastEl.classList.remove('show'), 2800);
    };

    // ── Tab navigation ────────────────────────────────────────────────────
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        });
    });

    // ── Helpers ───────────────────────────────────────────────────────────
    const accountId = () => document.getElementById('accountId').value.trim() || 'cuenta1';
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const setStatus = (id, msg, type = '') => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = msg;
        el.className = 'card-status' + (type ? ' ' + type : '');
    };

    // ── Sessions list ─────────────────────────────────────────────────────
    const sessionsEl = document.getElementById('sessionsList');

    const renderSessions = (sessions) => {
        if (!sessions.length) {
            sessionsEl.innerHTML = '<div class="empty">Sin sesiones aún</div>';
            return;
        }
        sessionsEl.innerHTML = sessions.map(s => {
            const dot = s.status === 'connected' ? 'connected' : s.status === 'connecting' ? 'connecting' : 'disconnected';
            const info = s.device
                ? `${s.device.phone}${s.device.name ? ' · ' + s.device.name : ''}`
                : s.status;
            return `
            <div class="session-row">
              <div class="session-dot dot-${dot}"></div>
              <div class="session-info">
                <div class="session-name">${esc(s.sessionId)}</div>
                <div class="session-sub">${esc(info)}</div>
              </div>
              <div class="session-actions">
                <button class="btn btn-danger btn-sm" onclick="disconnectSession('${esc(s.sessionId)}')">Desconectar</button>
              </div>
            </div>`;
        }).join('');
    };

    window.refreshSessions = async () => {
        try {
            const res  = await fetch(`/wa/sessions/${accountId()}`);
            const data = await res.json();
            renderSessions(data.sessions || []);
        } catch { sessionsEl.innerHTML = '<div class="empty" style="color:var(--danger)">Error al cargar sesiones</div>'; }
    };

    window.disconnectSession = async (sessionId) => {
        try {
            await fetch(`/wa/sessions/${accountId()}/${sessionId}`, { method: 'DELETE' });
            toast('Sesión desconectada');
            refreshSessions();
            clearQR();
        } catch { toast('Error al desconectar', 'error'); }
    };

    // ── QR flow ───────────────────────────────────────────────────────────
    let qrPollInterval = null;
    let currentSessionId = null;

    const clearQR = () => {
        clearInterval(qrPollInterval);
        qrPollInterval = null;
        document.getElementById('qrBox').innerHTML = '<span>Presiona generar para ver el QR</span>';
    };

    const pollQR = async () => {
        if (!currentSessionId) return;
        try {
            const res  = await fetch(`/wa/status/${accountId()}/${currentSessionId}`);
            const data = await res.json();
            const box  = document.getElementById('qrBox');

            if (data.status === 'connected') {
                clearInterval(qrPollInterval);
                box.innerHTML = '<span style="color:var(--accent);font-weight:700;font-size:1rem;">✓ Conectado</span>';
                setStatus('qrStatus', 'WhatsApp conectado correctamente', 'success');
                refreshSessions();
                return;
            }

            if (data.status === 'timeout') {
                clearInterval(qrPollInterval);
                box.innerHTML = '<span style="color:var(--danger)">QR expirado. Presiona Generar de nuevo.</span>';
                setStatus('qrStatus', 'QR expirado', 'error');
                return;
            }

            if (data.qr) {
                box.innerHTML = `<img src="${data.qr}" alt="QR">`;
                setStatus('qrStatus', 'Escanea el QR desde WhatsApp', 'info');
            } else {
                box.innerHTML = '<span>Generando QR...</span>';
                setStatus('qrStatus', 'Conectando con WhatsApp...', 'info');
            }
        } catch { }
    };

    window.startQR = async () => {
        clearInterval(qrPollInterval);
        setStatus('qrStatus', 'Iniciando conexión...', 'info');
        document.getElementById('qrBox').innerHTML = '<span>Conectando...</span>';
        try {
            const res  = await fetch('/wa/connect/qr', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: accountId() })
            });
            const data = await res.json();
            if (!data.success) { setStatus('qrStatus', data.message || 'Error', 'error'); return; }
            currentSessionId = data.sessionId;
            setStatus('qrStatus', `Sesión: ${data.sessionId}`, 'info');
            qrPollInterval = setInterval(pollQR, 1800);
            pollQR();
        } catch { setStatus('qrStatus', 'Error de conexión', 'error'); }
    };

    // ── Pairing code flow ─────────────────────────────────────────────────
    window.startPairing = async () => {
        const phone = document.getElementById('pairPhone').value.trim();
        if (!phone) { toast('Ingresa el número de teléfono', 'error'); return; }
        const codeEl = document.getElementById('pairingCode');
        codeEl.style.display = 'none';
        setStatus('pairStatus', 'Solicitando código a WhatsApp...', 'info');
        try {
            const res  = await fetch('/wa/connect/pairing', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: accountId(), phoneNumber: phone })
            });
            const data = await res.json();
            if (!data.success) { setStatus('pairStatus', data.message || 'Error', 'error'); return; }
            codeEl.textContent  = data.code;
            codeEl.style.display = 'block';
            setStatus('pairStatus', 'Ingresa este código en WhatsApp → Vincular dispositivo', 'success');
            currentSessionId = data.sessionId;
            clearInterval(qrPollInterval);
            qrPollInterval = setInterval(async () => {
                try {
                    const sr   = await fetch(`/wa/status/${accountId()}/${currentSessionId}`);
                    const sd   = await sr.json();
                    if (sd.status === 'connected') {
                        clearInterval(qrPollInterval);
                        setStatus('pairStatus', '✓ WhatsApp conectado correctamente', 'success');
                        refreshSessions();
                    }
                } catch { }
            }, 2000);
        } catch { setStatus('pairStatus', 'Error de conexión', 'error'); }
    };

    // ── Send message ──────────────────────────────────────────────────────
    window.sendMsg = async () => {
        const jid  = document.getElementById('sendJid').value.trim();
        const text = document.getElementById('sendText').value.trim();
        if (!jid || !text) { toast('JID y mensaje son obligatorios', 'error'); return; }
        setStatus('sendStatus', 'Enviando...', 'info');
        try {
            const res  = await fetch('/wa/send', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountId: accountId(), jid, text })
            });
            const data = await res.json();
            if (data.success) {
                setStatus('sendStatus', '✓ Mensaje enviado', 'success');
                document.getElementById('sendText').value = '';
                toast('Mensaje enviado', 'success');
            } else {
                setStatus('sendStatus', data.message || 'Error al enviar', 'error');
            }
        } catch { setStatus('sendStatus', 'Error de conexión', 'error'); }
    };

    // ── Message log polling ───────────────────────────────────────────────
    const logEl    = document.getElementById('messageLog');
    let localLog   = [];
    let lastCount  = 0;

    const renderLog = () => {
        if (!localLog.length) {
            logEl.innerHTML = '<div class="empty">Sin mensajes aún. Conecta una sesión y espera mensajes.</div>';
            return;
        }
        logEl.innerHTML = localLog.map(m => {
            const d    = new Date(m.timestamp);
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            return `
            <div class="msg-item ${m.direction || 'in'}">
              <div class="msg-meta">
                <span>${esc(m.from || m.jid || '')}</span>
                <span>${esc(m.accountId || '')} · ${esc(m.sessionId || '')}</span>
                <span style="margin-left:auto">${time}</span>
              </div>
              <div class="msg-text">${esc(m.text || '')}</div>
            </div>`;
        }).join('');

        if (document.getElementById('autoScroll').checked)
            logEl.scrollTop = logEl.scrollHeight;
    };

    const pollMessages = async () => {
        try {
            const res  = await fetch(`/wa/messages?accountId=${encodeURIComponent(accountId())}&limit=100`);
            const data = await res.json();
            const msgs = data.messages || [];
            if (msgs.length !== lastCount) {
                localLog  = msgs;
                lastCount = msgs.length;
                renderLog();
            }
        } catch { }
    };

    window.clearMsgLog = () => {
        localLog   = [];
        lastCount  = 0;
        logEl.innerHTML = '<div class="empty">Historial limpiado localmente. Los mensajes nuevos aparecerán aquí.</div>';
    };

    // ── Init ──────────────────────────────────────────────────────────────
    refreshSessions();
    setInterval(refreshSessions, 5000);
    setInterval(pollMessages, 2000);
})();
