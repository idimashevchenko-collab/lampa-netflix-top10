/*!
 * Streaming Tops for Lampa
 * File name intentionally remains netflix-top10.js so existing install URLs do not change.
 * Version: 2.2.0
 *
 * Daily rankings: FlixPatrol public TOP 10 pages, read by the free Jina Reader proxy.
 * Posters/metadata: Lampa built-in TMDB source (no extra TMDB key).
 */
(function () {
    'use strict';

    if (window.streaming_tops_v2_ready) return;
    window.streaming_tops_v2_ready = true;

    var VERSION = '2.2.0';
    var COMPONENT = 'streaming_tops';
    var SETTINGS_COMPONENT = 'streaming_tops_settings';
    var REGION_KEY = 'streaming_tops_region';
    var CACHE_KEY = 'streaming_tops_tmdb_cache_v2';
    var CACHE_TTL = 14 * 24 * 60 * 60 * 1000;
    var HOME_VIEW_KEY = 'streaming_tops_home_view';
    var SHOW_OFFICIAL_KEY = 'streaming_tops_show_official';
    var SHOW_POPULAR_KEY = 'streaming_tops_show_popular';
    var SHOW_TRENDING_KEY = 'streaming_tops_show_trending';

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

    var VIEW_LABELS = {
        all: 'Все',
        hot: '🔥 Сейчас',
        netflix: 'Netflix',
        hbo_max: 'HBO Max',
        prime_video: 'Prime Video',
        apple_tv: 'Apple TV',
        disney_plus: 'Disney+',
        paramount_plus: 'Paramount+'
    };

    var ICON =
        '<svg width="34" height="34" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
            '<rect x="4" y="5" width="24" height="4" rx="2" fill="currentColor"/>' +
            '<rect x="4" y="14" width="20" height="4" rx="2" fill="currentColor" opacity=".72"/>' +
            '<rect x="4" y="23" width="16" height="4" rx="2" fill="currentColor" opacity=".48"/>' +
        '</svg>';

    var manifest = {
        type: 'other',
        version: VERSION,
        name: 'Streaming',
        description: 'Популярное и топы Netflix, HBO Max, Prime Video, Apple TV, Disney+ и Paramount+',
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

    function settingEnabled(key, defaultValue) {
        try {
            var value = Lampa.Storage.get(key, defaultValue === false ? '0' : '1');
            return String(value) !== '0';
        } catch (e) {
            return defaultValue !== false;
        }
    }

    function homeView() {
        var value = 'all';
        try {
            value = Lampa.Storage.get(HOME_VIEW_KEY, 'all') || 'all';
        } catch (e) {}
        return VIEW_LABELS[value] ? value : 'all';
    }

    function currentView(object) {
        var value = object && object.streaming_view ? object.streaming_view : homeView();
        return VIEW_LABELS[value] ? value : 'all';
    }

    function baseServiceKey(key) {
        return key === 'netflix_official' ? 'netflix' : key;
    }

    function viewServiceKeys(view) {
        if (view === 'netflix') return ['netflix_official', 'netflix'];
        if (view === 'hbo_max') return ['hbo_max'];
        if (view === 'prime_video') return ['prime_video'];
        if (view === 'apple_tv') return ['apple_tv'];
        if (view === 'disney_plus') return ['disney_plus'];
        if (view === 'paramount_plus') return ['paramount_plus'];
        return [];
    }

    function availableNavViews(region) {
        var result = ['all', 'hot'];
        var seen = {};

        SERVICE_ORDER.forEach(function (key) {
            var base = baseServiceKey(key);
            if (seen[base] || !serviceEnabled(key)) return;

            var has = region && region.services && (
                region.services[key] ||
                region.services[base]
            );

            if (!has) return;
            seen[base] = true;
            result.push(base);
        });

        return result;
    }

    function openView(view) {
        try {
            Lampa.Storage.set('streaming_tops_last_view', view);
        } catch (e) {}

        Lampa.Activity.push({
            url: '',
            title: view === 'all' ? 'Streaming' : (VIEW_LABELS[view] || 'Streaming'),
            component: COMPONENT,
            streaming_view: view,
            page: 1
        });
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

    function pageContext(data, object) {
        var regionKey = getRegion();
        var region = data.regions && data.regions[regionKey];

        if (!region && data.regions) region = data.regions.UA;

        return {
            regionKey: regionKey,
            region: region,
            view: currentView(object)
        };
    }

    function navRow(region, activeView) {
        var views = availableNavViews(region);

        return {
            title: getRegion() === 'WORLD' ? 'Streaming · США' : 'Streaming · Украина',
            streaming_nav_line: true,
            results: views.map(function (view) {
                return {
                    title: VIEW_LABELS[view] || view,
                    streaming_nav: true,
                    streaming_view: view,
                    streaming_active: view === activeView,
                    params: {
                        style: { name: 'wide' }
                    }
                };
            })
        };
    }

    function serviceMeta(serviceKey) {
        var base = baseServiceKey(serviceKey);
        return SERVICES[serviceKey] || SERVICES[base] || {
            name: base,
            prefix: '▶'
        };
    }

    function conciseSource(serviceData) {
        var label = String(serviceData && serviceData.source_label || '').toLowerCase();

        if (label.indexOf('официаль') !== -1) return 'Official';
        if (label.indexOf('justwatch') !== -1) return 'JustWatch';

        return serviceData && serviceData.source_label
            ? serviceData.source_label
            : '';
    }

    function dedicatedRowTitle(serviceKey, serviceData, chartKey) {
        var official = serviceKey === 'netflix_official';
        var source = conciseSource(serviceData);

        if (official) {
            if (chartKey === 'movies') return '🏆 Official Top 10 · Фильмы';
            if (chartKey === 'tv') return '🏆 Official Top 10 · Сериалы';
        }

        if (chartKey === 'overall') {
            return '🔥 Горячее сейчас' + (source ? ' · ' + source : '');
        }

        if (chartKey === 'movies') {
            return 'Популярные фильмы' + (source ? ' · ' + source : '');
        }

        if (chartKey === 'tv') {
            return 'Популярные сериалы' + (source ? ' · ' + source : '');
        }

        return chartLabel(chartKey) + (source ? ' · ' + source : '');
    }

    function overviewRowTitle(serviceKey, serviceData) {
        var meta = serviceMeta(serviceKey);
        var source = conciseSource(serviceData);
        return meta.name + ' · Сейчас' + (source ? ' · ' + source : '');
    }

    function makeDef(serviceKey, serviceData, chartKey, title, items) {
        return {
            serviceKey: serviceKey,
            chartKey: chartKey,
            kind: chartKind(chartKey),
            items: items || [],
            title: title
        };
    }

    function pickOverviewChart(serviceData) {
        if (!serviceData || !serviceData.charts) return null;

        if (settingEnabled(SHOW_TRENDING_KEY, true) && serviceData.charts.overall && serviceData.charts.overall.length) {
            return { key: 'overall', items: serviceData.charts.overall };
        }

        if (settingEnabled(SHOW_POPULAR_KEY, true) && serviceData.charts.movies && serviceData.charts.movies.length) {
            return { key: 'movies', items: serviceData.charts.movies };
        }

        if (settingEnabled(SHOW_POPULAR_KEY, true) && serviceData.charts.tv && serviceData.charts.tv.length) {
            return { key: 'tv', items: serviceData.charts.tv };
        }

        return null;
    }

    function buildOverviewDefs(region) {
        var defs = [];
        var bases = [
            'netflix',
            'hbo_max',
            'prime_video',
            'apple_tv',
            'disney_plus',
            'paramount_plus'
        ];

        bases.forEach(function (base) {
            if (!serviceEnabled(base)) return;

            var data = region.services && region.services[base];
            if (!data) return;

            var picked = pickOverviewChart(data);
            if (!picked) return;

            defs.push(
                makeDef(
                    base,
                    data,
                    picked.key,
                    overviewRowTitle(base, data),
                    picked.items
                )
            );
        });

        return defs;
    }

    function buildDedicatedDefs(region, view) {
        var defs = [];
        var keys = viewServiceKeys(view);

        keys.forEach(function (serviceKey) {
            if (!serviceEnabled(serviceKey)) return;

            var serviceData = region.services && region.services[serviceKey];
            if (!serviceData || !serviceData.charts) return;

            var official = serviceKey === 'netflix_official';

            if (official && settingEnabled(SHOW_OFFICIAL_KEY, true)) {
                ['movies', 'tv'].forEach(function (chartKey) {
                    var list = serviceData.charts[chartKey] || [];
                    if (!list.length) return;

                    defs.push(
                        makeDef(
                            serviceKey,
                            serviceData,
                            chartKey,
                            dedicatedRowTitle(serviceKey, serviceData, chartKey),
                            list
                        )
                    );
                });

                return;
            }

            if (!official && settingEnabled(SHOW_POPULAR_KEY, true)) {
                ['movies', 'tv'].forEach(function (chartKey) {
                    var list = serviceData.charts[chartKey] || [];
                    if (!list.length) return;

                    defs.push(
                        makeDef(
                            serviceKey,
                            serviceData,
                            chartKey,
                            dedicatedRowTitle(serviceKey, serviceData, chartKey),
                            list
                        )
                    );
                });
            }

            if (!official && settingEnabled(SHOW_TRENDING_KEY, true)) {
                var hot = serviceData.charts.overall || [];
                if (hot.length) {
                    defs.push(
                        makeDef(
                            serviceKey,
                            serviceData,
                            'overall',
                            dedicatedRowTitle(serviceKey, serviceData, 'overall'),
                            hot
                        )
                    );
                }
            }
        });

        return defs;
    }

    function makeMixedItems(region) {
        var serviceBases = [
            'netflix',
            'hbo_max',
            'prime_video',
            'apple_tv',
            'disney_plus',
            'paramount_plus'
        ];
        var buckets = [];

        serviceBases.forEach(function (base) {
            if (!serviceEnabled(base)) return;

            var serviceData = region.services && region.services[base];
            if (!serviceData || !serviceData.charts) return;

            var list =
                (serviceData.charts.overall && serviceData.charts.overall.length
                    ? serviceData.charts.overall
                    : (serviceData.charts.movies || []));

            if (!list.length) return;

            buckets.push({
                serviceKey: base,
                list: list.slice(0, 4)
            });
        });

        var mixed = [];
        for (var i = 0; i < 4; i++) {
            buckets.forEach(function (bucket) {
                var raw = bucket.list[i];
                if (!raw) return;

                var item = {};
                Object.keys(raw).forEach(function (key) {
                    item[key] = raw[key];
                });

                item.streaming_mixed = true;
                item.streaming_mixed_service = bucket.serviceKey;
                item.rank = 0;
                mixed.push(item);
            });
        }

        return mixed.slice(0, 20);
    }

    function resolveMixedList(items, callback) {
        mapLimit(items || [], 4, function (raw, next) {
            var item = {};
            Object.keys(raw || {}).forEach(function (key) {
                item[key] = raw[key];
            });

            var serviceKey = item.streaming_mixed_service || '';
            item.service = serviceKey;
            item.chart = 'overall';

            resolveOne(item, 'multi', function (card) {
                if (card) {
                    card.streaming_mixed = true;
                    card.streaming_mixed_service = serviceKey;
                    card.streaming_rank = 0;
                }
                next(card);
            });
        }, function (resolved) {
            callback(resolved.filter(Boolean));
        });
    }

    function resolveDefs(defs, callback) {
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

    function buildRows(data, object, callback) {
        var ctx = pageContext(data, object);

        if (!ctx.region) {
            callback([]);
            return;
        }

        var first = navRow(ctx.region, ctx.view);

        if (ctx.view === 'hot') {
            resolveMixedList(makeMixedItems(ctx.region), function (cards) {
                callback([
                    first,
                    {
                        title: '🔥 Сейчас популярно · все сервисы',
                        streaming_mixed_line: true,
                        results: cards
                    }
                ]);
            });
            return;
        }

        var defs = ctx.view === 'all'
            ? buildOverviewDefs(ctx.region)
            : buildDedicatedDefs(ctx.region, ctx.view);

        resolveDefs(defs, function (rows) {
            callback([first].concat(rows));
        });
    }

    function loadRows(object, success, error) {
        requestJson(dataUrl(), function (data) {
            if (!data || !data.generated || Number(data.schema || 0) < 4) {
                error('Данные Streaming ещё не обновлены. Запусти GitHub Action Update Streaming Tops.');
                return;
            }

            buildRows(data, object, function (rows) {
                if (!rows.length) {
                    error('В текущем разделе нет доступных подборок.');
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

    function serviceShortLabel(key) {
        var meta = SERVICES[key] || SERVICES[baseServiceKey(key)] || {};
        return meta.name || key || '';
    }

    function decorateCardNode(cardInstance, decorator) {
        function run() {
            try {
                var render = cardInstance && cardInstance.render ? cardInstance.render() : null;
                if (!render) return;

                var node = render.jquery ? render : $(render);
                if (!node || !node.length) return;

                decorator(node);
            } catch (e) {}
        }

        try {
            if (cardInstance && cardInstance.use) {
                cardInstance.use({
                    onCreate: run,
                    onRender: run
                });
            }
        } catch (e1) {}

        setTimeout(run, 0);
        setTimeout(run, 120);
    }

    function applyRankBadge(cardInstance, data) {
        if (!data || !data.streaming_rank || !cardInstance) return;

        decorateCardNode(cardInstance, function (node) {
            node.addClass('streaming-tops-card');
            node.addClass('streaming-rank-' + String(data.streaming_rank));

            if (!node.find('.streaming-tops-rank').length) {
                node.append(
                    '<div class="streaming-tops-rank">#' +
                    String(data.streaming_rank) +
                    '</div>'
                );
            }
        });
    }

    function applyMixedServiceBadge(cardInstance, data) {
        if (!data || !data.streaming_mixed || !cardInstance) return;

        decorateCardNode(cardInstance, function (node) {
            node.addClass('streaming-tops-card');

            if (!node.find('.streaming-service-badge').length) {
                node.append(
                    '<div class="streaming-service-badge">' +
                    serviceShortLabel(data.streaming_mixed_service) +
                    '</div>'
                );
            }
        });
    }

    function applyNavCard(cardInstance, data) {
        if (!data || !data.streaming_nav || !cardInstance) return;

        decorateCardNode(cardInstance, function (node) {
            node.addClass('streaming-nav-card');
            if (data.streaming_active) node.addClass('streaming-nav-card--active');
            else node.removeClass('streaming-nav-card--active');

            node.children().not('.streaming-nav-pill').css('display', 'none');

            if (!node.find('.streaming-nav-pill').length) {
                node.append(
                    '<div class="streaming-nav-pill">' +
                    String(data.title || '') +
                    '</div>'
                );
            }
        });
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
                    object,
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
                        if (!card || !card.use) return;

                        if (data && data.streaming_nav) {
                            applyNavCard(card, data);

                            card.use({
                                onlyEnter: function () {
                                    openView(data.streaming_view || 'all');
                                }
                            });
                            return;
                        }

                        applyRankBadge(card, data);
                        applyMixedServiceBadge(card, data);

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
                object,
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

                    if (data.streaming_nav) {
                        applyNavCard(card, data);
                        card.onEnter = function () {
                            openView(data.streaming_view || 'all');
                        };
                        return;
                    }

                    applyRankBadge(card, data);
                    applyMixedServiceBadge(card, data);

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
            Lampa.Noty.show('Streaming: эта версия Lampa слишком старая');
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
                'min-width:2.15em!important;' +
                'height:2.15em!important;' +
                'padding:0 .42em!important;' +
                'display:flex!important;' +
                'align-items:center!important;' +
                'justify-content:center!important;' +
                'box-sizing:border-box!important;' +
                'border-radius:.5em!important;' +
                'font-size:1em!important;' +
                'font-weight:800!important;' +
                'line-height:1!important;' +
                'color:#fff!important;' +
                'background:rgba(15,15,15,.90)!important;' +
                'border:1px solid rgba(255,255,255,.20)!important;' +
                'box-shadow:0 .12em .45em rgba(0,0,0,.55)!important;' +
                'pointer-events:none!important;' +
            '}' +

            '.streaming-rank-1 .streaming-tops-rank{' +
                'min-width:2.7em!important;' +
                'height:2.7em!important;' +
                'font-size:1.18em!important;' +
                'border-width:2px!important;' +
            '}' +

            '.streaming-rank-2 .streaming-tops-rank,' +
            '.streaming-rank-3 .streaming-tops-rank{' +
                'min-width:2.4em!important;' +
                'height:2.4em!important;' +
                'font-size:1.08em!important;' +
            '}' +

            '.streaming-service-badge{' +
                'position:absolute!important;' +
                'left:.45em!important;' +
                'bottom:.45em!important;' +
                'z-index:12!important;' +
                'max-width:80%!important;' +
                'padding:.34em .55em!important;' +
                'border-radius:.42em!important;' +
                'font-size:.74em!important;' +
                'font-weight:700!important;' +
                'white-space:nowrap!important;' +
                'overflow:hidden!important;' +
                'text-overflow:ellipsis!important;' +
                'color:#fff!important;' +
                'background:rgba(10,10,10,.82)!important;' +
                'border:1px solid rgba(255,255,255,.16)!important;' +
                'pointer-events:none!important;' +
            '}' +

            '.streaming-nav-card{' +
                'width:auto!important;' +
                'min-width:8em!important;' +
                'height:3.05em!important;' +
                'margin-right:.55em!important;' +
                'border-radius:.7em!important;' +
                'background:rgba(255,255,255,.075)!important;' +
                'border:1px solid rgba(255,255,255,.10)!important;' +
                'overflow:hidden!important;' +
                'box-sizing:border-box!important;' +
            '}' +

            '.streaming-nav-card.focus{' +
                'background:#fff!important;' +
                'color:#111!important;' +
                'transform:scale(1.035)!important;' +
            '}' +

            '.streaming-nav-card--active{' +
                'background:rgba(255,255,255,.16)!important;' +
                'border-color:rgba(255,255,255,.38)!important;' +
            '}' +

            '.streaming-nav-pill{' +
                'width:100%!important;' +
                'height:100%!important;' +
                'padding:0 1.05em!important;' +
                'display:flex!important;' +
                'align-items:center!important;' +
                'justify-content:center!important;' +
                'box-sizing:border-box!important;' +
                'font-size:.92em!important;' +
                'font-weight:700!important;' +
                'white-space:nowrap!important;' +
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
                name: 'Streaming',
                icon: ICON
            });

            addSelectSetting(
                SETTINGS_COMPONENT,
                REGION_KEY,
                REGIONS,
                'UA',
                'Регион',
                'Украина — локальные данные; США — американские каталоги и популярность.',
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

            addSelectSetting(
                SETTINGS_COMPONENT,
                HOME_VIEW_KEY,
                {
                    all: 'Все сервисы',
                    hot: '🔥 Сейчас',
                    netflix: 'Netflix',
                    hbo_max: 'HBO Max',
                    prime_video: 'Prime Video',
                    apple_tv: 'Apple TV',
                    disney_plus: 'Disney+',
                    paramount_plus: 'Paramount+'
                },
                'all',
                'Стартовая вкладка',
                'Какой раздел открывать при выборе Streaming в левом меню.'
            );

            addSelectSetting(
                SETTINGS_COMPONENT,
                SHOW_OFFICIAL_KEY,
                { '1': 'Показывать', '0': 'Скрыть' },
                '1',
                'Official Top',
                'Показывать официальный недельный Netflix Top 10.'
            );

            addSelectSetting(
                SETTINGS_COMPONENT,
                SHOW_POPULAR_KEY,
                { '1': 'Показывать', '0': 'Скрыть' },
                '1',
                'Популярное',
                'Показывать популярные фильмы и сериалы JustWatch.'
            );

            addSelectSetting(
                SETTINGS_COMPONENT,
                SHOW_TRENDING_KEY,
                { '1': 'Показывать', '0': 'Скрыть' },
                '1',
                'Горячее сейчас',
                'Показывать trending-подборки JustWatch.'
            );

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
                            Lampa.Noty.show('Кэш Streaming очищен');
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
            title: 'Streaming',
            component: COMPONENT,
            streaming_view: homeView(),
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
                    '<div class="menu__text">Streaming</div>' +
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
                var button = Lampa.Menu.addButton(ICON, 'Streaming', openStreamingSection);

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
