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
        { key: 'fotos', label: "Foto's bij het pand" },
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

    // === GPS-guardrail (AVG) ===

    /**
     * Hoe ver van het middelpunt van een locatie een positie nog als "op het
     * terrein" geldt. Startwaarde, vast te stellen door de vakgroep: een
     * vakantiepark is zelden groter dan een paar honderd meter, en 500 m vangt
     * GPS-drift en de rand van het terrein ruim af terwijl een woonadres elders
     * er nooit binnen valt.
     */
    const MAX_AFSTAND_M = 500;

    /** Afstand in meters tussen twee posities (haversine). */
    function afstandMeter(lat1, lon1, lat2, lon2) {
        const R = 6371000;
        const rad = Math.PI / 180;
        const dLat = (lat2 - lat1) * rad;
        const dLon = (lon2 - lon1) * rad;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(lat1 * rad) * Math.cos(lat2 * rad)
            * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))));
    }

    /** Het middelpunt van een locatie, voor zover de kaart dat kent. */
    function locatiePositie(slug) {
        if (typeof MapModule === 'undefined' || !MapModule.getLocaties) { return null; }
        try {
            const gevonden = (MapModule.getLocaties() || []).find(function (l) { return l.slug === slug; });
            if (!gevonden || gevonden.lat == null || gevonden.lon == null) { return null; }
            return { lat: Number(gevonden.lat), lon: Number(gevonden.lon) };
        } catch (err) {
            return null;
        }
    }

    /**
     * Beoordeelt of een gemeten positie bij de gekozen locatie hoort.
     *
     * Geeft terug wat er van de positie in het dossier mag: `gps` als hij op het
     * terrein ligt, anders `null` met de afstand erbij zodat de controleur ziet
     * waarom. Kan er niet getoetst worden (locatie zonder coördinaat), dan blijft
     * de positie staan: een toets die niet uitvoerbaar is mag geen gegevens
     * weggooien.
     */
    function toetsGps(gps, slug) {
        if (!gps || gps.lat == null || gps.lon == null) {
            return { gps: null, getoetst: false, afstand: null };
        }
        const midden = locatiePositie(slug);
        if (!midden) {
            return { gps: gps, getoetst: false, afstand: null };
        }
        const afstand = afstandMeter(gps.lat, gps.lon, midden.lat, midden.lon);
        if (afstand <= MAX_AFSTAND_M) {
            return { gps: gps, getoetst: true, afstand: afstand };
        }
        return { gps: null, getoetst: true, afstand: afstand, buiten: true };
    }

    // === Foto capture ===

    function capturePhoto(vanCamera) {
        return new Promise((resolve) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            // `capture` dwingt de camera af en verbergt de fotobibliotheek.
            // Alleen zetten als de gebruiker uitdrukkelijk wil fotograferen;
            // anders kan hij ook beelden van een los toestel toevoegen.
            if (vanCamera) { input.capture = 'environment'; }
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
                    panden: [],
                };
            }
            // Foto's gaan sinds schema 1.1 WEL mee: ze zijn bij het
            // vastleggen al teruggeschaald naar maximaal 1600 px, en zonder
            // beeld is een rapportage in de desktop-app weinig waard.
            const exportBev = { ...bev };
            if (exportBev.fotos && exportBev.fotos.length > 0) {
                exportBev.fotos = exportBev.fotos.map((f) => ({
                    naam: f.naam,
                    type: f.type,
                    timestamp: f.timestamp,
                    data: f.data || null,
                    heeftFoto: !!f.data,
                }));
            }
            var ctx = pandContext(slug, bev.pandLabel);
            if (ctx) {
                exportBev.pandCode = ctx.pandCode;
                exportBev.bagPandnummer = ctx.bagPandnummer;
                exportBev.pandStatus = ctx.pandStatus;
                var reeds = perLocatie[slug].panden.some(function (p) { return p.label === bev.pandLabel; });
                if (!reeds) {
                    perLocatie[slug].panden.push({
                        label: bev.pandLabel,
                        pandCode: ctx.pandCode,
                        bagPandnummer: ctx.bagPandnummer,
                        bouwjaar: ctx.bouwjaar,
                        status: ctx.pandStatus,
                        adresDetail: ctx.adresDetail,
                    });
                }
            }
            perLocatie[slug].bevindingen.push(exportBev);
        }

        // Alle panden van de bezochte locaties meesturen, zodat de kaart in de
        // analyse-applicatie gelijk is aan die op de handheld.
        for (const slug of Object.keys(perLocatie)) {
            try {
                const volledig = await pandenVoorExport(slug);
                if (volledig.length > 0) { perLocatie[slug].panden = volledig; }
            } catch (err) {
                console.warn('Panden ophalen mislukt voor ' + slug + ':', err);
            }
        }

        const exportData = {
            type: 'bevindingen-export',
            schema_version: '1.1',
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


    /** Pandgegevens bij een label opzoeken in de kaartmodule. De analyse-
     *  applicatie heeft geen verbinding met de database, dus wat zij over een
     *  pand moet weten reist mee in het exportbestand. */
    function pandContext(locatieSlug, pandLabel) {
        if (typeof MapModule === 'undefined' || !pandLabel) { return null; }
        var alle;
        try { alle = MapModule.getPanden() || []; } catch (e) { return null; }
        for (var i = 0; i < alle.length; i++) {
            var p = alle[i];
            if (p.locatie_slug === locatieSlug && (p.label || '') === pandLabel) {
                return {
                    pandCode: p.pand_code || null,
                    bagPandnummer: p.bag_pandnummer || null,
                    bouwjaar: p.bouwjaar || null,
                    pandStatus: p.status || null,
                    adresDetail: p.adres_detail || null,
                };
            }
        }
        return null;
    }


    /** Alle panden van een locatie ophalen voor de export. Bij voorkeur vers
     *  van de server; zonder bereik valt hij terug op wat de kaart in het
     *  geheugen heeft. Nooit een lege lijst als er wel iets bekend is. */
    async function pandenVoorExport(locatieSlug) {
        var uitKaart = [];
        if (typeof MapModule !== 'undefined') {
            try {
                uitKaart = (MapModule.getPanden() || []).filter(function (p) {
                    return p.locatie_slug === locatieSlug;
                });
            } catch (e) { uitKaart = []; }
        }
        var lijst = uitKaart;
        if (typeof API !== 'undefined' && API.getPanden) {
            try {
                var data = await API.getPanden(locatieSlug);
                var vers = (data && data.panden) ? data.panden : data;
                if (Array.isArray(vers) && vers.length >= uitKaart.length) { lijst = vers; }
            } catch (e) { /* geen bereik: de kaartkopie volstaat */ }
        }
        return lijst.map(function (p) {
            var lat = (p.display_lat != null) ? p.display_lat : p.lat;
            var lon = (p.display_lon != null) ? p.display_lon : p.lon;
            return {
                label: p.label || null,
                pandCode: p.pand_code || null,
                bagPandnummer: p.bag_pandnummer || null,
                bouwjaar: p.bouwjaar || null,
                status: p.status || 'niet_verkend',
                extraStatussen: Array.isArray(p.extra_statussen) ? p.extra_statussen : [],
                adresDetail: p.adres_detail || null,
                lat: (lat != null) ? Number(lat) : null,
                lon: (lon != null) ? Number(lon) : null,
                handmatigGeplaatst: (p.display_lat != null),
            };
        });
    }

    /**
     * Exporteert het complete kaartmateriaal: alle locaties met al hun panden.
     *
     * Dit is bewust géén afgeleide van de bevindingen. De analyse-applicatie
     * moet de kaart kunnen tonen zoals hij hier is -- inclusief de panden die
     * uit de BAG zijn ingetekend en waar nog niemand is geweest, en inclusief
     * locatietypes die de bevroren lijst daar niet kent, zoals een testlocatie.
     *
     * De vorm is gelijk aan die van de controleur-export, zodat de andere kant
     * er niets nieuws voor hoeft te leren.
     */
    async function exportKaartmateriaal() {
        if (typeof API === 'undefined' || !API.getLocaties) {
            throw new Error('Geen verbinding met de server; kaartmateriaal komt daar vandaan.');
        }

        const data = await API.getLocaties();
        const locaties = (data && data.locaties) ? data.locaties : data;
        if (!Array.isArray(locaties) || locaties.length === 0) {
            throw new Error('De server gaf geen locaties terug.');
        }

        const uit = [];
        let totaalPanden = 0;
        for (const loc of locaties) {
            let panden = [];
            try {
                panden = await pandenVoorExport(loc.slug);
            } catch (err) {
                // Eén locatie die niet wil, mag de rest niet tegenhouden; het
                // aantal panden verraadt daarna vanzelf dat er iets ontbreekt.
                panden = [];
            }
            totaalPanden += panden.length;
            uit.push({
                locatieSlug: loc.slug,
                locatieNaam: loc.naam,
                slug: loc.slug,
                naam: loc.naam,
                type: loc.type || 'onbekend',
                adres: loc.adres || '',
                postcode: loc.postcode || '',
                plaats: loc.plaats || '',
                lat: (loc.lat != null) ? Number(loc.lat) : null,
                lon: (loc.lon != null) ? Number(loc.lon) : null,
                nauwkeurigheid: loc.nauwkeurigheid || 'onbekend',
                codePrefix: loc.code_prefix || null,
                panden: panden,
            });
        }

        return {
            schema_version: '1.2',
            export_type: 'kaartmateriaal',
            exportDatum: new Date().toISOString(),
            gemeente: { naam: 'Wijdemeren' },
            aantalLocaties: uit.length,
            aantalPanden: totaalPanden,
            locaties: uit,
        };
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
            '      <button type="button" class="btn btn--sm" id="bev-foto-btn">Foto maken</button>' +
            '      <button type="button" class="btn btn--sm" id="bev-foto-kies-btn" style="margin-left:4px">Foto\'s kiezen</button>' +
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

        let gpsBuiten = false;
        let gpsAfstand = null;

        getGPS().then((pos) => {
            const oordeel = toetsGps(pos, slug);
            gpsData = oordeel.gps;
            gpsBuiten = !!oordeel.buiten;
            gpsAfstand = oordeel.afstand;

            if (!pos) {
                gpsEl.textContent = 'GPS niet beschikbaar';
                gpsEl.style.color = 'var(--color-danger)';
                return;
            }
            if (oordeel.buiten) {
                // Bewust geen coördinaten in beeld: dit is de plek waar de
                // controleur zelf is, en die hoort niet in dit dossier.
                gpsEl.textContent = 'Je bevindt je ongeveer ' + oordeel.afstand
                    + ' meter van ' + naam + '. De positie wordt daarom niet vastgelegd.'
                    + ' De bevinding zelf wordt gewoon bewaard.';
                gpsEl.style.color = 'var(--color-warning, #C87A1E)';
                return;
            }
            gpsEl.textContent = pos.lat.toFixed(6) + ', ' + pos.lon.toFixed(6) + ' (\u00B1' + Math.round(pos.accuracy) + 'm)'
                + (oordeel.getoetst ? ' \u2014 op het terrein' : '');
            gpsEl.style.color = 'var(--color-success)';
        });

        // Foto's
        let fotos = [];
        document.getElementById('bev-foto-btn').addEventListener('click', async () => {
            const newFotos = await capturePhoto(true);
            fotos = fotos.concat(newFotos);
            renderFotoPreview(fotos);
        });
        document.getElementById('bev-foto-kies-btn').addEventListener('click', async () => {
            const newFotos = await capturePhoto(false);
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
                // Geen locatiegegeven maar de reden waarom er geen is; zonder
                // dat veld is later niet te verklaren waarom een bevinding
                // zonder positie in het dossier staat.
                gpsBuitenTerrein: gpsBuiten || undefined,
                gpsAfstandMeter: gpsBuiten ? gpsAfstand : undefined,
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


    // === Fotoalbum per pand ===

    /** Zoekt het fotoalbum van een pand, of maakt er een aan. Bewust een
     *  gewone bevinding met categorie 'fotos': opslag, export en de
     *  desktop-import werken daardoor ongewijzigd mee. */
    /** Herkent het fotoalbum van een pand.
     *
     *  Op het pand-id als dat bekend is, anders op het label. Het label is
     *  namelijk de aanduiding die de controleur zelf mag wijzigen ("Z2 02");
     *  wie na het fotograferen de aanduiding aanpast, raakte zijn album
     *  daarmee kwijt. Albums van voor deze wijziging dragen nog geen id en
     *  worden daarom nog steeds op het label gevonden -- ze krijgen het id er
     *  bij de eerste aanraking bij. Er gaat niets verloren.
     */
    function isAlbumVan(b, slug, pandLabel, pandId) {
        if (b.categorie !== 'fotos' || b.locatieSlug !== slug) { return false; }
        if (pandId && b.pandId) { return String(b.pandId) === String(pandId); }
        return (b.pandLabel || '') === (pandLabel || '');
    }

    async function vindOfMaakAlbum(slug, naam, pandLabel, pandId) {
        await openDB();
        const alle = await dbGetAll(STORE_NAME);
        const bestaand = alle.find((b) => isAlbumVan(b, slug, pandLabel, pandId));
        if (bestaand) {
            // Bijwerken bij het openen: een album van voor deze wijziging
            // krijgt het id erbij, en een hernoemd pand krijgt zijn nieuwe
            // aanduiding op de kaart in de bevindingenlijst.
            if (pandId && !bestaand.pandId) { bestaand.pandId = pandId; }
            if (pandLabel) { bestaand.pandLabel = pandLabel; }
            return bestaand;
        }

        const nu = new Date();
        return {
            locatieSlug: slug,
            locatieNaam: naam,
            pandLabel: pandLabel || null,
            pandId: pandId || null,
            datum: nu.toISOString().slice(0, 10),
            tijd: nu.toTimeString().slice(0, 5),
            categorie: 'fotos',
            adresDetail: '',
            beschrijving: "Foto's bij dit pand",
            gps: null,
            fotos: [],
            timestamp: nu.toISOString(),
        };
    }

    /** Opent het fotoalbum van een pand: bekijken, toevoegen, verwijderen.
     *  Bereikbaar vanuit de kaart, zonder het bevindingenformulier. */
    async function openPandFotos(slug, naam, pandLabel, pandId) {
        let album;
        try {
            album = await vindOfMaakAlbum(slug, naam, pandLabel, pandId);
        } catch (err) {
            alert('Album openen mislukt: ' + err.message);
            return;
        }
        let fotos = Array.isArray(album.fotos) ? album.fotos.slice() : [];

        const modal = document.getElementById('bev-modal');
        if (!modal) { alert('Fotovenster niet beschikbaar.'); return; }

        const titel = pandLabel ? escHtmlBev(pandLabel) : escHtmlBev(naam);
        modal.innerHTML =
            '<div class="modal__content">' +
            '  <div class="modal__header">' +
            '    <h2>Foto\'s — ' + titel + '</h2>' +
            '    <button class="modal__close" id="pf-close">&times;</button>' +
            '  </div>' +
            '  <div class="modal__body">' +
            '    <p class="text-muted" style="margin-top:0">Blijven op dit toestel. Ze gaan mee in de export naar de analyse-applicatie en komen nooit op de server.</p>' +
            '    <button type="button" class="btn btn--sm" id="pf-maak">Foto maken</button>' +
            '    <button type="button" class="btn btn--sm" id="pf-kies" style="margin-left:4px">Foto\'s kiezen</button>' +
            '    <div id="pf-preview" class="foto-preview" style="margin-top:10px"></div>' +
            '  </div>' +
            '  <div class="form-actions">' +
            '    <button class="btn" id="pf-annuleer">Sluiten</button>' +
            '    <button class="btn btn--primary" id="pf-bewaar">Bewaren</button>' +
            '  </div>' +
            '</div>';
        modal.classList.add('modal--open');

        function toon() {
            const el = document.getElementById('pf-preview');
            if (!el) { return; }
            if (fotos.length === 0) {
                el.innerHTML = '<span class="text-muted">Nog geen foto\'s bij dit pand.</span>';
                return;
            }
            let html = '';
            fotos.forEach((f, i) => {
                html += '<div class="foto-preview__item" style="position:relative;display:inline-block;margin:0 6px 6px 0">';
                html += '<img class="foto-preview__img" src="' + f.data + '" alt="Foto ' + (i + 1) + '">';
                html += '<button class="btn--icon" style="position:absolute;top:-4px;right:-4px;background:#fff;border-radius:50%;width:18px;height:18px;font-size:12px;line-height:1;border:1px solid #ccc" data-pf-idx="' + i + '">&times;</button>';
                html += '</div>';
            });
            el.innerHTML = html;
            el.querySelectorAll('[data-pf-idx]').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    const idx = parseInt(e.target.getAttribute('data-pf-idx'), 10);
                    fotos.splice(idx, 1);
                    toon();
                });
            });
        }
        toon();

        const sluit = () => { modal.classList.remove('modal--open'); };
        document.getElementById('pf-close').addEventListener('click', sluit);
        document.getElementById('pf-annuleer').addEventListener('click', sluit);

        document.getElementById('pf-maak').addEventListener('click', async () => {
            fotos = fotos.concat(await capturePhoto(true));
            toon();
        });
        document.getElementById('pf-kies').addEventListener('click', async () => {
            fotos = fotos.concat(await capturePhoto(false));
            toon();
        });

        document.getElementById('pf-bewaar').addEventListener('click', async () => {
            album.fotos = fotos;
            try {
                if (fotos.length === 0 && album.id) {
                    await dbDelete(STORE_NAME, album.id);
                } else if (fotos.length > 0) {
                    await saveBevinding(album);
                }
                sluit();
                updateBevCounter();
            } catch (err) {
                alert('Bewaren mislukt: ' + err.message);
            }
        });
    }

    /** Aantal foto's dat bij een pand hoort, voor het knoplabel op de kaart. */
    async function telPandFotos(slug, pandLabel, pandId) {
        try {
            await openDB();
            const alle = await dbGetAll(STORE_NAME);
            // Alle foto's bij dit pand tellen, dus ook die bij een gewone
            // bevinding horen -- de controleur ziet ze immers als een geheel.
            return alle
                .filter((b) => {
                    if (b.locatieSlug !== slug) { return false; }
                    if (pandId && b.pandId) { return String(b.pandId) === String(pandId); }
                    return (b.pandLabel || '') === (pandLabel || '');
                })
                .reduce((n, b) => n + (Array.isArray(b.fotos) ? b.fotos.length : 0), 0);
        } catch (err) {
            return 0;
        }
    }

    function escHtmlBev(str) {
        const d = document.createElement('div');
        d.textContent = str == null ? '' : String(str);
        return d.innerHTML;
    }

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
        exportKaartmateriaal: exportKaartmateriaal,
        getBevindingen: getBevindingen,
        getControleurNaam: () => controleurNaam,
        setControleurNaam: saveControleurNaam,
        updateBevCounter: updateBevCounter,
        openPandFotos: openPandFotos,
        telPandFotos: telPandFotos,
        CATEGORIEEN: CATEGORIEEN,
    };
})();
