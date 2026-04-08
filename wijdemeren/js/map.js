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
        L.control.layers({ 'Topografisch (PDOK)': brtLayer, 'OpenStreetMap': osmLayer, 'Luchtfoto': luchtLayer }, null, { position: 'topright' }).addTo(map);
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
        var bg = isPark ? '#1B5E20' : '#0D47A1';
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
        var typeClass = isPark ? 'park' : 'haven';
        var typeLabel = isPark ? 'Vakantiepark' : 'Jachthaven';
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
        html += '</div>';

        // Externe links
        html += '<div class="popup__links">';
        html += '<a href="https://www.google.com/maps/search/?api=1&query=' + loc.lat + ',' + loc.lon + '" target="_blank">Google Maps</a>';
        html += '<a href="https://bagviewer.kadaster.nl/lvbag/bag-viewer/#?geometry.x=' + loc.lon + '&geometry.y=' + loc.lat + '&zoomlevel=7" target="_blank">BAG</a>';
        html += '<a href="https://kadastralekaart.com/kaart/@' + loc.lat + ',' + loc.lon + ',17z" target="_blank">Kadaster</a>';
        html += '</div>';

        if (loc.nauwkeurigheid !== 'exact') {
            html += '<div class="popup__note">Positie ' + loc.nauwkeurigheid + '</div>';
        }

        return html;
    }

    function buildPandPopup(pand) {
        var color = STATUS_COLORS[pand.status] || '#9E9E9E';
        var label = STATUS_LABELS[pand.status] || 'Niet verkend';

        var html = '<div class="popup__type popup__type--pand">Pand</div>';
        html += '<div class="popup__title">' + pand.label + '</div>';
        html += '<div class="popup__addr">' + (pand.locatie_naam || '') + (pand.adres_detail ? ' — ' + pand.adres_detail : '') + '</div>';
        html += '<div class="popup__status"><div class="popup__status-dot" style="background:' + color + '"></div><span class="popup__status-label">' + label + '</span></div>';

        // Status knoppen
        html += '<div class="popup__btns">';
        Object.keys(STATUS_COLORS).forEach(function (key) {
            var active = (pand.status === key) ? ' popup__btn--active' : '';
            html += '<div class="popup__btn' + active + '" style="border-left:4px solid ' + STATUS_COLORS[key] + '" onclick="MapModule.setPandStatus(\'' + pand.id + '\',\'' + key + '\')">' + STATUS_LABELS[key] + '</div>';
        });
        html += '</div>';

        // Actie knoppen: bevinding + vragenlijst
        html += '<div class="popup__actions">';
        html += '<button class="btn btn--sm btn--primary" onclick="BevModule.openForm(\'' + pand.locatie_slug + '\',\'' + (pand.locatie_naam || '').replace(/'/g, "\\'") + '\',\'' + pand.label.replace(/'/g, "\\'") + '\')">+ Bevinding</button>';
        html += '<button class="btn btn--sm" onclick="VragenlijstModule.openForm(\'' + pand.locatie_slug + '\',\'' + (pand.locatie_naam || '').replace(/'/g, "\\'") + '\',\'' + pand.label.replace(/'/g, "\\'") + '\')" style="margin-left:4px">Vragenlijst</button>';
        html += '</div>';

        if (pand.status_updated_by_naam) {
            html += '<div class="popup__note">Laatst door: ' + pand.status_updated_by_naam + '</div>';
        }

        return html;
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
            // Panden zonder GPS: gebruik locatie-coördinaten met kleine offset
            var lat = pand.lat;
            var lon = pand.lon;

            if (lat === null || lon === null) {
                // Zoek de locatie en gebruik diens coördinaten met random offset
                var locEntry = locatieMarkers[pand.locatie_slug];
                if (locEntry) {
                    lat = locEntry.loc.lat + (Math.random() - 0.5) * 0.0008;
                    lon = locEntry.loc.lon + (Math.random() - 0.5) * 0.0008;
                } else {
                    return; // Geen positie mogelijk
                }
            }

            var color = STATUS_COLORS[pand.status] || '#9E9E9E';
            var marker = L.marker([lat, lon], { icon: mkPandIcon(color, 14) })
                .bindPopup(buildPandPopup(pand), { maxWidth: 300 });

            grpPanden.addLayer(marker);
            pandMarkers[pand.id] = { marker: marker, pand: pand, lat: lat, lon: lon };
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

        map.flyTo([entry.loc.lat, entry.loc.lon], 17, { duration: 1 });

        // Laad panden voor deze locatie
        try {
            var data = await API.getPanden(slug);
            loadPanden(data.panden);
        } catch (err) {
            console.error('Panden laden mislukt:', err);
        }
    }

    // === Pand toevoegen ===

    async function addPand(locatieSlug, locatieNaam) {
        var label = prompt('Label voor het pand (bijv. "Huisje 12", "Ligplaats A3"):');
        if (!label || !label.trim()) return;

        var adresDetail = prompt('Adresdetail (optioneel, bijv. "Oud Loosdrechtsedijk 113a"):', '');

        // GPS: gebruik huidige positie als die beschikbaar is
        var lat = null;
        var lon = null;

        if ('geolocation' in navigator) {
            var useGps = confirm('Wil je je huidige GPS-positie gebruiken voor dit pand?');
            if (useGps) {
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
        }

        try {
            await API.addPand({
                locatie_slug: locatieSlug,
                label: label.trim(),
                adres_detail: adresDetail || null,
                lat: lat,
                lon: lon,
            });
            // Herlaad panden voor deze locatie
            selectLocatie(locatieSlug);
        } catch (err) {
            alert('Fout bij toevoegen pand: ' + err.message);
        }
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
            var bg = isPark ? '#1B5E20' : '#0D47A1';
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
                var isPark = entry.loc.type === 'vakantiepark';
                var show = isPark ? showParks : showHavens;
                if (show) { grpLocaties.addLayer(entry.marker); } else { grpLocaties.removeLayer(entry.marker); }
            });
            if (sidebarOpen) { renderSidebar(); }
        }

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
        flyTo: flyTo,
        getLocaties: function () { return locaties; },
        getPanden: function () { return panden; },
        getMap: function () { return map; },
        STATUS_COLORS: STATUS_COLORS,
        STATUS_LABELS: STATUS_LABELS,
    };
})();
