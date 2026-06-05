// BIBOB Interview Pro v2.0 — Diarization module
// Pyannote-segmentation-3.0 ONNX via onnxruntime-web.
// Lazy-download van het ONNX-model bij eerste gebruik, gecached in IndexedDB
// voor offline-werking daarna.

import { log } from './utils.js';

const MODEL_URL = 'https://huggingface.co/onnx-community/pyannote-segmentation-3.0/resolve/main/onnx/model.onnx';
const MODEL_FALLBACK_URL = './models/sherpa-onnx-pyannote-segmentation-3-0/model.onnx';
const MODEL_CACHE_NAME = 'bibob-v2-models';
const MODEL_CACHE_KEY = 'pyannote-segmentation-3-0.onnx';

const SAMPLE_RATE = 16000;
const WINDOW_SAMPLES = 10 * SAMPLE_RATE;
const HOP_SAMPLES = 8 * SAMPLE_RATE;
const FRAMES_PER_WINDOW = 589;
const SECONDS_PER_FRAME = 10 / FRAMES_PER_WINDOW;

// Pyannote-3.0 powerset over 3 sprekers
const POWERSET = [
    /* 0 */ [],         // silence
    /* 1 */ [0],
    /* 2 */ [1],
    /* 3 */ [2],
    /* 4 */ [0, 1],     // overlap
    /* 5 */ [0, 2],
    /* 6 */ [1, 2],
];

let session = null;

// ── IndexedDB voor model-cache ──────────────────────────────────────────────
function openModelDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(MODEL_CACHE_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('models')) {
                db.createObjectStore('models');
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function getCachedModel() {
    const db = await openModelDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readonly');
        const store = tx.objectStore('models');
        const req = store.get(MODEL_CACHE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

async function setCachedModel(buffer) {
    const db = await openModelDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('models', 'readwrite');
        const store = tx.objectStore('models');
        const req = store.put(buffer, MODEL_CACHE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

async function downloadModel(url, progressCallback) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} bij ${url}`);
    const contentLength = +response.headers.get('content-length') || 0;
    if (!response.body || !contentLength) {
        // Fallback: hele body in 1x
        const buf = await response.arrayBuffer();
        if (progressCallback) progressCallback({ loaded: buf.byteLength, total: buf.byteLength, pct: 100 });
        return buf;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (progressCallback) {
            const pct = Math.round((loaded / contentLength) * 100);
            progressCallback({ loaded, total: contentLength, pct });
        }
    }
    const buf = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.length; }
    return buf.buffer;
}

// ── Public API ──────────────────────────────────────────────────────────────

export const Diarize = {
    async ensureModel(progressCallback) {
        if (session) return session;

        // Check ort beschikbaar
        if (typeof ort === 'undefined') {
            throw new Error('onnxruntime-web (window.ort) niet geladen — check index.html script-tag');
        }
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
        ort.env.wasm.numThreads = 1;

        // Probeer eerst IndexedDB-cache
        log('Pyannote-model laden — check IndexedDB-cache…');
        let modelBuffer = await getCachedModel().catch(() => null);

        if (!modelBuffer) {
            log(`Geen cache — downloaden van ${MODEL_URL}`);
            try {
                modelBuffer = await downloadModel(MODEL_URL, progressCallback);
                await setCachedModel(modelBuffer);
                log(`✓ Model gedownload (${modelBuffer.byteLength} bytes) + gecached`);
            } catch (errPrimary) {
                log(`Primary download faalde: ${errPrimary.message}. Probeer fallback ${MODEL_FALLBACK_URL}…`, 'warn');
                try {
                    modelBuffer = await downloadModel(MODEL_FALLBACK_URL, progressCallback);
                    await setCachedModel(modelBuffer);
                    log(`✓ Model via fallback (${modelBuffer.byteLength} bytes) + gecached`);
                } catch (errFallback) {
                    throw new Error(`Beide download-routes faalden: primair "${errPrimary.message}", fallback "${errFallback.message}"`);
                }
            }
        } else {
            log(`✓ Model uit IndexedDB-cache (${modelBuffer.byteLength} bytes)`);
        }

        // Init session uit ArrayBuffer
        session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all',
        });
        log(`✓ Pyannote session gemaakt — input: ${session.inputNames[0]}, output: ${session.outputNames[0]}`);
        return session;
    },

    isReady() { return !!session; },

    /**
     * Run diarization over audio-buffer.
     * @param {Float32Array} audioFloat32 - 16kHz mono samples
     * @param {function} [progressCallback] - krijgt {window: N, total: M}
     * @returns {Promise<Array<{startSec, endSec, label, speakers}>>}
     */
    async run(audioFloat32, progressCallback) {
        if (!session) throw new Error('Diarize niet geladen — roep eerst ensureModel() aan');

        const totalSamples = audioFloat32.length;
        const totalDurationSec = totalSamples / SAMPLE_RATE;
        const numWindows = Math.max(1, Math.ceil((totalSamples - WINDOW_SAMPLES + HOP_SAMPLES) / HOP_SAMPLES));
        const totalFrames = Math.ceil(totalDurationSec / SECONDS_PER_FRAME);
        const globalProbs = new Float32Array(totalFrames * 7);
        const globalCounts = new Int32Array(totalFrames);

        for (let w = 0; w < numWindows; w++) {
            const startSample = w * HOP_SAMPLES;
            const window = new Float32Array(WINDOW_SAMPLES);
            const available = Math.min(WINDOW_SAMPLES, totalSamples - startSample);
            window.set(audioFloat32.subarray(startSample, startSample + available));

            const inputTensor = new ort.Tensor('float32', window, [1, 1, WINDOW_SAMPLES]);
            const feeds = {};
            feeds[session.inputNames[0]] = inputTensor;
            const results = await session.run(feeds);
            const out = results[session.outputNames[0]];
            const data = out.data;
            const numFrames = out.dims[1];
            const numClasses = out.dims[2];

            const windowStartSec = startSample / SAMPLE_RATE;
            for (let f = 0; f < numFrames; f++) {
                const frameTimeSec = windowStartSec + f * SECONDS_PER_FRAME;
                const globalFrame = Math.floor(frameTimeSec / SECONDS_PER_FRAME);
                if (globalFrame >= totalFrames) break;
                for (let c = 0; c < Math.min(numClasses, 7); c++) {
                    globalProbs[globalFrame * 7 + c] += data[f * numClasses + c];
                }
                globalCounts[globalFrame]++;
            }

            if (progressCallback) progressCallback({ window: w + 1, total: numWindows });
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // Normaliseer overlap-zones
        for (let f = 0; f < totalFrames; f++) {
            const count = globalCounts[f] || 1;
            for (let c = 0; c < 7; c++) globalProbs[f * 7 + c] /= count;
        }

        // Argmax + smoothing
        const frameLabels = new Int8Array(totalFrames);
        for (let f = 0; f < totalFrames; f++) {
            let maxIdx = 0, maxVal = globalProbs[f * 7];
            for (let c = 1; c < 7; c++) {
                if (globalProbs[f * 7 + c] > maxVal) {
                    maxVal = globalProbs[f * 7 + c];
                    maxIdx = c;
                }
            }
            frameLabels[f] = maxIdx;
        }
        const smoothed = new Int8Array(totalFrames);
        if (totalFrames > 0) smoothed[0] = frameLabels[0];
        if (totalFrames > 1) smoothed[totalFrames - 1] = frameLabels[totalFrames - 1];
        for (let f = 1; f < totalFrames - 1; f++) {
            if (frameLabels[f - 1] === frameLabels[f + 1] && frameLabels[f] !== frameLabels[f - 1]) {
                smoothed[f] = frameLabels[f - 1];
            } else {
                smoothed[f] = frameLabels[f];
            }
        }

        // Groepeer in segments
        const segments = [];
        let segStart = 0;
        let segLabel = smoothed[0];
        for (let f = 1; f < totalFrames; f++) {
            if (smoothed[f] !== segLabel) {
                segments.push({
                    startSec: segStart * SECONDS_PER_FRAME,
                    endSec: f * SECONDS_PER_FRAME,
                    label: segLabel,
                    speakers: POWERSET[segLabel] || [],
                });
                segStart = f;
                segLabel = smoothed[f];
            }
        }
        if (totalFrames > 0) {
            segments.push({
                startSec: segStart * SECONDS_PER_FRAME,
                endSec: totalFrames * SECONDS_PER_FRAME,
                label: segLabel,
                speakers: POWERSET[segLabel] || [],
            });
        }

        // Filter te korte segments (<400 ms)
        const MIN_SEG_SEC = 0.4;
        const filtered = [];
        for (const seg of segments) {
            const dur = seg.endSec - seg.startSec;
            if (dur < MIN_SEG_SEC && filtered.length > 0) {
                filtered[filtered.length - 1].endSec = seg.endSec;
            } else {
                filtered.push(seg);
            }
        }
        return filtered;
    },

    /**
     * Merge Whisper-chunks met diarization-segments via timestamp-overlap.
     * Per chunk: dominante speaker = die met meeste overlap-seconden binnen
     * de chunk. Multi-speaker chunks krijgen `hasMultipleSpeakers: true`.
     */
    mergeChunksWithSpeakers(whisperChunks, diarSegments) {
        const merged = [];
        for (const chunk of whisperChunks) {
            const ts = chunk.timestamp;
            if (!ts || ts.length !== 2 || typeof ts[0] !== 'number') {
                merged.push({
                    startSec: null,
                    endSec: null,
                    text: (chunk.text || '').trim(),
                    dominantSpeaker: null,
                    hasMultipleSpeakers: false,
                });
                continue;
            }
            const cStart = ts[0];
            const cEnd = (ts[1] !== null && typeof ts[1] === 'number') ? ts[1] : cStart + 5;

            const overlapPerSpeaker = {};
            for (const seg of diarSegments) {
                if (seg.endSec <= cStart || seg.startSec >= cEnd) continue;
                const overlap = Math.min(cEnd, seg.endSec) - Math.max(cStart, seg.startSec);
                if (overlap <= 0) continue;
                for (const spk of seg.speakers) {
                    overlapPerSpeaker[spk] = (overlapPerSpeaker[spk] || 0) + overlap;
                }
            }

            let dominantSpeaker = null, maxOverlap = 0;
            for (const [spk, ov] of Object.entries(overlapPerSpeaker)) {
                if (ov > maxOverlap) { maxOverlap = ov; dominantSpeaker = parseInt(spk); }
            }
            const speakers = Object.keys(overlapPerSpeaker).map(Number);

            merged.push({
                startSec: cStart,
                endSec: cEnd,
                text: (chunk.text || '').trim(),
                dominantSpeaker,
                hasMultipleSpeakers: speakers.length > 1,
            });
        }
        return merged;
    },

    getModelName() { return 'pyannote-segmentation-3.0'; },
};
