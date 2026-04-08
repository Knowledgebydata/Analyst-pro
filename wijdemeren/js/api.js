'use strict';

/**
 * API module — alle HTTP communicatie met de backend.
 *
 * Endpoints:
 *   /api/locaties  — gebieden (vakantieparken / jachthavens)
 *   /api/panden    — individuele panden/huisjes binnen een locatie
 *   /api/controles — controlehistorie per pand
 *
 * Voor de GitHub Pages versie wijst BASE naar de externe server.
 * De server moet CORS toestaan voor het domein van de PWA.
 */
var API = (function () {
    // === CONFIGURATIE ===
    // Bij GitHub Pages hosting: volledig URL naar de backend server.
    // Bij hosting op dezelfde server: gebruik '/api'.
    var BASE = (function () {
        var host = window.location.hostname;
        // Als we op de server zelf draaien, gebruik relatieve URL
        if (host === 'vakantieparken.knowledgebydata.nl') {
            return '/api';
        }
        // Anders (GitHub Pages, localhost, etc): volledig URL
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

        var res = await fetch(BASE + path, opts);

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
        updatePandStatus: function (pandId, status, samenvatting) {
            return request('PATCH', '/panden/' + pandId + '/status', { status: status, samenvatting: samenvatting });
        },
        updatePand: function (id, data) {
            return request('PUT', '/panden/' + id, data);
        },
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
