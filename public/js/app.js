(() => {
    // ── Toast ─────────────────────────────────────────────────────────────
    const toastEl = document.getElementById('toast');
    const toast = (msg, type = '') => {
        toastEl.textContent = msg;
        toastEl.className = 'toast show' + (type ? ' ' + type : '');
        setTimeout(() => toastEl.classList.remove('show'), 2800);
    };

    // ── Tab navigation (sidebar + bottom nav) ────────────────────────────
    const switchTab = (tabName) => {
        document.querySelectorAll('.nav-btn, .bnav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll(`[data-tab="${tabName}"]`).forEach(b => b.classList.add('active'));
        const tabEl = document.getElementById('tab-' + tabName);
        if (tabEl) tabEl.classList.add('active');
        if (tabName === 'ai') loadAiSettings();
        window.scrollTo(0, 0);
    };

    document.querySelectorAll('.nav-btn, .bnav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
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
            const dot  = s.status === 'connected' ? 'connected' : s.status === 'connecting' ? 'connecting' : 'disconnected';
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
            codeEl.textContent   = data.code;
            codeEl.style.display = 'block';
            setStatus('pairStatus', 'Ingresa este código en WhatsApp → Vincular dispositivo', 'success');
            currentSessionId = data.sessionId;
            clearInterval(qrPollInterval);
            qrPollInterval = setInterval(async () => {
                try {
                    const sr = await fetch(`/wa/status/${accountId()}/${currentSessionId}`);
                    const sd = await sr.json();
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
    const logEl   = document.getElementById('messageLog');
    let localLog  = [];
    let lastCount = 0;

    const renderLog = () => {
        if (!localLog.length) {
            logEl.innerHTML = '<div class="empty">Sin mensajes aún. Conecta una sesión y espera mensajes.</div>';
            return;
        }
        logEl.innerHTML = localLog.map(m => {
            const d    = new Date(m.timestamp);
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const dir  = m.direction || 'in';
            const tag  = dir === 'out' ? '<span class="msg-dir-badge out">IA</span>' : '';
            return `
            <div class="msg-item ${dir}">
              <div class="msg-meta">
                <span>${tag} ${esc(m.from || m.jid || '')}</span>
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

    // ══════════════════════════════════════════════════════════════════════
    // ── AI settings ───────────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    window.toggleKeyVisibility = () => {
        const el = document.getElementById('groqApiKey');
        el.type = el.type === 'password' ? 'text' : 'password';
    };

    window.loadAiSettings = async () => {
        try {
            const [cfgRes, modRes] = await Promise.all([
                fetch('/ai/settings'),
                fetch('/ai/models'),
            ]);
            const cfg  = await cfgRes.json();
            const mods = await modRes.json();

            const modelSel = document.getElementById('aiModel');
            modelSel.innerHTML = (mods.models || []).map(m =>
                `<option value="${esc(m)}" ${m === cfg.model ? 'selected' : ''}>${esc(m)}</option>`
            ).join('');

            document.getElementById('aiEnabled').checked = !!cfg.enabled;
            document.getElementById('aiSystemPrompt').value = cfg.systemPrompt || '';
            document.getElementById('aiMaxHistory').value   = cfg.maxHistory   || 10;

            renderAiStatus(cfg);
        } catch (err) {
            console.error('Error loading AI settings:', err);
        }
    };

    const renderAiStatus = (cfg) => {
        const box    = document.getElementById('aiStatusBox');
        const keyOk  = cfg.hasKey;
        const active = cfg.enabled && keyOk;
        const rows = [
            {
                label: 'API Key',
                value: keyOk ? '✓ Configurada' : '✗ No configurada',
                cls:   keyOk ? 'stat-ok' : 'stat-warn',
            },
            {
                label: 'Estado IA',
                value: active ? '✓ Activa · respondiendo' : cfg.enabled ? '⚠ Activa — falta API Key' : '○ Desactivada',
                cls:   active ? 'stat-ok' : cfg.enabled ? 'stat-warn' : 'stat-off',
            },
            {
                label: 'Modelo',
                value: cfg.model || '—',
                cls:   '',
            },
            {
                label: 'Historial / usuario',
                value: `${cfg.maxHistory} mensajes · ${cfg.activeConversations || 0} conversaciones activas`,
                cls:   '',
            },
            {
                label: 'Separación de usuarios',
                value: '✓ Cada número tiene su propio historial',
                cls:   'stat-ok',
            },
        ];
        box.innerHTML = rows.map(r => `
          <div class="ai-stat-row">
            <span class="ai-stat-label">${esc(r.label)}</span>
            <span class="${r.cls}">${esc(r.value)}</span>
          </div>
        `).join('');
    };

    window.saveAiSettings = async () => {
        const apiKey = document.getElementById('groqApiKey').value.trim();
        const body = {
            enabled:      document.getElementById('aiEnabled').checked,
            systemPrompt: document.getElementById('aiSystemPrompt').value,
            model:        document.getElementById('aiModel').value,
            maxHistory:   Number(document.getElementById('aiMaxHistory').value),
        };
        if (apiKey) body.apiKey = apiKey;

        setStatus('aiKeyStatus', 'Guardando...', 'info');
        try {
            const res  = await fetch('/ai/settings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.success) {
                setStatus('aiKeyStatus', '✓ Configuración guardada', 'success');
                document.getElementById('groqApiKey').value = '';
                renderAiStatus(data.config);
                toast('Configuración de IA guardada', 'success');
            } else {
                setStatus('aiKeyStatus', 'Error al guardar', 'error');
            }
        } catch { setStatus('aiKeyStatus', 'Error de conexión', 'error'); }
    };

    // ══════════════════════════════════════════════════════════════════════
    // ── Groups & Broadcast ────────────────────────────────────────────────
    // ══════════════════════════════════════════════════════════════════════

    let selectedGroup  = null;
    let groupMembers   = [];

    window.loadGroups = async () => {
        const listEl = document.getElementById('groupsList');
        listEl.innerHTML = '<div class="empty">Cargando grupos...</div>';
        try {
            const res  = await fetch(`/wa/groups/${accountId()}`);
            const data = await res.json();
            if (!data.groups || !data.groups.length) {
                listEl.innerHTML = '<div class="empty">No se encontraron grupos. Asegúrate de tener una sesión conectada.</div>';
                return;
            }
            const sorted = [...data.groups].sort((a, b) => a.name.localeCompare(b.name));
            listEl.innerHTML = sorted.map(g => `
              <div class="group-item" data-id="${esc(g.id)}" data-name="${esc(g.name)}" onclick="selectGroup('${esc(g.id)}', '${esc(g.name.replace(/'/g, "\\'"))}')">
                <div class="group-name">${esc(g.name)}</div>
                <div class="group-sub">${g.participants} miembros</div>
              </div>
            `).join('');
        } catch (err) {
            listEl.innerHTML = `<div class="empty" style="color:var(--danger)">Error: ${esc(err.message)}</div>`;
        }
    };

    window.selectGroup = async (groupId, groupName) => {
        selectedGroup = { id: groupId, name: groupName };

        document.querySelectorAll('.group-item').forEach(el => {
            el.classList.toggle('selected', el.dataset.id === groupId);
        });

        document.getElementById('selectedGroupName').textContent = groupName;
        const membersEl = document.getElementById('membersPreview');
        membersEl.innerHTML = '<div class="empty">Cargando miembros...</div>';

        try {
            const res  = await fetch(`/wa/groups/${accountId()}/${encodeURIComponent(groupId)}/members`);
            const data = await res.json();
            groupMembers = data.members || [];

            if (!groupMembers.length) {
                membersEl.innerHTML = '<div class="empty">No se encontraron miembros</div>';
                return;
            }
            membersEl.innerHTML = `
              <div class="members-header">${groupMembers.length} miembros (excluye tu número)</div>
              <div class="members-grid">
                ${groupMembers.map(m => `
                  <div class="member-chip">
                    <span class="member-phone">+${esc(m.phone)}</span>
                    ${m.admin ? `<span class="badge badge-green" style="font-size:.65rem">${m.admin}</span>` : ''}
                  </div>
                `).join('')}
              </div>
            `;
        } catch (err) {
            membersEl.innerHTML = `<div class="empty" style="color:var(--danger)">Error: ${esc(err.message)}</div>`;
        }
    };

    window.startBroadcast = async () => {
        if (!selectedGroup) { toast('Selecciona un grupo primero', 'error'); return; }
        const message = document.getElementById('broadcastMsg').value.trim();
        if (!message) { toast('Escribe el mensaje de difusión', 'error'); return; }

        const delayMs   = Number(document.getElementById('broadcastDelay').value) * 1000;
        const resetSent = document.getElementById('resetSent').checked;

        setStatus('broadcastStatus', 'Iniciando difusión...', 'info');
        try {
            const res  = await fetch('/wa/broadcast', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    accountId: accountId(),
                    groupId:   selectedGroup.id,
                    message,
                    delayMs,
                    resetSent,
                })
            });
            const data = await res.json();
            if (data.success) {
                setStatus('broadcastStatus', `✓ ${data.message}`, 'success');
                toast(`Difusión iniciada — ${data.total} contactos`, 'success');
                broadcastPollInterval = setInterval(pollBroadcastStatus, 3000);
                pollBroadcastStatus();
            } else {
                setStatus('broadcastStatus', data.message || 'Error', 'error');
            }
        } catch { setStatus('broadcastStatus', 'Error de conexión', 'error'); }
    };

    window.stopBroadcast = async () => {
        try {
            await fetch('/wa/broadcast/stop', { method: 'POST' });
            toast('Señal de parada enviada');
        } catch { toast('Error', 'error'); }
    };

    window.resetBroadcast = async () => {
        if (!confirm('¿Limpiar el registro de enviados? Esto permite volver a contactar a todos.')) return;
        try {
            await fetch('/wa/broadcast/reset', { method: 'POST' });
            toast('Registro limpiado');
        } catch { toast('Error', 'error'); }
    };

    let broadcastPollInterval = null;

    window.pollBroadcastStatus = async () => {
        try {
            const res  = await fetch('/wa/broadcast/status');
            const data = await res.json();
            renderBroadcastProgress(data);
            if (!data.running && broadcastPollInterval) {
                clearInterval(broadcastPollInterval);
                broadcastPollInterval = null;
            }
        } catch { }
    };

    const renderBroadcastProgress = (data) => {
        const el = document.getElementById('broadcastProgress');
        if (!data.total && !data.running) {
            el.innerHTML = '<div class="empty">Sin difusión activa</div>';
            return;
        }
        const pct = data.total ? Math.round((data.sent / data.total) * 100) : 0;
        el.innerHTML = `
          <div class="progress-stats">
            <span class="stat-ok">✓ ${data.sent} enviados</span>
            <span style="color:var(--text-sub)">○ ${data.skipped} omitidos</span>
            <span style="color:var(--danger)">✗ ${data.failed} fallidos</span>
            <span style="margin-left:auto;font-weight:700">${data.sent + data.skipped}/${data.total + data.skipped}</span>
          </div>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width:${pct}%"></div>
          </div>
          <div class="progress-label">${data.running ? `⏳ En curso — ${pct}%` : data.finishedAt ? `✓ Completado` : 'Detenido'}</div>
          ${data.log && data.log.length ? `
            <div class="broadcast-log">
              ${[...data.log].slice(-20).reverse().map(l => `
                <div class="log-line ${l.status}">
                  +${esc(l.phone)} — <strong>${esc(l.status)}</strong>${l.error ? ': ' + esc(l.error) : ''}
                </div>
              `).join('')}
            </div>
          ` : ''}
        `;
    };

    // ── Init ──────────────────────────────────────────────────────────────
    refreshSessions();
    setInterval(refreshSessions, 5000);
    setInterval(pollMessages, 2000);
    loadAiSettings();
})();
