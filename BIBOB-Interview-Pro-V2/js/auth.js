// BIBOB Interview Pro v2.0 — Authentication
//
// Upgrade t.o.v. v1.0:
//   - PIN-hash via Web Crypto PBKDF2-SHA-256, 100k iteraties (was plaintext)
//   - PIN-lengte 6 cijfers (was 4)
//   - Lockout na 5 mislukte pogingen (5 min cooldown)
//
// Waarom PBKDF2 en niet bcrypt:
//   - Native browser-API, geen externe library + geen CDN-call (offline-first)
//   - 100k iteraties biedt vergelijkbare brute-force-resistance als bcrypt cost-10
//   - SubtleCrypto is in alle moderne browsers + iOS Safari + Android Chrome
//
// Storage keys:
//   bibob_v2_pin_record — JSON {salt, hash, iterations, algorithm} (base64)
//   bibob_v2_user       — gebruikersnaam
//   bibob_v2_created    — ISO-datum eerste setup
//   bibob_v2_fails      — JSON {count, lockedUntil} voor lockout-tracking
//
// Belangrijk: PBKDF2-hash is een lokale-toegangs-barrière voor PWA op vertrouwd
// device, vergelijkbaar met banking-apps. Gevoelige audio + interviews worden
// apart versleuteld (AES-256 met dossier-key) in storage-module.

import { toast, log } from './utils.js';

const KEYS = {
    PIN_RECORD: 'bibob_v2_pin_record',
    USER:       'bibob_v2_user',
    CREATED:    'bibob_v2_created',
    FAILS:      'bibob_v2_fails',
};

const PIN_LENGTH = 6;
const MAX_FAILS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 min
const PBKDF2_ITERATIONS = 100000;       // ~bcrypt cost-10 equivalent
const SALT_LENGTH_BYTES = 16;
const HASH_BITS = 256;

// ── PBKDF2 helpers ─────────────────────────────────────────────────────────
function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
}
function base64ToBuf(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
}

async function pbkdf2Hash(pin, saltBytes) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(pin),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations: PBKDF2_ITERATIONS,
            hash: 'SHA-256',
        },
        keyMaterial,
        HASH_BITS
    );
    return new Uint8Array(derivedBits);
}

async function createPinRecord(pin) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
    const hash = await pbkdf2Hash(pin, salt);
    return {
        algorithm: 'PBKDF2-SHA-256',
        iterations: PBKDF2_ITERATIONS,
        salt: bufToBase64(salt),
        hash: bufToBase64(hash),
    };
}

async function verifyPinAgainstRecord(pin, record) {
    if (!record || !record.salt || !record.hash) return false;
    const saltBytes = base64ToBuf(record.salt);
    const candidateHash = await pbkdf2Hash(pin, saltBytes);
    const candidateB64 = bufToBase64(candidateHash);
    // Constant-time compare (oversize-veilig genoeg voor 6-cijfer PIN)
    if (candidateB64.length !== record.hash.length) return false;
    let diff = 0;
    for (let i = 0; i < candidateB64.length; i++) {
        diff |= candidateB64.charCodeAt(i) ^ record.hash.charCodeAt(i);
    }
    return diff === 0;
}

// ── Auth-module ────────────────────────────────────────────────────────────

export const Auth = {
    state: {
        currentPin: '',
        mode: 'login', // 'login' | 'setup' | 'app'
    },

    init() {
        const hasRecord = !!localStorage.getItem(KEYS.PIN_RECORD);
        const hasUser = !!localStorage.getItem(KEYS.USER);
        if (hasRecord && hasUser) {
            this.state.mode = 'login';
            this.showLogin();
        } else {
            this.state.mode = 'setup';
            this.showSetup();
        }
    },

    // ── UI: tonen/verbergen ────────────────────────────────────────────────
    showLogin() {
        document.getElementById('screen-login').classList.remove('hidden');
        document.getElementById('screen-setup').classList.add('hidden');
        document.getElementById('app-shell').classList.remove('active');
        this.clearPin();
        this.checkLockout();
    },

    showSetup() {
        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('screen-setup').classList.remove('hidden');
        document.getElementById('app-shell').classList.remove('active');
        document.getElementById('setup-name').focus();
    },

    showApp() {
        document.getElementById('screen-login').classList.add('hidden');
        document.getElementById('screen-setup').classList.add('hidden');
        document.getElementById('app-shell').classList.add('active');
        const user = localStorage.getItem(KEYS.USER);
        const displayUserEl = document.getElementById('display-user');
        if (displayUserEl) displayUserEl.textContent = user || '';
        const settingsUserEl = document.getElementById('display-user-settings');
        if (settingsUserEl) settingsUserEl.textContent = user || '';
        this.state.mode = 'app';
    },

    // ── PIN-numpad handling ────────────────────────────────────────────────
    digit(n) {
        if (this.state.mode !== 'login') return;
        if (this.state.currentPin.length >= PIN_LENGTH) return;
        this.state.currentPin += String(n);
        this.updateDots();
        if (this.state.currentPin.length === PIN_LENGTH) {
            setTimeout(() => this.verify(), 120);
        }
    },

    backspace() {
        if (this.state.mode !== 'login') return;
        this.state.currentPin = this.state.currentPin.slice(0, -1);
        this.updateDots();
    },

    clearPin() {
        this.state.currentPin = '';
        this.updateDots();
        const errEl = document.getElementById('login-error');
        if (errEl) errEl.textContent = '';
    },

    updateDots() {
        const dots = document.querySelectorAll('#screen-login .pin-dot');
        dots.forEach((d, i) => {
            d.classList.toggle('filled', i < this.state.currentPin.length);
        });
    },

    // ── Lockout-mechaniek ──────────────────────────────────────────────────
    getFails() {
        try {
            const raw = localStorage.getItem(KEYS.FAILS);
            return raw ? JSON.parse(raw) : { count: 0, lockedUntil: null };
        } catch {
            return { count: 0, lockedUntil: null };
        }
    },

    setFails(obj) {
        localStorage.setItem(KEYS.FAILS, JSON.stringify(obj));
    },

    resetFails() {
        localStorage.removeItem(KEYS.FAILS);
    },

    checkLockout() {
        const fails = this.getFails();
        if (fails.lockedUntil && fails.lockedUntil > Date.now()) {
            const remainingMin = Math.ceil((fails.lockedUntil - Date.now()) / 60000);
            const errEl = document.getElementById('login-error');
            if (errEl) errEl.textContent = `Geblokkeerd — wacht ${remainingMin} min`;
            document.querySelectorAll('#screen-login .numpad-btn').forEach(b => b.disabled = true);
            return true;
        }
        document.querySelectorAll('#screen-login .numpad-btn').forEach(b => b.disabled = false);
        return false;
    },

    // ── Verify pin ─────────────────────────────────────────────────────────
    async verify() {
        if (this.checkLockout()) {
            this.clearPin();
            return;
        }
        const pin = this.state.currentPin;
        const recordRaw = localStorage.getItem(KEYS.PIN_RECORD);
        if (!recordRaw) {
            log('Geen PIN-record gevonden — switch naar setup', 'warn');
            this.showSetup();
            return;
        }
        let record;
        try {
            record = JSON.parse(recordRaw);
        } catch (err) {
            log('PIN-record corrupt — forceer setup', 'error');
            localStorage.removeItem(KEYS.PIN_RECORD);
            this.showSetup();
            return;
        }

        try {
            const match = await verifyPinAgainstRecord(pin, record);
            if (match) {
                log('✓ PIN correct');
                this.resetFails();
                this.showApp();
            } else {
                this.handleFail();
            }
        } catch (err) {
            log('Verify-fout: ' + err.message, 'error');
            toast('Fout bij verifiëren — probeer opnieuw', 'error');
            this.clearPin();
        }
    },

    handleFail() {
        const fails = this.getFails();
        fails.count = (fails.count || 0) + 1;
        const errEl = document.getElementById('login-error');
        const box = document.querySelector('#screen-login .auth-box');
        box.classList.add('shake');
        setTimeout(() => box.classList.remove('shake'), 400);

        if (fails.count >= MAX_FAILS) {
            fails.lockedUntil = Date.now() + LOCK_DURATION_MS;
            this.setFails(fails);
            errEl.textContent = `Te veel pogingen — geblokkeerd voor 5 min`;
            log(`✗ ${MAX_FAILS} mislukte pogingen — lockout 5 min`, 'warn');
            this.checkLockout();
        } else {
            this.setFails(fails);
            const left = MAX_FAILS - fails.count;
            errEl.textContent = `Onjuiste PIN (${left} pogingen over)`;
        }
        this.clearPin();
    },

    // ── Setup flow (eerste opstart) ────────────────────────────────────────
    async completeSetup() {
        const name = document.getElementById('setup-name').value.trim();
        const pin = document.getElementById('setup-pin').value;
        const confirm = document.getElementById('setup-pin-confirm').value;
        const errEl = document.getElementById('setup-error');

        if (!name) {
            errEl.textContent = 'Voer uw naam in';
            return;
        }
        if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) {
            errEl.textContent = `PIN moet ${PIN_LENGTH} cijfers zijn`;
            return;
        }
        if (pin !== confirm) {
            errEl.textContent = 'PIN-bevestiging komt niet overeen';
            return;
        }

        try {
            errEl.textContent = '';
            const record = await createPinRecord(pin);
            localStorage.setItem(KEYS.PIN_RECORD, JSON.stringify(record));
            localStorage.setItem(KEYS.USER, name);
            localStorage.setItem(KEYS.CREATED, new Date().toISOString());
            this.resetFails();
            log(`Account aangemaakt voor ${name} — PBKDF2-SHA-256 (${PBKDF2_ITERATIONS} iteraties)`);
            toast('Account aangemaakt', 'success');
            this.showApp();
        } catch (err) {
            errEl.textContent = 'Fout: ' + err.message;
            log('Setup-fout: ' + err.message, 'error');
        }
    },

    // ── Logout / reset ─────────────────────────────────────────────────────
    logout() {
        log('Uitgelogd');
        this.state.mode = 'login';
        this.showLogin();
    },

    async changePin() {
        const newPin = prompt(`Nieuwe ${PIN_LENGTH}-cijferige PIN:`);
        if (!newPin) return;
        if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(newPin)) {
            toast(`PIN moet ${PIN_LENGTH} cijfers zijn`, 'error');
            return;
        }
        try {
            const record = await createPinRecord(newPin);
            localStorage.setItem(KEYS.PIN_RECORD, JSON.stringify(record));
            this.resetFails();
            toast('PIN gewijzigd', 'success');
            log('PIN gewijzigd door gebruiker');
        } catch (err) {
            toast('Fout: ' + err.message, 'error');
        }
    },

    getCurrentUser() {
        return localStorage.getItem(KEYS.USER) || '';
    },
};
