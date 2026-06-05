// BIBOB Interview Pro v2.0 — Utilities
// Toast, DOM helpers, formatting, logging.

export function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

export function toast(msg, type = 'info', durationMs = 3000) {
    let wrap = document.getElementById('toast-wrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'toast-wrap';
        wrap.className = 'toast-wrap';
        document.body.appendChild(wrap);
    }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    wrap.appendChild(t);
    setTimeout(() => {
        t.style.opacity = '0';
        t.style.transition = 'opacity .3s';
        setTimeout(() => t.remove(), 300);
    }, durationMs);
}

export function formatTime(sec) {
    if (typeof sec !== 'number' || !isFinite(sec)) return '?';
    const m = Math.floor(sec / 60);
    const s = (sec % 60).toFixed(1);
    return `${m}:${s.padStart(4, '0')}`;
}

export function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('nl-NL', {
        day:'numeric', month:'short', year:'numeric',
        hour:'2-digit', minute:'2-digit'
    });
}

export function countWords(text) {
    if (!text || typeof text !== 'string') return 0;
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
}

export function uid() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

// Eenvoudige logger met behoud van timestamp; console + DOM-target indien aanwezig.
export function log(msg, level = 'info') {
    const ts = new Date().toISOString().substring(11, 19);
    const fmt = `[${ts}] ${msg}`;
    if (level === 'error') console.error(fmt);
    else if (level === 'warn') console.warn(fmt);
    else console.log(fmt);

    const logEl = document.getElementById('debug-log');
    if (logEl) {
        const line = document.createElement('div');
        line.className = 'log-line log-' + level;
        line.textContent = fmt;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
    }
}
