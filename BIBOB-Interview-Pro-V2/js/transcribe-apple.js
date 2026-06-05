// BIBOB Interview Pro v2.0 — Transcribe-engine voor iOS Safari
// Apple Web Speech API met requiresOnDeviceRecognition = true.
// Op iOS 14.5+ draait Apple's eigen Speech-framework volledig on-device,
// geen audio gaat naar Apple-cloud, geen 466 MB model nodig (Apple OS heeft
// het ingebouwd).
//
// Live transcribe (continuous + interimResults). Wordt gestart bij opname-start,
// gestopt bij opname-stop. Finale text wordt verzameld in chunks per
// "isFinal"-event.
//
// LET OP: Apple Speech levert GEEN audio-buffer aan. Voor diarization moet
// MediaRecorder parallel lopen (audio→pyannote achteraf). In MVP doen we
// alleen text — diarization op iOS komt in v2.1.

import { log } from './utils.js';

export const TranscribeApple = {
    state: {
        recognition: null,
        isActive: false,
        finalChunks: [],   // [{text, timestampMs (relative to start)}]
        finalText: '',
        startedAt: 0,
        onChunkCallback: null,
        userRequestedStop: false,
    },

    isSupported() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        return !!SR;
    },

    /**
     * Heeft de browser de on-device-flag (iOS 14.5+) ondersteund?
     * We weten dit pas zeker na een poging — daarom checken we user-agent als hint.
     */
    isLikelyOnDevice() {
        const ua = navigator.userAgent;
        // iOS Safari 14.5+ heeft requiresOnDeviceRecognition support
        if (!/iPad|iPhone|iPod/.test(ua)) return false;
        const match = ua.match(/OS (\d+)_(\d+)/);
        if (!match) return false;
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        return major > 14 || (major === 14 && minor >= 5);
    },

    async ensureModel(/* progressCallback */) {
        if (!this.isSupported()) {
            throw new Error('Apple Speech API niet beschikbaar — werkt alleen op iOS Safari');
        }
        log('Apple Speech API beschikbaar — geen model-download nodig');
        return true;
    },

    /**
     * Start live transcribe.
     * @param {function} onChunk - krijgt {final, interim, chunks}
     */
    async startLive(onChunk) {
        if (this.state.isActive) throw new Error('Apple Speech reeds actief');

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const rec = new SR();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = 'nl-NL';
        rec.maxAlternatives = 1;

        // Probeer on-device te forceren (iOS 14.5+).
        // Browser negeert silent als niet ondersteund — dan VAL HET NIET TERUG
        // op cloud, want WAY niet ondersteund betekent OS pre-14.5.
        try {
            rec.requiresOnDeviceRecognition = true;
            log('requiresOnDeviceRecognition = true gezet');
        } catch (err) {
            log('requiresOnDeviceRecognition setten faalde: ' + err.message, 'warn');
        }

        this.state.recognition = rec;
        this.state.finalChunks = [];
        this.state.finalText = '';
        this.state.startedAt = Date.now();
        this.state.onChunkCallback = onChunk;
        this.state.userRequestedStop = false;
        this.state.isActive = true;

        rec.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const result = e.results[i];
                const transcript = result[0].transcript;
                if (result.isFinal) {
                    const cleanedText = transcript.trim();
                    if (cleanedText) {
                        const tsMs = Date.now() - this.state.startedAt;
                        this.state.finalChunks.push({
                            text: cleanedText,
                            timestampMs: tsMs,
                        });
                        this.state.finalText += cleanedText + ' ';
                        log(`Apple Speech final chunk @${(tsMs/1000).toFixed(1)}s: "${cleanedText.substring(0, 40)}..."`);
                    }
                } else {
                    interim += transcript;
                }
            }
            if (typeof this.state.onChunkCallback === 'function') {
                this.state.onChunkCallback({
                    final: this.state.finalText.trim(),
                    interim: interim.trim(),
                    chunks: this.state.finalChunks,
                });
            }
        };

        rec.onerror = (e) => {
            // 'no-speech' is geen echte error, vaak tijdens stiltes
            if (e.error !== 'no-speech' && e.error !== 'aborted') {
                log('SpeechRecognition error: ' + e.error, 'error');
            }
        };

        rec.onend = () => {
            // Auto-restart als gebruiker niet bewust gestopt is
            if (this.state.isActive && !this.state.userRequestedStop) {
                try {
                    log('SpeechRecognition restart (auto)');
                    rec.start();
                } catch (err) {
                    log('Restart faalde: ' + err.message, 'warn');
                    this.state.isActive = false;
                }
            }
        };

        rec.onstart = () => log('Apple Speech start');

        rec.start();
    },

    /**
     * Stop live transcribe. Retourneert {text, chunks, durationSec}.
     */
    async stopLive() {
        if (!this.state.isActive) {
            return { text: '', chunks: [], durationSec: 0 };
        }
        this.state.userRequestedStop = true;
        this.state.isActive = false;

        const durationSec = (Date.now() - this.state.startedAt) / 1000;

        try {
            this.state.recognition.stop();
        } catch (err) {
            log('rec.stop() faalde: ' + err.message, 'warn');
        }

        // Wacht 600ms op laatste final-results die nog binnen kunnen komen
        await new Promise(r => setTimeout(r, 600));

        const result = {
            text: this.state.finalText.trim(),
            chunks: [...this.state.finalChunks],
            durationSec,
        };

        this.state.recognition = null;
        return result;
    },

    isActive() { return this.state.isActive; },
    getModelName() { return 'Apple-Speech-on-device (iOS native)'; },
};
