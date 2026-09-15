#!/usr/bin/env python3
"""
Streaming Tops updater v2.4.2

Stable free sources:
1) Netflix official weekly country charts:
   https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv

2) Current provider popularity / trending:
   JustWatch public GraphQL endpoint:
   https://apis.justwatch.com/graphql

No paid API keys.

Important:
- "Netflix • Official weekly" is the real Netflix weekly country chart.
- JustWatch rows are explicitly labelled JustWatch; they are NOT claimed to
  be the in-app proprietary daily ranking of Netflix/HBO/etc.
- WORLD bucket in the JSON/UI represents US provider popularity, not a fake
  global JustWatch ranking.
"""

from __future__ import annotations

import csv
import io
import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "top10.json"

JUSTWATCH_ENDPOINT = "https://apis.justwatch.com/graphql"
NETFLIX_TSV = "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv"

REGIONS = {
    "UA": {"jw_country": "UA", "name": "Украина"},
    "WORLD": {"jw_country": "US", "name": "США"},
}

SERVICE_MATCHERS = {
    "netflix": [r"\bnetflix\b"],
    "hbo_max": [r"\bhbo max\b", r"\bmax\b"],
    "prime_video": [r"amazon prime video", r"\bprime video\b"],
    "apple_tv": [r"apple tv\+", r"apple tv plus", r"\bapple tv\b"],
    "disney_plus": [r"disney\+", r"disney plus"],
    "paramount_plus": [r"paramount\+", r"paramount plus"],
}

PACKAGES_QUERY = r"""
query GetProviders($country: Country!) {
  packages(country: $country, platform: WEB, includeAddons: true) {
    id
    packageId
    clearName
    shortName
    technicalName
    slug
  }
}
"""

POPULAR_QUERY = r"""
query GetPopularTitles(
  $popularTitlesFilter: TitleFilter,
  $country: Country!,
  $language: Language!,
  $first: Int!,
  $sortBy: PopularTitlesSorting!,
  $offset: Int = 0
) {
  popularTitles(
    country: $country
    filter: $popularTitlesFilter
    first: $first
    sortBy: $sortBy
    sortRandomSeed: 0
    offset: $offset
  ) {
    edges {
      cursor
      node {
        ...TitleDetails
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}

fragment TitleDetails on MovieOrShowOrSeasonOrEpisode {
  id
  objectType
  content(country: $country, language: $language) {
    title
    originalReleaseYear
    ... on MovieOrShowContent {
      genres {
        shortName
        translation(language: $language)
      }
    }
  }
}
"""



STREAMING_CHARTS_QUERY = r"""
query GetStreamingChartInfo(
  $countryStreamingCharts: Country,
  $country: Country!,
  $language: Language!,
  $filter: StreamingChartsFilter,
  $first: Int!
) {
  streamingCharts(
    country: $countryStreamingCharts
    filter: $filter
    first: $first
  ) {
    edges {
      streamingChartInfo {
        rank
        trend
        trendDifference
        daysInTop10
        topRank
      }
      node {
        id
        objectType
        ... on Movie {
          content(country: $country, language: $language) {
            title
            originalReleaseYear
          }
        }
        ... on Show {
          content(country: $country, language: $language) {
            title
            originalReleaseYear
          }
        }
        ... on Season {
          content(country: $country, language: $language) {
            title
            originalReleaseYear
          }
        }
      }
    }
  }
}
"""
def graphql(
    operation_name: str,
    query: str,
    variables: dict[str, Any],
) -> dict[str, Any]:
    import urllib.error

    payload = json.dumps({
        "operationName": operation_name,
        "query": query,
        "variables": variables,
    }).encode("utf-8")

    request = urllib.request.Request(
        JUSTWATCH_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "streaming-tops-lampa/2.4.2",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", errors="replace")
        except Exception:
            body = ""
        raise RuntimeError(
            f"JustWatch HTTP {exc.code} for {operation_name}: {body[:1500]}"
        ) from exc

    data = json.loads(raw)

    if data.get("errors"):
        raise RuntimeError(
            "JustWatch GraphQL "
            + operation_name
            + ": "
            + json.dumps(data["errors"], ensure_ascii=False)[:1500]
        )

    return data.get("data") or {}


def package_text(pkg: dict[str, Any]) -> str:
    return " ".join(
        str(pkg.get(key) or "")
        for key in ("clearName", "technicalName", "shortName", "id")
    ).lower()


def find_packages(country: str) -> dict[str, str]:
    data = graphql("GetProviders", PACKAGES_QUERY, {"country": country})
    packages = data.get("packages") or []

    found: dict[str, str] = {}

    for service_key, patterns in SERVICE_MATCHERS.items():
        best = None
        for pkg in packages:
            text = package_text(pkg)

            if service_key == "hbo_max" and "cinemax" in text:
                continue
            if service_key == "apple_tv" and "apple tv store" in text:
                continue

            if any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns):
                best = pkg
                # exact clearName-ish matches are preferred
                clear = str(pkg.get("clearName") or "").lower()
                if service_key == "netflix" and clear == "netflix":
                    break
                if service_key == "hbo_max" and "hbo max" in clear:
                    break
                if service_key == "prime_video" and "amazon prime video" in clear:
                    break
                if service_key == "apple_tv" and ("apple tv+" in clear or "apple tv plus" in clear):
                    break
                if service_key == "disney_plus" and "disney" in clear:
                    break
                if service_key == "paramount_plus" and "paramount" in clear:
                    break

        if best:
            # JustWatch TitleFilter.packages expects provider/package codes
            # such as nfx/apv, not the opaque GraphQL node id (cGF8...).
            code = str(best.get("shortName") or "").strip()
            if code:
                found[service_key] = code

    return {k: v for k, v in found.items() if v}


def get_popular(
    country: str,
    package_id: str | None,
    object_types: list[str],
    sort_by: str,
    count: int = 10,
    genres: list[str] | None = None,
) -> list[dict[str, Any]]:
    title_filter: dict[str, Any] = {
        "includeTitlesWithoutUrl": True,
        "objectTypes": object_types,
        "releaseYear": {},
    }

    if package_id:
        title_filter["packages"] = [package_id]

    if genres:
        title_filter["genres"] = genres

    variables = {
        "country": country,
        "language": "en",
        "popularTitlesFilter": title_filter,
        "first": count,
        "sortBy": sort_by,
        "offset": 0,
    }

    data = graphql("GetPopularTitles", POPULAR_QUERY, variables)
    edges = ((data.get("popularTitles") or {}).get("edges") or [])

    rows: list[dict[str, Any]] = []
    for edge in edges[:count]:
        node = (edge or {}).get("node") or {}
        content = node.get("content") or {}
        title = content.get("title")
        if not title:
            continue

        genres: list[dict[str, str]] = []
        for genre in content.get("genres") or []:
            short_name = str((genre or {}).get("shortName") or "").strip()
            label = str(
                (genre or {}).get("translation")
                or short_name
            ).strip()

            if short_name:
                genres.append({
                    "code": short_name,
                    "label": label,
                })

        rows.append({
            "rank": len(rows) + 1,
            "title": title,
            "search_title": title,
            "year": content.get("originalReleaseYear"),
            "justwatch_id": node.get("id"),
            "genres": genres,
        })

    return rows


def browse_copy(
    items: list[dict[str, Any]],
    limit: int = 70,
) -> list[dict[str, Any]]:
    """
    Full browse rows have no ranking badge in Lampa.
    They preserve JustWatch popularity order but are presented as a catalog.
    """
    result: list[dict[str, Any]] = []

    for raw in items[:limit]:
        item = dict(raw)
        item["source_rank"] = item.get("rank", 0)
        item["rank"] = 0
        item["browse"] = True
        result.append(item)

    return result


def title_identity(item: dict[str, Any]) -> str:
    jw_id = str(item.get("justwatch_id") or "").strip()
    if jw_id:
        return "id:" + jw_id

    return (
        "title:"
        + str(item.get("title") or "").strip().casefold()
        + "|"
        + str(item.get("year") or "")
    )


def build_new_releases(
    movies: list[dict[str, Any]],
    tv: list[dict[str, Any]],
    documentary_movies: list[dict[str, Any]],
    documentary_tv: list[dict[str, Any]],
    limit: int = 30,
) -> list[dict[str, Any]]:
    """
    Mixed "New releases" shelf:
    - movies + series + documentaries together;
    - newest release year first;
    - within the same year, preserve JustWatch popularity order;
    - de-duplicate titles that also appear in the documentary-specific query.

    JustWatch's public popularTitles response gives originalReleaseYear but not
    a stable exact provider-added date, so this shelf means recent releases
    currently present in that provider's catalog, not "added to service today".
    """
    combined: list[dict[str, Any]] = []

    for media_order, source in enumerate(
        (movies, tv, documentary_movies, documentary_tv)
    ):
        for source_index, raw in enumerate(source):
            item = dict(raw)
            item["_media_order"] = media_order
            item["_source_index"] = source_index
            combined.append(item)

    seen: set[str] = set()
    unique: list[dict[str, Any]] = []

    for item in combined:
        identity = title_identity(item)
        if identity in seen:
            continue
        seen.add(identity)
        unique.append(item)

    unique.sort(
        key=lambda item: (
            -int(item.get("year") or 0),
            int(item.get("rank") or 999),
            int(item.get("_media_order") or 0),
            int(item.get("_source_index") or 0),
        )
    )

    result: list[dict[str, Any]] = []
    for raw in unique[:limit]:
        item = {
            key: value
            for key, value in raw.items()
            if not key.startswith("_")
        }
        item["source_rank"] = item.get("rank", 0)
        item["rank"] = 0
        item["browse"] = True
        item["new_release"] = True
        result.append(item)

    return result


def get_justwatch_weekly_chart(object_type: str) -> list[dict[str, Any]]:
    filter_value = {
        "category": "WEEKLY_POPULARITY_SAME_CONTENT_TYPE",
        "objectType": object_type,
    }

    # The chart endpoint exposes Global as null. If that changes, fall back
    # to the supported US chart instead of failing the whole updater.
    last_error = None
    for chart_country in (None, "US"):
        try:
            variables = {
                "countryStreamingCharts": chart_country,
                "country": "US",
                "language": "en",
                "filter": filter_value,
                "first": 10,
            }
            data = graphql(
                "GetStreamingChartInfo",
                STREAMING_CHARTS_QUERY,
                variables,
            )
            edges = ((data.get("streamingCharts") or {}).get("edges") or [])

            rows: list[dict[str, Any]] = []
            for edge in edges[:10]:
                info = (edge or {}).get("streamingChartInfo") or {}
                node = (edge or {}).get("node") or {}
                content = node.get("content") or {}
                title = content.get("title")
                if not title:
                    continue

                rows.append({
                    "rank": info.get("rank") or (len(rows) + 1),
                    "title": title,
                    "search_title": title,
                    "year": content.get("originalReleaseYear"),
                    "justwatch_id": node.get("id"),
                    "trend": info.get("trend"),
                    "trend_difference": info.get("trendDifference"),
                })

            if rows:
                return rows
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"JustWatch weekly chart unavailable: {last_error}")


def build_justwatch_weekly_service() -> dict[str, Any] | None:
    try:
        movies = get_justwatch_weekly_chart("MOVIE")
        tv = get_justwatch_weekly_chart("SHOW")

        if not (movies or tv):
            return None

        return {
            "name": "JustWatch",
            "date": datetime.now(timezone.utc).date().isoformat(),
            "scope": "global",
            "source_label": "Global Top 10 недели",
            "source_url": "https://www.justwatch.com/",
            "stale": False,
            "charts": {
                "movies": movies,
                "tv": tv,
                "overall": [],
            },
        }
    except Exception as exc:
        print("WARNING JustWatch weekly charts:", exc)
        return None


def build_justwatch_region(region_key: str) -> dict[str, Any]:
    region = REGIONS[region_key]
    country = region["jw_country"]
    packages = find_packages(country)

    print(f"[JustWatch {country}] packages:", packages)

    services: dict[str, Any] = {}

    for service_key, package_id in packages.items():
        print(f"[JustWatch {country}] {service_key} ({package_id})")

        # One broad provider catalog for films and one for series.
        # Genre metadata comes with every item, so Lampa can instantly filter
        # the same catalog into Documentary / Comedy / Crime / Sci-Fi etc.
        movies_catalog = get_popular(
            country,
            package_id,
            ["MOVIE"],
            "POPULAR",
            count=70,
        )
        tv_catalog = get_popular(
            country,
            package_id,
            ["SHOW"],
            "POPULAR",
            count=70,
        )
        hot = get_popular(
            country,
            package_id,
            ["MOVIE", "SHOW"],
            "TRENDING",
            count=10,
        )

        # Documentary is a relatively small genre, so filtering only the
        # provider's top ~70 general titles can leave just a handful of items.
        # Fetch it directly from JustWatch and keep a large dedicated catalog.
        documentary_movies = []
        documentary_tv = []

        try:
            documentary_movies = get_popular(
                country,
                package_id,
                ["MOVIE"],
                "POPULAR",
                count=100,
                genres=["doc"],
            )
        except Exception as exc:
            print(f"  documentary movies fallback to broad catalog: {exc}")

        try:
            documentary_tv = get_popular(
                country,
                package_id,
                ["SHOW"],
                "POPULAR",
                count=100,
                genres=["doc"],
            )
        except Exception as exc:
            print(f"  documentary TV fallback to broad catalog: {exc}")

        if not (movies_catalog or tv_catalog or hot):
            continue

        services[service_key] = {
            "name": service_key,
            "date": datetime.now(timezone.utc).date().isoformat(),
            "scope": "local" if region_key == "UA" else "world",
            "source_label": "JustWatch",
            "source_url": f"https://www.justwatch.com/{'ua' if country == 'UA' else 'us'}",
            "stale": False,
            "charts": {
                "movies": movies_catalog[:10],
                "tv": tv_catalog[:10],
                "overall": hot,
            },
            "catalogs": {
                "movies": browse_copy(movies_catalog, 70),
                "tv": browse_copy(tv_catalog, 70),
            },
            "genre_catalogs": {
                "doc": {
                    "movies": browse_copy(documentary_movies, 100),
                    "tv": browse_copy(documentary_tv, 100),
                }
            },
            "new_releases": build_new_releases(
                movies_catalog,
                tv_catalog,
                documentary_movies,
                documentary_tv,
                limit=30,
            ),
        }

    return {
        "name": region["name"],
        "services": services,
    }


def download_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; StreamingTopsLampa/2.1)",
            "Accept": "text/tab-separated-values,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        return response.read().decode("utf-8-sig")


def parse_tsv(text: str) -> list[dict[str, str]]:
    return [
        {str(k).strip(): (v or "").strip() for k, v in row.items()}
        for row in csv.DictReader(io.StringIO(text), delimiter="\t")
    ]


def pick(row: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = row.get(key, "")
        if value:
            return value.strip()
    return ""


def as_int(value: str, default: int = 0) -> int:
    try:
        return int(float(str(value).replace(",", "").strip()))
    except Exception:
        return default


def build_netflix_official() -> dict[str, dict[str, Any]]:
    rows = parse_tsv(download_text(NETFLIX_TSV))
    weeks = [pick(row, "week") for row in rows if pick(row, "week")]
    latest = max(weeks)

    by_country: dict[str, dict[str, Any]] = {}

    for row in rows:
        if pick(row, "week") != latest:
            continue

        iso = pick(row, "country_iso2", "country_code").upper()
        if iso not in {"UA", "US"}:
            continue

        category = pick(row, "category").lower()
        if category == "films":
            chart = "movies"
        elif category == "tv":
            chart = "tv"
        else:
            continue

        show_title = pick(row, "show_title", "title")
        if not show_title:
            continue

        season_title = pick(row, "season_title")
        display_title = show_title

        # Preserve Netflix's season distinction in the source rows, while
        # search_title remains the base show for TMDB matching.
        if season_title and season_title.upper() not in {"N/A", "NA"}:
            display_title = f"{show_title} — {season_title}"

        item = {
            "rank": as_int(pick(row, "weekly_rank", "rank"), 999),
            "title": display_title,
            "search_title": show_title,
        }

        country = by_country.setdefault(
            iso,
            {"movies": [], "tv": []},
        )
        country[chart].append(item)

    for country in by_country.values():
        country["movies"] = sorted(country["movies"], key=lambda x: x["rank"])[:10]
        country["tv"] = sorted(country["tv"], key=lambda x: x["rank"])[:10]

    result = {}
    for iso, charts in by_country.items():
        result[iso] = {
            "name": "Netflix",
            "date": latest,
            "scope": "local",
            "source_label": "официальный Top 10 недели",
            "source_url": "https://www.netflix.com/tudum/top10",
            "stale": False,
            "charts": {
                "movies": charts["movies"],
                "tv": charts["tv"],
                "overall": [],
            },
        }

    return result


def main() -> None:
    print("Fetching official Netflix weekly Top 10...")
    netflix_official = build_netflix_official()

    regions = {}

    for region_key in ("UA", "WORLD"):
        print("Building", region_key)
        region = build_justwatch_region(region_key)

        iso = "UA" if region_key == "UA" else "US"
        if iso in netflix_official:
            # Insert official Netflix first.
            services = {"netflix_official": netflix_official[iso]}
            services.update(region["services"])
            region["services"] = services

        regions[region_key] = region

    # JustWatch's own weekly homepage-style charts.
    justwatch_weekly = build_justwatch_weekly_service()
    if justwatch_weekly:
        regions["UA"]["services"]["justwatch_weekly"] = json.loads(
            json.dumps(justwatch_weekly)
        )
        regions["WORLD"]["services"]["justwatch_weekly"] = json.loads(
            json.dumps(justwatch_weekly)
        )

    # If services unavailable in UA but available in US, explicitly fallback.
    ua_services = regions["UA"]["services"]
    us_services = regions["WORLD"]["services"]

    for key in ("hbo_max", "prime_video", "apple_tv", "disney_plus", "paramount_plus"):
        if key not in ua_services and key in us_services:
            fallback = json.loads(json.dumps(us_services[key]))
            fallback["scope"] = "world_fallback"
            fallback["source_label"] = "JustWatch"
            fallback["note"] = "Нет локального каталога/рейтинга JustWatch для Украины; показан США."
            ua_services[key] = fallback

    payload = {
        "schema": 4,
        "generated": True,
        "version": "2.4.2",
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "Netflix Tudum + JustWatch public GraphQL + JustWatch streamingCharts",
        "source_note": (
            "Netflix official rows are weekly country charts. "
            "JustWatch provider rows represent current popularity/trending. "
            "The JustWatch tab uses the weekly streamingCharts ranking. "
            "Provider browse catalogs include genre metadata and are filtered in Lampa."
        ),
        "regions": regions,
        "last_errors": [],
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Wrote", OUT)
    print("UA services:", ", ".join(regions["UA"]["services"].keys()))
    print("US services:", ", ".join(regions["WORLD"]["services"].keys()))


if __name__ == "__main__":
    main()
