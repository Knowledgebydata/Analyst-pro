// BIBOB Interview Pro v2.0 — Main app orchestration
// Bindt auth-flow + tab-switching + models-loading + recorder + transcribe + diarize

import { Auth } from './auth.js';
import { Transcribe } from './transcribe.js';
import { Diarize } from './diarize.js';
import { Recorder } from './recorder.js';
import { toast, log, formatTime, countWords, uid, escapeHtml } from './utils.js';

const State = {
    interviews: [],            // tijdelijk in-memory; storage.js komt later
    lastInterview: null,
};

// ── Tab-switching ────────────────────────────────────────────────────────────
function switchTab(tabName) {
    document.querySelectorAll('.nav-tab').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(n => n.classList.remove('active'));
    const tabBtn = document.querySelector(`.nav-tab[data-tab="${tabName}"]`);
    const tabContent = document.getElementById(`tab-${tabName}`);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');
}

// ── Dashboard rendering ──────────────────────────────────────────────────────
function renderDashboard() {
    const countEl = document.getElementById('stat-count');
    const wordsEl = document.getElementById('stat-words');
    if (countEl) countEl.textContent = State.interviews.length;
    if (wordsEl) wordsEl.textContent = State.interviews.reduce((s, i) => s + (i.wordCount || 0), 0);

    const recentEl = document.getElementById('recent-list');
    if (!recentEl) return;
    if (State.interviews.length === 0) {
        recentEl.innerHTML = `
            <div class="empty">
                <i class="fas fa-microphone-alt-slash"></i>
                <p>Nog geen interviews opgenomen</p>
            </div>`;
    } else {
        recentEl.innerHTML = State.interviews.slice(0, 5).map(i => `
            <div style="padding:12px;background:rgba(0,0,0,0.3);border-radius:10px;margin-bottom:8px">
                <div style="font-weight:600">${escapeHtml(i.naam || 'Onbekend')}</div>
                <div style="font-size:.75rem;color:rgba(255,255,255,0.5);margin-top:4px">
                    ${escapeHtml(i.onderwerp || '')} — ${i.wordCount || 0} woorden
                </div>
            </div>
        `).join('');
    }
}

// ── Modellen laden (Step 2) ──────────────────────────────────────────────────
async function loadModels() {
    const btn = document.getElementById('load-models-btn');
    const progressBar = document.getElementById('models-progress');
    const progressWrap = document.getElementById('models-progress-wrap');
    const statusEl = document.getElementById('models-status');

    btn.disabled = true;
    progressWrap.style.display = 'block';
    setStatus(statusEl, 'Whisper-small downloaden (~466 MB) — kan 2-15 min duren bij eerste keer', 'warning');

    try {
        // Whisper laden met progress per bestand
        await Transcribe.ensureModel((p) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
                const pct = Math.round(p.progress);
                progressBar.style.width = pct + '%';
                progressBar.textContent = `Whisper: ${p.file || '...'} ${pct}%`;
            }
        });
        progressBar.style.width = '100%';
        progressBar.textContent = 'Whisper klaar';
        setStatus(statusEl, '✓ Whisper geladen — nu pyannote diarization (~6 MB)', 'success');

        // Pyannote laden
        await Diarize.ensureModel((p) => {
            progressBar.style.width = (p.pct || 100) + '%';
            progressBar.textContent = `Pyannote: ${p.pct || 100}%`;
        });

        setStatus(statusEl, '✓ Beide modellen klaar — je kunt nu een interview opnemen', 'success');
        document.getElementById('start-interview-btn').disabled = false;
        btn.style.display = 'none';
    } catch (err) {
        setStatus(statusEl, '✗ Fout: ' + err.message, 'error');
        log('Models load fout: ' + err.message, 'error');
        btn.disabled = false;
    }
}

// ── Interview-flow (Step 3) ──────────────────────────────────────────────────
async function startInterview() {
    const naam = document.getElementById('interview-naam').value.trim();
    if (!naam) { toast('Naam geïnterviewde verplicht', 'error'); return; }
    if (!Transcribe.isReady() || !Diarize.isReady()) {
        toast('Laad eerst de modellen', 'error');
        return;
    }

    try {
        const recIndicator = document.getElementById('rec-indicator');
        const recDur = document.getElementById('rec-duration');
        const recBtn = document.getElementById('start-interview-btn');
        const stopBtn = document.getElementById('stop-interview-btn');

        recIndicator.classList.remove('hidden');
        recBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');

        await Recorder.start((sec) => {
            recDur.textContent = sec.toFixed(0);
        });
    } catch (err) {
        toast('Microfoon-fout: ' + err.message, 'error');
        log('Recorder fout: ' + err.message, 'error');
        resetRecorderUI();
    }
}

async function stopInterview() {
    const naam = document.getElementById('interview-naam').value.trim();
    const onderwerp = document.getElementById('interview-onderwerp').value.trim();
    const resultsCard = document.getElementById('results-card');
    const transcriptBody = document.getElementById('transcript-body');
    const runStatus = document.getElementById('run-status');

    try {
        setStatus(runStatus, 'opname verwerken…', 'warning');
        const { audioFloat32, durationSec, blob } = await Recorder.stop();
        log(`Opname gestopt: ${durationSec.toFixed(1)}s`);

        resultsCard.classList.remove('hidden');
        setStatus(runStatus, 'Whisper transcribe loopt…', 'warning');
        const transResult = await Transcribe.run(audioFloat32);
        log(`Transcribe klaar — ${transResult.chunks?.length || 0} chunks`);

        setStatus(runStatus, 'pyannote diarize loopt…', 'warning');
        const diarSegments = await Diarize.run(audioFloat32, (p) => {
            setStatus(runStatus, `diarize window ${p.window}/${p.total}…`, 'warning');
        });
        log(`Diarize klaar — ${diarSegments.length} segments`);

        const merged = Diarize.mergeChunksWithSpeakers(transResult.chunks || [], diarSegments);
        const speakerSet = new Set();
        for (const r of merged) if (r.dominantSpeaker !== null) speakerSet.add(r.dominantSpeaker);

        const interview = {
            id: uid(),
            naam,
            onderwerp,
            createdAt: new Date().toISOString(),
            durationSec,
            speakerCount: speakerSet.size,
            chunks: merged,
            wordCount: merged.reduce((s, c) => s + countWords(c.text), 0),
        };
        State.interviews.unshift(interview);
        State.lastInterview = interview;

        // Render transcript
        const colors = ['var(--spk1)', 'var(--spk2)', 'var(--spk3)'];
        transcriptBody.innerHTML = merged.map(r => {
            const ts = r.startSec !== null ? `${formatTime(r.startSec)} → ${formatTime(r.endSec)}` : '?';
            let spkLabel = 'onbekend';
            let color = '#666';
            if (r.dominantSpeaker !== null) {
                spkLabel = `Speaker ${r.dominantSpeaker + 1}`;
                color = colors[r.dominantSpeaker] || '#666';
                if (r.hasMultipleSpeakers) spkLabel += ' (overlap)';
            }
            return `
                <div style="padding:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
                        <span style="font-family:Menlo,monospace;color:var(--accent);font-size:.75rem">${ts}</span>
                        <span style="background:${color};color:white;padding:2px 10px;border-radius:10px;font-size:.7rem;font-weight:600">${escapeHtml(spkLabel)}</span>
                    </div>
                    <div style="color:rgba(255,255,255,0.92);line-height:1.5;font-size:.92rem">${escapeHtml(r.text)}</div>
                </div>
            `;
        }).join('');

        setStatus(runStatus, `✓ klaar — ${speakerSet.size} sprekers, ${merged.length} chunks`, 'success');
        document.getElementById('export-json-btn').classList.remove('hidden');
        renderDashboard();
        resetRecorderUI();
    } catch (err) {
        setStatus(runStatus, '✗ Fout: ' + err.message, 'error');
        log('Stop-interview fout: ' + err.message, 'error');
        resetRecorderUI();
    }
}

function resetRecorderUI() {
    document.getElementById('rec-indicator').classList.add('hidden');
    document.getElementById('start-interview-btn').classList.remove('hidden');
    document.getElementById('stop-interview-btn').classList.add('hidden');
}

// ── JSON-export v2.0.0 ───────────────────────────────────────────────────────
function exportJson() {
    if (!State.lastInterview) return;
    const i = State.lastInterview;
    const exportObj = {
        type: 'bibob-interview-pro-export',
        version: '2.0.0',
        generatedAt: new Date().toISOString(),
        source: {
            tool: 'BIBOB Interview Pro v2.0 PWA',
            transcriptionModel: Transcribe.getModelName(),
            diarizationModel: Diarize.getModelName(),
        },
        interview: {
            id: i.id,
            naam_subject: i.naam,
            onderwerp: i.onderwerp,
            createdAt: i.createdAt,
            durationSec: i.durationSec,
        },
        speakerCount: i.speakerCount,
        segments: i.chunks.map((c, idx) => ({
            index: idx,
            startSec: c.startSec,
            endSec: c.endSec,
            durationSec: c.startSec !== null ? +(c.endSec - c.startSec).toFixed(2) : null,
            speaker: c.dominantSpeaker !== null ? `Speaker_${c.dominantSpeaker + 1}` : null,
            hasMultipleSpeakers: c.hasMultipleSpeakers,
            text: c.text,
        })),
        fullTranscript: i.chunks.map(c => c.text).join(' ').trim(),
        wordCount: i.wordCount,
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = (i.naam || 'interview').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${safe}-bibob-interview-v2.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('JSON-export gedownload', 'success');
}

function setStatus(el, msg, type = '') {
    if (!el) return;
    el.textContent = 'Status: ' + msg;
    el.className = 'status' + (type ? ' ' + type : '');
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
function bootstrap() {
    log('BIBOB Interview Pro v2.0 — bootstrap');
    log(`Secure context: ${window.isSecureContext}`);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(() => log('Service worker geregistreerd'))
            .catch(err => log('SW registratie faalde: ' + err.message, 'warn'));
    }

    // Numpad
    document.querySelectorAll('[data-numpad]').forEach(btn => {
        const action = btn.dataset.numpad;
        btn.addEventListener('click', () => {
            if (action === 'clear') Auth.clearPin();
            else if (action === 'backspace') Auth.backspace();
            else Auth.digit(action);
        });
    });

    // Setup + auth
    document.getElementById('setup-submit')?.addEventListener('click', () => Auth.completeSetup());
    document.getElementById('logout-btn')?.addEventListener('click', () => { if (confirm('Uitloggen?')) Auth.logout(); });
    document.getElementById('change-pin-btn')?.addEventListener('click', () => Auth.changePin());

    // Tabs
    document.querySelectorAll('.nav-tab').forEach(t => {
        t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    // Modellen + recorder
    document.getElementById('load-models-btn')?.addEventListener('click', loadModels);
    document.getElementById('start-interview-btn')?.addEventListener('click', startInterview);
    document.getElementById('stop-interview-btn')?.addEventListener('click', stopInterview);
    document.getElementById('export-json-btn')?.addEventListener('click', exportJson);

    Auth.init();
    renderDashboard();
}

document.addEventListener('DOMContentLoaded', bootstrap);
window.BibobApp = { State, switchTab, renderDashboard };
