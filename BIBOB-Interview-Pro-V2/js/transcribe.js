// BIBOB Interview Pro v2.0 — Transcribe module
// Whisper-small via transformers.js. Volledig on-device na initial download.
// Model wordt gecached in IndexedDB door transformers.js zelf — bij eerstvolgende
// app-start (zelfs offline) blijft het bruikbaar.

import { log } from './utils.js';

const WHISPER_MODEL = 'Xenova/whisper-small';
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
     * Transcribeer audio-buffer.
     * @param {Float32Array} audioFloat32 - 16kHz mono samples
     * @param {object} opts - { language: 'dutch', returnTimestamps: true }
     * @returns {Promise<{text: string, chunks: Array<{timestamp: [number, number], text: string}>}>}
     */
    async run(audioFloat32, opts = {}) {
        if (!transcriber) throw new Error('Transcriber niet geladen — roep eerst ensureModel() aan');
        const result = await transcriber(audioFloat32, {
            language: opts.language || 'dutch',
            task: opts.task || 'transcribe',
            return_timestamps: opts.returnTimestamps !== false,
            chunk_length_s: opts.chunkLengthSec || 30,
            stride_length_s: opts.strideLengthSec || 5,
        });
        return result;
    },

    getModelName() { return WHISPER_MODEL; },
};
