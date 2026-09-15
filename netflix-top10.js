/*!
 * Netflix Top 10 Native Cards for Lampa
 * Version: 1.0.1
 *
 * Ranking source: official Netflix Tudum Top 10 datasets.
 * Metadata/posters: Lampa built-in TMDB source (no extra API key required).
 *
 * Designed for Lampa 3.x (Maker API) with a legacy fallback.
 */
(function () {
    'use strict';

    if (window.netflix_top10_native_ready) return;
    window.netflix_top10_native_ready = true;

    var VERSION = '1.0.1';
    var COMPONENT = 'netflix_top10_native';
    var SETTINGS_COMPONENT = 'netflix_top10_native_settings';
    var CACHE_KEY = 'netflix_top10_tmdb_cache_v1';
    var COUNTRY_KEY = 'netflix_top10_country';
    var CACHE_TTL = 14 * 24 * 60 * 60 * 1000;

    var COUNTRIES = {
        UA: 'Украина',
        US: 'США',
        GB: 'Великобритания',
        PL: 'Польша',
        DE: 'Германия',
        FR: 'Франция',
        ES: 'Испания',
        IT: 'Италия',
        CA: 'Канада',
        JP: 'Япония',
        KR: 'Южная Корея',
        GLOBAL: 'Global'
    };

    var ICON =
        '<svg width="34" height="34" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
        '<path d="M8 4h5.1l10.8 24h-5.3L8 4z" fill="currentColor"/>' +
        '<path d="M19 4h5v24h-5z" fill="currentColor" opacity=".48"/>' +
        '<path d="M8 4h5v24H8z" fill="currentColor" opacity=".48"/>' +
        '</svg>';

    var manifest = {
        type: 'other',
        version: VERSION,
        name: 'Netflix Top 10',
        description: 'Официальный Netflix Top 10 с нативными карточками Lampa',
        component: COMPONENT
    };

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[Netflix Top 10]');
            console.log.apply(console, args);
        } catch (e) {}
    }

    function appDigital() {
        try {
            return parseInt((Lampa.Manifest && Lampa.Manifest.app_digital) || 0, 10) || 0;
        } catch (e) {
            return 0;
        }
    }

    function isV3() {
        return appDigital() >= 300 && Lampa.Maker && Lampa.Maker.make;
    }

    function currentCountry() {
        var value = 'UA';
        try {
            value = Lampa.Storage.get(COUNTRY_KEY, 'UA') || 'UA';
        } catch (e) {}
        return COUNTRIES[value] ? value : 'UA';
    }

    function pluginBaseUrl() {
        var src = '';

        try {
            if (document.currentScript && document.currentScript.src) {
                src = document.currentScript.src;
            }
        } catch (e) {}

        if (!src) {
            try {
                var scripts = document.getElementsByTagName('script');
                for (var i = scripts.length - 1; i >= 0; i--) {
                    var candidate = scripts[i].src || '';
                    if (candidate.indexOf('netflix-top10.js') !== -1) {
                        src = candidate;
                        break;
                    }
                }
            } catch (e2) {}
        }

        if (!src) return '';
        src = src.split('?')[0].split('#')[0];
        return src.substring(0, src.lastIndexOf('/'));
    }

    function dataUrl() {
        var base = pluginBaseUrl();
        if (!base) return '';
        return base + '/data/top10.json?v=' + Date.now();
    }

    function requestJson(url, success, error) {
        if (!url) {
            error('Не удалось определить URL файла data/top10.json');
            return null;
        }

        var RequestClass = Lampa.Network || Lampa.Request || Lampa.Reguest;

        if (RequestClass) {
            try {
                var network = new RequestClass();
                if (network.timeout) network.timeout(20000);

                var method = network.silent || network.native || network.get;
                if (method) {
                    method.call(
                        network,
                        url,
                        function (response) {
                            try {
                                success(typeof response === 'string' ? JSON.parse(response) : response);
                            } catch (e) {
                                error('Некорректный JSON: ' + e.message);
                            }
                        },
                        function () {
                            error('Не удалось загрузить рейтинг Netflix');
                        },
                        false,
                        {
                            dataType: 'json',
                            cache: { life: 10 }
                        }
                    );
                    return network;
                }
            } catch (e1) {
                log('Lampa network fallback:', e1);
            }
        }

        if (window.fetch) {
            fetch(url, { cache: 'no-store' })
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                })
                .then(success)
                .catch(function (e) {
                    error('Ошибка сети: ' + e.message);
                });
            return null;
        }

        error('В этой сборке Lampa не найден доступный сетевой клиент');
        return null;
    }

    function normalizeTitle(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[’‘´`]/g, "'")
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9а-яёіїєґ]+/gi, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^\s+|\s+$/g, '');
    }

    function tmdbTitle(item) {
        return item.title || item.name || item.original_title || item.original_name || '';
    }

    function tmdbAltTitles(item) {
        return [
            item.title,
            item.name,
            item.original_title,
            item.original_name
        ].filter(Boolean);
    }

    function scoreCandidate(candidate, wanted, kind) {
        var wantedNorm = normalizeTitle(wanted);
        var titles = tmdbAltTitles(candidate);
        var best = 0;
        var i;

        for (i = 0; i < titles.length; i++) {
            var current = normalizeTitle(titles[i]);
            if (!current) continue;

            if (current === wantedNorm) best = Math.max(best, 100);
            else if (current.indexOf(wantedNorm) === 0 || wantedNorm.indexOf(current) === 0) best = Math.max(best, 78);
            else if (current.indexOf(wantedNorm) !== -1 || wantedNorm.indexOf(current) !== -1) best = Math.max(best, 58);
        }

        if (candidate.poster_path) best += 7;
        if (candidate.vote_count && candidate.vote_count > 100) best += 3;
        if (candidate.popularity) best += Math.min(5, Math.log(candidate.popularity + 1));

        if (kind === 'movie' && candidate.title) best += 2;
        if (kind === 'tv' && candidate.name) best += 2;

        return best;
    }

    function selectBestCandidate(results, wanted, kind) {
        var list = results || [];
        if (!list.length) return null;

        var scored = list.map(function (item, index) {
            return {
                item: item,
                score: scoreCandidate(item, wanted, kind),
                index: index
            };
        });

        scored.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return a.index - b.index;
        });

        return scored[0].item;
    }

    function loadCache() {
        var cache = {};
        try {
            cache = Lampa.Storage.get(CACHE_KEY, {}) || {};
        } catch (e) {}

        if (!cache || typeof cache !== 'object') cache = {};
        return cache;
    }

    function saveCache(cache) {
        try {
            var keys = Object.keys(cache);
            if (keys.length > 300) {
                keys.sort(function (a, b) {
                    return (cache[b].saved_at || 0) - (cache[a].saved_at || 0);
                });

                var trimmed = {};
                keys.slice(0, 240).forEach(function (key) {
                    trimmed[key] = cache[key];
                });
                cache = trimmed;
            }

            Lampa.Storage.set(CACHE_KEY, cache);
        } catch (e) {}
    }

    function cacheKey(kind, title) {
        return kind + '|' + normalizeTitle(title);
    }

    function tmdbSearch(kind, title, success, error) {
        var api = Lampa.Api && Lampa.Api.sources && Lampa.Api.sources.tmdb;

        if (!api || !api.get) {
            error('TMDB API Lampa недоступен');
            return;
        }

        var path = kind === 'tv' ? 'search/tv' : 'search/movie';

        try {
            api.get(
                path,
                {
                    query: title,
                    include_adult: false,
                    page: 1
                },
                function (response) {
                    success(response && response.results ? response.results : []);
                },
                function () {
                    error('TMDB search failed');
                }
            );
        } catch (e) {
            error(e.message || 'TMDB search failed');
        }
    }

    function decorateResolvedCard(card, netflixItem) {
        var result = {};
        var key;

        for (key in card) {
            if (Object.prototype.hasOwnProperty.call(card, key)) result[key] = card[key];
        }

        result.source = 'tmdb';
        result.netflix_rank = netflixItem.rank;
        result.netflix_title = netflixItem.title;
        result.netflix_season_title = netflixItem.season_title || '';
        result.netflix_weeks = netflixItem.weeks_in_top10 || netflixItem.cumulative_weeks_in_top_10 || 0;

        return result;
    }

    function resolveOne(netflixItem, kind, callback) {
        var title = netflixItem.search_title || netflixItem.title || '';
        var cache = loadCache();
        var key = cacheKey(kind, title);
        var cached = cache[key];

        if (cached && cached.card && (Date.now() - (cached.saved_at || 0) < CACHE_TTL)) {
            callback(decorateResolvedCard(cached.card, netflixItem));
            return;
        }

        tmdbSearch(
            kind,
            title,
            function (results) {
                var best = selectBestCandidate(results, title, kind);

                if (!best) {
                    callback(null);
                    return;
                }

                best.source = 'tmdb';
                cache[key] = {
                    saved_at: Date.now(),
                    card: best
                };
                saveCache(cache);

                callback(decorateResolvedCard(best, netflixItem));
            },
            function () {
                callback(null);
            }
        );
    }

    function mapLimit(items, limit, iterator, done) {
        var source = items.slice();
        var output = new Array(source.length);
        var nextIndex = 0;
        var active = 0;
        var finished = 0;

        if (!source.length) {
            done([]);
            return;
        }

        function pump() {
            while (active < limit && nextIndex < source.length) {
                (function (index) {
                    active++;
                    nextIndex++;

                    iterator(source[index], function (value) {
                        output[index] = value;
                        active--;
                        finished++;

                        if (finished === source.length) done(output);
                        else pump();
                    });
                })(nextIndex);
            }
        }

        pump();
    }

    function resolveList(items, kind, callback) {
        mapLimit(items || [], 4, function (item, next) {
            resolveOne(item, kind, next);
        }, function (resolved) {
            callback(resolved.filter(Boolean));
        });
    }

    function weekLabel(week) {
        if (!week) return '';
        var parts = String(week).split('-');
        if (parts.length !== 3) return String(week);
        return parts[2] + '.' + parts[1] + '.' + parts[0];
    }

    function buildCountryRows(data, code, callback) {
        var bucket = data.countries && data.countries[code];
        if (!bucket) {
            callback([], '');
            return;
        }

        var movies = bucket.movies || [];
        var tv = bucket.tv || [];
        var doneCount = 0;
        var movieCards = [];
        var tvCards = [];

        function finish() {
            doneCount++;
            if (doneCount < 2) return;

            var countryName = COUNTRIES[code] || bucket.name || code;
            var week = bucket.week || data.latest_country_week || '';
            var suffix = countryName + (week ? ' · ' + weekLabel(week) : '');

            callback([
                {
                    title: '🔥 Netflix Top 10 — Фильмы · ' + suffix,
                    results: movieCards
                },
                {
                    title: '📺 Netflix Top 10 — Сериалы · ' + suffix,
                    results: tvCards
                }
            ], week);
        }

        resolveList(movies, 'movie', function (cards) {
            movieCards = cards;
            finish();
        });

        resolveList(tv, 'tv', function (cards) {
            tvCards = cards;
            finish();
        });
    }

    function buildGlobalRows(data, callback) {
        var global = data.global || {};
        var groups = global.groups || {};
        var defs = [
            { key: 'films_english', title: '🎬 Netflix Global — Films (English)', kind: 'movie' },
            { key: 'films_non_english', title: '🌍 Netflix Global — Films (Non-English)', kind: 'movie' },
            { key: 'tv_english', title: '📺 Netflix Global — TV (English)', kind: 'tv' },
            { key: 'tv_non_english', title: '🌐 Netflix Global — TV (Non-English)', kind: 'tv' }
        ];

        var rows = new Array(defs.length);
        var count = 0;

        defs.forEach(function (def, index) {
            resolveList(groups[def.key] || [], def.kind, function (cards) {
                var week = global.week || data.latest_global_week || '';
                rows[index] = {
                    title: def.title + (week ? ' · ' + weekLabel(week) : ''),
                    results: cards
                };
                count++;
                if (count === defs.length) callback(rows, week);
            });
        });
    }

    function loadRows(success, error) {
        requestJson(dataUrl(), function (data) {
            if (!data || !data.generated) {
                error('Файл top10.json ещё не был обновлён GitHub Action');
                return;
            }

            var country = currentCountry();

            if (country === 'GLOBAL') {
                buildGlobalRows(data, success);
            } else {
                buildCountryRows(data, country, function (rows, week) {
                    if (!rows.length) {
                        error('Для выбранной страны нет данных Netflix');
                        return;
                    }
                    success(rows, week);
                });
            }
        }, error);
    }

    function openSearch(title) {
        Lampa.Activity.push({
            url: '',
            title: 'Поиск: ' + title,
            component: 'search',
            search: title,
            page: 1
        });
    }

    function openFull(card) {
        if (!card || !card.id) {
            openSearch(card && (card.netflix_title || tmdbTitle(card)) || '');
            return;
        }

        try {
            if (Lampa.Router && Lampa.Router.call) {
                Lampa.Router.call('full', card);
                return;
            }
        } catch (e) {}

        var kind = card.name || card.original_name || card.first_air_date ? 'tv' : 'movie';

        try {
            Lampa.Activity.push({
                url: kind + '/' + card.id,
                title: tmdbTitle(card),
                component: 'full',
                id: card.id,
                method: kind,
                source: 'tmdb',
                card: card,
                movie: card,
                page: 1
            });
        } catch (e2) {
            openSearch(card.netflix_title || tmdbTitle(card));
        }
    }

    function applyRankBadge(cardInstance, data) {
        if (!data || !data.netflix_rank || !cardInstance) return;

        function decorate() {
            try {
                var render = cardInstance.render ? cardInstance.render() : null;
                if (!render) return;

                var node = render.jquery ? render : $(render);
                if (!node || !node.length) return;

                node.addClass('netflix-top10-card');

                if (!node.find('.netflix-top10-rank').length) {
                    node.append(
                        '<div class="netflix-top10-rank">#' +
                        String(data.netflix_rank) +
                        '</div>'
                    );
                }
            } catch (e) {}
        }

        try {
            if (cardInstance.use) {
                cardInstance.use({
                    onCreate: decorate,
                    onRender: decorate
                });
            }
        } catch (e1) {}

        setTimeout(decorate, 0);
        setTimeout(decorate, 120);
    }

    function createV3Component(object) {
        var comp = Lampa.Maker.make('Main', object);

        comp.use({
            onCreate: function () {
                var self = this;

                try {
                    if (self.activity && self.activity.loader) self.activity.loader(true);
                } catch (e) {}

                loadRows(
                    function (rows) {
                        try {
                            if (self.activity && self.activity.loader) self.activity.loader(false);
                        } catch (e) {}

                        self.build(rows);
                    },
                    function (message) {
                        try {
                            if (self.activity && self.activity.loader) self.activity.loader(false);
                        } catch (e) {}

                        if (self.empty) self.empty(message);
                        else if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message);
                    }
                );
            },

            onInstance: function (line) {
                if (!line || !line.use) return;

                line.use({
                    onInstance: function (card, data) {
                        applyRankBadge(card, data);

                        if (!card || !card.use) return;

                        card.use({
                            onlyEnter: function () {
                                openFull(data);
                            },
                            onFocus: function () {
                                try {
                                    if (Lampa.Background && Lampa.Background.change && Lampa.Utils && Lampa.Utils.cardImgBackground) {
                                        Lampa.Background.change(Lampa.Utils.cardImgBackground(data));
                                    }
                                } catch (e) {}
                            }
                        });
                    }
                });
            }
        });

        return comp;
    }

    function createLegacyComponent(object) {
        var comp = new Lampa.InteractionMain(object);

        comp.create = function () {
            var self = this;
            this.activity.loader(true);

            loadRows(
                function (rows) {
                    self.activity.loader(false);
                    self.build(rows);
                },
                function (message) {
                    self.activity.loader(false);
                    if (self.empty) self.empty(message);
                    else if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show(message);
                }
            );

            return this.render();
        };

        comp.onAppend = function (line) {
            if (!line) return;

            line.onAppend = function (card) {
                try {
                    var data = card.data || card.card_data || {};
                    applyRankBadge(card, data);

                    card.onEnter = function () {
                        openFull(data);
                    };
                } catch (e) {}
            };
        };

        return comp;
    }

    function component(object) {
        if (isV3()) return createV3Component(object);

        if (Lampa.InteractionMain) return createLegacyComponent(object);

        Lampa.Noty.show('Netflix Top 10: эта версия Lampa слишком старая');
        return {
            create: function () { return $('<div></div>'); },
            render: function () { return $('<div></div>'); },
            start: function () {},
            pause: function () {},
            stop: function () {},
            destroy: function () {}
        };
    }

    function addStyles() {
        if (document.getElementById('netflix-top10-native-style')) return;

        var style = document.createElement('style');
        style.id = 'netflix-top10-native-style';
        style.innerHTML =
            '.netflix-top10-card{position:relative!important}' +
            '.netflix-top10-rank{' +
                'position:absolute!important;' +
                'left:.35em!important;' +
                'top:.35em!important;' +
                'z-index:12!important;' +
                'min-width:2.2em!important;' +
                'height:2.2em!important;' +
                'padding:0 .45em!important;' +
                'display:flex!important;' +
                'align-items:center!important;' +
                'justify-content:center!important;' +
                'box-sizing:border-box!important;' +
                'border-radius:.42em!important;' +
                'font-size:1.05em!important;' +
                'font-weight:800!important;' +
                'line-height:1!important;' +
                'color:#fff!important;' +
                'background:rgba(229,9,20,.96)!important;' +
                'box-shadow:0 .12em .45em rgba(0,0,0,.5)!important;' +
                'pointer-events:none!important;' +
            '}';
        document.head.appendChild(style);
    }

    function registerManifest() {
        try {
            Lampa.Manifest.plugins = manifest;
        } catch (e) {
            log('Manifest error', e);
        }
    }

    function addSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addComponent || !Lampa.SettingsApi.addParam) return;

        try {
            Lampa.SettingsApi.addComponent({
                component: SETTINGS_COMPONENT,
                name: 'Netflix Top 10',
                icon: ICON
            });

            Lampa.SettingsApi.addParam({
                component: SETTINGS_COMPONENT,
                param: {
                    name: COUNTRY_KEY,
                    type: 'select',
                    values: COUNTRIES,
                    default: 'UA'
                },
                field: {
                    name: 'Регион рейтинга',
                    description: 'Какой Netflix Top 10 показывать во вкладке Netflix'
                },
                onChange: function (value) {
                    try {
                        Lampa.Storage.set(COUNTRY_KEY, value || 'UA');
                    } catch (e) {}
                }
            });

            Lampa.SettingsApi.addParam({
                component: SETTINGS_COMPONENT,
                param: {
                    name: 'netflix_top10_clear_cache',
                    type: 'button'
                },
                field: {
                    name: 'Очистить кэш постеров',
                    description: 'Повторно найти все позиции Netflix в TMDB'
                },
                onChange: function () {
                    try {
                        Lampa.Storage.set(CACHE_KEY, {});
                        if (Lampa.Noty && Lampa.Noty.show) Lampa.Noty.show('Кэш Netflix Top 10 очищен');
                    } catch (e) {}
                }
            });
        } catch (e) {
            log('Settings error', e);
        }
    }

    function openNetflixSection() {
        Lampa.Activity.push({
            url: '',
            title: 'Netflix Top 10',
            component: COMPONENT,
            page: 1
        });
    }

    function menuButtonExists() {
        try {
            return !!document.querySelector(
                '.netflix-top10-menu, .menu__item[data-action="netflix_top10"]'
            );
        } catch (e) {
            return false;
        }
    }

    function addLegacyMenuButton() {
        try {
            if (menuButtonExists()) return true;

            var list = $('.menu .menu__list').eq(0);
            if (!list || !list.length) return false;

            var button = $(
                '<li class="menu__item selector netflix-top10-menu" data-action="netflix_top10">' +
                    '<div class="menu__ico">' + ICON + '</div>' +
                    '<div class="menu__text">Netflix</div>' +
                '</li>'
            );

            button.on('hover:enter click', function () {
                openNetflixSection();
            });

            list.append(button);

            log('Menu button added by legacy DOM fallback');
            return true;
        } catch (e) {
            log('Legacy menu fallback error', e);
            return false;
        }
    }

    function addMenu() {
        if (menuButtonExists()) return;

        /*
         * Lampa 3.x official API.
         * Some builds expose SettingsApi but either do not expose Menu.addButton
         * or rebuild the menu after plugins load. Therefore we verify that the
         * button actually reached the DOM and fall back to the classic menu DOM.
         */
        if (
            !window.netflix_top10_menu_api_attempted &&
            Lampa.Menu &&
            typeof Lampa.Menu.addButton === 'function'
        ) {
            window.netflix_top10_menu_api_attempted = true;

            try {
                var button = Lampa.Menu.addButton(
                    ICON,
                    'Netflix',
                    openNetflixSection
                );

                if (button && button.addClass) {
                    button.addClass('netflix-top10-menu');
                }

                if (button && button.attr) {
                    button.attr('data-action', 'netflix_top10');
                }

                log('Menu.addButton called');
            } catch (e) {
                log('Menu.addButton error', e);
            }
        }

        /*
         * Check on the next tick because some Lampa builds append the element
         * asynchronously. If it is still absent, use the old reliable markup.
         */
        setTimeout(function () {
            if (!menuButtonExists()) addLegacyMenuButton();
        }, 80);
    }

    function startPlugin() {
        if (window.netflix_top10_native_started) return;
        window.netflix_top10_native_started = true;

        try {
            if (!Lampa.Storage.get(COUNTRY_KEY, '')) {
                Lampa.Storage.set(COUNTRY_KEY, 'UA');
            }
        } catch (e) {}

        addStyles();
        registerManifest();
        Lampa.Component.add(COMPONENT, component);
        addSettings();
        addMenu();

        // Some TV builds rebuild the left menu after plugin initialization.
        // Retry safely; duplicate protection is built into addMenu().
        setTimeout(addMenu, 700);
        setTimeout(addMenu, 1800);
        setTimeout(addMenu, 4000);

        log('Started v' + VERSION + ', Lampa app_digital=' + appDigital());
    }

    function bootstrap() {
        if (typeof Lampa === 'undefined') {
            setTimeout(bootstrap, 200);
            return;
        }

        if (window.appready) {
            startPlugin();
            return;
        }

        if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') startPlugin();
            });

            setTimeout(function () {
                if (window.appready) startPlugin();
            }, 1200);
        } else {
            startPlugin();
        }
    }

    bootstrap();
})();
