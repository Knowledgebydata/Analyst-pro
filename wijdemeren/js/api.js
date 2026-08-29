'use strict';

/**
 * API module — alle HTTP communicatie met de backend.
 *
 * Endpoints:
 *   /api/locaties  — gebieden (vakantieparken / jachthavens)
 *   /api/panden    — individuele panden/huisjes binnen een locatie
 *   /api/controles — controlehistorie per pand
 */
var API = (function () {
    // Deze kopie draait op twee plekken. Op de server zelf is de backend
    // same-origin; op GitHub Pages (app.knowledgebydata.nl/wijdemeren/)
    // staat hij op een ander domein en moet de volledige URL erin, anders
    // gaat elk verzoek naar GitHub en krijg je 404 in plaats van data.
    var BASE = (function () {
        if (window.location.hostname === 'vakantieparken.knowledgebydata.nl') {
            return '/api';
        }
        return 'https://vakantieparken.knowledgebydata.nl/api';
    })();
    var token = null;

    function setToken(t) { token = t; }
    function getToken() { return token; }
    function clearToken() { token = null; }
    function getBase() { return BASE; }

    async function request(method, path, body) {
        var headers = { 'Content-Type': 'application/json' };
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }

        var opts = { method: method, headers: headers };
        if (body && method !== 'GET') {
            opts.body = JSON.stringify(body);
        }

        // CORS credentials meesturen als we cross-origin zijn
        if (BASE.startsWith('http')) {
            opts.credentials = 'omit';
        }

        var res;
        try {
            res = await fetch(BASE + path, opts);
        } catch (netwerkFout) {
            // Een TypeError uit fetch is geen inlogfout maar een verbinding
            // die niet tot stand kwam: geen netwerk, certificaatprobleem of
            // een server die niet antwoordt. Dat onderscheid heeft ons op
            // 24-08 zeven weken gekost; daarom hier expliciet benoemd.
            throw new Error('Geen verbinding met de server. Controleer de netwerkverbinding; blijft dit terugkomen, dan is er iets met de server of het certificaat.');
        }

        if (res.status === 401) {
            clearToken();
            localStorage.removeItem('wh_token');
            document.getElementById('main-screen').classList.remove('screen--active');
            document.getElementById('login-screen').classList.add('screen--active');
            throw new Error('Sessie verlopen, log opnieuw in');
        }

        var data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Onbekende fout');
        }

        return data;
    }

    return {
        setToken: setToken,
        getToken: getToken,
        clearToken: clearToken,
        getBase: getBase,

        // === Auth ===
        login: function (username, password) {
            return request('POST', '/auth/login', { username: username, password: password });
        },
        me: function () {
            return request('GET', '/auth/me');
        },
        changePassword: function (currentPassword, newPassword) {
            return request('POST', '/auth/change-password', { currentPassword: currentPassword, newPassword: newPassword });
        },

        // === Locaties (gebieden) ===
        getLocaties: function (params) {
            var qs = params ? '?' + new URLSearchParams(params).toString() : '';
            return request('GET', '/locaties' + qs);
        },
        getLocatie: function (slug) {
            return request('GET', '/locaties/' + slug);
        },
        addLocatie: function (data) {
            return request('POST', '/locaties', data);
        },
        updateLocatie: function (slug, data) {
            return request('PUT', '/locaties/' + slug, data);
        },

        // === Panden (individuele huisjes/ligplaatsen) ===
        getPanden: function (locatieSlug) {
            var qs = locatieSlug ? '?locatie=' + encodeURIComponent(locatieSlug) : '';
            return request('GET', '/panden' + qs);
        },
        getPand: function (id) {
            return request('GET', '/panden/' + id);
        },
        addPand: function (data) {
            return request('POST', '/panden', data);
        },
        updatePandStatus: function (pandId, status, samenvatting, extraStatussen) {
            var lijf = { status: status, samenvatting: samenvatting };
            if (Array.isArray(extraStatussen)) { lijf.extraStatussen = extraStatussen; }
            return request('PATCH', '/panden/' + pandId + '/status', lijf);
        },
        updatePand: function (id, data) {
            return request('PUT', '/panden/' + id, data);
        },
        setPandAanduiding: function (id, label) {
            return request('PATCH', '/panden/' + id + '/aanduiding', { label: label });
        },
        movePand: function (id, lat, lon) {
            return request('PATCH', '/panden/' + id + '/positie', { lat: lat, lon: lon });
        },
        resetPandPosities: function (locatieSlug) {
            return request('POST', '/panden/reset-posities', locatieSlug ? { locatie_slug: locatieSlug } : {});
        },
        zoekPanden: function (term) {
            return request('GET', '/panden?q=' + encodeURIComponent(term));
        },
        archiveerPand: function (id) {
            return request('DELETE', '/panden/' + id);
        },
        herstelPand: function (id) {
            return request('POST', '/panden/' + id + '/herstellen', {});
        },
        getGearchiveerdePanden: function () {
            return request('GET', '/panden?gearchiveerd=ja');
        },
        importeerBagPanden: function (locatieSlug, straal) {
            return request('POST', '/panden/importeer-bag', { locatie_slug: locatieSlug, straal: straal });
        },
        // Blijft bestaan omdat oudere schermen deze naam nog aanroepen; hij
        // archiveert nu, net als archiveerPand.
        deletePand: function (id) {
            return request('DELETE', '/panden/' + id);
        },

        // === Controles ===
        getControles: function (params) {
            var qs = params ? '?' + new URLSearchParams(params).toString() : '';
            return request('GET', '/controles' + qs);
        },
        getSamenvatting: function () {
            return request('GET', '/controles/samenvatting');
        },
        exportControles: function () {
            return request('GET', '/controles/export');
        },

        // === Users ===
        getUsers: function () {
            return request('GET', '/users');
        },
        createUser: function (data) {
            return request('POST', '/users', data);
        },
        updateUser: function (id, data) {
            return request('PATCH', '/users/' + id, data);
        },

        // === Geocoding ===
        geocodeAddress: function (address) {
            return request('POST', '/geocode/adres', { address: address });
        },
        geocodeAll: function () {
            return request('POST', '/geocode/alle-locaties', {});
        },
    };
})();
