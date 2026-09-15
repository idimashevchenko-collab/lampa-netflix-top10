/*!
 * Streaming Tops for Lampa
 * File name intentionally remains netflix-top10.js so existing install URLs do not change.
 * Version: 2.1.0
 *
 * Daily rankings: FlixPatrol public TOP 10 pages, read by the free Jina Reader proxy.
 * Posters/metadata: Lampa built-in TMDB source (no extra TMDB key).
 */
(function () {
    'use strict';

    if (window.streaming_tops_v2_ready) return;
    window.streaming_tops_v2_ready = true;

    var VERSION = '2.1.0';
    var COMPONENT = 'streaming_tops';
    var SETTINGS_COMPONENT = 'streaming_tops_settings';
    var REGION_KEY = 'streaming_tops_region';
    var CACHE_KEY = 'streaming_tops_tmdb_cache_v2';
    var CACHE_TTL = 14 * 24 * 60 * 60 * 1000;

    var REGIONS = {
        UA: 'Украина',
        WORLD: 'США'
    };

    var SERVICES = {
        netflix_official: {
            name: 'Netflix',
            prefix: '🔴',
            setting: 'streaming_tops_show_netflix'
        },
        netflix: {
            name: 'Netflix',
            prefix: '🔴',
            setting: 'streaming_tops_show_netflix'
        },
        hbo_max: {
            name: 'HBO Max',
            prefix: '🟣',
            setting: 'streaming_tops_show_hbo'
        },
        prime_video: {
            name: 'Prime Video',
            prefix: '📦',
            setting: 'streaming_tops_show_prime'
        },
        apple_tv: {
            name: 'Apple TV',
            prefix: '🍎',
            setting: 'streaming_tops_show_apple'
        },
        disney_plus: {
            name: 'Disney+',
            prefix: '🏰',
            setting: 'streaming_tops_show_disney'
        },
        paramount_plus: {
            name: 'Paramount+',
            prefix: '⛰️',
            setting: 'streaming_tops_show_paramount'
        }
    };

    var SERVICE_ORDER = [
        'netflix_official',
        'netflix',
        'hbo_max',
        'prime_video',
        'apple_tv',
        'disney_plus',
        'paramount_plus'
    ];

    var ICON =
        '<svg width="34" height="34" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="4" y="5" width="24" height="4" rx="2" fill="currentColor"/>' +
            '<rect x="4" y="14" width="20" height="4" rx="2" fill="currentColor" opacity=".72"/>' +
            '<rect x="4" y="23" width="16" height="4" rx="2" fill="currentColor" opacity=".48"/>' +
        '</svg>';

    var manifest = {
        type: 'other',
        version: VERSION,
        name: 'Streaming Tops',
        description: 'Ежедневные Top 10 Netflix, HBO Max, Prime Video, Apple TV, Disney+ и Paramount+',
        component: COMPONENT
    };

    function log() {
        try {
            var args = Array.prototype.slice.call(arguments);
            args.unshift('[Streaming Tops]');
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

    function getRegion() {
        var value = 'UA';
        try {
            value = Lampa.Storage.get(REGION_KEY, 'UA') || 'UA';
        } catch (e) {}

        // Migration from the old Netflix-only plugin.
        if (value === 'GLOBAL') value = 'WORLD';

        return REGIONS[value] ? value : 'UA';
    }

    function serviceEnabled(key) {
        var service = SERVICES[key];
        if (!service) return false;

        try {
            var value = Lampa.Storage.get(service.setting, '1');
            return String(value) !== '0';
        } catch (e) {
            return true;
        }
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
            error('Не удалось определить URL data/top10.json');
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
                            error('Не удалось загрузить Streaming Tops');
                        },
                        false,
                        { dataType: 'json', cache: { life: 5 } }
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

        error('В этой сборке Lampa нет доступного сетевого клиента');
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
        if (!candidate) return -999;

        if (candidate.media_type === 'person') return -999;

        var wantedNorm = normalizeTitle(wanted);
        var titles = tmdbAltTitles(candidate);
        var best = 0;

        for (var i = 0; i < titles.length; i++) {
            var current = normalizeTitle(titles[i]);
            if (!current) continue;

            if (current === wantedNorm) best = Math.max(best, 100);
            else if (current.indexOf(wantedNorm) === 0 || wantedNorm.indexOf(current) === 0) best = Math.max(best, 78);
            else if (current.indexOf(wantedNorm) !== -1 || wantedNorm.indexOf(current) !== -1) best = Math.max(best, 58);
        }

        if (candidate.poster_path) best += 7;
        if (candidate.vote_count && candidate.vote_count > 100) best += 3;
        if (candidate.popularity) best += Math.min(5, Math.log(candidate.popularity + 1));

        var type = candidate.media_type ||
            (candidate.name || candidate.original_name || candidate.first_air_date ? 'tv' : 'movie');

        if (kind === 'movie' && type === 'movie') best += 8;
        if (kind === 'tv' && type === 'tv') best += 8;

        return best;
    }

    function selectBestCandidate(results, wanted, kind) {
        var list = (results || []).filter(function (item) {
            return item && item.media_type !== 'person';
        });

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

            if (keys.length > 500) {
                keys.sort(function (a, b) {
                    return (cache[b].saved_at || 0) - (cache[a].saved_at || 0);
                });

                var trimmed = {};
                keys.slice(0, 400).forEach(function (key) {
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

        var path = kind === 'tv'
            ? 'search/tv'
            : (kind === 'movie' ? 'search/movie' : 'search/multi');

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

    function decorateResolvedCard(card, sourceItem, kind) {
        var result = {};

        Object.keys(card || {}).forEach(function (key) {
            result[key] = card[key];
        });

        if (!result.media_type) {
            result.media_type = kind === 'multi'
                ? (result.name || result.original_name || result.first_air_date ? 'tv' : 'movie')
                : kind;
        }

        result.source = 'tmdb';
        result.streaming_rank = sourceItem.rank || 0;
        result.streaming_service = sourceItem.service || '';
        result.streaming_chart = sourceItem.chart || '';
        result.streaming_source_title = sourceItem.title || '';
        result.streaming_source_url = sourceItem.source_url || '';

        return result;
    }

    function resolveOne(sourceItem, kind, callback) {
        var title = sourceItem.search_title || sourceItem.title || '';
        var cache = loadCache();
        var key = cacheKey(kind, title);
        var cached = cache[key];

        if (cached && cached.card && Date.now() - (cached.saved_at || 0) < CACHE_TTL) {
            callback(decorateResolvedCard(cached.card, sourceItem, kind));
            return;
        }

        tmdbSearch(
            kind,
            title,
            function (results) {
                var best = selectBestCandidate(results, title, kind);

                // If a strict movie/TV search failed, try multi as a safety net.
                if (!best && kind !== 'multi') {
                    tmdbSearch('multi', title, function (multiResults) {
                        var multiBest = selectBestCandidate(multiResults, title, kind);
                        if (!multiBest) {
                            callback(null);
                            return;
                        }

                        cache[key] = { saved_at: Date.now(), card: multiBest };
                        saveCache(cache);
                        callback(decorateResolvedCard(multiBest, sourceItem, kind));
                    }, function () {
                        callback(null);
                    });
                    return;
                }

                if (!best) {
                    callback(null);
                    return;
                }

                cache[key] = { saved_at: Date.now(), card: best };
                saveCache(cache);
                callback(decorateResolvedCard(best, sourceItem, kind));
            },
            function () {
                callback(null);
            }
        );
    }

    function mapLimit(items, limit, iterator, done) {
        var source = (items || []).slice();
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

    function resolveList(items, kind, serviceKey, chartKey, callback) {
        mapLimit(items || [], 4, function (raw, next) {
            var item = {};
            Object.keys(raw || {}).forEach(function (key) { item[key] = raw[key]; });
            item.service = serviceKey;
            item.chart = chartKey;

            resolveOne(item, kind, next);
        }, function (resolved) {
            callback(resolved.filter(Boolean));
        });
    }

    function dateLabel(value) {
        if (!value) return '';
        var parts = String(value).split('-');
        if (parts.length !== 3) return value;
        return parts[2] + '.' + parts[1] + '.' + parts[0];
    }

    function chartLabel(key) {
        if (key === 'movies') return 'Фильмы';
        if (key === 'tv') return 'Сериалы';
        return 'Общий Top 10';
    }

    function chartKind(key) {
        if (key === 'movies') return 'movie';
        if (key === 'tv') return 'tv';
        return 'multi';
    }

    function buildRows(data, callback) {
        var regionKey = getRegion();
        var region = data.regions && data.regions[regionKey];

        if (!region && data.regions) region = data.regions.UA;
        if (!region) {
            callback([]);
            return;
        }

        var defs = [];

        SERVICE_ORDER.forEach(function (serviceKey) {
            if (!serviceEnabled(serviceKey)) return;

            var serviceData = region.services && region.services[serviceKey];
            if (!serviceData || !serviceData.charts) return;

            var meta = SERVICES[serviceKey] || { name: serviceKey, prefix: '▶' };
            var scopeText = regionKey === 'WORLD' ? 'США' : 'Украина';

            if (serviceData.scope === 'world_fallback') {
                scopeText = 'США · локального каталога для Украины нет';
            }

            var stale = serviceData.stale ? ' · данные предыдущего обновления' : '';
            var date = serviceData.date ? ' · ' + dateLabel(serviceData.date) : '';
            var sourceLabel = serviceData.source_label ? ' · ' + serviceData.source_label : '';

            ['movies', 'tv', 'overall'].forEach(function (chartKey) {
                var list = serviceData.charts[chartKey] || [];
                if (!list.length) return;

                defs.push({
                    serviceKey: serviceKey,
                    chartKey: chartKey,
                    kind: chartKind(chartKey),
                    items: list,
                    title:
                        meta.prefix + ' ' + meta.name +
                        ' · ' + chartLabel(chartKey) +
                        sourceLabel +
                        ' · ' + scopeText + date + stale
                });
            });
        });

        if (!defs.length) {
            callback([]);
            return;
        }

        var rows = new Array(defs.length);
        var count = 0;

        defs.forEach(function (def, index) {
            resolveList(
                def.items,
                def.kind,
                def.serviceKey,
                def.chartKey,
                function (cards) {
                    rows[index] = {
                        title: def.title,
                        results: cards
                    };

                    count++;
                    if (count === defs.length) callback(rows.filter(Boolean));
                }
            );
        });
    }

    function loadRows(success, error) {
        requestJson(dataUrl(), function (data) {
            if (!data || !data.generated || Number(data.schema || 0) < 4) {
                error('Данные Streaming Tops ещё не обновлены. Запусти GitHub Action Update Streaming Tops.');
                return;
            }

            buildRows(data, function (rows) {
                if (!rows.length) {
                    error('В текущем регионе нет доступных рейтингов.');
                    return;
                }
                success(rows);
            });
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
            openSearch(card && (card.streaming_source_title || tmdbTitle(card)) || '');
            return;
        }

        try {
            if (Lampa.Router && Lampa.Router.call) {
                Lampa.Router.call('full', card);
                return;
            }
        } catch (e) {}

        var kind = card.media_type ||
            (card.name || card.original_name || card.first_air_date ? 'tv' : 'movie');

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
            openSearch(card.streaming_source_title || tmdbTitle(card));
        }
    }

    function applyRankBadge(cardInstance, data) {
        if (!data || !data.streaming_rank || !cardInstance) return;

        function decorate() {
            try {
                var render = cardInstance.render ? cardInstance.render() : null;
                if (!render) return;

                var node = render.jquery ? render : $(render);
                if (!node || !node.length) return;

                node.addClass('streaming-tops-card');

                if (!node.find('.streaming-tops-rank').length) {
                    node.append(
                        '<div class="streaming-tops-rank">#' +
                        String(data.streaming_rank) +
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
                                    if (
                                        Lampa.Background &&
                                        Lampa.Background.change &&
                                        Lampa.Utils &&
                                        Lampa.Utils.cardImgBackground
                                    ) {
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

        if (Lampa.Noty && Lampa.Noty.show) {
            Lampa.Noty.show('Streaming Tops: эта версия Lampa слишком старая');
        }

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
        if (document.getElementById('streaming-tops-style')) return;

        var style = document.createElement('style');
        style.id = 'streaming-tops-style';
        style.innerHTML =
            '.streaming-tops-card{position:relative!important}' +
            '.streaming-tops-rank{' +
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
                'background:rgba(20,20,20,.90)!important;' +
                'box-shadow:0 .12em .45em rgba(0,0,0,.55)!important;' +
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

    function addSelectSetting(component, name, values, defaultValue, title, description, onChange) {
        Lampa.SettingsApi.addParam({
            component: component,
            param: {
                name: name,
                type: 'select',
                values: values,
                default: defaultValue
            },
            field: {
                name: title,
                description: description
            },
            onChange: onChange || function (value) {
                try { Lampa.Storage.set(name, value); } catch (e) {}
            }
        });
    }

    function addSettings() {
        if (!Lampa.SettingsApi || !Lampa.SettingsApi.addComponent || !Lampa.SettingsApi.addParam) return;

        try {
            Lampa.SettingsApi.addComponent({
                component: SETTINGS_COMPONENT,
                name: 'Streaming Tops',
                icon: ICON
            });

            addSelectSetting(
                SETTINGS_COMPONENT,
                REGION_KEY,
                REGIONS,
                'UA',
                'Регион',
                'Украина — локальные ежедневные чарты; Мир — мировые чарты.',
                function (value) {
                    try { Lampa.Storage.set(REGION_KEY, value || 'UA'); } catch (e) {}
                }
            );

            var settingsAdded = {};
            SERVICE_ORDER.forEach(function (key) {
                var service = SERVICES[key];
                if (settingsAdded[service.setting]) return;
                settingsAdded[service.setting] = true;

                addSelectSetting(
                    SETTINGS_COMPONENT,
                    service.setting,
                    { '1': 'Показывать', '0': 'Скрыть' },
                    '1',
                    service.name,
                    'Показывать или скрывать ряды ' + service.name + '.'
                );
            });

            Lampa.SettingsApi.addParam({
                component: SETTINGS_COMPONENT,
                param: {
                    name: 'streaming_tops_clear_cache',
                    type: 'button'
                },
                field: {
                    name: 'Очистить кэш постеров',
                    description: 'Повторно сопоставить названия из рейтингов с TMDB.'
                },
                onChange: function () {
                    try {
                        Lampa.Storage.set(CACHE_KEY, {});
                        if (Lampa.Noty && Lampa.Noty.show) {
                            Lampa.Noty.show('Кэш Streaming Tops очищен');
                        }
                    } catch (e) {}
                }
            });
        } catch (e) {
            log('Settings error', e);
        }
    }

    function openStreamingSection() {
        Lampa.Activity.push({
            url: '',
            title: 'Streaming Tops',
            component: COMPONENT,
            page: 1
        });
    }

    function menuButtonExists() {
        try {
            return !!document.querySelector(
                '.streaming-tops-menu, .menu__item[data-action="streaming_tops"]'
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
                '<li class="menu__item selector streaming-tops-menu" data-action="streaming_tops">' +
                    '<div class="menu__ico">' + ICON + '</div>' +
                    '<div class="menu__text">Streaming Tops</div>' +
                '</li>'
            );

            button.on('hover:enter click', openStreamingSection);
            list.append(button);

            log('Menu button added by DOM fallback');
            return true;
        } catch (e) {
            log('Legacy menu fallback error', e);
            return false;
        }
    }

    function addMenu() {
        if (menuButtonExists()) return;

        if (
            !window.streaming_tops_menu_api_attempted &&
            Lampa.Menu &&
            typeof Lampa.Menu.addButton === 'function'
        ) {
            window.streaming_tops_menu_api_attempted = true;

            try {
                var button = Lampa.Menu.addButton(ICON, 'Streaming Tops', openStreamingSection);

                if (button && button.addClass) button.addClass('streaming-tops-menu');
                if (button && button.attr) button.attr('data-action', 'streaming_tops');
            } catch (e) {
                log('Menu.addButton error', e);
            }
        }

        setTimeout(function () {
            if (!menuButtonExists()) addLegacyMenuButton();
        }, 80);
    }

    function startPlugin() {
        if (window.streaming_tops_v2_started) return;
        window.streaming_tops_v2_started = true;

        try {
            if (!Lampa.Storage.get(REGION_KEY, '')) {
                Lampa.Storage.set(REGION_KEY, 'UA');
            }
        } catch (e) {}

        addStyles();
        registerManifest();
        Lampa.Component.add(COMPONENT, component);
        addSettings();
        addMenu();

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
