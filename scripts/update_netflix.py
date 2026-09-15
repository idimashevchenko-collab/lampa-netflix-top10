#!/usr/bin/env python3
"""Build compact Netflix Top 10 JSON for the Lampa plugin.

Official public files:
- https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv
- https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv

No TMDB key is used here. Posters/metadata are resolved inside Lampa using
Lampa's built-in TMDB source.
"""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path

COUNTRIES_URL = "https://www.netflix.com/tudum/top10/data/all-weeks-countries.tsv"
GLOBAL_URL = "https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv"

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "top10.json"


def download(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; LampaNetflixTop10/1.0)",
            "Accept": "text/tab-separated-values,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read().decode("utf-8-sig")


def parse_tsv(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text), delimiter="\t")
    return [
        {str(k).strip(): (v or "").strip() for k, v in row.items()}
        for row in reader
    ]


def pick(row: dict[str, str], *keys: str, default: str = "") -> str:
    for key in keys:
        value = row.get(key, "")
        if value not in ("", None):
            return str(value).strip()
    return default


def as_int(value: str, default: int = 0) -> int:
    try:
        return int(float(str(value).replace(",", "").strip()))
    except Exception:
        return default


def clean_optional(value: str) -> str:
    value = (value or "").strip()
    if value.upper() in {"N/A", "NA", "NULL", "NONE"}:
        return ""
    return value


def netflix_item(row: dict[str, str]) -> dict:
    title = pick(row, "show_title", "title")
    item = {
        "rank": as_int(pick(row, "weekly_rank", "rank"), 999),
        "title": title,
        "search_title": title,
    }

    season = clean_optional(pick(row, "season_title"))
    if season:
        item["season_title"] = season

    weeks = as_int(
        pick(row, "cumulative_weeks_in_top_10", "weeks_in_top_10"),
        0,
    )
    if weeks:
        item["weeks_in_top10"] = weeks

    return item


def build_countries(rows: list[dict[str, str]]) -> tuple[str, dict]:
    weeks = [pick(row, "week") for row in rows if pick(row, "week")]
    if not weeks:
        raise RuntimeError("Country dataset has no week values")

    latest = max(weeks)
    countries: dict[str, dict] = {}

    for row in rows:
        if pick(row, "week") != latest:
            continue

        code = pick(row, "country_iso2", "country_code").upper()
        if not code:
            continue

        category = pick(row, "category").strip().lower()
        if category == "films":
            key = "movies"
        elif category == "tv":
            key = "tv"
        else:
            continue

        title = pick(row, "show_title", "title")
        if not title:
            continue

        country = countries.setdefault(
            code,
            {
                "name": pick(row, "country_name", default=code),
                "week": latest,
                "movies": [],
                "tv": [],
            },
        )
        country[key].append(netflix_item(row))

    for country in countries.values():
        country["movies"] = sorted(
            country["movies"], key=lambda item: item["rank"]
        )[:10]
        country["tv"] = sorted(
            country["tv"], key=lambda item: item["rank"]
        )[:10]

    return latest, dict(sorted(countries.items()))


GLOBAL_CATEGORY_MAP = {
    "films (english)": "films_english",
    "films (non-english)": "films_non_english",
    "tv (english)": "tv_english",
    "tv (non-english)": "tv_non_english",
}


def build_global(rows: list[dict[str, str]]) -> tuple[str, dict]:
    weeks = [pick(row, "week") for row in rows if pick(row, "week")]
    if not weeks:
        raise RuntimeError("Global dataset has no week values")

    latest = max(weeks)
    groups = {value: [] for value in GLOBAL_CATEGORY_MAP.values()}

    for row in rows:
        if pick(row, "week") != latest:
            continue

        category = pick(row, "category").strip().lower()
        key = GLOBAL_CATEGORY_MAP.get(category)
        if not key:
            continue

        title = pick(row, "show_title", "title")
        if not title:
            continue

        groups[key].append(netflix_item(row))

    for key in groups:
        groups[key] = sorted(groups[key], key=lambda item: item["rank"])[:10]

    return latest, {
        "week": latest,
        "groups": groups,
    }


def main() -> None:
    print("Downloading Netflix country dataset...")
    country_rows = parse_tsv(download(COUNTRIES_URL))

    print("Downloading Netflix global dataset...")
    global_rows = parse_tsv(download(GLOBAL_URL))

    country_week, countries = build_countries(country_rows)
    global_week, global_data = build_global(global_rows)

    payload = {
        "schema": 2,
        "generated": True,
        "source": "Netflix Tudum Top 10",
        "source_url": "https://www.netflix.com/tudum/top10",
        "latest_country_week": country_week,
        "latest_global_week": global_week,
        "countries": countries,
        "global": global_data,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )

    print(
        f"Wrote {OUT}: {len(countries)} countries, "
        f"country week={country_week}, global week={global_week}"
    )


if __name__ == "__main__":
    main()
