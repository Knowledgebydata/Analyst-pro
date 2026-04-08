'use strict';

/**
 * VragenlijstModule — Gestructureerde vragenlijst voor controles vakantieparken.
 *
 * Gebaseerd op:
 * - CoMensha signalenlijst mensenhandel
 * - RIEC protocollen vakantieparkcontroles
 * - Nederlandse Arbeidsinspectie indicatoren arbeidsuitbuiting
 * - CCV Barrièremodel Ondermijning Vakantieparken
 *
 * Opslag: IndexedDB (device-only, privacy-by-design).
 * Eén vragenlijst per bewoner/aangetroffen persoon — meerdere per pand mogelijk.
 */
var VragenlijstModule = (function () {

    // === Database ===
    var DB_NAME = 'wijdemeren-vragenlijsten';
    var DB_VERSION = 1;
    var STORE_LIJST = 'vragenlijsten';
    var STORE_META = 'meta';
    var db = null;

    // === Vragenlijst definitie ===

    var NATIONALITEITEN = [
        'Nederlands', 'Pools', 'Roemeens', 'Bulgaars', 'Duits', 'Turks',
        'Marokkaans', 'Surinaams', 'Oekraïens', 'Hongaars', 'Litouws',
        'Lets', 'Tsjechisch', 'Slowaaks', 'Portugees', 'Spaans',
        'Italiaans', 'Eritrees', 'Syrisch', 'Afghaans', 'Anders',
    ];

    var TALEN = [
        { key: 'nl', label: 'Nederlands' },
        { key: 'en', label: 'Engels' },
        { key: 'pl', label: 'Pools' },
        { key: 'ro', label: 'Roemeens' },
        { key: 'bg', label: 'Bulgaars' },
        { key: 'de', label: 'Duits' },
        { key: 'uk', label: 'Oekraïens' },
        { key: 'hu', label: 'Hongaars' },
        { key: 'tr', label: 'Turks' },
        { key: 'ar', label: 'Arabisch' },
        { key: 'anders', label: 'Anders' },
    ];

    var SECTIES = [
        {
            key: 'bewoner',
            titel: 'Bewoner / Aangetroffen persoon',
            vragen: [
                { key: 'geslacht', label: 'Geslacht', type: 'keuze', opties: ['Man', 'Vrouw', 'Anders', 'Onbekend'] },
                { key: 'leeftijd', label: 'Geschatte leeftijdscategorie', type: 'keuze', opties: ['0–17 (minderjarig)', '18–25', '26–45', '46–65', '65+', 'Onbekend'] },
                { key: 'nationaliteit', label: 'Nationaliteit', type: 'keuze', opties: NATIONALITEITEN },
                { key: 'taal', label: 'Taal van communicatie', type: 'keuze', opties: TALEN.map(function (t) { return t.label; }) },
                { key: 'tolkGebruikt', label: 'Is er een tolk gebruikt?', type: 'janee' },
                { key: 'tolkTaal', label: 'Zo ja, in welke taal?', type: 'tekst', conditie: { key: 'tolkGebruikt', waarde: 'Ja' } },
                { key: 'relatiePand', label: 'Relatie tot het pand', type: 'keuze', opties: ['Eigenaar', 'Huurder', 'Gast/bezoeker', 'Werknemer (op terrein)', 'Kraker', 'Onbekend'] },
            ],
        },
        {
            key: 'woonsituatie',
            titel: 'Woonsituatie',
            vragen: [
                { key: 'verblijfsduur', label: 'Hoe lang verblijft deze persoon hier?', type: 'keuze', opties: ['< 1 week', '1–4 weken', '1–6 maanden', '6–12 maanden', '> 1 jaar', 'Onbekend'] },
                { key: 'aantalPersonen', label: 'Hoeveel personen wonen in dit pand?', type: 'getal' },
                { key: 'aantalSlaapplekken', label: 'Hoeveel slaapplekken zijn er?', type: 'getal' },
                { key: 'minderjarigen', label: 'Zijn er minderjarigen aanwezig?', type: 'janee' },
                { key: 'aantalMinderjarigen', label: 'Zo ja, hoeveel?', type: 'getal', conditie: { key: 'minderjarigen', waarde: 'Ja' } },
                { key: 'brpIngeschreven', label: 'Staat bewoner ingeschreven op dit adres (BRP)?', type: 'janeeonbekend' },
                { key: 'pandGeschikt', label: 'Is het pand geschikt voor het aantal bewoners?', type: 'janee' },
            ],
        },
        {
            key: 'arbeid',
            titel: 'Arbeidssituatie',
            vragen: [
                { key: 'werkzaam', label: 'Is de bewoner werkzaam?', type: 'janeeonbekend' },
                { key: 'werkgever', label: 'Werkgever / bedrijfsnaam', type: 'tekst', conditie: { key: 'werkzaam', waarde: 'Ja' } },
                { key: 'werkSoort', label: 'Aard van het werk', type: 'keuze', opties: ['Logistiek/distributie', 'Landbouw/tuinbouw', 'Bouw', 'Horeca', 'Schoonmaak', 'Vleesindustrie/slachterij', 'Productie/fabriek', 'Sekswerk', 'Huishoudelijk werk', 'Anders', 'Onbekend'], conditie: { key: 'werkzaam', waarde: 'Ja' } },
                { key: 'arbeidscontract', label: 'Heeft de bewoner een arbeidscontract?', type: 'janeeonbekend', conditie: { key: 'werkzaam', waarde: 'Ja' } },
                { key: 'salarisOntvangen', label: 'Wordt er salaris ontvangen?', type: 'keuze', opties: ['Ja', 'Nee', 'Deels', 'Onbekend'], conditie: { key: 'werkzaam', waarde: 'Ja' } },
                { key: 'uitzendbureau', label: 'Via welk uitzendbureau? (indien van toepassing)', type: 'tekst', conditie: { key: 'werkzaam', waarde: 'Ja' } },
                { key: 'huisvestingViaWerkgever', label: 'Wordt huisvesting geregeld door werkgever/uitzendbureau?', type: 'janee', conditie: { key: 'werkzaam', waarde: 'Ja' } },
            ],
        },
        {
            key: 'signalen_arbeid',
            titel: 'Signalen arbeidsuitbuiting',
            beschrijving: 'Let op: individuele signalen hoeven niet veel te betekenen. In combinatie vormen zij vaak een sterke indicatie van uitbuiting (bron: CoMensha).',
            vragen: [
                { key: 'eigenDocumenten', label: 'Heeft bewoner beschikking over eigen identiteitsdocumenten?', type: 'janee' },
                { key: 'eigenBankrekening', label: 'Heeft bewoner toegang tot eigen bankrekening?', type: 'janeeonbekend' },
                { key: 'schuldenWerkgever', label: 'Heeft bewoner schulden bij werkgever of bemiddelaar?', type: 'janeeonbekend' },
                { key: 'inhoudingenSalaris', label: 'Worden er inhoudingen op salaris gedaan voor huisvesting/transport/verzekering?', type: 'janeeonbekend' },
                { key: 'vrijVerlaten', label: 'Kan bewoner vrij het terrein/de woning verlaten?', type: 'janee' },
                { key: 'langeWerkdagen', label: 'Werkt bewoner buitensporig lange uren (>12u/dag)?', type: 'janeeonbekend' },
                { key: 'dwangDreiging', label: 'Zijn er signalen van dwang, dreiging of intimidatie?', type: 'janee' },
                { key: 'signaalToelichting', label: 'Toelichting signalen arbeidsuitbuiting', type: 'lang' },
            ],
        },
        {
            key: 'signalen_seksueel',
            titel: 'Signalen seksuele uitbuiting',
            beschrijving: 'Signalen op basis van EMM-signalenkaart en CoMensha-indicatoren.',
            vragen: [
                { key: 'signalenSekswerk', label: 'Zijn er signalen van prostitutie of sekswerk?', type: 'janee' },
                { key: 'wisselendeBezoekers', label: 'Zijn er opvallend veel wisselende (mannelijke) bezoekers?', type: 'janee' },
                { key: 'controleDerden', label: 'Zijn er signalen van controle door derden (bijv. "vriendje", bewaker)?', type: 'janee' },
                { key: 'signalenGeweld', label: 'Zijn er signalen van (seksueel) geweld?', type: 'janee' },
                { key: 'minderjarigSekswerk', label: 'Zijn er aanwijzingen dat minderjarigen betrokken zijn?', type: 'janee' },
                { key: 'seksToelichting', label: 'Toelichting signalen seksuele uitbuiting', type: 'lang' },
            ],
        },
        {
            key: 'signalen_ondermijning',
            titel: 'Signalen ondermijning',
            beschrijving: 'Op basis van RIEC-protocollen en CCV Barrièremodel Ondermijning Vakantieparken.',
            vragen: [
                { key: 'drugsProductie', label: 'Signalen van drugsproductie of -handel?', type: 'janee' },
                { key: 'hennepteelt', label: 'Signalen van hennepteelt (geur, condensatie, afgetapte stroom)?', type: 'janee' },
                { key: 'pandAanpassingen', label: 'Onverklaarbare aanpassingen aan het pand (extra sloten, verduistering, afzuiging)?', type: 'janee' },
                { key: 'witwassen', label: 'Signalen van witwassen (luxe goederen, contant geld, geen verklaarbaar inkomen)?', type: 'janee' },
                { key: 'vuurwerkopslag', label: 'Signalen van illegale opslag (vuurwerk, wapens, chemicaliën)?', type: 'janee' },
                { key: 'ondermijningToelichting', label: 'Toelichting signalen ondermijning', type: 'lang' },
            ],
        },
        {
            key: 'welzijn',
            titel: 'Welzijn & veiligheid',
            vragen: [
                { key: 'fysiekeToestand', label: 'Fysieke conditie bewoner', type: 'keuze', opties: ['Goed', 'Zorgelijk', 'Slecht', 'Niet beoordeeld'] },
                { key: 'verwondingen', label: 'Zijn er zichtbare verwondingen?', type: 'janee' },
                { key: 'angstig', label: 'Lijkt bewoner angstig of geïntimideerd?', type: 'janee' },
                { key: 'medischeZorg', label: 'Heeft bewoner toegang tot medische zorg?', type: 'janeeonbekend' },
                { key: 'welzijnToelichting', label: 'Toelichting welzijn', type: 'lang' },
            ],
        },
        {
            key: 'pand_waarnemingen',
            titel: 'Visuele waarnemingen pand',
            vragen: [
                { key: 'onderhoud', label: 'Staat van onderhoud pand', type: 'keuze', opties: ['Goed', 'Matig', 'Slecht', 'Verpauperd'] },
                { key: 'overbewoning', label: 'Is er sprake van overbewoning?', type: 'janee' },
                { key: 'sanitair', label: 'Sanitaire voorzieningen adequaat?', type: 'janee' },
                { key: 'ventilatie', label: 'Voldoende ventilatie?', type: 'janee' },
                { key: 'brandveiligheid', label: 'Brandveiligheid in orde (rookmelders, vluchtwegen)?', type: 'janee' },
                { key: 'asbestVerdenking', label: 'Asbest-verdachte materialen aanwezig?', type: 'janee' },
                { key: 'pandToelichting', label: 'Overige waarnemingen', type: 'lang' },
            ],
        },
        {
            key: 'conclusie',
            titel: 'Conclusie & vervolgactie',
            vragen: [
                { key: 'risicoInschatting', label: 'Risico-inschatting', type: 'keuze', opties: ['Geen bijzonderheden', 'Aandachtspunten', 'Ernstige signalen', 'Acuut — directe actie vereist'] },
                { key: 'vervolgActie', label: 'Vervolgactie(s) nodig?', type: 'multi', opties: ['Geen', 'Terugkomen voor hercontrole', 'Melding CoMensha (mensenhandel)', 'Melding politie', 'Melding Arbeidsinspectie', 'Melding Veilig Thuis', 'Melding brandweer', 'Bestuurlijke maatregel', 'Handhavingsverzoek'] },
                { key: 'conclusieOpmerkingen', label: 'Opmerkingen en bevindingen', type: 'lang' },
            ],
        },
    ];

    // === IndexedDB ===

    function openDB() {
        return new Promise(function (resolve, reject) {
            if (db) { resolve(db); return; }

            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (e) {
                var idb = e.target.result;

                if (!idb.objectStoreNames.contains(STORE_LIJST)) {
                    var store = idb.createObjectStore(STORE_LIJST, { keyPath: 'id' });
                    store.createIndex('locatieSlug', 'locatieSlug', { unique: false });
                    store.createIndex('pandLabel', 'pandLabel', { unique: false });
                    store.createIndex('datum', 'datum', { unique: false });
                }

                if (!idb.objectStoreNames.contains(STORE_META)) {
                    idb.createObjectStore(STORE_META, { keyPath: 'key' });
                }
            };

            request.onsuccess = function (e) {
                db = e.target.result;
                resolve(db);
            };

            request.onerror = function () {
                reject(new Error('Kan vragenlijst-database niet openen'));
            };
        });
    }

    function dbPut(storeName, data) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, 'readwrite');
            var store = tx.objectStore(storeName);
            var req = store.put(data);
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbGetAll(storeName) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, 'readonly');
            var store = tx.objectStore(storeName);
            var req = store.getAll();
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function dbDelete(storeName, key) {
        return new Promise(function (resolve, reject) {
            var tx = db.transaction(storeName, 'readwrite');
            var store = tx.objectStore(storeName);
            var req = store.delete(key);
            req.onsuccess = function () { resolve(); };
            req.onerror = function () { reject(req.error); };
        });
    }

    // === Helpers ===

    function generateId() {
        return 'vl-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    function getGPS() {
        return new Promise(function (resolve) {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy });
                },
                function () { resolve(null); },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
            );
        });
    }

    // === CRUD ===

    async function saveVragenlijst(data) {
        await openDB();
        if (!data.id) { data.id = generateId(); }
        data.savedAt = new Date().toISOString();
        await dbPut(STORE_LIJST, data);
        return data;
    }

    async function getVragenlijsten() {
        await openDB();
        var all = await dbGetAll(STORE_LIJST);
        all.sort(function (a, b) {
            return (b.datum || '').localeCompare(a.datum || '') || (b.timestamp || '').localeCompare(a.timestamp || '');
        });
        return all;
    }

    async function deleteVragenlijst(id) {
        await openDB();
        await dbDelete(STORE_LIJST, id);
    }

    // === UI: Multi-step formulier ===

    function openForm(locatieSlug, locatieNaam, pandLabel) {
        // Sluit open popup
        var mapInstance = MapModule.getMap();
        if (mapInstance) { mapInstance.closePopup(); }

        var modal = document.getElementById('vl-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'vl-modal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        var currentSectie = 0;
        var antwoorden = {};
        var gpsData = null;

        // GPS ophalen op achtergrond
        getGPS().then(function (pos) { gpsData = pos; });

        renderSectie();
        modal.classList.add('modal--open');

        // Overlay click sluit
        modal.addEventListener('click', function handler(e) {
            if (e.target === modal) {
                modal.classList.remove('modal--open');
                modal.removeEventListener('click', handler);
            }
        });

        function renderSectie() {
            var sectie = SECTIES[currentSectie];
            var totaal = SECTIES.length;
            var voortgang = Math.round(((currentSectie + 1) / totaal) * 100);

            var html = '';
            html += '<div class="modal__content" style="max-width:520px">';
            html += '  <div class="modal__header">';
            html += '    <h3>Vragenlijst</h3>';
            html += '    <button class="modal__close" id="vl-modal-close">&times;</button>';
            html += '  </div>';

            // Voortgangsbalk
            html += '  <div class="vl-progress">';
            html += '    <div class="vl-progress__bar" style="width:' + voortgang + '%"></div>';
            html += '  </div>';
            html += '  <div class="vl-progress__label">' + (currentSectie + 1) + ' / ' + totaal + ' — ' + escapeHtml(sectie.titel) + '</div>';

            // Context info
            html += '  <div class="vl-context">';
            html += '    <span>' + escapeHtml(locatieNaam) + '</span>';
            if (pandLabel) { html += ' <span style="color:var(--color-muted)">/ ' + escapeHtml(pandLabel) + '</span>'; }
            html += '  </div>';

            html += '  <div class="modal__body">';

            // Sectie beschrijving
            if (sectie.beschrijving) {
                html += '<div class="vl-beschrijving">' + escapeHtml(sectie.beschrijving) + '</div>';
            }

            // Vragen renderen
            sectie.vragen.forEach(function (vraag) {
                // Conditionele vragen: alleen tonen als conditie voldaan
                var conditieClass = '';
                if (vraag.conditie) {
                    var conditieVal = antwoorden[vraag.conditie.key];
                    if (conditieVal !== vraag.conditie.waarde) {
                        conditieClass = ' vl-vraag--hidden';
                    }
                }

                html += '<div class="vl-vraag' + conditieClass + '" data-key="' + vraag.key + '">';
                html += '  <label class="vl-vraag__label">' + escapeHtml(vraag.label) + '</label>';

                var huidig = antwoorden[vraag.key] || '';

                if (vraag.type === 'keuze') {
                    html += '  <select class="input vl-input" data-key="' + vraag.key + '">';
                    html += '    <option value="">— Kies —</option>';
                    vraag.opties.forEach(function (opt) {
                        var sel = (huidig === opt) ? ' selected' : '';
                        html += '    <option value="' + escapeHtml(opt) + '"' + sel + '>' + escapeHtml(opt) + '</option>';
                    });
                    html += '  </select>';
                } else if (vraag.type === 'janee') {
                    html += '  <div class="vl-knoppen">';
                    html += '    <button class="vl-knop' + (huidig === 'Ja' ? ' vl-knop--actief' : '') + '" data-key="' + vraag.key + '" data-val="Ja">Ja</button>';
                    html += '    <button class="vl-knop' + (huidig === 'Nee' ? ' vl-knop--actief' : '') + '" data-key="' + vraag.key + '" data-val="Nee">Nee</button>';
                    html += '  </div>';
                } else if (vraag.type === 'janeeonbekend') {
                    html += '  <div class="vl-knoppen">';
                    html += '    <button class="vl-knop' + (huidig === 'Ja' ? ' vl-knop--actief' : '') + '" data-key="' + vraag.key + '" data-val="Ja">Ja</button>';
                    html += '    <button class="vl-knop' + (huidig === 'Nee' ? ' vl-knop--actief' : '') + '" data-key="' + vraag.key + '" data-val="Nee">Nee</button>';
                    html += '    <button class="vl-knop' + (huidig === 'Onbekend' ? ' vl-knop--actief' : '') + '" data-key="' + vraag.key + '" data-val="Onbekend">Onbekend</button>';
                    html += '  </div>';
                } else if (vraag.type === 'multi') {
                    var geselecteerd = Array.isArray(huidig) ? huidig : [];
                    html += '  <div class="vl-multi">';
                    vraag.opties.forEach(function (opt) {
                        var checked = geselecteerd.indexOf(opt) !== -1 ? ' checked' : '';
                        html += '    <label class="vl-check"><input type="checkbox" data-key="' + vraag.key + '" value="' + escapeHtml(opt) + '"' + checked + '> ' + escapeHtml(opt) + '</label>';
                    });
                    html += '  </div>';
                } else if (vraag.type === 'getal') {
                    html += '  <input type="number" class="input vl-input" data-key="' + vraag.key + '" value="' + escapeHtml(huidig.toString()) + '" min="0" inputmode="numeric">';
                } else if (vraag.type === 'lang') {
                    html += '  <textarea class="input vl-input" data-key="' + vraag.key + '" rows="3" placeholder="Optioneel">' + escapeHtml(huidig) + '</textarea>';
                } else {
                    html += '  <input type="text" class="input vl-input" data-key="' + vraag.key + '" value="' + escapeHtml(huidig) + '">';
                }

                html += '</div>';
            });

            html += '  </div>'; // modal__body

            // Navigatie knoppen
            html += '  <div class="vl-nav">';
            if (currentSectie > 0) {
                html += '    <button class="btn" id="vl-vorige">Vorige</button>';
            } else {
                html += '    <span></span>';
            }
            if (currentSectie < totaal - 1) {
                html += '    <button class="btn btn--primary" id="vl-volgende">Volgende</button>';
            } else {
                html += '    <button class="btn btn--primary" id="vl-opslaan">Opslaan</button>';
            }
            html += '  </div>';

            html += '</div>'; // modal__content

            modal.innerHTML = html;

            // Event listeners
            document.getElementById('vl-modal-close').addEventListener('click', function () {
                if (confirm('Weet je zeker dat je wilt stoppen? Niet-opgeslagen antwoorden gaan verloren.')) {
                    modal.classList.remove('modal--open');
                }
            });

            // Input handlers
            modal.querySelectorAll('select.vl-input, input.vl-input, textarea.vl-input').forEach(function (el) {
                el.addEventListener('change', function () {
                    var key = el.getAttribute('data-key');
                    antwoorden[key] = el.value;
                    updateCondities();
                });
                el.addEventListener('input', function () {
                    var key = el.getAttribute('data-key');
                    antwoorden[key] = el.value;
                });
            });

            // Ja/Nee/Onbekend knoppen
            modal.querySelectorAll('.vl-knop').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var key = btn.getAttribute('data-key');
                    var val = btn.getAttribute('data-val');
                    antwoorden[key] = val;

                    // Visuele toggle
                    var siblings = btn.parentNode.querySelectorAll('.vl-knop');
                    siblings.forEach(function (s) { s.classList.remove('vl-knop--actief'); });
                    btn.classList.add('vl-knop--actief');

                    updateCondities();
                });
            });

            // Multi-select checkboxen
            modal.querySelectorAll('.vl-multi input[type="checkbox"]').forEach(function (cb) {
                cb.addEventListener('change', function () {
                    var key = cb.getAttribute('data-key');
                    var checked = [];
                    modal.querySelectorAll('.vl-multi input[data-key="' + key + '"]:checked').forEach(function (c) {
                        checked.push(c.value);
                    });
                    antwoorden[key] = checked;
                });
            });

            // Navigatie
            var btnVorige = document.getElementById('vl-vorige');
            var btnVolgende = document.getElementById('vl-volgende');
            var btnOpslaan = document.getElementById('vl-opslaan');

            if (btnVorige) {
                btnVorige.addEventListener('click', function () {
                    collectCurrentAnswers();
                    currentSectie--;
                    renderSectie();
                });
            }

            if (btnVolgende) {
                btnVolgende.addEventListener('click', function () {
                    collectCurrentAnswers();
                    currentSectie++;
                    renderSectie();
                });
            }

            if (btnOpslaan) {
                btnOpslaan.addEventListener('click', async function () {
                    collectCurrentAnswers();

                    var controleur = '';
                    if (typeof BevModule !== 'undefined') {
                        controleur = BevModule.getControleurNaam();
                    }

                    var vragenlijst = {
                        locatieSlug: locatieSlug,
                        locatieNaam: locatieNaam,
                        pandLabel: pandLabel || null,
                        controleur: controleur,
                        datum: new Date().toISOString().slice(0, 10),
                        tijd: new Date().toTimeString().slice(0, 5),
                        gps: gpsData,
                        antwoorden: antwoorden,
                        timestamp: new Date().toISOString(),
                    };

                    try {
                        await saveVragenlijst(vragenlijst);
                        modal.classList.remove('modal--open');
                        updateVlCounter();
                        alert('Vragenlijst opgeslagen.');
                    } catch (err) {
                        alert('Opslaan mislukt: ' + err.message);
                    }
                });
            }
        }

        function collectCurrentAnswers() {
            // Collect alle huidige input waarden (voor als ze niet via change event zijn opgeslagen)
            modal.querySelectorAll('select.vl-input, input.vl-input[type="text"], input.vl-input[type="number"], textarea.vl-input').forEach(function (el) {
                var key = el.getAttribute('data-key');
                if (key) { antwoorden[key] = el.value; }
            });
        }

        function updateCondities() {
            var sectie = SECTIES[currentSectie];
            sectie.vragen.forEach(function (vraag) {
                if (!vraag.conditie) return;
                var el = modal.querySelector('.vl-vraag[data-key="' + vraag.key + '"]');
                if (!el) return;

                var conditieVal = antwoorden[vraag.conditie.key];
                if (conditieVal === vraag.conditie.waarde) {
                    el.classList.remove('vl-vraag--hidden');
                } else {
                    el.classList.add('vl-vraag--hidden');
                }
            });
        }
    }

    // === UI: Lijst weergave ===

    async function renderList(container) {
        var lijsten = await getVragenlijsten();
        var el = typeof container === 'string' ? document.getElementById(container) : container;
        if (!el) return;

        if (lijsten.length === 0) {
            el.innerHTML = '<p style="padding:16px;color:var(--color-muted);text-align:center">Nog geen vragenlijsten ingevuld.<br>Open een pand op de kaart en klik op <strong>Vragenlijst</strong>.</p>';
            return;
        }

        var html = '';
        lijsten.forEach(function (vl) {
            var bewoner = vl.antwoorden || {};
            var risico = bewoner.risicoInschatting || 'Niet ingevuld';
            var risicoClass = '';
            if (risico === 'Ernstige signalen') { risicoClass = ' bev-card--ernstig'; }
            if (risico === 'Acuut — directe actie vereist') { risicoClass = ' bev-card--acuut'; }

            html += '<div class="bev-card' + risicoClass + '">';
            html += '  <div class="bev-card__header">';
            html += '    <span class="bev-card__locatie">' + escapeHtml(vl.locatieNaam) + (vl.pandLabel ? ' / ' + escapeHtml(vl.pandLabel) : '') + '</span>';
            html += '    <span class="bev-card__date">' + (vl.datum || '') + ' ' + (vl.tijd || '') + '</span>';
            html += '  </div>';

            // Bewoner samenvatting
            var nat = bewoner.nationaliteit || '';
            var geslacht = bewoner.geslacht || '';
            var leeftijd = bewoner.leeftijd || '';
            html += '  <div class="bev-card__cat">' + [geslacht, leeftijd, nat].filter(Boolean).join(' · ') + '</div>';

            // Risico badge
            html += '  <div class="vl-risico vl-risico--' + risicoSlug(risico) + '">' + escapeHtml(risico) + '</div>';

            // Vervolgacties
            var acties = bewoner.vervolgActie;
            if (Array.isArray(acties) && acties.length > 0 && acties[0] !== 'Geen') {
                html += '  <div style="font-size:11px;margin-top:2px">';
                acties.forEach(function (a) {
                    html += '<span class="vl-actie-tag">' + escapeHtml(a) + '</span> ';
                });
                html += '  </div>';
            }

            html += '  <div class="bev-card__actions">';
            html += '    <button class="btn btn--sm" data-vl-view="' + vl.id + '">Bekijken</button>';
            html += '    <button class="btn btn--sm btn--danger" data-vl-delete="' + vl.id + '">Verwijderen</button>';
            html += '  </div>';
            html += '</div>';
        });

        el.innerHTML = html;

        // Event handlers
        el.querySelectorAll('[data-vl-delete]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                if (!confirm('Vragenlijst verwijderen?')) return;
                await deleteVragenlijst(btn.getAttribute('data-vl-delete'));
                renderList(el);
                updateVlCounter();
            });
        });

        el.querySelectorAll('[data-vl-view]').forEach(function (btn) {
            btn.addEventListener('click', async function () {
                var id = btn.getAttribute('data-vl-view');
                var lijsten2 = await getVragenlijsten();
                var vl = lijsten2.find(function (v) { return v.id === id; });
                if (vl) { showDetail(vl); }
            });
        });
    }

    function risicoSlug(risico) {
        if (!risico) return 'onbekend';
        if (risico.indexOf('Acuut') !== -1) return 'acuut';
        if (risico.indexOf('Ernstig') !== -1) return 'ernstig';
        if (risico.indexOf('Aandacht') !== -1) return 'aandacht';
        return 'geen';
    }

    // === Detail weergave ===

    function showDetail(vl) {
        var modal = document.getElementById('vl-detail-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'vl-detail-modal';
            modal.className = 'modal';
            document.body.appendChild(modal);
        }

        var html = '';
        html += '<div class="modal__content" style="max-width:520px">';
        html += '  <div class="modal__header">';
        html += '    <h3>Vragenlijst — ' + escapeHtml(vl.locatieNaam) + '</h3>';
        html += '    <button class="modal__close" id="vl-detail-close">&times;</button>';
        html += '  </div>';
        html += '  <div class="modal__body">';

        html += '  <div class="vl-detail-meta">';
        html += '    <div>Datum: <strong>' + (vl.datum || '') + ' ' + (vl.tijd || '') + '</strong></div>';
        html += '    <div>Controleur: <strong>' + escapeHtml(vl.controleur) + '</strong></div>';
        if (vl.pandLabel) { html += '    <div>Pand: <strong>' + escapeHtml(vl.pandLabel) + '</strong></div>'; }
        if (vl.gps) { html += '    <div>GPS: ' + vl.gps.lat.toFixed(5) + ', ' + vl.gps.lon.toFixed(5) + '</div>'; }
        html += '  </div>';

        // Alle secties met antwoorden
        SECTIES.forEach(function (sectie) {
            var heeftAntwoorden = false;
            sectie.vragen.forEach(function (vraag) {
                var val = vl.antwoorden[vraag.key];
                if (val !== undefined && val !== '' && val !== null) { heeftAntwoorden = true; }
            });

            if (!heeftAntwoorden) return;

            html += '<div class="vl-detail-sectie">';
            html += '  <h4>' + escapeHtml(sectie.titel) + '</h4>';

            sectie.vragen.forEach(function (vraag) {
                var val = vl.antwoorden[vraag.key];
                if (val === undefined || val === '' || val === null) return;

                var displayVal = Array.isArray(val) ? val.join(', ') : val;
                var isAlarm = isAlarmWaarde(vraag, val);

                html += '  <div class="vl-detail-rij' + (isAlarm ? ' vl-detail-rij--alarm' : '') + '">';
                html += '    <span class="vl-detail-label">' + escapeHtml(vraag.label) + '</span>';
                html += '    <span class="vl-detail-waarde">' + escapeHtml(displayVal) + '</span>';
                html += '  </div>';
            });

            html += '</div>';
        });

        html += '  </div>'; // modal__body
        html += '</div>'; // modal__content

        modal.innerHTML = html;
        modal.classList.add('modal--open');

        document.getElementById('vl-detail-close').addEventListener('click', function () {
            modal.classList.remove('modal--open');
        });
        modal.addEventListener('click', function (e) {
            if (e.target === modal) { modal.classList.remove('modal--open'); }
        });
    }

    /** Bepaal of een antwoord een alarm-signaal is (rood markeren) */
    function isAlarmWaarde(vraag, val) {
        // Signaal-secties: "Nee" op beschermende vragen, "Ja" op risico-vragen
        var beschermendeVragen = ['eigenDocumenten', 'eigenBankrekening', 'vrijVerlaten', 'sanitair', 'ventilatie', 'brandveiligheid', 'pandGeschikt', 'medischeZorg'];
        var risicoVragen = ['dwangDreiging', 'signalenSekswerk', 'wisselendeBezoekers', 'controleDerden', 'signalenGeweld', 'minderjarigSekswerk', 'drugsProductie', 'hennepteelt', 'witwassen', 'vuurwerkopslag', 'verwondingen', 'angstig', 'overbewoning', 'asbestVerdenking', 'schuldenWerkgever', 'langeWerkdagen', 'pandAanpassingen'];

        if (beschermendeVragen.indexOf(vraag.key) !== -1 && val === 'Nee') return true;
        if (risicoVragen.indexOf(vraag.key) !== -1 && val === 'Ja') return true;
        if (vraag.key === 'risicoInschatting' && (val.indexOf('Ernstig') !== -1 || val.indexOf('Acuut') !== -1)) return true;

        return false;
    }

    // === Export ===

    async function exportJSON() {
        var lijsten = await getVragenlijsten();

        if (lijsten.length === 0) {
            alert('Geen vragenlijsten om te exporteren.');
            return;
        }

        var controleur = '';
        if (typeof BevModule !== 'undefined') {
            controleur = BevModule.getControleurNaam();
        }

        var exportData = {
            type: 'vragenlijsten-export',
            controleur: controleur,
            exportDatum: new Date().toISOString(),
            aantalVragenlijsten: lijsten.length,
            vragenlijsten: lijsten,
        };

        var blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'vragenlijsten-' + (controleur || 'export') + '-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(url);
    }

    // === Counter badge ===

    async function updateVlCounter() {
        try {
            var lijsten = await getVragenlijsten();
            var badge = document.getElementById('vl-count-badge');
            if (badge) {
                badge.textContent = lijsten.length > 0 ? lijsten.length : '';
                badge.hidden = lijsten.length === 0;
            }
        } catch (err) {
            // Ignore
        }
    }

    // === Init ===

    async function init() {
        await openDB();
        updateVlCounter();
    }

    return {
        init: init,
        openForm: openForm,
        renderList: renderList,
        exportJSON: exportJSON,
        getVragenlijsten: getVragenlijsten,
        deleteVragenlijst: deleteVragenlijst,
        updateVlCounter: updateVlCounter,
        SECTIES: SECTIES,
    };
})();
