// BIBOB Interview Pro v2.0 — Transcribe module
// Whisper via transformers.js. Volledig on-device na initial download.
// Model wordt gecached in IndexedDB door transformers.js zelf — bij eerstvolgende
// app-start (zelfs offline) blijft het bruikbaar.
//
// Whisper-tiny: ~75 MB, snel maar minder accuraat — geschikt voor iOS Safari die
//   moeite heeft met grotere modellen
// Whisper-small: ~466 MB, betere kwaliteit — werkt op desktop en Android
//
// Op iOS detecteren we automatisch en kiezen tiny om hang-issues te vermijden.

import { log } from './utils.js';

function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Default: tiny op iOS (kleiner, sneller, betrouwbaarder), small elders
const WHISPER_MODEL = isIOS() ? 'Xenova/whisper-tiny' : 'Xenova/whisper-small';
const TRANSCRIBE_TIMEOUT_MS = 90_000; // 90 sec max

let pipeline = null;
let env = null;
let transcriber = null;

async function loadTransformersJs() {
    if (pipeline) return;
    log('Transformers.js laden van CDN…');
    const mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    pipeline = mod.pipeline;
    env = mod.env;
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    log('Transformers.js geladen ✓');
}

export const Transcribe = {
    async ensureModel(progressCallback) {
        if (transcriber) return transcriber;
        await loadTransformersJs();
        log(`Whisper-pipeline aanmaken (${WHISPER_MODEL})…`);
        transcriber = await pipeline('automatic-speech-recognition', WHISPER_MODEL, {
            progress_callback: (p) => {
                if (typeof progressCallback === 'function') progressCallback(p);
                if (p.status === 'progress' && typeof p.progress === 'number') {
                    // logging gebeurt door progressCallback in UI
                } else if (p.status === 'done') {
                    log(`✓ Bestand klaar: ${p.file}`);
                } else if (p.status === 'ready') {
                    log('✓ Whisper-pipeline ready');
                }
            },
        });
        return transcriber;
    },

    isReady() {
        return !!transcriber;
    },

    /**
     * Transcribeer audio-buffer met harde timeout.
     * @param {Float32Array} audioFloat32 - 16kHz mono samples
     * @param {object} opts - { language: 'dutch', returnTimestamps: true, timeoutMs: 90000 }
     * @returns {Promise<{text: string, chunks: Array<{timestamp: [number, number], text: string}>}>}
     */
    async run(audioFloat32, opts = {}) {
        if (!transcriber) throw new Error('Transcriber niet geladen — roep eerst ensureModel() aan');

        const timeoutMs = opts.timeoutMs || TRANSCRIBE_TIMEOUT_MS;
        const runPromise = transcriber(audioFloat32, {
            language: opts.language || 'dutch',
            task: opts.task || 'transcribe',
            return_timestamps: opts.returnTimestamps !== false,
            chunk_length_s: opts.chunkLengthSec || 30,
            stride_length_s: opts.strideLengthSec || 5,
        });

        let timeoutHandle;
        const timeoutPromise = new Promise((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(`Transcribe-timeout na ${timeoutMs/1000}s — Whisper hangt waarschijnlijk (bekend iOS Safari issue). Probeer kortere audio of desktop.`));
            }, timeoutMs);
        });

        try {
            return await Promise.race([runPromise, timeoutPromise]);
        } finally {
            clearTimeout(timeoutHandle);
        }
    },

    getModelName() { return WHISPER_MODEL; },
    isIOS() { return isIOS(); },
};
