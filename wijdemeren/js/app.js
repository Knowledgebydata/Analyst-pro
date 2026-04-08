'use strict';

/**
 * App module — login, tabs, WebSocket, admin beheer, instellingen.
 *
 * Gemeente-configuratie wordt dynamisch geladen via /api/config.
 * Dit maakt de applicatie herbruikbaar voor andere gemeentes
 * zonder code-aanpassingen — alleen de server .env wijzigen.
 */
(function () {
    var currentUser = null;
    var socket = null;

    /** Gemeente config (geladen vanuit /api/config) met fallback defaults */
    var gemeenteConfig = {
        gemeente: { naam: 'Handhaving', titel: 'Handhaving', subtitel: '', themaKleur: '#154273', logo: null },
        kaart: { centerLat: 52.210, centerLon: 5.075, defaultZoom: 12 },
        locatieTypes: ['vakantiepark', 'jachthaven'],
        versie: '1.0.0',
    };

    document.addEventListener('DOMContentLoaded', async function () {
        await loadGemeenteConfig();
        MapModule.init(gemeenteConfig.kaart);
        BevModule.init();
        bindTabs();
        bindLogin();
        bindAdmin();
        bindInstellingen();

        var savedToken = localStorage.getItem('wh_token');
        if (savedToken) {
            API.setToken(savedToken);
            checkAuth();
        }
    });

    /**
     * Laad gemeente-specifieke configuratie van de server.
     * Past titels, kleuren en meta-tags aan.
     * Faalt graceful — de app werkt ook met defaults.
     */
    async function loadGemeenteConfig() {
        try {
            var configUrl = API.getBase() + '/config';
            var data = await fetch(configUrl).then(function (r) { return r.json(); });
            gemeenteConfig = data;
        } catch (err) {
            console.warn('Gemeente config laden mislukt, gebruik defaults:', err);
        }

        var gc = gemeenteConfig.gemeente;
        var volledigeTitel = gc.naam + ' ' + gc.titel;

        // Document titel
        document.title = volledigeTitel;

        // Login scherm
        var loginTitle = document.querySelector('.login__title');
        if (loginTitle) { loginTitle.textContent = volledigeTitel; }

        var loginSub = document.querySelector('.login__sub');
        if (loginSub) { loginSub.textContent = gc.subtitel || ''; }

        // Header
        var headerTitle = document.querySelector('.header__title');
        if (headerTitle) { headerTitle.textContent = volledigeTitel; }

        // Thema kleur (CSS custom property + meta tag)
        if (gc.themaKleur) {
            document.documentElement.style.setProperty('--color-primary', gc.themaKleur);
            var metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme) { metaTheme.setAttribute('content', gc.themaKleur); }
        }

        // Logo SVG in login — vervang door afbeelding als URL geconfigureerd
        if (gc.logo) {
            var logoEl = document.querySelector('.login__logo');
            if (logoEl) {
                logoEl.innerHTML = '<img src="' + gc.logo + '" alt="' + gc.naam + '" width="48" height="48">';
            }
        }
    }

    // === Tabs ===
    function bindTabs() {
        var tabBtns = document.querySelectorAll('[data-tab]');
        tabBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var targetId = btn.getAttribute('data-tab');

                // Deactiveer alle tabs
                tabBtns.forEach(function (b) { b.classList.remove('tabs__btn--active'); });
                document.querySelectorAll('.tab-content').forEach(function (tc) { tc.classList.remove('tab-content--active'); });

                // Activeer geselecteerde tab
                btn.classList.add('tabs__btn--active');
                var target = document.getElementById(targetId);
                if (target) { target.classList.add('tab-content--active'); }

                // Kaart resize na tab switch
                if (targetId === 'tab-kaart') {
                    var map = MapModule.getMap();
                    if (map) { setTimeout(function () { map.invalidateSize(); }, 100); }
                }

                // Bevindingen lijst renderen bij tab switch
                if (targetId === 'tab-bevindingen') {
                    BevModule.renderList('bev-list');
                }

                // Controleur naam laden bij instellingen
                if (targetId === 'tab-instellingen') {
                    document.getElementById('setting-naam').value = BevModule.getControleurNaam();
                }
            });
        });
    }

    // === Login ===
    function bindLogin() {
        document.getElementById('login-form').addEventListener('submit', async function (e) {
            e.preventDefault();
            var btn = document.getElementById('login-btn');
            var errEl = document.getElementById('login-error');
            errEl.hidden = true;
            btn.disabled = true;
            btn.textContent = 'Bezig...';

            try {
                var username = document.getElementById('login-user').value.trim();
                var password = document.getElementById('login-pass').value;
                var data = await API.login(username, password);

                API.setToken(data.token);
                localStorage.setItem('wh_token', data.token);
                currentUser = data.user;
                showMainScreen();
            } catch (err) {
                errEl.textContent = err.message;
                errEl.hidden = false;
            } finally {
                btn.disabled = false;
                btn.textContent = 'Inloggen';
            }
        });

        document.getElementById('btn-logout').addEventListener('click', function () {
            API.clearToken();
            localStorage.removeItem('wh_token');
            if (socket) { socket.disconnect(); socket = null; }
            document.getElementById('main-screen').classList.remove('screen--active');
            document.getElementById('login-screen').classList.add('screen--active');
        });
    }

    async function checkAuth() {
        try {
            var data = await API.me();
            currentUser = data.user;
            showMainScreen();
        } catch (err) {
            localStorage.removeItem('wh_token');
            API.clearToken();
        }
    }

    function showMainScreen() {
        document.getElementById('login-screen').classList.remove('screen--active');
        document.getElementById('main-screen').classList.add('screen--active');
        document.getElementById('user-display').textContent = currentUser.displayName;
        document.getElementById('btn-admin').hidden = (currentUser.role !== 'beheerder');

        // Auto-set controleur naam als die nog leeg is
        if (!BevModule.getControleurNaam() && currentUser.displayName) {
            BevModule.setControleurNaam(currentUser.displayName);
        }

        loadLocaties();
        connectSocket();
    }

    async function loadLocaties() {
        try {
            var data = await API.getLocaties();
            MapModule.loadLocaties(data.locaties);
            updateHeaderInfo(data.locaties);
        } catch (err) {
            console.error('Locaties laden mislukt:', err);
        }
    }

    function updateHeaderInfo(locaties) {
        var parks = locaties.filter(function (l) { return l.type === 'vakantiepark'; }).length;
        var havens = locaties.filter(function (l) { return l.type === 'jachthaven'; }).length;
        var totaalPanden = locaties.reduce(function (sum, l) { return sum + (parseInt(l.totaal_panden, 10) || 0); }, 0);
        var verkendPanden = locaties.reduce(function (sum, l) { return sum + (parseInt(l.verkend, 10) || 0); }, 0);
        document.getElementById('header-info').textContent =
            parks + ' parken | ' + havens + ' havens | ' + verkendPanden + '/' + totaalPanden + ' panden verkend';
    }

    // === WebSocket ===
    function connectSocket() {
        if (socket) { socket.disconnect(); }

        // Bepaal de WebSocket URL op basis van hosting
        var wsUrl = undefined; // Standaard: zelfde host
        var apiBase = API.getBase();
        if (apiBase && apiBase.startsWith('http')) {
            // Cross-origin: extraheer de server URL
            wsUrl = apiBase.replace(/\/api$/, '');
        }

        socket = io(wsUrl || undefined, {
            auth: { token: API.getToken() },
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 2000,
        });

        socket.on('connected', function (data) {
            console.log('WebSocket verbonden:', data);
        });

        socket.on('online_count', function (data) {
            document.getElementById('online-count').textContent = data.count + ' online';
        });

        socket.on('status_update', function (data) {
            // Status update is nu per PAND
            MapModule.updatePandMarker(data.pandId, data.status);
        });

        socket.on('disconnect', function () {
            document.getElementById('online-count').textContent = 'Offline';
        });
    }

    // === Instellingen ===
    function bindInstellingen() {
        // Controleur naam opslaan
        document.getElementById('btn-save-naam').addEventListener('click', async function () {
            var naam = document.getElementById('setting-naam').value.trim();
            if (!naam) { alert('Vul je naam in.'); return; }

            await BevModule.setControleurNaam(naam);
            document.getElementById('setting-naam-msg').textContent = 'Opgeslagen!';
            setTimeout(function () {
                document.getElementById('setting-naam-msg').textContent = '';
            }, 2000);
        });

        // Wachtwoord wijzigen
        document.getElementById('btn-change-password').addEventListener('click', changePassword);

        // Bevindingen wissen
        document.getElementById('btn-clear-bev').addEventListener('click', async function () {
            if (!confirm('Weet je zeker dat je alle lokale bevindingen wilt wissen? Dit kan niet ongedaan worden gemaakt.')) return;
            if (!confirm('LAATSTE WAARSCHUWING: Alle bevindingen worden verwijderd. Heb je al een export gemaakt?')) return;

            // Verwijder IndexedDB database
            indexedDB.deleteDatabase('wijdemeren-bevindingen');
            await BevModule.init();
            BevModule.renderList('bev-list');
            alert('Alle bevindingen zijn gewist.');
        });

        // Export knop
        document.getElementById('btn-export-bev').addEventListener('click', function () {
            BevModule.exportJSON();
        });
    }

    // === Admin beheer ===
    function bindAdmin() {
        document.getElementById('btn-admin').addEventListener('click', function () {
            document.getElementById('admin-modal').classList.add('modal--open');
            loadUsers();
            loadSamenvatting();
        });
        document.getElementById('admin-modal-close').addEventListener('click', function () {
            document.getElementById('admin-modal').classList.remove('modal--open');
        });
        // Sluit modal bij klik op overlay (buiten de content)
        document.getElementById('admin-modal').addEventListener('click', function (e) {
            if (e.target === this) {
                this.classList.remove('modal--open');
            }
        });
        document.getElementById('btn-add-user').addEventListener('click', addUser);
        document.getElementById('btn-geocode-all').addEventListener('click', geocodeAll);
    }

    async function loadUsers() {
        try {
            var data = await API.getUsers();
            var html = '<table class="user-table"><thead><tr><th>Naam</th><th>Gebruikersnaam</th><th>Rol</th><th>Actief</th></tr></thead><tbody>';
            data.users.forEach(function (u) {
                html += '<tr><td>' + u.display_name + '</td><td>' + u.username + '</td><td>' + u.role + '</td><td>' + (u.is_active ? 'Ja' : 'Nee') + '</td></tr>';
            });
            html += '</tbody></table>';
            document.getElementById('users-list').innerHTML = html;
        } catch (err) {
            document.getElementById('users-list').innerHTML = '<p class="text-muted">' + err.message + '</p>';
        }
    }

    async function loadSamenvatting() {
        try {
            var data = await API.getSamenvatting();
            var html = '<table class="user-table"><thead><tr><th>Status</th><th>Aantal</th></tr></thead><tbody>';
            data.samenvatting.forEach(function (s) {
                html += '<tr><td>' + s.status + '</td><td>' + s.aantal + '</td></tr>';
            });
            html += '</tbody></table>';
            document.getElementById('admin-samenvatting').innerHTML = html;
        } catch (err) {
            document.getElementById('admin-samenvatting').innerHTML = '<p class="text-muted">' + err.message + '</p>';
        }
    }

    async function addUser() {
        var username = prompt('Gebruikersnaam:');
        if (!username) return;
        var displayName = prompt('Weergavenaam:');
        if (!displayName) return;
        var password = prompt('Wachtwoord (min. 8 tekens):');
        if (!password || password.length < 8) { alert('Min. 8 tekens'); return; }
        var role = prompt('Rol (controleur / coordinator / beheerder):', 'controleur');
        if (!['controleur', 'coordinator', 'beheerder'].includes(role)) { alert('Ongeldige rol'); return; }

        try {
            await API.createUser({ username: username, displayName: displayName, password: password, role: role });
            alert('Gebruiker aangemaakt');
            loadUsers();
        } catch (err) { alert(err.message); }
    }

    async function geocodeAll() {
        if (!confirm('Alle niet-exacte locaties geocoderen via PDOK?')) return;
        var el = document.getElementById('geocode-result');
        el.innerHTML = '<p>Bezig...</p>';
        try {
            var result = await API.geocodeAll();
            el.innerHTML = '<p><strong>' + result.message + '</strong></p>';
            loadLocaties();
        } catch (err) { el.innerHTML = '<p style="color:red">' + err.message + '</p>'; }
    }

    async function changePassword() {
        var cur = prompt('Huidig wachtwoord:');
        if (!cur) return;
        var nw = prompt('Nieuw wachtwoord (min. 8 tekens):');
        if (!nw || nw.length < 8) { alert('Min. 8 tekens'); return; }
        try {
            await API.changePassword(cur, nw);
            alert('Wachtwoord gewijzigd');
        } catch (err) { alert(err.message); }
    }

    // === PWA ===
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('./sw.js').catch(function () { });
        });
    }
})();
