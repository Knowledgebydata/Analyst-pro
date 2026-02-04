# Knowledge PWA - Progressive Web App

Een volledige Progressive Web App kennisbank die offline werkt en geïnstalleerd kan worden als standalone applicatie.

## 🚀 Wat is Nieuw in de PWA Versie

### Offline Functionaliteit
- **Service Worker**: Werkt volledig offline na eerste bezoek
- **Smart Caching**: Automatische caching van resources en data
- **Network Resilience**: Blijft werken zonder internetverbinding

### Installeerbaar
- **Standalone App**: Installeer als native app op desktop en mobiel
- **App Shortcuts**: Snelkoppelingen voor "Nieuwe Notitie" en "Zoeken"
- **Custom Icons**: Professionele app icons voor alle platforms

### Enhanced UX
- **Install Prompt**: Elegante banner voor app installatie
- **Status Indicator**: Toont online/offline status
- **Progressive Enhancement**: Werkt overal, beter op moderne browsers

## 📦 Bestanden

```
knowledge-pwa.html      - Hoofdapplicatie (volledig zelfstandig)
manifest.json           - Web App Manifest (voor installatie)
service-worker.js       - Service Worker (voor offline + caching)
```

## 🔧 Installatie & Setup

### Optie 1: Lokale Server (Aanbevolen voor PWA)

PWA's vereisen HTTPS of localhost. Gebruik een lokale webserver:

**Python 3:**
```bash
python -m http.server 8000
```

**Node.js (http-server):**
```bash
npx http-server -p 8000
```

**PHP:**
```bash
php -S localhost:8000
```

Open dan: `http://localhost:8000/knowledge-pwa.html`

### Optie 2: Direct Openen

Je kunt `knowledge-pwa.html` ook direct openen in je browser, maar sommige PWA features werken alleen via HTTP(S):
- Service Worker: ❌ (vereist localhost of HTTPS)
- Installatie: ❌ (vereist localhost of HTTPS)
- Offline: ❌ (vereist service worker)
- Basis app: ✅ (werkt volledig)

### Optie 3: Deploy naar Hosting

Upload alle 3 bestanden naar je webhosting:
- `knowledge-pwa.html`
- `manifest.json`
- `service-worker.js`

Let op: **Alle bestanden moeten in dezelfde directory staan!**

## 📱 App Installeren

### Desktop (Chrome/Edge)
1. Open de app in Chrome of Edge
2. Klik op het installatie-icoon in de adresbalk (⊕)
3. Of gebruik de install banner onderaan de pagina
4. Klik "Installeer"
5. App opent als standalone window

### Desktop (Safari)
Safari ondersteunt geen PWA installatie op macOS. Gebruik Chrome of Edge.

### iOS (Safari)
1. Open de app in Safari
2. Tap het "Deel" icoon
3. Scroll en tap "Add to Home Screen"
4. Tap "Add"
5. App verschijnt op home screen

### Android (Chrome)
1. Open de app in Chrome
2. Tap de drie puntjes (⋮)
3. Tap "Install app" of "Add to Home screen"
4. Bevestig installatie
5. App verschijnt in app drawer

## ⚡ PWA Features

### Service Worker Caching
De service worker cached automatisch:
- De HTML app zelf
- React libraries (CDN)
- Marked.js (markdown parser)
- Google Fonts
- Alle gebruikersdata (localStorage)

**Caching Strategy:**
- Cache First: App shell resources
- Network First met Cache Fallback: CDN resources
- Runtime Caching: Dynamische resources

### Offline Ervaring
- **Eerste bezoek**: Vereist internet voor resources
- **Daarna**: Werkt 100% offline
- **Status**: Indicator toont online/offline status
- **Data**: Blijft lokaal, sync niet nodig

### App Shortcuts
Sneltoetsen in app menu (desktop) of long-press (mobiel):
- **New Note**: Opent app en maakt nieuwe notitie
- **Search**: Opent app met focus op zoekbalk

### Updates
Service worker checkt automatisch op updates:
- Bij reload wordt nieuwe versie gedownload
- Gebruiker ziet geen onderbreking
- Next reload gebruikt nieuwe versie

## 🔒 Privacy & Security

### Data Opslag
- **Volledig Lokaal**: Alle data in browser localStorage
- **Geen Cloud**: Zero externe servers (behalve CDN voor libraries)
- **Geen Tracking**: Geen analytics, cookies, of telemetrie

### Security Overwegingen
- **HTTPS**: Voor productie altijd HTTPS gebruiken
- **Same-Origin**: Service worker werkt alleen voor eigen domain
- **No Backend**: Geen server-side code, puur client-side

### Data Backup
**Belangrijk**: localStorage kan gewist worden! Maak backups:

**Via Console (F12):**
```javascript
// Export naar bestand
const notes = JSON.parse(localStorage.getItem('knowledge-base-notes'));
const blob = new Blob([JSON.stringify(notes, null, 2)], {type: 'application/json'});
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `knowledge-backup-${new Date().toISOString()}.json`;
a.click();
```

**Restore:**
```javascript
// Plak JSON inhoud
localStorage.setItem('knowledge-base-notes', 'PASTE_JSON_HERE');
location.reload();
```

## 🛠️ Development

### Service Worker Updates
Als je de service worker aanpast:
1. Verhoog `CACHE_NAME` versie in `service-worker.js`
2. Reload de pagina
3. Oude cache wordt automatisch verwijderd

### Manifest Aanpassingen
Pas `manifest.json` aan voor:
- App naam / beschrijving
- Thema kleuren
- Icons (gebruik eigen SVG of PNG)
- Start URL
- Display mode

### Debug Tools

**Chrome DevTools:**
- Application tab → Service Workers
- Application tab → Manifest
- Application tab → Cache Storage
- Application tab → Local Storage

**Console Commands:**
```javascript
// Check service worker status
navigator.serviceWorker.ready.then(reg => console.log('SW Ready:', reg));

// Force update service worker
navigator.serviceWorker.getRegistration().then(reg => reg.update());

// Unregister service worker
navigator.serviceWorker.getRegistration().then(reg => reg.unregister());

// Clear cache
caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))));
```

## 📊 Browser Support

### Desktop
- ✅ Chrome 90+ (volledige PWA support)
- ✅ Edge 90+ (volledige PWA support)
- ✅ Firefox 88+ (service worker, geen install)
- ⚠️ Safari 14+ (basis features, geen install op macOS)

### Mobiel
- ✅ Chrome Android 90+ (volledige support)
- ✅ Safari iOS 14+ (add to home screen)
- ✅ Samsung Internet 14+
- ✅ Firefox Android 88+

### Feature Detection
App checkt automatisch op:
- Service Worker support
- Notification API
- Push API
- Background Sync
- Periodic Sync

## 🎨 Customization

### Kleuren Aanpassen
In `knowledge-pwa.html`, wijzig CSS variabelen:
```css
:root {
    --color-accent: #4A90E2;  /* Primaire kleur */
    --color-bg: #FAFAFA;      /* Achtergrond */
    /* etc... */
}
```

Update ook `manifest.json`:
```json
{
    "theme_color": "#4A90E2",
    "background_color": "#FAFAFA"
}
```

### Icons Vervangen
Huidige icons zijn inline SVG. Voor custom icons:
1. Genereer 192x192 en 512x512 PNG icons
2. Upload naar server
3. Update `manifest.json` icon paths:
```json
{
    "src": "/icons/icon-192.png",
    "sizes": "192x192",
    "type": "image/png"
}
```

### Shortcuts Aanpassen
In `manifest.json`:
```json
{
    "shortcuts": [
        {
            "name": "Custom Action",
            "url": "./knowledge-pwa.html?action=custom",
            "icons": [...]
        }
    ]
}
```

Dan in `knowledge-pwa.html`, handle de action:
```javascript
const params = new URLSearchParams(window.location.search);
if (params.get('action') === 'custom') {
    // Your code here
}
```

## 🚨 Troubleshooting

### Service Worker Registreert Niet
- **Check**: Console voor errors
- **Fix**: Zorg dat alle 3 bestanden in zelfde directory staan
- **Fix**: Gebruik localhost of HTTPS, niet file://

### Install Prompt Verschijnt Niet
- **Check**: DevTools → Application → Manifest (geen errors?)
- **Check**: Service worker geregistreerd?
- **Fix**: Reload pagina, wacht 30 seconden
- **Note**: Verschijnt niet als al geïnstalleerd

### App Werkt Niet Offline
- **Check**: Service worker actief? (DevTools → Application)
- **Check**: Bezocht met internet eerst?
- **Fix**: Reload met internet, dan offline testen

### Cache Updates Niet
- **Fix**: Verhoog CACHE_NAME versie in service-worker.js
- **Fix**: DevTools → Application → Clear storage → Clear site data
- **Fix**: Hard reload (Ctrl+Shift+R)

### LocalStorage Data Kwijt
- **Preventie**: Regelmatig backups maken (zie Data Backup)
- **Oorzaak**: Browser data gewist, incognito mode
- **Restore**: Laad backup JSON in via console

## 📈 Future Enhancements

Mogelijke uitbreidingen:
- **Push Notifications**: Reminders voor notities
- **Background Sync**: Sync tussen devices
- **Share Target**: Ontvang gedeelde tekst van andere apps
- **File System Access**: Direct .md bestanden opslaan
- **Web Share**: Deel notities naar andere apps
- **Periodic Background Sync**: Auto-backup
- **Badging API**: Unread count badge

## 🔗 Resources

- [PWA Documentation](https://web.dev/progressive-web-apps/)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [Web App Manifest](https://web.dev/add-manifest/)
- [Workbox (Advanced SW)](https://developers.google.com/web/tools/workbox)

## ⚖️ License

Voor persoonlijk gebruik door Loek van Knowledge by Data B.V.

---

**Gemaakt met**: React 18, Service Worker API, Web App Manifest
**PWA Features**: Offline-first, Installeerbaar, Responsive
**Geïnspireerd door**: Obsidian (features) + Things (design)
