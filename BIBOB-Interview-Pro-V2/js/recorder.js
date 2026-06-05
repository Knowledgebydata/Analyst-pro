// BIBOB Interview Pro v2.0 — Audio recorder
// MediaRecorder voor live opname + Web Audio API voor 16kHz mono-conversie.

import { log } from './utils.js';

const SAMPLE_RATE = 16000;

export const Recorder = {
    state: {
        mediaRecorder: null,
        stream: null,
        chunks: [],
        isRecording: false,
        startedAt: 0,
        durationTimer: null,
        onDuration: null,
    },

    async start(onDurationUpdate) {
        if (this.state.isRecording) throw new Error('Opname loopt al');

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: 48000,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });

        let mimeType = 'audio/webm;codecs=opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/mp4'; // iOS Safari
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

        log(`Recorder MIME-type: ${mimeType || '(browser default)'}`);

        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        this.state.chunks = [];
        mr.ondataavailable = (e) => {
            if (e.data.size > 0) this.state.chunks.push(e.data);
        };

        this.state.mediaRecorder = mr;
        this.state.stream = stream;
        this.state.isRecording = true;
        this.state.startedAt = Date.now();
        this.state.onDuration = onDurationUpdate;

        if (typeof onDurationUpdate === 'function') {
            this.state.durationTimer = setInterval(() => {
                const sec = (Date.now() - this.state.startedAt) / 1000;
                onDurationUpdate(sec);
            }, 200);
        }

        mr.start();
        log('Opname gestart');
    },

    /**
     * Stop opname en retourneer { blob, durationSec, audioFloat32 (16kHz mono) }
     */
    async stop() {
        if (!this.state.isRecording) throw new Error('Geen actieve opname');

        return new Promise((resolve, reject) => {
            const mr = this.state.mediaRecorder;
            mr.onstop = async () => {
                try {
                    // Stop tracks + timer
                    this.state.stream.getTracks().forEach(t => t.stop());
                    clearInterval(this.state.durationTimer);
                    this.state.durationTimer = null;
                    this.state.isRecording = false;

                    const blob = new Blob(this.state.chunks, {
                        type: mr.mimeType || 'audio/webm',
                    });
                    log(`Opname klaar: ${(blob.size / 1024).toFixed(1)} KB, type ${blob.type}`);

                    const { audioFloat32, durationSec } = await this.decodeBlobTo16kHzMono(blob);
                    resolve({ blob, audioFloat32, durationSec });
                } catch (err) {
                    reject(err);
                }
            };
            mr.stop();
        });
    },

    /**
     * Decodeer audio-blob naar 16kHz mono Float32Array (input voor Whisper/pyannote).
     */
    async decodeBlobTo16kHzMono(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
        try {
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const numCh = audioBuffer.numberOfChannels;
            const numSamples = audioBuffer.length;
            const mono = new Float32Array(numSamples);
            for (let ch = 0; ch < numCh; ch++) {
                const data = audioBuffer.getChannelData(ch);
                for (let i = 0; i < numSamples; i++) mono[i] += data[i] / numCh;
            }
            return { audioFloat32: mono, durationSec: audioBuffer.duration };
        } finally {
            audioContext.close();
        }
    },

    isRecording() {
        return this.state.isRecording;
    },
};
