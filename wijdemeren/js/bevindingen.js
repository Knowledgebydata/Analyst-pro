'use strict';

/**
 * BevModule — Lokale bevindingen-module met IndexedDB opslag.
 *
 * Bevindingen worden LOKAAL opgeslagen op het device van de controleur.
 * Ze worden NIET naar de server gesynchroniseerd.
 * Export als JSON is de enige manier om data te delen.
 *
 * Functies:
 * - Formulier per locatie met categorie, beschrijving, foto's, GPS
 * - Opslag in IndexedDB (persistent, overleeft refresh)
 * - Lijst met alle bevindingen per sessie
 * - Export als JSON voor de coordinator
 * - Verwijderen van individuele bevindingen
 */
var BevModule = (function () {
    const DB_NAME = 'wijdemeren-bevindingen';
    const DB_VERSION = 1;
    const STORE_NAME = 'bevindingen';
    const STORE_META = 'meta';

    const CATEGORIEEN = [
        { key: 'recreatie', label: 'Recreatief gebruik' },
        { key: 'permanente_bewoning', label: 'Permanente bewoning' },
        { key: 'woonverklaring', label: 'Woonverklaring' },
        { key: 'ongemeubileerd', label: 'Ongemeubileerd' },
        { key: 'verpauperd', label: 'Verpauperd' },
        { key: 'arbeidsmigranten', label: 'Arbeidsmigranten' },
        { key: 'sekswerkers', label: 'Sekswerkers' },
        { key: 'leegstand', label: 'Leegstand' },
        { key: 'asbest', label: 'Asbest verdacht' },
        { key: 'milieu', label: 'Milieu-overtreding' },
        { key: 'brandveiligheid', label: 'Brandveiligheid' },
        { key: 'overig', label: 'Overig' },
    ];

    let db = null;
    let controleurNaam = '';

    // === IndexedDB ===

    function openDB() {
        return new Promise((resolve, reject) => {
            if (db) { resolve(db); return; }

            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const idb = e.target.result;

                if (!idb.objectStoreNames.contains(STORE_NAME)) {
                    const store = idb.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('locatieSlug', 'locatieSlug', { unique: false });
                    store.createIndex('datum', 'datum', { unique: false });
                    store.createIndex('categorie', 'categorie', { unique: false });
                }

                if (!idb.objectStoreNames.contains(STORE_META)) {
                    idb.createObjectStore(STORE_META, { keyPath: 'key' });
                }
            };

            request.onsuccess = (e) => {
                db = e.target.result;
                resolve(db);
            };

            request.onerror = () => {
                reject(new Error('Kan IndexedDB niet openen'));
            };
        });
    }

    function dbTransaction(storeName, mode) {
        return db.transaction(storeName, mode).objectStore(storeName);
    }

    function dbPut(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function dbGetAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function dbGet(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function dbDelete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }

    // === GPS ===

    function getGPS() {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                resolve(null);
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    resolve({
                        lat: pos.coords.latitude,
                        lon: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                    });
                },
                () => { resolve(null); },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
            );
        });
    }

    // === Foto capture ===

    function capturePhoto() {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.capture = 'environment';
            input.multiple = true;

            input.addEventListener('change', async () => {
                const files = Array.from(input.files);
                const results = [];

                for (const file of files) {
                    try {
                        const dataUrl = await readFileAsDataURL(file);
                        // Resize als te groot (max 1600px breed)
                        const resized = await resizeImage(dataUrl, 1600);
                        results.push({
                            naam: file.name,
                            type: file.type,
                            data: resized,
                            timestamp: new Date().toISOString(),
                        });
                    } catch (err) {
                        console.error('Foto verwerken mislukt:', err);
                    }
                }

                resolve(results);
            });

            // Als gebruiker annuleert
            input.addEventListener('cancel', () => { resolve([]); });

            input.click();
        });
    }

    function readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    function resizeImage(dataUrl, maxWidth) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                if (img.width <= maxWidth) {
                    resolve(dataUrl);
                    return;
                }

                const scale = maxWidth / img.width;
                const canvas = document.createElement('canvas');
                canvas.width = maxWidth;
                canvas.height = Math.round(img.height * scale);

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    }

    // === Controleur naam ===

    async function loadControleurNaam() {
        await openDB();
        const meta = await dbGet(STORE_META, 'controleur');
        controleurNaam = meta ? meta.value : '';
        return controleurNaam;
    }

    async function saveControleurNaam(naam) {
        await openDB();
        controleurNaam = naam;
        await dbPut(STORE_META, { key: 'controleur', value: naam });
    }

    // === Bevinding CRUD ===

    function generateId() {
        return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    async function saveBevinding(bevinding) {
        await openDB();

        if (!bevinding.id) {
            bevinding.id = generateId();
        }

        bevinding.controleur = controleurNaam;
        bevinding.savedAt = new Date().toISOString();

        await dbPut(STORE_NAME, bevinding);
        return bevinding;
    }

    async function getBevindingen() {
        await openDB();
        const all = await dbGetAll(STORE_NAME);
        // Sorteer op datum desc, dan timestamp desc
        all.sort((a, b) => {
            const d = (b.datum || '').localeCompare(a.datum || '');
            if (d !== 0) return d;
            return (b.timestamp || '').localeCompare(a.timestamp || '');
        });
        return all;
    }

    async function deleteBevinding(id) {
        await openDB();
        await dbDelete(STORE_NAME, id);
    }

    // === Export ===

    async function exportJSON() {
        const bevindingen = await getBevindingen();

        if (bevindingen.length === 0) {
            alert('Geen bevindingen om te exporteren.');
            return;
        }

        // Groepeer per locatie
        const perLocatie = {};
        for (const bev of bevindingen) {
            const slug = bev.locatieSlug || 'onbekend';
            if (!perLocatie[slug]) {
                perLocatie[slug] = {
                    locatieSlug: slug,
                    locatieNaam: bev.locatieNaam || slug,
                    bevindingen: [],
                };
            }
            // Strip base64 foto data voor export (te groot)
            const exportBev = { ...bev };
            if (exportBev.fotos && exportBev.fotos.length > 0) {
                exportBev.fotos = exportBev.fotos.map((f) => ({
                    naam: f.naam,
                    type: f.type,
                    timestamp: f.timestamp,
                    // Data wordt niet meegenomen in export, alleen metadata
                    heeftFoto: true,
                }));
            }
            perLocatie[slug].bevindingen.push(exportBev);
        }

        const exportData = {
            controleur: controleurNaam,
            exportDatum: new Date().toISOString(),
            aantalBevindingen: bevindingen.length,
            locaties: Object.values(perLocatie),
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bevindingen-${controleurNaam || 'export'}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // === UI: Formulier ===

    function openForm(slug, naam, pandLabel) {
        // Sluit eventueel open popup
        const mapInstance = MapModule.getMap();
        if (mapInstance) { mapInstance.closePopup(); }

        // Maak modal als die nog niet bestaat
        let modal = document.getElementById('bev-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'bev-modal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        const today = new Date().toISOString().slice(0, 10);
        const timeNow = new Date().toTimeString().slice(0, 5);

        let catOptions = '';
        for (const cat of CATEGORIEEN) {
            catOptions += '<option value="' + cat.key + '">' + cat.label + '</option>';
        }

        modal.innerHTML = '' +
            '<div class="modal__content" style="max-width:480px">' +
            '  <div class="modal__header">' +
            '    <h3>Bevinding — ' + escapeHtml(naam) + (pandLabel ? ' / ' + escapeHtml(pandLabel) : '') + '</h3>' +
            '    <button class="modal__close" id="bev-modal-close">&times;</button>' +
            '  </div>' +
            '  <div class="modal__body">' +
            '    <div class="form-group">' +
            '      <label for="bev-datum">Datum</label>' +
            '      <input type="date" id="bev-datum" class="input" value="' + today + '">' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label for="bev-tijd">Tijdstip</label>' +
            '      <input type="time" id="bev-tijd" class="input" value="' + timeNow + '">' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label for="bev-categorie">Categorie</label>' +
            '      <select id="bev-categorie" class="input">' + catOptions + '</select>' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label for="bev-adres-detail">Adres detail (kavel, huisnr)</label>' +
            '      <input type="text" id="bev-adres-detail" class="input" placeholder="bijv. kavel 12, huisnr 5a">' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label for="bev-beschrijving">Beschrijving</label>' +
            '      <textarea id="bev-beschrijving" class="input" rows="4" placeholder="Wat is waargenomen?"></textarea>' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label>GPS positie</label>' +
            '      <div id="bev-gps-info" class="form-static" style="color:var(--color-muted)">Wordt automatisch vastgelegd...</div>' +
            '    </div>' +
            '    <div class="form-group">' +
            '      <label>Foto\'s</label>' +
            '      <button type="button" class="btn btn--sm" id="bev-foto-btn">Foto toevoegen</button>' +
            '      <div id="bev-foto-preview" class="foto-preview"></div>' +
            '    </div>' +
            '    <div class="form-actions">' +
            '      <button class="btn btn--primary" id="bev-save-btn">Opslaan</button>' +
            '      <button class="btn" id="bev-cancel-btn">Annuleren</button>' +
            '    </div>' +
            '  </div>' +
            '</div>';

        modal.classList.add('modal--open');

        // Sluit bij klik op overlay
        modal.addEventListener('click', function (e) {
            if (e.target === modal) { modal.classList.remove('modal--open'); }
        });

        // GPS ophalen
        const gpsEl = document.getElementById('bev-gps-info');
        let gpsData = null;

        getGPS().then((pos) => {
            if (pos) {
                gpsData = pos;
                gpsEl.textContent = pos.lat.toFixed(6) + ', ' + pos.lon.toFixed(6) + ' (\u00B1' + Math.round(pos.accuracy) + 'm)';
                gpsEl.style.color = 'var(--color-success)';
            } else {
                gpsEl.textContent = 'GPS niet beschikbaar';
                gpsEl.style.color = 'var(--color-danger)';
            }
        });

        // Foto's
        let fotos = [];
        document.getElementById('bev-foto-btn').addEventListener('click', async () => {
            const newFotos = await capturePhoto();
            fotos = fotos.concat(newFotos);
            renderFotoPreview(fotos);
        });

        // Sluiten
        const closeModal = () => { modal.classList.remove('modal--open'); };
        document.getElementById('bev-modal-close').addEventListener('click', closeModal);
        document.getElementById('bev-cancel-btn').addEventListener('click', closeModal);

        // Opslaan
        document.getElementById('bev-save-btn').addEventListener('click', async () => {
            const beschrijving = document.getElementById('bev-beschrijving').value.trim();
            if (!beschrijving) {
                alert('Vul een beschrijving in.');
                return;
            }

            const bevinding = {
                locatieSlug: slug,
                locatieNaam: naam,
                pandLabel: pandLabel || null,
                datum: document.getElementById('bev-datum').value,
                tijd: document.getElementById('bev-tijd').value,
                categorie: document.getElementById('bev-categorie').value,
                adresDetail: document.getElementById('bev-adres-detail').value.trim(),
                beschrijving: beschrijving,
                gps: gpsData,
                fotos: fotos,
                timestamp: new Date().toISOString(),
            };

            try {
                await saveBevinding(bevinding);
                closeModal();
                updateBevCounter();
            } catch (err) {
                alert('Opslaan mislukt: ' + err.message);
            }
        });
    }

    function renderFotoPreview(fotos) {
        const el = document.getElementById('bev-foto-preview');
        if (!el) return;

        let html = '';
        fotos.forEach((f, i) => {
            html += '<div style="position:relative;display:inline-block">';
            html += '<img class="foto-preview__img" src="' + f.data + '" alt="Foto ' + (i + 1) + '">';
            html += '<button class="btn--icon" style="position:absolute;top:-4px;right:-4px;background:#fff;border-radius:50%;width:18px;height:18px;font-size:12px;line-height:1;border:1px solid #ccc" data-foto-idx="' + i + '">&times;</button>';
            html += '</div>';
        });
        el.innerHTML = html;

        // Verwijder knoppen
        el.querySelectorAll('[data-foto-idx]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.getAttribute('data-foto-idx'), 10);
                fotos.splice(idx, 1);
                renderFotoPreview(fotos);
            });
        });
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // === UI: Bevindingen lijst ===

    async function renderList(container) {
        const bevindingen = await getBevindingen();
        const el = typeof container === 'string' ? document.getElementById(container) : container;
        if (!el) return;

        if (bevindingen.length === 0) {
            el.innerHTML = '<p style="padding:16px;color:var(--color-muted);text-align:center">Nog geen bevindingen opgeslagen.<br>Open een locatie op de kaart en klik op <strong>+ Bevinding</strong>.</p>';
            return;
        }

        let html = '';
        for (const bev of bevindingen) {
            const catLabel = CATEGORIEEN.find((c) => c.key === bev.categorie);
            html += '<div class="bev-card">';
            html += '  <div class="bev-card__header">';
            html += '    <span class="bev-card__locatie">' + escapeHtml(bev.locatieNaam || bev.locatieSlug) + (bev.pandLabel ? ' / ' + escapeHtml(bev.pandLabel) : '') + '</span>';
            html += '    <span class="bev-card__date">' + (bev.datum || '') + ' ' + (bev.tijd || '') + '</span>';
            html += '  </div>';
            html += '  <div class="bev-card__cat">' + (catLabel ? catLabel.label : bev.categorie) + '</div>';
            if (bev.adresDetail) {
                html += '  <div style="font-size:11px;color:var(--color-muted);margin-bottom:2px">' + escapeHtml(bev.adresDetail) + '</div>';
            }
            html += '  <div class="bev-card__desc">' + escapeHtml(bev.beschrijving) + '</div>';

            if (bev.fotos && bev.fotos.length > 0) {
                html += '  <div class="foto-preview" style="margin-top:4px">';
                bev.fotos.forEach((f) => {
                    if (f.data) {
                        html += '<img class="foto-preview__img" src="' + f.data + '" alt="' + escapeHtml(f.naam || 'Foto') + '">';
                    }
                });
                html += '  </div>';
            }

            if (bev.gps) {
                html += '  <div style="font-size:9px;color:var(--color-muted);margin-top:2px">GPS: ' + bev.gps.lat.toFixed(5) + ', ' + bev.gps.lon.toFixed(5) + '</div>';
            }

            html += '  <div class="bev-card__actions">';
            html += '    <button class="btn btn--sm btn--danger" data-bev-delete="' + bev.id + '">Verwijderen</button>';
            html += '  </div>';
            html += '</div>';
        }

        el.innerHTML = html;

        // Delete handlers
        el.querySelectorAll('[data-bev-delete]').forEach((btn) => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-bev-delete');
                if (!confirm('Bevinding verwijderen?')) return;
                await deleteBevinding(id);
                renderList(el);
                updateBevCounter();
            });
        });
    }

    // === Bevindingen counter badge ===

    async function updateBevCounter() {
        const bevindingen = await getBevindingen();
        const badge = document.getElementById('bev-count-badge');
        if (badge) {
            badge.textContent = bevindingen.length > 0 ? bevindingen.length : '';
            badge.hidden = bevindingen.length === 0;
        }
    }

    // === Init ===

    async function init() {
        await openDB();
        await loadControleurNaam();
        updateBevCounter();
    }

    return {
        init: init,
        openForm: openForm,
        renderList: renderList,
        exportJSON: exportJSON,
        getBevindingen: getBevindingen,
        getControleurNaam: () => controleurNaam,
        setControleurNaam: saveControleurNaam,
        updateBevCounter: updateBevCounter,
        CATEGORIEEN: CATEGORIEEN,
    };
})();
