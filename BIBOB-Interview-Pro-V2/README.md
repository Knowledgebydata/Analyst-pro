# BIBOB Interview Pro v2.0 — PWA

100% on-device transcriptie + speaker-diarization voor Bibob-verhoren. Geen cloud, geen derden, AVG-conform.

**Status**: scaffolding + auth-flow klaar (sessie 2026-06-05). Volgende sessies: modellen-loader, recorder, transcribe/diarize-modules, consent-flow, JSON-export.

## Hoe testen — sessie 1 (auth + UI shell)

```bash
cd ~/Downloads/BIBOB-Interview-Pro-V2
python3 -m http.server 8083
```

Open in Chrome of Safari: **`http://localhost:8083`**

### Eerste opstart

1. Setup-scherm: voer naam in + 6-cijferige PIN + bevestig PIN
2. Klik "Account aanmaken"
3. Je komt in de app-shell

### Volgende opstart

1. Login-scherm met numpad
2. Tik 6-cijferige PIN
3. Na 5 mislukte pogingen: 5 min lockout

### Wat zit er nu in

| Onderdeel | Status |
|---|---|
| Setup + login met **bcrypt-hashed PIN** (cost-factor 10) | ✓ |
| Lockout na 5 mislukte pogingen | ✓ |
| 4 tabs: Dashboard / Interview / Lijst / Settings | ✓ scaffolding |
| PWA-manifest + service-worker (cache app-shell) | ✓ |
| Canonieke KbD-styling (dark gradient + glasmorphisme) | ✓ |
| Modellen-loader (Whisper + pyannote) | placeholder |
| Recorder (MediaRecorder + 16kHz-conversie) | placeholder |
| Transcribe-engine | komt van POC-COMBINED |
| Diarization-engine | komt van POC-DIARIZATION |
| Consent-detectie module | placeholder |
| Audio-archief (encrypted IndexedDB) | placeholder |
| JSON-export v2.0.0 | komt van POC-COMBINED |
| Interview-management (lijst + storage) | placeholder |

## Architectuur

```
BIBOB-Interview-Pro-V2/
├── index.html              UI shell met 4 tabs
├── manifest.json           PWA install metadata
├── sw.js                   Service worker (cache app-shell, niet ML-modellen)
├── README.md
├── css/
│   └── style.css           Canonieke KbD-styling
├── js/
│   ├── app.js              Bootstrap + tab-switching + event-binding
│   ├── auth.js             bcrypt PIN-flow + lockout
│   ├── utils.js            Toast, log, format, escape
│   ├── transcribe.js       (komt — port van POC-COMBINED)
│   ├── diarize.js          (komt — port van POC-DIARIZATION)
│   ├── recorder.js         (komt — MediaRecorder + 16kHz-conversie)
│   ├── consent.js          (komt — auto-scan eerste 60s op consent-keywords)
│   ├── storage.js          (komt — IndexedDB voor interviews + encrypted audio)
│   └── exporter.js         (komt — v2.0.0 JSON-export)
├── icons/                  Gekopieerd uit v1.0
└── models/                 (komt — pyannote ONNX via setup.sh)
```

## Storage-keys (localStorage)

| Key | Wat |
|---|---|
| `bibob_v2_pin_hash` | bcrypt-hash van PIN (cost 10) |
| `bibob_v2_user` | Gebruikersnaam |
| `bibob_v2_created` | ISO-datum eerste setup |
| `bibob_v2_fails` | `{count, lockedUntil}` voor lockout-tracking |

Interview-data + audio-archief komen in IndexedDB (storage-module).

## Reset tijdens dev-test

```javascript
// Open DevTools Console:
localStorage.clear();
location.reload();
```

## Verschillen t.o.v. v1.0

| Aspect | v1.0 (bestaande PWA) | v2.0 (nieuw, deze map) |
|---|---|---|
| Auth | PIN 4-digit plaintext localStorage | PIN 6-digit bcrypt-hashed |
| Lockout | geen | 5 mislukte = 5 min lockout |
| Transcribe-engine | Web Speech API (cloud Google/MS) | Whisper-small via transformers.js (100% on-device) |
| Diarization | geen | pyannote-segmentation-3.0 via onnxruntime-web |
| Consent | geen | verplichte ingesproken consent-check eerste 60s |
| Audio-opslag | geen | encrypted IndexedDB (AES-256, dossier-key) |
| Export | JSON met `text` only | v2.0.0 JSON met segments + speakers + metadata |
| Styling | wit | dark gradient + glasmorphisme (KbD v4.1.0-blueprint) |

## Volgende sessies — globale planning

- **Stap 2**: model-management (Whisper-small + pyannote, lazy-download, IndexedDB)
- **Stap 3**: recorder.js — MediaRecorder + 16kHz mono-conversie
- **Stap 4-6**: port van POC-COMBINED logica (transcribe + diarize + merge)
- **Stap 7**: consent.js — auto-scan keywords + bevestigings-modal
- **Stap 8**: storage.js — IndexedDB voor interviews + encrypted audio
- **Stap 9**: exporter.js — v2.0.0 JSON-formaat bevroren (zie CLAUDE.md)
- **Stap 10**: cross-device test (iOS Safari, Android Chrome, Mac/Win)

Geschat: 10-12 dagen werk in totaal, ~1-2 sessies per stap.
