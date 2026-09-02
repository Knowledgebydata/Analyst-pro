'use strict';

/**
 * Kaartmodule — Leaflet kaart met twee lagen:
 *
 * 1. LOCATIES (vakantieparken / jachthavens) — altijd zichtbaar als gebiedsmarkers
 * 2. PANDEN (individuele huisjes/ligplaatsen) — gekleurde statusmarkers per pand
 *
 * De kleurcodering zit op PAND-niveau, niet op locatieniveau.
 */
var MapModule = (function () {
    var STATUS_COLORS = {
        recreatie: '#4CAF50',
        wonen: '#FF9800',
        woonverklaring: '#FFEB3B',
        gereed_niet_in_gebruik: '#03A9F4',
        ongemeubileerd: '#1565C0',
        verpauperd: '#212121',
        twijfel: '#9C27B0',
        arbeidsmigranten: '#F44336',
        sekswerkers: '#B71C1C',
        niet_verkend: '#9E9E9E',
    };

    var STATUS_LABELS = {
        recreatie: 'Recreatie',
        wonen: 'Wonen',
        woonverklaring: 'Woonverklaring',
        gereed_niet_in_gebruik: 'Gereed, niet in gebruik',
        ongemeubileerd: 'Ongemeubileerd',
        verpauperd: 'Verpauperd',
        twijfel: 'Twijfel',
        arbeidsmigranten: 'Arbeidsmigranten',
        sekswerkers: 'Sekswerkers',
        niet_verkend: 'Niet verkend',
    };

    var map = null;
    var locaties = [];
    var panden = [];
    var locatieMarkers = {};   // slug -> { marker, loc }
    var pandMarkers = {};      // pand.id -> { marker, pand }
    var grpLocaties = null;    // layer group voor gebiedsmarkers
    var grpPanden = null;      // layer group voor pandmarkers
    var allBounds = null;
    var showParks = true;
    var showHavens = true;
    var sidebarOpen = false;
    var selectedLocatieSlug = null; // welke locatie is geselecteerd / ingezoomd
    var beheerModus = false;        // beheerder op de server: verplaatsen/bewerken/GPS-reset
    var addPandContext = null;      // { slug, naam, bestaand[], prikPositie } tijdens pand-toevoegen
    var grpAanduidingen = null;     // gele BAG-huisnummerlabels (laagmenu)
    var prikActief = false;         // eenmalige wijs-de-plek-aan-modus (oude flow)
    var puntModusAan = false;       // toevoegmodus: elke tik op de kaart = punt daar
    var aanduidingenCache = [];     // laatst geladen BAG-aanduidingen (voor labelvoorstel)
    var editPandId = null;          // pand-id tijdens bewerken
    var zoekResultaten = [];        // laatste zoekuitkomst op pandcode/pandnaam

    /**
     * @param {Object} [kaartConfig]
     */
    function init(kaartConfig) {
        var cfg = kaartConfig || {};
        var centerLat = cfg.centerLat || 52.210;
        var centerLon = cfg.centerLon || 5.075;
        var defaultZoom = cfg.defaultZoom || 12;

        map = L.map('map', { zoomControl: true }).setView([centerLat, centerLon], defaultZoom);

        var brtLayer = L.tileLayer(
            'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png',
            { attribution: '&copy; Kadaster', maxZoom: 19 }
        );
        var osmLayer = L.tileLayer(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { attribution: '&copy; OSM', maxZoom: 19 }
        );
        var luchtLayer = L.tileLayer(
            'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg',
            { attribution: 'Luchtfoto &copy; Kadaster', maxZoom: 19 }
        );

        var brtFail = false;
        brtLayer.on('tileerror', function () {
            if (!brtFail) { brtFail = true; map.removeLayer(brtLayer); osmLayer.addTo(map); }
        });
        brtLayer.addTo(map);
        // De gele BAG-huisnummerlabels: groep MOET bestaan voor hij in het
        // laagmenu gaat (de proef van 02-09 ving hem als null). Laden zodra de
        // laag aangaat, verversen bij locatiewissel, opruimen bij uitzetten.
        grpAanduidingen = L.layerGroup();
        map.on('overlayadd', function (e) { if (e.layer === grpAanduidingen) laadAanduidingen(); });
        map.on('overlayremove', function (e) { if (e.layer === grpAanduidingen) grpAanduidingen.clearLayers(); });

        L.control.layers({ 'Topografisch (PDOK)': brtLayer, 'OpenStreetMap': osmLayer, 'Luchtfoto': luchtLayer }, { 'Huisnummers (BAG)': grpAanduidingen }, { position: 'topright' }).addTo(map);
        L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(map);

        grpLocaties = L.layerGroup().addTo(map);
        grpPanden = L.layerGroup().addTo(map);

        renderLegend();
        bindControls();
    }

    // === Icon helpers ===

    /** Pand-icoon: klein gekleurd bolletje */
    function mkPandIcon(color, size) {
        size = size || 14;
        var border = (color === '#FFEB3B') ? '2px solid rgba(0,0,0,.3)' : '2px solid rgba(255,255,255,.8)';
        return L.divIcon({
            className: 'cm',
            html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';border:' + border + ';box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
            popupAnchor: [0, -(size / 2 + 2)],
        });
    }

    /** Locatie-icoon: groter vierkant/romb label */
    function mkLocatieIcon(loc) {
        var isPark = loc.type === 'vakantiepark';
        var isTest = loc.type === 'testlocatie';
        // Een testlocatie krijgt hetzelfde anker als een jachthaven, maar in
        // een afwijkende kleur: op de kaart moet meteen zichtbaar zijn dat
        // daar geoefend wordt en niet gehandhaafd.
        var bg = isPark ? '#1B5E20' : (isTest ? '#6A1B9A' : '#0D47A1');
        var icon = isPark ? '&#9960;' : '&#9875;';
        var count = loc.totaal_panden || 0;
        var verkend = loc.verkend || 0;
        var badge = count > 0 ? '<span style="position:absolute;top:-6px;right:-8px;background:#fff;color:#333;font-size:9px;border-radius:8px;padding:1px 4px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.3)">' + verkend + '/' + count + '</span>' : '';

        return L.divIcon({
            className: 'cm',
            html: '<div style="position:relative;width:28px;height:28px;border-radius:6px;background:' + bg + ';border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px">' + icon + badge + '</div>',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -16],
        });
    }

    // === Popup builders ===

    function buildLocatiePopup(loc) {
        var isPark = loc.type === 'vakantiepark';
        var isTest = loc.type === 'testlocatie';
        var typeClass = isPark ? 'park' : 'haven';
        var typeLabel = isPark ? 'Vakantiepark' : (isTest ? 'Testlocatie' : 'Jachthaven');
        var count = loc.totaal_panden || 0;
        var verkend = loc.verkend || 0;

        var html = '<div class="popup__type popup__type--' + typeClass + '">' + typeLabel + '</div>';
        html += '<div class="popup__title">' + loc.naam + '</div>';
        html += '<div class="popup__addr">' + loc.adres + (loc.plaats ? ', ' + loc.plaats : '') + '</div>';
        html += '<div class="popup__stats">' + count + ' panden | ' + verkend + ' verkend</div>';

        // Knop om panden toe te voegen
        html += '<div class="popup__actions">';
        html += '<button class="btn btn--sm btn--primary" onclick="MapModule.selectLocatie(\'' + loc.slug + '\')">Panden bekijken</button>';
        html += '<button class="btn btn--sm" onclick="MapModule.addPand(\'' + loc.slug + '\',\'' + loc.naam.replace(/'/g, "\\'") + '\')">+ Pand toevoegen</button>';
        if (beheerModus) {
            html += '<button class="btn btn--sm" onclick="MapModule.importeerBag(\'' + loc.slug + '\')" style="margin-left:4px">BAG-import</button>';
        }
        html += '</div>';

        // Externe links
        html += '<div class="popup__links">';
        html += '<a href="https://www.google.com/maps/search/?api=1&query=' + loc.lat + ',' + loc.lon + '" target="_blank">Google Maps</a>';
        // GEEN coordinaten meer: geometry.x/geometry.y zijn RD (EPSG:28992) en
        // hier ging WGS84 mee, waardoor de viewer buiten Nederland uitkwam.
        html += '<a href="https://bagviewer.kadaster.nl/lvbag/bag-viewer/" target="_blank" rel="noopener">BAG-viewer</a>';
        html += '<a href="https://kadastralekaart.com/kaart/@' + loc.lat + ',' + loc.lon + ',17z" target="_blank">Kadaster</a>';
        html += '</div>';

        if (loc.nauwkeurigheid !== 'exact') {
            html += '<div class="popup__note">Positie ' + loc.nauwkeurigheid + '</div>';
        }

        return html;
    }

    /**
     * Vult in de geopende popup het aantal foto's bij dit pand in.
     *
     * Waarom bij popupopen en niet bij het bouwen van de popup: het aantal
     * komt uit IndexedDB en dat is asynchroon, terwijl buildPandPopup() een
     * string moet teruggeven. Leaflet houdt standaard een popup tegelijk open,
     * dus een vast id volstaat.
     *
     * Faalt de telling, dan blijft de knop kaal staan -- dat is de oude
     * toestand en nooit een reden om de popup te breken.
     */
    function vulFotoTelling(pand) {
        if (typeof BevModule === 'undefined' || !BevModule.telPandFotos) { return; }

        BevModule.telPandFotos(pand.locatie_slug, pand.label, pand.id).then(function (aantal) {
            var teller = document.getElementById('pf-telling');
            if (teller) { teller.textContent = aantal > 0 ? ' (' + aantal + ')' : ''; }

            var melding = document.getElementById('pf-melding');
            if (!melding) { return; }
            if (aantal > 0) {
                melding.innerHTML = '<div class="popup__note">' + aantal + ' foto'
                    + (aantal === 1 ? '' : '\'s') + ' opgeslagen bij dit pand.</div>';
            } else {
                melding.innerHTML = '';
            }
        }).catch(function () { /* stil: de knop blijft dan zonder telling */ });
    }

    function buildPandPopup(pand) {
        var color = STATUS_COLORS[pand.status] || '#9E9E9E';
        var label = STATUS_LABELS[pand.status] || 'Niet verkend';

        var html = '<div class="popup__type popup__type--pand">Pand' + (pand.pand_code ? ' ' + escHtml(pand.pand_code) : '') + '</div>';
        html += '<div class="popup__title">' + escHtml(pand.label) + '</div>';
        html += '<div class="popup__addr">' + escHtml(pand.locatie_naam || '') + (pand.adres_detail ? ' — ' + escHtml(pand.adres_detail) : '') + '</div>';
        if (pand.bag_pandnummer && !(pand.label || '').trim()) {
            html += '<div class="popup__note">BAG-pand <a href="https://bagviewer.kadaster.nl/lvbag/bag-viewer?objectId='
                + encodeURIComponent(pand.bag_pandnummer) + '" target="_blank" rel="noopener">'
                + escHtml(pand.bag_pandnummer) + '</a>'
                + (pand.bouwjaar ? ' &middot; bouwjaar ' + escHtml(pand.bouwjaar) : '') + '</div>';
        }
        html += '<div class="popup__status"><div class="popup__status-dot" style="background:' + color + '"></div><span class="popup__status-label">' + label + '</span></div>';

        // Status knoppen
        html += '<div class="popup__btns">';
        Object.keys(STATUS_COLORS).forEach(function (key) {
            var active = (pand.status === key) ? ' popup__btn--active' : '';
            html += '<div class="popup__btn' + active + '" style="border-left:4px solid ' + STATUS_COLORS[key] + '" onclick="MapModule.setPandStatus(\'' + pand.id + '\',\'' + key + '\')">' + STATUS_LABELS[key] + '</div>';
        });
        html += '</div>';

        // Tweede rij: aanvullende statussen. De bovenste rij zet de dominante
        // status en bepaalt de kleur op de kaart; deze rij verandert die niet.
        var extra = Array.isArray(pand.extra_statussen) ? pand.extra_statussen : [];
        html += '<div class="popup__extra"><div class="popup__extra-kop">Ook van toepassing</div><div class="popup__btns">';
        Object.keys(STATUS_COLORS).forEach(function (key) {
            if (key === pand.status || key === 'niet_verkend') { return; }
            var aan = (extra.indexOf(key) !== -1) ? ' popup__chip--aan' : '';
            html += '<div class="popup__chip' + aan + '" style="border-left:4px solid ' + STATUS_COLORS[key] + '" onclick="MapModule.wisselExtraStatus(\'' + pand.id + '\',\'' + key + '\')">' + STATUS_LABELS[key] + '</div>';
        });
        html += '</div></div>';

        // Hier komt bij het openen van de popup te staan hoeveel foto's er bij
        // dit pand liggen. Leeg zolang dat niet geteld is; het tellen gaat via
        // IndexedDB en dat is asynchroon, terwijl deze HTML synchroon wordt
        // opgebouwd.
        html += '<div id="pf-melding"></div>';

        // Actie knoppen: bevinding + vragenlijst
        html += '<div class="popup__actions">';
        html += '<button class="btn btn--sm btn--primary" onclick="BevModule.openForm(\'' + pand.locatie_slug + '\',\'' + (pand.locatie_naam || '').replace(/'/g, "\\'") + '\',\'' + pand.label.replace(/'/g, "\\'") + '\')">+ Bevinding</button>';
        html += '<button class="btn btn--sm" onclick="VragenlijstModule.openForm(\'' + pand.locatie_slug + '\',\'' + (pand.locatie_naam || '').replace(/'/g, "\\'") + '\',\'' + pand.label.replace(/'/g, "\\'") + '\')" style="margin-left:4px">Vragenlijst</button>';
        html += '<button class="btn btn--sm" onclick="BevModule.openPandFotos(\'' + pand.locatie_slug + '\',\'' + (pand.locatie_naam || '').replace(/'/g, "\\'") + '\',\'' + String(pand.label || '').replace(/'/g, "\\'") + '\',\'' + pand.id + '\')" style="margin-left:4px">Foto\'s<span id="pf-telling"></span></button>';
        html += '<button class="btn btn--sm" onclick="MapModule.zetAanduiding(\'' + pand.id + '\')" style="margin-left:4px">Aanduiding</button>';
        html += '</div>';

        if (pand.status_updated_by_naam) {
            html += '<div class="popup__note">Laatst door: ' + pand.status_updated_by_naam + '</div>';
        }

        if (pand.display_lat != null && pand.display_lon != null) {
            html += '<div class="popup__note">Handmatig geplaatst door beheerder' + (pand.lat != null ? ' (GPS-registratie bewaard)' : ' (geen GPS vastgelegd)') + '</div>';
        } else if (pand.lat == null) {
            html += '<div class="popup__note">Geen GPS vastgelegd — positie is indicatief</div>';
        }

        if (beheerModus) {
            html += '<div class="popup__actions">';
            html += '<button class="btn btn--sm" onclick="MapModule.openPandEdit(\'' + pand.id + '\')">Bewerken (beheerder)</button>';
            html += '<button class="btn btn--sm btn--danger" onclick="MapModule.archiveerPand(\'' + pand.id + '\')" style="margin-left:4px">Verwijderen</button>';
            html += '</div>';
            html += '<div class="popup__note">Sleep de marker om het punt te verplaatsen. Verwijderen zet het pand in het archief: het verdwijnt van de kaart, de controlehistorie blijft bewaard en een beheerder kan het terughalen.</div>';
        }

        return html;
    }

    // === Positie-helpers ===

    /** Korte aanduiding van een pand: de pandcode als die er is, met het label
     *  erachter zodra die twee van elkaar verschillen. Gebruikt in de
     *  zweeftekst op de kaart en in de zoekresultaten. */
    /** De aanduiding zoals de controleur hem geeft, bijvoorbeeld "Z2 02".
     *  Die gaat voor op de pandcode en zeker op het BAG-pandnummer: bij een
     *  BAG-import is dat nummer feitelijk de naam van het pand, en dat leest
     *  in het veld nergens naar. Volgorde: aanduiding, pandcode, BAG, dan een
     *  neutrale terugval. */
    function aanduidingVan(pand) {
        var label = (pand.label || '').trim();
        if (label) { return label; }
        if (pand.pand_code) { return pand.pand_code; }
        if (pand.bag_pandnummer) { return 'BAG ' + pand.bag_pandnummer; }
        return 'Pand';
    }

    function tooltipTekst(pand) {
        var code = pand.pand_code || '';
        var aand = aanduidingVan(pand);
        if (code && aand !== code) { return aand + ' — ' + code; }
        return aand;
    }

    /** Zweeftekst op de kaart voor de beheerder: dezelfde aanduiding als
     *  tooltipTekst(), aangevuld met de statustekst -- zodat de status ook
     *  zonder kleurherkenning duidelijk is bij het zweven over een pand.
     *  Alleen voor beheerModus; de bevestigingsdialoog, de zijbalk en de
     *  zweeftekst voor controleur/coordinator gebruiken tooltipTekst()
     *  zonder status (de zijbalk toont de status al apart ernaast).
     */
    function tooltipTekstMetStatus(pand) {
        var status = STATUS_LABELS[pand.status] || 'Niet verkend';
        return tooltipTekst(pand) + ' \u00b7 ' + status;
    }

    /** Deterministische kleine offset voor panden zonder GPS (stabiel per pand,
     *  in plaats van de oude random spreiding die punten soms in het water zette). */
    function hashOffset(id) {
        var h = 0;
        var str = String(id || '');
        for (var i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
        var a = ((h % 1000) / 1000) * 0.0004;
        var b = ((((h / 1000) | 0) % 1000) / 1000) * 0.0004;
        return [a, b];
    }

    /** Kaartpositie van een pand: handmatige plaatsing (beheerder) gaat voor,
     *  daarna de GPS-registratie, daarna een stabiele offset rond de locatie.
     *  De GPS-kolommen zelf worden hier nooit gewijzigd. */
    function posVoor(pand) {
        if (pand.display_lat != null && pand.display_lon != null) {
            return { lat: Number(pand.display_lat), lon: Number(pand.display_lon) };
        }
        if (pand.lat != null && pand.lon != null) {
            return { lat: Number(pand.lat), lon: Number(pand.lon) };
        }
        var locEntry = locatieMarkers[pand.locatie_slug];
        if (!locEntry) return null;
        var off = hashOffset(pand.id);
        return { lat: locEntry.loc.lat + off[0], lon: locEntry.loc.lon + off[1] };
    }


    /** Aanduiding van een pand wijzigen. Open voor elke rol: de controleur
     *  staat bij het huisje en leest het bordje, de beheerder niet. */
    async function zetAanduiding(pandId) {
        var entry = pandMarkers[pandId];
        if (!entry) { return; }
        var huidig = entry.pand.label || '';
        var nieuw = prompt('Aanduiding van dit pand, zoals het ter plaatse bekend staat (bijvoorbeeld "Z2 02"):', huidig);
        if (nieuw === null) { return; }
        nieuw = nieuw.trim();
        if (!nieuw) { alert('Geef een aanduiding op.'); return; }
        if (nieuw === huidig) { return; }

        try {
            var res = await API.setPandAanduiding(pandId, nieuw);
            var bijgewerkt = (res && res.pand) ? res.pand : null;
            entry.pand.label = bijgewerkt ? bijgewerkt.label : nieuw;
            entry.marker.setPopupContent(buildPandPopup(entry.pand));
            if (entry.marker.getTooltip()) {
                entry.marker.setTooltipContent(beheerModus ? tooltipTekstMetStatus(entry.pand) : tooltipTekst(entry.pand));
            }
            for (var i = 0; i < panden.length; i++) {
                if (panden[i].id === pandId) { panden[i].label = entry.pand.label; break; }
            }
            if (sidebarOpen) { renderSidebar(); }
        } catch (err) {
            alert('Aanduiding wijzigen mislukt: ' + (err && err.message ? err.message : err));
        }
    }


    /** Een aanvullende status aan- of uitzetten. De dominante status en dus de
     *  kleur op de kaart blijft ongemoeid -- dat is de hele afspraak: wat op
     *  straat is ingevoerd verandert hier niet door. */
    async function wisselExtraStatus(pandId, status) {
        var entry = pandMarkers[pandId];
        if (!entry) { return; }
        var huidig = Array.isArray(entry.pand.extra_statussen) ? entry.pand.extra_statussen.slice() : [];
        var i = huidig.indexOf(status);
        if (i === -1) { huidig.push(status); } else { huidig.splice(i, 1); }

        try {
            var res = await API.updatePandStatus(pandId, entry.pand.status, null, huidig);
            var terug = (res && res.pand && Array.isArray(res.pand.extra_statussen))
                ? res.pand.extra_statussen : huidig;
            entry.pand.extra_statussen = terug;
            for (var j = 0; j < panden.length; j++) {
                if (panden[j].id === pandId) { panden[j].extra_statussen = terug; break; }
            }
            entry.marker.setPopupContent(buildPandPopup(entry.pand));
        } catch (err) {
            alert('Aanvullende status wijzigen mislukt: ' + (err && err.message ? err.message : err));
        }
    }

    // === Data laden ===

    function loadLocaties(data) {
        locaties = data;
        grpLocaties.clearLayers();
        locatieMarkers = {};

        var coords = [];

        locaties.forEach(function (loc) {
            var marker = L.marker([loc.lat, loc.lon], { icon: mkLocatieIcon(loc) })
                .bindPopup(buildLocatiePopup(loc), { maxWidth: 300 });

            grpLocaties.addLayer(marker);
            locatieMarkers[loc.slug] = { marker: marker, loc: loc };
            coords.push([loc.lat, loc.lon]);
        });

        if (coords.length > 0) {
            allBounds = L.latLngBounds(coords);
            map.fitBounds(allBounds, { padding: [60, 40] });
        }

        renderSidebar();
    }

    function loadPanden(data) {
        panden = data;
        grpPanden.clearLayers();
        pandMarkers = {};

        panden.forEach(function (pand) {
            var pos = posVoor(pand);
            if (!pos) return; // Geen positie mogelijk

            var color = STATUS_COLORS[pand.status] || '#9E9E9E';
            var aanduiding = beheerModus ? tooltipTekstMetStatus(pand) : tooltipTekst(pand);

            // Zweven bestaat niet op een aanraakscherm: daar zou een
            // Leaflet-tooltip bij elke tik samen met de popup openen. Op zulke
            // toestellen zetten we de tekst daarom in het title-attribuut en
            // op de kaartcomputer als echte zweeftekst.
            var kanZweven = !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);

            var marker = L.marker([pos.lat, pos.lon], {
                icon: mkPandIcon(color, 14),
                draggable: beheerModus,
                title: kanZweven ? undefined : aanduiding,
            }).bindPopup(buildPandPopup(pand), { maxWidth: 300 });

            marker.on('popupopen', function () { vulFotoTelling(pand); });

            if (kanZweven) {
                marker.bindTooltip(aanduiding, { direction: 'top', offset: [0, -10], opacity: 0.95 });
            }

            if (beheerModus) {
                marker.on('dragend', function (e) { onPandDragged(pand.id, e.target); });
            }

            grpPanden.addLayer(marker);
            pandMarkers[pand.id] = { marker: marker, pand: pand, lat: pos.lat, lon: pos.lon };
        });
    }

    // === Status updates ===

    function updatePandMarker(pandId, newStatus) {
        var entry = pandMarkers[pandId];
        if (!entry) return;

        entry.pand.status = newStatus;
        var color = STATUS_COLORS[newStatus] || '#9E9E9E';
        entry.marker.setIcon(mkPandIcon(color, 14));
        entry.marker.setPopupContent(buildPandPopup(entry.pand));
        if (entry.marker.getTooltip()) { entry.marker.setTooltipContent(beheerModus ? tooltipTekstMetStatus(entry.pand) : tooltipTekst(entry.pand)); }

        if (sidebarOpen) { renderSidebar(); }
    }

    async function setPandStatus(pandId, status) {
        try {
            await API.updatePandStatus(pandId, status);
            updatePandMarker(pandId, status);
        } catch (err) {
            alert('Fout bij status wijzigen: ' + err.message);
        }
    }

    // === Locatie selecteren (zoom in + laad panden) ===

    async function selectLocatie(slug) {
        selectedLocatieSlug = slug;
        var entry = locatieMarkers[slug];
        if (!entry) return;

        sluitLijstOpSmalScherm();
        map.flyTo([entry.loc.lat, entry.loc.lon], 17, { duration: 1 });

        // Laad panden voor deze locatie
        try {
            var data = await API.getPanden(slug);
            loadPanden(data.panden);
        } catch (err) {
            console.error('Panden laden mislukt:', err);
        }

        if (grpAanduidingen && map.hasLayer(grpAanduidingen)) { laadAanduidingen(); }
    }

    // === BAG-huisnummerlabels (gele bordjes, zoals de BAG-viewer) ===

    async function laadAanduidingen() {
        if (!grpAanduidingen) return;
        grpAanduidingen.clearLayers();
        if (!selectedLocatieSlug) {
            alert('Kies eerst een locatie; de huisnummers worden per locatie geladen.');
            return;
        }
        try {
            var data = await API.getBagAanduidingen(selectedLocatieSlug, 300);
            aanduidingenCache = data.aanduidingen || [];
            (data.aanduidingen || []).forEach(function (a) {
                var m = L.marker([a.lat, a.lon], {
                    icon: L.divIcon({
                        className: 'bag-aanduiding',
                        html: '<span style="display:inline-block;background:#f6c700;color:#1a1a1a;border:1px solid #8a7300;' +
                              'border-radius:3px;padding:1px 5px;font:600 11px/1.5 sans-serif;white-space:nowrap;' +
                              'box-shadow:0 1px 2px rgba(0,0,0,.35)">' + escHtml(a.label) + '</span>',
                        iconSize: null,
                        iconAnchor: [0, 8],
                    }),
                    interactive: true,
                    keyboard: false,
                });
                m.bindTooltip(escHtml((a.straat ? a.straat + ' ' : '') + a.label +
                    (a.gebruiksdoel ? ' \u2014 ' + a.gebruiksdoel : '')), { direction: 'top' });
                // In toevoegmodus is een tik op het gele bordje het snelste pad:
                // plek EN label komen dan allebei uit de BAG.
                m.on('click', function () { if (puntModusAan) openSnelPunt(a.lat, a.lon, a.label); });
                m.addTo(grpAanduidingen);
            });
            if (!map.hasLayer(grpAanduidingen)) { grpAanduidingen.addTo(map); }
        } catch (err) {
            console.error('BAG-aanduidingen laden mislukt:', err);
            alert('Huisnummers laden mislukte: ' + err.message);
        }
    }

    // === Pand toevoegen ===

    async function addPand(locatieSlug, locatieNaam) {
        // Bestaande labels ophalen voor de duplicaatcontrole (voorkomt de
        // 409-herhaalfout van 26-08: label moet uniek zijn per locatie)
        var bestaand = [];
        try {
            var data = await API.getPanden(locatieSlug);
            bestaand = data.panden.map(function (p) { return p.label; });
        } catch (err) { /* dan alleen de server-side controle */ }

        addPandContext = { slug: locatieSlug, naam: locatieNaam, bestaand: bestaand };

        var el = ensureModal();
        document.getElementById('wh-pand-modal-title').textContent = 'Pand toevoegen \u2014 ' + locatieNaam;

        var html = '';
        if (bestaand.length > 0) {
            html += '<div style="font-size:12px;color:#666"><strong>Bestaande labels op deze locatie:</strong><div style="max-height:90px;overflow-y:auto;margin-top:4px;line-height:1.7">' + bestaand.slice().sort().map(escHtml).join(' &middot; ') + '</div></div>';
        }
        html += '<label style="font-size:13px">Label (uniek per locatie)<input type="text" id="wh-pand-label" placeholder="bijv. 22-C10, Huisje 12, Ligplaats A3" style="width:100%;padding:8px;margin-top:4px" oninput="MapModule.checkPandLabel(this.value)"></label>';
        html += '<div id="wh-pand-label-warn" style="color:#c62828;font-size:12px;min-height:16px"></div>';
        html += '<label style="font-size:13px">Adresdetail (optioneel)<input type="text" id="wh-pand-adres" placeholder="bijv. Moleneind 20a" style="width:100%;padding:8px;margin-top:4px"></label>';
        html += '<label style="font-size:13px;display:flex;align-items:center;gap:8px"><input type="checkbox" id="wh-pand-gps" checked> Huidige GPS-positie gebruiken</label>';
        html += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">';
        html += '<button class="btn btn--sm" type="button" onclick="MapModule.startPrik()">Wijs de plek aan op de kaart</button>';
        html += '<span id="wh-pand-prik-status" style="font-size:12px;color:#2e7d32"></span>';
        html += '</div>';
        html += '<button class="btn btn--primary" id="wh-pand-submit" onclick="MapModule.submitAddPand()">Toevoegen</button>';

        document.getElementById('wh-pand-modal-body').innerHTML = html;
        if (!('geolocation' in navigator)) { document.getElementById('wh-pand-gps').checked = false; }
        el.classList.add('modal--open');
        setTimeout(function () { document.getElementById('wh-pand-label').focus(); }, 100);
    }

    // === Plek aanwijzen op de kaart (voor iedereen: controleur en beheerder) ===
    //
    // Eenmalige prikmodus, zoals het punt-toevoegen in de analyse-applicatie:
    // de modal gaat tijdelijk opzij, EEN klik op de kaart kiest de plek, en de
    // modal komt terug met de keuze zichtbaar. Een aangewezen plek gaat als
    // positie_bron 'kaart' mee, zodat de herkomst nooit voor GPS doorgaat.

    /** Afstand in meters (haversine); zelfde formule als de GPS-kooi. */
    function afstandMeterKaart(lat1, lon1, lat2, lon2) {
        var R = 6371000;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * R * Math.asin(Math.sqrt(a));
    }

    function startPrik() {
        if (!addPandContext || prikActief) return;
        prikActief = true;
        var modal = document.getElementById('wh-pand-modal');
        if (modal) modal.classList.remove('modal--open');
        map.getContainer().style.cursor = 'crosshair';
        alert('Tik op de kaart op de plek van het pand. De invoer komt daarna vanzelf terug.');
        map.once('click', function (e) {
            prikActief = false;
            map.getContainer().style.cursor = '';
            if (!addPandContext) return;
            // Plausibiliteit: de aangewezen plek hoort bij DEZE locatie. Een
            // klik ver daarbuiten is vrijwel zeker een vergissing (verkeerd
            // ingezoomd) en zou het pand onvindbaar ver wegzetten.
            var entry = locatieMarkers[addPandContext.slug];
            if (entry && afstandMeterKaart(e.latlng.lat, e.latlng.lng, entry.loc.lat, entry.loc.lon) > 2000) {
                alert('Die plek ligt meer dan 2 km van ' + addPandContext.naam + '. De klik is niet overgenomen; zoom in op de locatie en wijs opnieuw aan.');
            } else {
                addPandContext.prikPositie = { lat: e.latlng.lat, lon: e.latlng.lng };
            }
            if (modal) modal.classList.add('modal--open');
            var st = document.getElementById('wh-pand-prik-status');
            if (st) st.textContent = addPandContext.prikPositie ? '\u2713 Plek aangewezen op de kaart (gaat voor op GPS)' : '';
        });
    }

    // === Toevoegmodus: tik op de kaart = punt daar (controleur en beheerder) ===
    //
    // De omgekeerde volgorde van de oude flow: EERST tikken, DAN een klein
    // invulvakje met de plek al gezet. Ligt er een BAG-bordje binnen 20 meter,
    // dan staat het label ("22 C07") al ingevuld. De modus blijft aan zodat je
    // bordje voor bordje kunt doorwerken; de +Punt-knop zet hem weer uit.

    function dichtstbijzijndeAanduiding(lat, lon) {
        var beste = null, besteAfstand = 20; // meter
        aanduidingenCache.forEach(function (a) {
            var d = afstandMeterKaart(lat, lon, a.lat, a.lon);
            if (d < besteAfstand) { besteAfstand = d; beste = a; }
        });
        return beste;
    }

    function wisselPuntModus() {
        if (!puntModusAan && !selectedLocatieSlug) {
            alert('Kies eerst een locatie (tik op een park of haven); daarna zet je de toevoegmodus aan.');
            return;
        }
        puntModusAan = !puntModusAan;
        var btn = document.getElementById('btn-punt-modus');
        if (btn) { btn.classList.toggle('btn--primary', puntModusAan); }
        map.getContainer().style.cursor = puntModusAan ? 'crosshair' : '';
        if (puntModusAan) {
            alert('Toevoegmodus aan: tik op de kaart (of op een geel BAG-bordje) op de plek van het pand. Zet de modus uit met de +Punt-knop.');
        }
    }

    function onKaartKlikPunt(e) {
        if (!puntModusAan || prikActief) return;
        if (!selectedLocatieSlug) { return; }
        var entry = locatieMarkers[selectedLocatieSlug];
        if (entry && afstandMeterKaart(e.latlng.lat, e.latlng.lng, entry.loc.lat, entry.loc.lon) > 2000) {
            alert('Die plek ligt meer dan 2 km van ' + entry.loc.naam + '. Zoom in op de locatie en tik opnieuw.');
            return;
        }
        var voorstel = dichtstbijzijndeAanduiding(e.latlng.lat, e.latlng.lng);
        openSnelPunt(e.latlng.lat, e.latlng.lng, voorstel ? voorstel.label : null);
    }

    async function snelOpslaan(label, lat, lon) {
        try {
            await API.addPand({
                locatie_slug: selectedLocatieSlug,
                label: label,
                adres_detail: null,
                lat: lat,
                lon: lon,
                positie_bron: 'kaart',
            });
            selectLocatie(selectedLocatieSlug);
        } catch (err) {
            alert('Punt niet toegevoegd: ' + err.message);
        }
    }

    function openSnelPunt(lat, lon, labelVoorstel) {
        if (!selectedLocatieSlug) return;
        var entry = locatieMarkers[selectedLocatieSlug];
        var naam = entry ? entry.loc.naam : selectedLocatieSlug;
        var bestaand = panden.map(function (p) { return p.label; });

        // Bordje-pad: label EN plek zijn bekend -> een korte bevestiging
        // volstaat en het punt staat er. Geen invulvakje.
        var voorstelIsNieuw = labelVoorstel &&
            !bestaand.some(function (b) { return normLabel(b) === normLabel(labelVoorstel); });
        if (voorstelIsNieuw) {
            if (window.confirm('Punt "' + labelVoorstel + '" hier toevoegen?')) {
                snelOpslaan(labelVoorstel, lat, lon);
            }
            return;
        }

        addPandContext = { slug: selectedLocatieSlug, naam: naam, bestaand: bestaand,
                           prikPositie: { lat: lat, lon: lon } };

        var el = ensureModal();
        document.getElementById('wh-pand-modal-title').textContent = 'Punt toevoegen \u2014 ' + naam;

        var html = '<div style="font-size:12px;color:#2e7d32">\u2713 Plek overgenomen van je tik op de kaart</div>';
        if (labelVoorstel) {
            html += '<div style="font-size:12px;color:#c62828">BAG-bordje ' + escHtml(labelVoorstel) + ' bestaat al als pand \u2014 kies een ander label.</div>';
        }
        html += '<label style="font-size:13px">Label (uniek per locatie)<input type="text" id="wh-pand-label" value="" placeholder="bijv. 22-C10, Huisje 12" style="width:100%;padding:8px;margin-top:4px" oninput="MapModule.checkPandLabel(this.value)"></label>';
        html += '<div id="wh-pand-label-warn" style="color:#c62828;font-size:12px;min-height:16px"></div>';
        html += '<label style="font-size:13px">Adresdetail (optioneel)<input type="text" id="wh-pand-adres" placeholder="bijv. Moleneind 22" style="width:100%;padding:8px;margin-top:4px"></label>';
        html += '<span id="wh-pand-prik-status" hidden></span>';
        html += '<button class="btn btn--primary" id="wh-pand-submit" onclick="MapModule.submitAddPand()">Toevoegen</button>';
        html += '<div style="font-size:11px;color:#888;margin-top:6px">De toevoegmodus blijft aan: na het opslaan tik je gewoon het volgende pand aan.</div>';

        document.getElementById('wh-pand-modal-body').innerHTML = html;
        el.classList.add('modal--open');
        setTimeout(function () { var i = document.getElementById('wh-pand-label'); if (i) i.focus(); }, 100);
    }

    function normLabel(v) { return String(v || '').toLowerCase().replace(/[\s\-_./]/g, ''); }

    function escHtml(v) {
        return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function checkPandLabel(v) {
        if (!addPandContext) return;
        var warn = document.getElementById('wh-pand-label-warn');
        var btn = document.getElementById('wh-pand-submit');
        var n = normLabel(v);
        var dup = n && addPandContext.bestaand.some(function (b) { return normLabel(b) === n; });
        var bijna = !dup && n && addPandContext.bestaand.filter(function (b) {
            return normLabel(b).indexOf(n) === 0 || n.indexOf(normLabel(b)) === 0;
        });
        if (dup) {
            warn.textContent = 'Dit label bestaat al op deze locatie (ook met spatie/streepje-variaties). Kies een ander label.';
            btn.disabled = true;
        } else if (bijna && bijna.length > 0) {
            warn.textContent = 'Lijkt op bestaand label: ' + bijna.slice(0, 3).join(', ');
            btn.disabled = false;
        } else {
            warn.textContent = '';
            btn.disabled = false;
        }
    }

    async function submitAddPand() {
        if (!addPandContext) return;
        var label = (document.getElementById('wh-pand-label').value || '').trim();
        if (!label) { document.getElementById('wh-pand-label-warn').textContent = 'Vul een label in.'; return; }

        var n = normLabel(label);
        if (addPandContext.bestaand.some(function (b) { return normLabel(b) === n; })) {
            document.getElementById('wh-pand-label-warn').textContent = 'Dit label bestaat al op deze locatie. Kies een ander label.';
            return;
        }

        var adresDetail = (document.getElementById('wh-pand-adres').value || '').trim();
        var gpsVak = document.getElementById('wh-pand-gps');
        var wilGps = !!(gpsVak && gpsVak.checked);
        var btn = document.getElementById('wh-pand-submit');
        btn.disabled = true;
        btn.textContent = 'Bezig...';

        var lat = null;
        var lon = null;
        var positieBron = null;
        if (addPandContext.prikPositie) {
            lat = addPandContext.prikPositie.lat;
            lon = addPandContext.prikPositie.lon;
            positieBron = 'kaart';
            wilGps = false; // de aangewezen plek gaat voor
        }
        if (wilGps && 'geolocation' in navigator) {
            try {
                var pos = await new Promise(function (resolve, reject) {
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0,
                    });
                });
                lat = pos.coords.latitude;
                lon = pos.coords.longitude;
            } catch (err) {
                console.warn('GPS niet beschikbaar:', err);
            }
        }

        try {
            await API.addPand({
                locatie_slug: addPandContext.slug,
                label: label,
                adres_detail: adresDetail || null,
                lat: lat,
                lon: lon,
                positie_bron: positieBron,
            });
            var slug = addPandContext.slug;
            sluitPandModal();
            selectLocatie(slug);
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Toevoegen';
            document.getElementById('wh-pand-label-warn').textContent = 'Fout bij toevoegen: ' + err.message;
        }
    }

    // === Beheerder: verplaatsen, bewerken, GPS-reset ===

    function setBeheerModus(v) {
        beheerModus = !!v;
        var btn = document.getElementById('btn-reset-gps');
        if (btn) { btn.hidden = !beheerModus; }
        if (panden.length > 0) { loadPanden(panden); } // hertekenen met sleepbaarheid
    }

    async function onPandDragged(pandId, marker) {
        var entry = pandMarkers[pandId];
        if (!entry) return;
        var ll = marker.getLatLng();

        if (!confirm('"' + entry.pand.label + '" op deze plek neerzetten?\n\nDe oorspronkelijke GPS-registratie blijft bewaard; met de GPS-reset-knop springt het punt er weer naartoe.')) {
            marker.setLatLng([entry.lat, entry.lon]);
            return;
        }

        try {
            await API.movePand(pandId, ll.lat, ll.lng);
            entry.pand.display_lat = ll.lat;
            entry.pand.display_lon = ll.lng;
            entry.lat = ll.lat;
            entry.lon = ll.lng;
            marker.setPopupContent(buildPandPopup(entry.pand));
        } catch (err) {
            marker.setLatLng([entry.lat, entry.lon]);
            alert('Verplaatsen mislukt: ' + err.message);
        }
    }

    async function resetGpsPosities() {
        var scopeTekst = selectedLocatieSlug ? 'van de geselecteerde locatie' : 'van ALLE locaties';
        if (!confirm('Alle handmatig verplaatste punten ' + scopeTekst + ' terugzetten naar hun GPS-registratie?')) return;
        try {
            var r = await API.resetPandPosities(selectedLocatieSlug);
            alert(r.message);
            if (selectedLocatieSlug) { selectLocatie(selectedLocatieSlug); }
            else { grpPanden.clearLayers(); pandMarkers = {}; }
        } catch (err) {
            alert('Reset mislukt: ' + err.message);
        }
    }

    function openPandEdit(pandId) {
        var entry = pandMarkers[pandId];
        if (!entry) return;
        var pand = entry.pand;
        editPandId = pandId;

        var el = ensureModal();
        document.getElementById('wh-pand-modal-title').textContent = 'Pand bewerken \u2014 ' + pand.label;

        var html = '';
        html += '<label style="font-size:13px">Label<input type="text" id="wh-edit-label" value="' + escHtml(pand.label) + '" style="width:100%;padding:8px;margin-top:4px"></label>';
        html += '<label style="font-size:13px">Adresdetail<input type="text" id="wh-edit-adres" value="' + escHtml(pand.adres_detail || '') + '" style="width:100%;padding:8px;margin-top:4px"></label>';
        html += '<label style="font-size:13px">Status<select id="wh-edit-status" style="width:100%;padding:8px;margin-top:4px">';
        Object.keys(STATUS_LABELS).forEach(function (key) {
            html += '<option value="' + key + '"' + (pand.status === key ? ' selected' : '') + '>' + STATUS_LABELS[key] + '</option>';
        });
        html += '</select></label>';
        html += '<label style="font-size:13px">Notitie<textarea id="wh-edit-notitie" rows="3" style="width:100%;padding:8px;margin-top:4px">' + escHtml(pand.notitie || '') + '</textarea></label>';
        html += '<div style="font-size:12px;color:#666">GPS-registratie: ' + (pand.lat != null ? Number(pand.lat).toFixed(6) + ', ' + Number(pand.lon).toFixed(6) : 'niet vastgelegd') + (pand.display_lat != null ? ' &middot; handmatig verplaatst' : '') + '</div>';
        html += '<button class="btn btn--primary" id="wh-edit-submit" onclick="MapModule.savePandEdit()">Opslaan</button>';

        document.getElementById('wh-pand-modal-body').innerHTML = html;
        el.classList.add('modal--open');
    }

    async function savePandEdit() {
        var entry = pandMarkers[editPandId];
        if (!entry) return;
        var pand = entry.pand;

        var label = (document.getElementById('wh-edit-label').value || '').trim();
        var adres = (document.getElementById('wh-edit-adres').value || '').trim();
        var status = document.getElementById('wh-edit-status').value;
        var notitie = (document.getElementById('wh-edit-notitie').value || '').trim();

        if (!label) { alert('Label mag niet leeg zijn.'); return; }

        var btn = document.getElementById('wh-edit-submit');
        btn.disabled = true;
        btn.textContent = 'Bezig...';

        try {
            await API.updatePand(pand.id, {
                label: label,
                adres_detail: adres || null,
                notitie: notitie || null,
            });
            if (status !== pand.status) {
                await API.updatePandStatus(pand.id, status, 'Achteraf ingevuld door beheerder');
            }
            pand.label = label;
            pand.adres_detail = adres || null;
            pand.notitie = notitie || null;
            pand.status = status;
            entry.marker.setIcon(mkPandIcon(STATUS_COLORS[status] || '#9E9E9E', 14));
            entry.marker.setPopupContent(buildPandPopup(pand));
            sluitPandModal();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Opslaan';
            alert('Opslaan mislukt: ' + err.message);
        }
    }

    // === Beheerder: BAG-panden importeren ===

    /** Zet de panden uit de Basisregistratie Adressen en Gebouwen binnen een
     *  straal rond de locatie vooraf op de kaart. De server slaat panden die
     *  er al staan over, dus nogmaals importeren dupliceert niets. */
    async function importeerBag(locatieSlug) {
        var invoer = prompt('BAG-panden importeren rond deze locatie.\n\nStraal in meters (25 tot 500):', '150');
        if (invoer === null) return;
        var straal = parseInt(invoer, 10);
        if (!isFinite(straal)) { alert('Geen geldig getal.'); return; }

        try {
            var r = await API.importeerBagPanden(locatieSlug, straal);
            alert(r.message);
            selectLocatie(locatieSlug);
        } catch (err) {
            alert('BAG-import mislukt: ' + err.message);
        }
    }

    // === Beheerder: pand archiveren ===

    /** Zet een pand in het archief. Het verdwijnt van de kaart, maar blijft met
     *  zijn controlehistorie in de database staan en is terug te halen. */
    async function archiveerPand(pandId) {
        var entry = pandMarkers[pandId];
        if (!entry) return;

        if (!confirm('"' + tooltipTekst(entry.pand) + '" verwijderen van de kaart?\n\nHet pand gaat naar het archief. De controlehistorie blijft bewaard en een beheerder kan het pand terugzetten.')) return;

        try {
            await API.archiveerPand(pandId);
            grpPanden.removeLayer(entry.marker);
            delete pandMarkers[pandId];
            panden = panden.filter(function (p) { return p.id !== pandId; });
            if (sidebarOpen) { renderSidebar(); }
        } catch (err) {
            alert('Verwijderen mislukt: ' + err.message);
        }
    }

    // === Zoeken op pandcode of pandnaam ===

    async function zoekPanden(term) {
        var uit = document.getElementById('pand-search-list');
        if (!uit) return;
        term = String(term || '').trim();

        if (term.length < 2) {
            uit.innerHTML = '';
            uit.hidden = true;
            return;
        }

        uit.hidden = false;
        uit.innerHTML = '<div style="padding:12px;color:#999">Zoeken\u2026</div>';

        try {
            var data = await API.zoekPanden(term);
            zoekResultaten = data.panden || [];

            if (zoekResultaten.length === 0) {
                uit.innerHTML = '<div style="padding:12px;color:#999">Geen pand gevonden voor "' + escHtml(term) + '"</div>';
                return;
            }

            var html = '';
            zoekResultaten.forEach(function (p) {
                var kleur = STATUS_COLORS[p.status] || '#9E9E9E';
                html += '<div class="map-sidebar__item" onclick="MapModule.gaNaarPand(\'' + p.id + '\')">';
                html += '<div class="map-sidebar__dot" style="background:' + kleur + '"></div>';
                html += '<div class="map-sidebar__info"><div class="map-sidebar__name">' + escHtml(tooltipTekst(p)) + '</div>';
                html += '<div class="map-sidebar__addr">' + escHtml(p.locatie_naam || '') + ' <span style="color:#999;font-size:10px">' + escHtml(STATUS_LABELS[p.status] || '') + '</span></div></div>';
                html += '</div>';
            });
            uit.innerHTML = html;
        } catch (err) {
            uit.innerHTML = '<div style="padding:12px;color:#c62828">Zoeken mislukt: ' + escHtml(err.message) + '</div>';
        }
    }

    /** Springt naar een gevonden pand, ook wanneer dat op een andere locatie
     *  ligt dan de kaart nu toont: eerst die locatie laden, dan het punt. */
    async function gaNaarPand(pandId) {
        var gevonden = null;
        for (var i = 0; i < zoekResultaten.length; i++) {
            if (zoekResultaten[i].id === pandId) { gevonden = zoekResultaten[i]; break; }
        }
        if (!gevonden) return;

        sluitLijstOpSmalScherm();

        if (selectedLocatieSlug !== gevonden.locatie_slug) {
            await selectLocatie(gevonden.locatie_slug);
        }

        var entry = pandMarkers[pandId];
        if (!entry) {
            // Het pand zit niet in wat er nu geladen is; vlieg dan in elk geval
            // naar de locatie, zodat de controleur niet in het niets kijkt.
            flyTo(gevonden.locatie_slug);
            return;
        }

        map.flyTo([entry.lat, entry.lon], 19, { duration: 1 });
        setTimeout(function () { entry.marker.openPopup(); }, 1100);
    }

    // === Modal-helpers (hergebruiken de bestaande .modal-stijlen) ===

    function ensureModal() {
        var el = document.getElementById('wh-pand-modal');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'wh-pand-modal';
        el.className = 'modal';
        el.innerHTML = '<div class="modal__content"><div class="modal__header"><h3 id="wh-pand-modal-title"></h3><button class="modal__close" onclick="MapModule.sluitPandModal()">&times;</button></div><div class="modal__body" id="wh-pand-modal-body"></div></div>';
        document.body.appendChild(el);
        return el;
    }

    function sluitPandModal() {
        var el = document.getElementById('wh-pand-modal');
        if (el) { el.classList.remove('modal--open'); }
        addPandContext = null;
        editPandId = null;
        prikActief = false;
        if (map) { map.getContainer().style.cursor = ''; }
    }

    function flyTo(slug) {
        var entry = locatieMarkers[slug];
        if (!entry) return;
        map.flyTo([entry.loc.lat, entry.loc.lon], 17, { duration: 1 });
        setTimeout(function () { entry.marker.openPopup(); }, 1200);
    }

    // === UI renders ===

    function renderLegend() {
        var el = document.getElementById('legend-items');
        var html = '';
        Object.keys(STATUS_COLORS).forEach(function (key) {
            html += '<div class="map-legend__row"><div class="map-legend__dot" style="background:' + STATUS_COLORS[key] + '"></div><span>' + STATUS_LABELS[key] + '</span></div>';
        });
        el.innerHTML = html;
    }

    /**
     * Sluit de lijst wanneer die de kaart afdekt.
     *
     * De grens van 600px is dezelfde als in css/app.css; wijzigt die daar, dan
     * hier mee. Op een breed scherm staat de lijst naast de kaart en blijft hij
     * open, zodat je door de locaties kunt lopen zonder hem telkens opnieuw te
     * openen.
     */
    function sluitLijstOpSmalScherm() {
        var smal = !!(window.matchMedia && window.matchMedia('(max-width: 600px)').matches);
        if (!smal || !sidebarOpen) { return; }

        sidebarOpen = false;
        var el = document.getElementById('map-sidebar');
        if (el && el.classList) { el.classList.remove('map-sidebar--open'); }

        // De kaart is niet van formaat veranderd - de lijst lag eroverheen -
        // maar een kaart die ooit verborgen is opgebouwd houdt een verkeerde
        // maat vast en tekent dan halve tegels. invalidateSize laat het midden
        // staan en herstelt dat.
        if (map && typeof map.invalidateSize === 'function') { map.invalidateSize(); }
    }

    function renderSidebar() {
        var listEl = document.getElementById('sidebar-list');
        var search = (document.getElementById('sidebar-search').value || '').toLowerCase();

        var filtered = locaties.filter(function (l) {
            if (!showParks && l.type === 'vakantiepark') return false;
            if (!showHavens && l.type === 'jachthaven') return false;
            if (search && l.naam.toLowerCase().indexOf(search) === -1 && l.adres.toLowerCase().indexOf(search) === -1) return false;
            return true;
        });

        var html = '';
        filtered.forEach(function (loc) {
            var isPark = loc.type === 'vakantiepark';
            var bg = isPark ? '#1B5E20' : (loc.type === 'testlocatie' ? '#6A1B9A' : '#0D47A1');
            var count = loc.totaal_panden || 0;
            var verkend = loc.verkend || 0;
            html += '<div class="map-sidebar__item" onclick="MapModule.selectLocatie(\'' + loc.slug + '\')">';
            html += '<div class="map-sidebar__dot" style="background:' + bg + ';border-radius:4px"></div>';
            html += '<div class="map-sidebar__info"><div class="map-sidebar__name">' + loc.naam + '</div><div class="map-sidebar__addr">' + loc.adres + ' <span style="color:#999;font-size:10px">' + verkend + '/' + count + ' panden</span></div></div>';
            html += '</div>';
        });

        listEl.innerHTML = html || '<div style="padding:12px;color:#999">Geen locaties gevonden</div>';
    }

    function bindControls() {
        document.getElementById('btn-sidebar-toggle').addEventListener('click', function () {
            sidebarOpen = !sidebarOpen;
            document.getElementById('map-sidebar').classList.toggle('map-sidebar--open', sidebarOpen);
            if (sidebarOpen) { renderSidebar(); }
            map.invalidateSize();
        });

        document.getElementById('sidebar-close').addEventListener('click', function () {
            sidebarOpen = false;
            document.getElementById('map-sidebar').classList.remove('map-sidebar--open');
            map.invalidateSize();
        });

        document.getElementById('sidebar-search').addEventListener('input', function () {
            renderSidebar();
        });

        var pandZoekVeld = document.getElementById('pand-search');
        if (pandZoekVeld) {
            var zoekTimer = null;
            pandZoekVeld.addEventListener('input', function () {
                var term = this.value;
                if (zoekTimer) { clearTimeout(zoekTimer); }
                // Even wachten tot het typen stilvalt: anders vuurt elke
                // toetsaanslag een zoekopdracht af over duizenden panden.
                zoekTimer = setTimeout(function () { zoekPanden(term); }, 300);
            });
        }

        var btnParken = document.getElementById('btn-filter-parks');
        var btnHavens = document.getElementById('btn-filter-havens');

        // Filter logica: klik op "Parken" toont alleen parken, "Havens" alleen havens
        // Klik nogmaals op actieve filter → toon alles
        btnParken.addEventListener('click', function () {
            if (showParks && !showHavens) {
                // Was al gefilterd op parken → toon alles
                showParks = true;
                showHavens = true;
            } else {
                // Filter op alleen parken
                showParks = true;
                showHavens = false;
            }
            btnParken.classList.toggle('btn--primary', showParks && !showHavens);
            btnHavens.classList.toggle('btn--primary', showHavens && !showParks);
            applyTypeFilter();
        });

        btnHavens.addEventListener('click', function () {
            if (showHavens && !showParks) {
                // Was al gefilterd op havens → toon alles
                showParks = true;
                showHavens = true;
            } else {
                // Filter op alleen havens
                showHavens = true;
                showParks = false;
            }
            btnParken.classList.toggle('btn--primary', showParks && !showHavens);
            btnHavens.classList.toggle('btn--primary', showHavens && !showParks);
            applyTypeFilter();
        });

        function applyTypeFilter() {
            Object.keys(locatieMarkers).forEach(function (slug) {
                var entry = locatieMarkers[slug];
                var type = entry.loc.type;
                // Een testlocatie hoort bij geen van beide filters en blijft
                // altijd staan; anders verdwijnt de oefenlocatie zodra iemand
                // op Parken of Havens klikt en lijkt hij weg te zijn.
                var show = (type === 'testlocatie') ? true
                    : (type === 'vakantiepark' ? showParks : showHavens);
                if (show) { grpLocaties.addLayer(entry.marker); } else { grpLocaties.removeLayer(entry.marker); }
            });
            if (sidebarOpen) { renderSidebar(); }
        }

        var btnGps = document.getElementById('btn-reset-gps');
        if (btnGps) { btnGps.addEventListener('click', resetGpsPosities); }

        map.on('click', onKaartKlikPunt);
        var btnPunt = document.getElementById('btn-punt-modus');
        if (btnPunt) { btnPunt.addEventListener('click', wisselPuntModus); }

        document.getElementById('btn-reset-view').addEventListener('click', function () {
            if (allBounds) { map.fitBounds(allBounds, { padding: [60, 40] }); }
            selectedLocatieSlug = null;
            grpPanden.clearLayers();
            pandMarkers = {};
        });

        var legendCollapsed = false;
        document.getElementById('legend-toggle').addEventListener('click', function () {
            legendCollapsed = !legendCollapsed;
            document.getElementById('legend-items').style.display = legendCollapsed ? 'none' : '';
            this.textContent = legendCollapsed ? '\u25B2' : '\u25BC';
        });
    }

    return {
        init: init,
        loadLocaties: loadLocaties,
        loadPanden: loadPanden,
        updatePandMarker: updatePandMarker,
        setPandStatus: setPandStatus,
        selectLocatie: selectLocatie,
        addPand: addPand,
        checkPandLabel: checkPandLabel,
        submitAddPand: submitAddPand,
        startPrik: startPrik,
        laadAanduidingen: laadAanduidingen,
        wisselPuntModus: wisselPuntModus,
        openSnelPunt: openSnelPunt,
        zetAanduiding: zetAanduiding,
        wisselExtraStatus: wisselExtraStatus,
        setBeheerModus: setBeheerModus,
        openPandEdit: openPandEdit,
        savePandEdit: savePandEdit,
        archiveerPand: archiveerPand,
        importeerBag: importeerBag,
        zoekPanden: zoekPanden,
        gaNaarPand: gaNaarPand,
        sluitPandModal: sluitPandModal,
        flyTo: flyTo,
        getLocaties: function () { return locaties; },
        getPanden: function () { return panden; },
        getMap: function () { return map; },
        STATUS_COLORS: STATUS_COLORS,
        STATUS_LABELS: STATUS_LABELS,
    };
})();
