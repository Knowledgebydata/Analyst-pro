// BIBOB Interview Pro v2.0 — Main app orchestration
// Bindt auth-flow + tab-switching + models-loading + recorder + transcribe + diarize

import { Auth } from './auth.js';
import { Transcribe } from './transcribe.js';
import { TranscribeApple } from './transcribe-apple.js';
import { Diarize } from './diarize.js';
import { Recorder } from './recorder.js';
import { Storage } from './storage.js';
import { toast, log, formatTime, formatDate, countWords, uid, escapeHtml } from './utils.js';

// iOS Safari detectie — daar gebruiken we Apple Speech ipv Whisper-WASM
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
const USE_APPLE_SPEECH = isIOS() && TranscribeApple.isSupported();

const State = {
    interviews: [],            // wordt bij bootstrap uit Storage geladen
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
        recentEl.innerHTML = State.interviews.slice(0, 5).map(i => renderInterviewSummary(i)).join('');
    }
}

function renderInterviewSummary(i) {
    const dt = i.createdAt ? formatDate(i.createdAt) : '';
    const dn = i.dienstnummerVerhoorder ? `· DN ${escapeHtml(i.dienstnummerVerhoorder)}` : '';
    let statusBadge = '';
    if (i.status === 'transcribing') {
        statusBadge = `<span style="background:#fb8c00;color:white;padding:2px 8px;border-radius:8px;font-size:.65rem;font-weight:600;margin-left:6px">bezig…</span>`;
    } else if (i.status === 'failed') {
        statusBadge = `<span style="background:#dc3545;color:white;padding:2px 8px;border-radius:8px;font-size:.65rem;font-weight:600;margin-left:6px">gefaald</span>`;
    }
    return `
        <div data-iid="${escapeHtml(i.id)}" class="interview-summary"
             style="padding:12px;background:rgba(0,0,0,0.3);border-radius:10px;margin-bottom:8px;cursor:pointer">
            <div style="font-weight:600">${escapeHtml(i.naam || 'Onbekend')}${statusBadge}</div>
            <div style="font-size:.75rem;color:rgba(255,255,255,0.5);margin-top:4px">
                ${escapeHtml(i.onderwerp || '')} ${dn} — ${i.wordCount || 0} woorden · ${dt}
            </div>
        </div>`;
}

// ── Lijst-tab rendering (alle interviews) ───────────────────────────────────
function renderList() {
    const wrap = document.getElementById('all-list');
    if (!wrap) return;
    if (State.interviews.length === 0) {
        wrap.innerHTML = `
            <div class="empty">
                <i class="fas fa-folder-open"></i>
                <p>Nog geen interviews opgenomen</p>
            </div>`;
        return;
    }
    wrap.innerHTML = State.interviews.map(i => renderInterviewSummary(i)).join('');

    // Click-handlers voor detail-view
    wrap.querySelectorAll('.interview-summary').forEach(el => {
        el.addEventListener('click', () => showInterviewDetail(el.dataset.iid));
    });
}

function showInterviewDetail(id) {
    const i = State.interviews.find(x => x.id === id);
    if (!i) { toast('Interview niet gevonden', 'error'); return; }

    const colors = ['var(--spk1)', 'var(--spk2)', 'var(--spk3)'];
    const dn = i.dienstnummerVerhoorder || '';
    const speakerName = (idx) => {
        if (idx === 0 && dn) return `Verhoorder DN ${escapeHtml(dn)}`;
        return `Speaker ${idx + 1}`;
    };

    const html = `
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:10000;overflow-y:auto;padding:20px">
            <div style="max-width:700px;margin:20px auto;background:linear-gradient(135deg,#0a0f1a,#16213e);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:25px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:15px">
                    <div>
                        <h2 style="color:var(--primary-light);font-size:1.2rem;margin-bottom:4px">${escapeHtml(i.naam)}</h2>
                        <div style="font-size:.78rem;color:rgba(255,255,255,0.6)">
                            ${escapeHtml(i.onderwerp || '')} · DN ${escapeHtml(dn)} · ${formatDate(i.createdAt)}
                        </div>
                    </div>
                    <button id="close-detail" class="btn btn-ghost" style="padding:8px 14px">✕</button>
                </div>
                <div style="display:flex;gap:15px;margin-bottom:15px;font-size:.85rem;color:rgba(255,255,255,0.7)">
                    <span>Duur: <strong style="color:white">${(i.durationSec||0).toFixed(0)}s</strong></span>
                    <span>Sprekers: <strong style="color:white">${i.speakerCount||0}</strong></span>
                    <span>Woorden: <strong style="color:white">${i.wordCount||0}</strong></span>
                </div>
                <div style="background:rgba(0,0,0,0.3);border-radius:10px;overflow:hidden;margin-bottom:15px">
                    ${(i.chunks||[]).map(c => {
                        const ts = c.startSec !== null ? `${formatTime(c.startSec)} → ${formatTime(c.endSec)}` : '?';
                        let lbl = 'onbekend', col = '#666';
                        if (c.dominantSpeaker !== null) {
                            lbl = speakerName(c.dominantSpeaker);
                            col = colors[c.dominantSpeaker] || '#666';
                            if (c.hasMultipleSpeakers) lbl += ' (overlap)';
                        }
                        return `
                            <div style="padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05)">
                                <div style="display:flex;gap:10px;align-items:center;margin-bottom:5px">
                                    <span style="font-family:Menlo,monospace;color:var(--accent);font-size:.75rem">${ts}</span>
                                    <span style="background:${col};color:white;padding:2px 10px;border-radius:10px;font-size:.7rem;font-weight:600">${escapeHtml(lbl)}</span>
                                </div>
                                <div style="color:rgba(255,255,255,0.92);line-height:1.5;font-size:.9rem">${escapeHtml(c.text)}</div>
                            </div>`;
                    }).join('')}
                </div>
                <div style="display:flex;gap:10px;flex-wrap:wrap">
                    <button id="detail-export" class="btn btn-primary"><i class="fas fa-download"></i> Export JSON</button>
                    <button id="detail-delete" class="btn btn-danger"><i class="fas fa-trash"></i> Verwijder</button>
                </div>
            </div>
        </div>`;

    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const overlay = wrap.firstElementChild;
    document.body.appendChild(overlay);

    overlay.querySelector('#close-detail').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#detail-export').addEventListener('click', () => {
        State.lastInterview = i;
        exportJson();
    });
    overlay.querySelector('#detail-delete').addEventListener('click', () => {
        if (!confirm(`Interview met ${i.naam} verwijderen?`)) return;
        State.interviews = Storage.delete(id);
        overlay.remove();
        renderDashboard();
        renderList();
        toast('Interview verwijderd', 'success');
    });
}

// ── Modellen laden (Step 2) ──────────────────────────────────────────────────
const MODELS_FLAG_KEY = 'bibob_v2_models_ever_loaded';

async function loadModels(silent = false) {
    const btn = document.getElementById('load-models-btn');
    const progressBar = document.getElementById('models-progress');
    const progressWrap = document.getElementById('models-progress-wrap');
    const statusEl = document.getElementById('models-status');

    if (btn) btn.disabled = true;
    if (progressWrap) progressWrap.style.display = 'block';

    try {
        // ── iOS-pad: Apple Speech — geen download nodig ────────────────────
        if (USE_APPLE_SPEECH) {
            setStatus(statusEl, 'Apple Speech (iOS on-device) initialiseren…', 'warning');
            await TranscribeApple.ensureModel();
            if (progressBar) { progressBar.style.width = '100%'; progressBar.textContent = 'Apple Speech klaar'; }
            // Op iOS skippen we pyannote (te zwaar voor iPhone-WASM)
            localStorage.setItem(MODELS_FLAG_KEY, '1');
            setStatus(statusEl, '✓ Apple Speech klaar (iOS native, on-device) — je kunt een interview opnemen', 'success');
            const startBtn = document.getElementById('start-interview-btn');
            if (startBtn) startBtn.disabled = false;
            if (btn) btn.style.display = 'none';
            if (progressWrap) setTimeout(() => { progressWrap.style.display = 'none'; }, 2000);
            return;
        }

        // ── Desktop-pad: Whisper + pyannote ────────────────────────────────
        const firstTime = !localStorage.getItem(MODELS_FLAG_KEY);
        const initMsg = firstTime
            ? 'Whisper-small downloaden (~466 MB) — kan 2-15 min duren bij eerste keer'
            : 'Whisper-small laden uit cache (snel)…';
        setStatus(statusEl, initMsg, 'warning');

        await Transcribe.ensureModel((p) => {
            if (p.status === 'progress' && typeof p.progress === 'number') {
                const pct = Math.round(p.progress);
                if (progressBar) {
                    progressBar.style.width = pct + '%';
                    progressBar.textContent = `Whisper: ${p.file || '...'} ${pct}%`;
                }
            }
        });
        if (progressBar) { progressBar.style.width = '100%'; progressBar.textContent = 'Whisper klaar'; }
        setStatus(statusEl, '✓ Whisper geladen — nu pyannote diarization (~6 MB)', 'success');

        await Diarize.ensureModel((p) => {
            if (progressBar) {
                progressBar.style.width = (p.pct || 100) + '%';
                progressBar.textContent = `Pyannote: ${p.pct || 100}%`;
            }
        });

        localStorage.setItem(MODELS_FLAG_KEY, '1');
        setStatus(statusEl, '✓ Beide modellen klaar — je kunt een interview opnemen', 'success');
        const startBtn = document.getElementById('start-interview-btn');
        if (startBtn) startBtn.disabled = false;
        if (btn) btn.style.display = 'none';
        if (progressWrap) setTimeout(() => { progressWrap.style.display = 'none'; }, 2000);
    } catch (err) {
        setStatus(statusEl, '✗ Fout: ' + err.message, 'error');
        log('Models load fout: ' + err.message, 'error');
        if (btn) btn.disabled = false;
    }
}

// Auto-start: bij elk login direct modellen laden uit cache (of eerste keer download)
function autoStartModelsIfPossible() {
    // Als de gebruiker eerder al modellen heeft geladen → automatisch in achtergrond laden
    // Eerste-keer-gebruikers moeten zelf op knop klikken (om bewust de ~466 MB download te accepteren)
    const everLoaded = localStorage.getItem(MODELS_FLAG_KEY);
    if (everLoaded) {
        log('Modellen eerder geladen — auto-load uit cache…');
        loadModels(true);
    } else {
        log('Eerste sessie — gebruiker moet zelf modellen-download starten');
    }
}

// ── Interview-flow (Step 3) ──────────────────────────────────────────────────
async function startInterview() {
    const naam = document.getElementById('interview-naam').value.trim();
    if (!naam) { toast('Naam geïnterviewde verplicht', 'error'); return; }

    if (USE_APPLE_SPEECH) {
        // iOS: alleen Apple Speech moet beschikbaar zijn
        if (!TranscribeApple.isSupported()) {
            toast('Apple Speech niet beschikbaar op dit apparaat', 'error');
            return;
        }
    } else {
        // Desktop: Whisper + pyannote moeten geladen zijn
        if (!Transcribe.isReady() || !Diarize.isReady()) {
            toast('Laad eerst de modellen', 'error');
            return;
        }
    }

    try {
        const recIndicator = document.getElementById('rec-indicator');
        const recDur = document.getElementById('rec-duration');
        const recBtn = document.getElementById('start-interview-btn');
        const stopBtn = document.getElementById('stop-interview-btn');
        const liveTextEl = document.getElementById('live-transcript');

        // Verberg vorig resultaat — Bibob: schone start, geen oude data zichtbaar
        const prevResults = document.getElementById('results-card');
        if (prevResults) prevResults.classList.add('hidden');
        const transcriptBody = document.getElementById('transcript-body');
        if (transcriptBody) transcriptBody.innerHTML = '';
        const exportBtn = document.getElementById('export-json-btn');
        if (exportBtn) exportBtn.classList.add('hidden');

        recIndicator.classList.remove('hidden');
        recBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        if (liveTextEl) {
            liveTextEl.classList.remove('hidden');
            liveTextEl.textContent = '(luisteren…)';
        }

        if (USE_APPLE_SPEECH) {
            // Apple Speech LIVE — tekst verschijnt direct
            await TranscribeApple.startLive((upd) => {
                if (liveTextEl) {
                    const interim = upd.interim ? ` <em style="opacity:.5">${escapeHtml(upd.interim)}</em>` : '';
                    liveTextEl.innerHTML = escapeHtml(upd.final) + interim;
                    liveTextEl.scrollTop = liveTextEl.scrollHeight;
                }
            });
            // Optioneel: ook MediaRecorder parallel voor audio-archief later
            // Voor MVP skippen we dat - alleen text via Apple Speech
            const start = Date.now();
            const tickTimer = setInterval(() => {
                if (!TranscribeApple.isActive()) { clearInterval(tickTimer); return; }
                recDur.textContent = ((Date.now() - start) / 1000).toFixed(0);
            }, 500);
            // Bewaar tickTimer voor stop
            startInterview._tickTimer = tickTimer;
        } else {
            // Desktop: gewoon MediaRecorder + later Whisper+Diarize
            await Recorder.start((sec) => {
                recDur.textContent = sec.toFixed(0);
            });
        }
    } catch (err) {
        toast('Microfoon-fout: ' + err.message, 'error');
        log('Recorder fout: ' + err.message, 'error');
        resetRecorderUI();
    }
}

async function stopInterview() {
    const naam = document.getElementById('interview-naam').value.trim();
    const onderwerp = document.getElementById('interview-onderwerp').value.trim();
    const dnInput = document.getElementById('interview-dienstnummer');
    const dienstnummerVerhoorder = (dnInput?.value || Auth.getDienstnummer()).trim();
    const resultsCard = document.getElementById('results-card');
    const transcriptBody = document.getElementById('transcript-body');
    const runStatus = document.getElementById('run-status');

    // Stub OUTSIDE try zodat hij in catch ook bekend is
    const stubId = uid();
    let interviewSaved = false;

    try {
        setStatus(runStatus, 'opname verwerken…', 'warning');

        let audioFloat32 = null;
        let durationSec = 0;
        let merged = [];
        let speakerSet = new Set();

        if (USE_APPLE_SPEECH) {
            // ── iOS-pad: Apple Speech klaar ─────────────────────────────────
            if (startInterview._tickTimer) {
                clearInterval(startInterview._tickTimer);
                startInterview._tickTimer = null;
            }
            const appleResult = await TranscribeApple.stopLive();
            durationSec = appleResult.durationSec;
            log(`Apple Speech klaar — ${appleResult.chunks.length} chunks, ${appleResult.text.length} chars`);

            // Bouw chunks-array zoals Whisper-format (dominantSpeaker = 0 = verhoorder)
            // Apple Speech geeft geen diarization. Voor MVP: alles op Speaker 1 (= verhoorder).
            // Subject vs verhoorder kan in v2.1 met audio-buffer + pyannote toegevoegd worden.
            merged = appleResult.chunks.map((c, idx) => ({
                startSec: c.timestampMs / 1000,
                endSec: (idx + 1 < appleResult.chunks.length
                    ? appleResult.chunks[idx + 1].timestampMs / 1000
                    : durationSec),
                text: c.text,
                dominantSpeaker: 0, // = "Verhoorder DN xxx"
                hasMultipleSpeakers: false,
            }));
            speakerSet.add(0);

            // Sla stub direct op (consistent met desktop-pad)
            const stub = {
                id: stubId,
                naam, onderwerp, dienstnummerVerhoorder,
                createdAt: new Date().toISOString(),
                durationSec,
                status: 'completed',
                speakerCount: 1,
                chunks: merged,
                wordCount: merged.reduce((s, c) => s + countWords(c.text), 0),
                engine: 'apple-speech',
            };
            State.interviews = Storage.add(stub);
            State.lastInterview = stub;
            interviewSaved = true;
        } else {
            // ── Desktop-pad: Whisper + pyannote ──────────────────────────────
            const r = await Recorder.stop();
            audioFloat32 = r.audioFloat32;
            durationSec = r.durationSec;
            log(`Opname gestopt: ${durationSec.toFixed(1)}s`);

            // Stub eerst opslaan (overleeft crash)
            const stub = {
                id: stubId,
                naam, onderwerp, dienstnummerVerhoorder,
                createdAt: new Date().toISOString(),
                durationSec,
                status: 'transcribing',
                speakerCount: 0,
                chunks: [],
                wordCount: 0,
                engine: 'whisper-pyannote',
            };
            State.interviews = Storage.add(stub);
            State.lastInterview = stub;
            interviewSaved = true;
            renderDashboard();
            renderList();
            log(`Interview-stub opgeslagen (id=${stubId}) — start transcribe`);

            resultsCard.classList.remove('hidden');
            setStatus(runStatus, 'Whisper transcribe loopt…', 'warning');
            const transResult = await Transcribe.run(audioFloat32);
            log(`Transcribe klaar — ${transResult.chunks?.length || 0} chunks`);

            setStatus(runStatus, 'pyannote diarize loopt…', 'warning');
            const diarSegments = await Diarize.run(audioFloat32, (p) => {
                setStatus(runStatus, `diarize window ${p.window}/${p.total}…`, 'warning');
            });
            log(`Diarize klaar — ${diarSegments.length} segments`);

            merged = Diarize.mergeChunksWithSpeakers(transResult.chunks || [], diarSegments);
            for (const r2 of merged) if (r2.dominantSpeaker !== null) speakerSet.add(r2.dominantSpeaker);

            const wordCount = merged.reduce((s, c) => s + countWords(c.text), 0);
            Storage.update(stubId, {
                status: 'completed',
                speakerCount: speakerSet.size,
                chunks: merged,
                wordCount,
            });
            State.interviews = Storage.loadAll();
            State.lastInterview = Storage.get(stubId);
            log(`Interview ${stubId} → completed (${merged.length} chunks, ${speakerSet.size} sprekers)`);
        }

        // ── Render-flow voor beide paden ────────────────────────────────────
        const interview = State.lastInterview;
        resultsCard.classList.remove('hidden');

        // Render transcript in resultaat-kaart
        const colors = ['var(--spk1)', 'var(--spk2)', 'var(--spk3)'];
        const speakerName = (idx) => {
            if (idx === 0 && dienstnummerVerhoorder) return `Verhoorder DN ${escapeHtml(dienstnummerVerhoorder)}`;
            return `Speaker ${idx + 1}`;
        };
        transcriptBody.innerHTML = merged.map(r => {
            const ts = r.startSec !== null ? `${formatTime(r.startSec)} → ${formatTime(r.endSec)}` : '?';
            let spkLabel = 'onbekend', color = '#666';
            if (r.dominantSpeaker !== null) {
                spkLabel = speakerName(r.dominantSpeaker);
                color = colors[r.dominantSpeaker] || '#666';
                if (r.hasMultipleSpeakers) spkLabel += ' (overlap)';
            }
            return `
                <div style="padding:12px;border-bottom:1px solid rgba(255,255,255,0.05)">
                    <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
                        <span style="font-family:Menlo,monospace;color:var(--accent);font-size:.75rem">${ts}</span>
                        <span style="background:${color};color:white;padding:2px 10px;border-radius:10px;font-size:.7rem;font-weight:600">${spkLabel}</span>
                    </div>
                    <div style="color:rgba(255,255,255,0.92);line-height:1.5;font-size:.92rem">${escapeHtml(r.text)}</div>
                </div>
            `;
        }).join('');

        setStatus(runStatus, `✓ klaar — ${speakerSet.size} sprekers, ${merged.length} chunks, opgeslagen`, 'success');
        document.getElementById('export-json-btn').classList.remove('hidden');
        renderDashboard();
        renderList();
        resetRecorderUI();
        toast('Interview opgeslagen', 'success');
        // Form-velden leegmaken voor volgend interview (Bibob: schone start,
        // geen oude subject-gegevens zichtbaar). Resultaten-card blijft zichtbaar
        // tot gebruiker een nieuw interview start of naar andere tab gaat.
        document.getElementById('interview-naam').value = '';
        document.getElementById('interview-onderwerp').value = '';
    } catch (err) {
        setStatus(runStatus, '✗ Fout: ' + err.message, 'error');
        log('Stop-interview fout: ' + err.message, 'error');
        if (interviewSaved) {
            // Markeer stub als failed zodat gebruiker weet dat hervat nodig is
            try {
                Storage.update(stubId, {
                    status: 'failed',
                    error: err.message,
                });
                State.interviews = Storage.loadAll();
                renderDashboard();
                renderList();
                toast('Transcribe gefaald — interview-metadata bewaard', 'warning');
            } catch (saveErr) {
                log('Kon failed-status niet opslaan: ' + saveErr.message, 'error');
            }
        }
        resetRecorderUI();
    }
}

function resetRecorderUI() {
    document.getElementById('rec-indicator').classList.add('hidden');
    document.getElementById('start-interview-btn').classList.remove('hidden');
    document.getElementById('stop-interview-btn').classList.add('hidden');
    const liveEl = document.getElementById('live-transcript');
    if (liveEl) { liveEl.classList.add('hidden'); liveEl.innerHTML = ''; }
}

/** Wist interview-formulier voor schone start van volgend interview (Bibob: geen
 *  oude subject-gegevens zichtbaar bij nieuw onderzoek).
 *  Dienstnummer blijft staan (verhoorder is doorgaans dezelfde). */
function resetInterviewForm() {
    const fields = ['interview-naam', 'interview-onderwerp'];
    for (const id of fields) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }
    // Resultaten-card verbergen
    const resultsCard = document.getElementById('results-card');
    if (resultsCard) resultsCard.classList.add('hidden');
    const transcriptBody = document.getElementById('transcript-body');
    if (transcriptBody) transcriptBody.innerHTML = '';
    const exportBtn = document.getElementById('export-json-btn');
    if (exportBtn) exportBtn.classList.add('hidden');
    log('Interview-form gewist — klaar voor nieuw interview');
}

// ── JSON-export v2.0.0 ───────────────────────────────────────────────────────
function exportJson() {
    if (!State.lastInterview) return;
    const i = State.lastInterview;
    const dn = i.dienstnummerVerhoorder || '';
    const speakerNameFor = (idx) => {
        if (idx === 0 && dn) return `Verhoorder_DN_${dn}`;
        return `Speaker_${idx + 1}`;
    };
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
            dienstnummer_verhoorder: dn,
            createdAt: i.createdAt,
            durationSec: i.durationSec,
        },
        speakerCount: i.speakerCount,
        segments: i.chunks.map((c, idx) => ({
            index: idx,
            startSec: c.startSec,
            endSec: c.endSec,
            durationSec: c.startSec !== null ? +(c.endSec - c.startSec).toFixed(2) : null,
            speaker: c.dominantSpeaker !== null ? speakerNameFor(c.dominantSpeaker) : null,
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

    // Laad interviews uit persistent storage
    State.interviews = Storage.loadAll();
    log(`${State.interviews.length} interview(s) uit storage geladen`);

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

    // Dienstnummer wijzigen (Settings)
    document.getElementById('change-dn-btn')?.addEventListener('click', () => {
        const cur = Auth.getDienstnummer();
        const nw = prompt('Dienstnummer (nieuwe waarde):', cur);
        if (nw === null) return;
        const trimmed = nw.trim();
        if (!trimmed) { toast('Dienstnummer mag niet leeg zijn', 'error'); return; }
        Auth.setDienstnummer(trimmed);
        document.getElementById('display-dn-settings').textContent = trimmed;
        // Vul ook het interview-form veld bij
        const dnFld = document.getElementById('interview-dienstnummer');
        if (dnFld) dnFld.value = trimmed;
        toast('Dienstnummer bijgewerkt', 'success');
    });

    // Tabs
    document.querySelectorAll('.nav-tab').forEach(t => {
        t.addEventListener('click', () => switchTab(t.dataset.tab));
    });

    // Modellen + recorder
    document.getElementById('load-models-btn')?.addEventListener('click', () => loadModels(false));
    document.getElementById('start-interview-btn')?.addEventListener('click', startInterview);
    document.getElementById('stop-interview-btn')?.addEventListener('click', stopInterview);
    document.getElementById('export-json-btn')?.addEventListener('click', exportJson);

    // Hook na succesvolle login: auto-load models + render lijst + pre-fill dienstnummer
    Auth.onAfterLogin = () => {
        const dn = Auth.getDienstnummer();
        const dnFld = document.getElementById('interview-dienstnummer');
        if (dnFld) dnFld.value = dn || '';
        const dnSettingsEl = document.getElementById('display-dn-settings');
        if (dnSettingsEl) dnSettingsEl.textContent = dn || '(niet ingesteld)';
        renderDashboard();
        renderList();
        autoStartModelsIfPossible();
    };

    Auth.init();
}

document.addEventListener('DOMContentLoaded', bootstrap);
window.BibobApp = { State, switchTab, renderDashboard, renderList, Storage };
