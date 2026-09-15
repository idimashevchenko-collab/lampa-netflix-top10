#!/usr/bin/env python3
"""
Streaming Tops daily updater for Lampa.

Free data path:
    FlixPatrol public Top 10 pages
        -> Jina AI Reader (r.jina.ai, no API key)
        -> compact data/top10.json
        -> Lampa plugin

The script intentionally keeps the old filename update_netflix.py so the
existing repository structure and plugin URL do not have to change.

Important:
- We DO NOT deduplicate seasons/titles. Ranking rows are preserved in source order.
- If a source temporarily fails, the previous successful chart is kept.
- Disney+ and Paramount+ have no Ukraine local chart in this configuration,
  so Ukraine receives a clearly marked World fallback for those services.
"""

from __future__ import annotations

import copy
import json
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "top10.json"

JINA_PREFIX = "https://r.jina.ai/http://flixpatrol.com/top10"

SERVICES: dict[str, dict[str, Any]] = {
    "netflix": {
        "name": "Netflix",
        "slug": "netflix",
        "ua_local": True,
    },
    "hbo_max": {
        "name": "HBO Max",
        "slug": "hbo-max",
        "ua_local": True,
    },
    "prime_video": {
        "name": "Prime Video",
        "slug": "amazon-prime",
        "ua_local": True,
    },
    "apple_tv": {
        "name": "Apple TV",
        "slug": "apple-tv",
        "ua_local": True,
    },
    "disney_plus": {
        "name": "Disney+",
        "slug": "disney",
        "ua_local": False,
        "fallback_note": "Disney+ не имеет локального чарта Украины; показан мировой рейтинг.",
    },
    "paramount_plus": {
        "name": "Paramount+",
        "slug": "paramount-plus",
        "ua_local": False,
        "fallback_note": "Paramount+ не имеет локального чарта Украины; показан мировой рейтинг.",
    },
}

MONTHS = {
    "January": 1,
    "February": 2,
    "March": 3,
    "April": 4,
    "May": 5,
    "June": 6,
    "July": 7,
    "August": 8,
    "September": 9,
    "October": 10,
    "November": 11,
    "December": 12,
}

HEADING_RE = re.compile(r"^(#{2,4})\s+(.+?)\s*$")
RANK_RE = re.compile(r"^\s*\|?\s*(\d{1,2})\.\s*(?:\||\s)")
TITLE_LINK_RE = re.compile(
    r"\[([^\]]+)\]\((?:https?://)?(?:www\.)?flixpatrol\.com/title/[^)]+\)",
    re.IGNORECASE,
)
ANY_MD_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
DATE_RE = re.compile(
    r"\bon\s+"
    r"(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),\s+(\d{4})\b",
    re.IGNORECASE,
)

CHANGE_RE = re.compile(r"^(?:[+\-]\d+|n/?a|–|—|-)$", re.IGNORECASE)
DAYS_RE = re.compile(r"^\d+\s*(?:d|day|days)$", re.IGNORECASE)
POINTS_RE = re.compile(r"^[\d,\s]+$")


def load_previous() -> dict[str, Any]:
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        if isinstance(data, dict) and int(data.get("schema", 0)) >= 4:
            return data
    except Exception:
        pass
    return {}


def jina_url(service_slug: str, region: str) -> str:
    if region == "UA":
        return f"{JINA_PREFIX}/{service_slug}/ukraine/"
    return f"{JINA_PREFIX}/{service_slug}/"


def source_url(service_slug: str, region: str) -> str:
    if region == "UA":
        return f"https://flixpatrol.com/top10/{service_slug}/ukraine/"
    return f"https://flixpatrol.com/top10/{service_slug}/"


def fetch_reader(url: str, attempts: int = 3) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; StreamingTopsLampa/2.0)",
        "Accept": "text/plain,text/markdown,*/*",
        "X-Return-Format": "markdown",
    }

    last_error: Exception | None = None

    for attempt in range(1, attempts + 1):
        try:
            request = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(request, timeout=90) as response:
                raw = response.read()
            text = raw.decode("utf-8", errors="replace")
            if len(text.strip()) < 100:
                raise RuntimeError("Reader returned an unexpectedly short response")
            return text
        except Exception as exc:
            last_error = exc
            if attempt < attempts:
                time.sleep(3 * attempt)

    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def parse_date(text: str) -> str:
    match = DATE_RE.search(text)
    if not match:
        return ""

    month_name = match.group(1).capitalize()
    month = MONTHS.get(month_name)
    if not month:
        return ""

    try:
        parsed = date(int(match.group(3)), month, int(match.group(2)))
        return parsed.isoformat()
    except ValueError:
        return ""


def normalize_heading(text: str) -> str:
    text = re.sub(r"\[[^\]]+\]\([^)]+\)", "", text)
    text = text.replace("*", "").strip().lower()
    return re.sub(r"\s+", " ", text)


def chart_key_from_heading(text: str) -> str | None:
    normalized = normalize_heading(text)

    if "kids" in normalized:
        return None

    if "tv show" in normalized:
        return "tv"

    if "movie" in normalized or "films" in normalized:
        return "movies"

    if "overall" in normalized:
        return "overall"

    return None


def clean_markdown(value: str) -> str:
    value = ANY_MD_LINK_RE.sub(lambda m: m.group(1), value)
    value = value.replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", value).strip(" \t|")


def extract_title_from_row(line: str) -> str:
    match = TITLE_LINK_RE.search(line)
    if match:
        return clean_markdown(match.group(1))

    # Jina often keeps FlixPatrol links, but this is a fallback if it emits
    # plain text cells.
    cells = [clean_markdown(cell) for cell in line.split("|")]
    cells = [cell for cell in cells if cell]

    rank_index = None
    for index, cell in enumerate(cells):
        if re.fullmatch(r"\d{1,2}\.", cell):
            rank_index = index
            break

    if rank_index is None:
        return ""

    for cell in cells[rank_index + 1 :]:
        if not cell:
            continue
        if CHANGE_RE.fullmatch(cell):
            continue
        if DAYS_RE.fullmatch(cell):
            continue
        # Global tables have a numeric score after the title. Skip it.
        if POINTS_RE.fullmatch(cell):
            continue
        lowered = cell.lower()
        if lowered in {"overview", "full details"}:
            continue
        return cell

    return ""


def extract_rows(lines: list[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []

    for line in lines:
        rank_match = RANK_RE.match(line)
        if not rank_match:
            continue

        rank = int(rank_match.group(1))
        if rank < 1 or rank > 10:
            continue

        title = extract_title_from_row(line)
        if not title:
            continue

        # Preserve source order and duplicates exactly. Do not dedupe.
        items.append(
            {
                "rank": rank,
                "title": title,
                "search_title": title,
            }
        )

    # Some Reader layouts may accidentally duplicate the same row while
    # keeping identical rank+title. Remove only exact rendering duplicates,
    # NOT different ranks of the same title.
    seen: set[tuple[int, str]] = set()
    clean: list[dict[str, Any]] = []
    for item in items:
        signature = (item["rank"], item["title"])
        if signature in seen:
            continue
        seen.add(signature)
        clean.append(item)

    clean.sort(key=lambda item: item["rank"])
    return clean[:10]


def parse_charts(markdown: str) -> tuple[str, dict[str, list[dict[str, Any]]]]:
    lines = markdown.splitlines()
    page_date = parse_date(markdown[:12000])

    headings: list[tuple[int, int, str]] = []
    for index, line in enumerate(lines):
        match = HEADING_RE.match(line.strip())
        if not match:
            continue
        headings.append((index, len(match.group(1)), match.group(2).strip()))

    charts: dict[str, list[dict[str, Any]]] = {
        "movies": [],
        "tv": [],
        "overall": [],
    }

    for position, (line_index, level, heading_text) in enumerate(headings):
        key = chart_key_from_heading(heading_text)
        if not key:
            continue

        # Accept headings that look like actual ranking sections.
        normalized = normalize_heading(heading_text)
        if "top" not in normalized:
            continue

        end = len(lines)
        for next_index, next_level, _ in headings[position + 1 :]:
            if next_level <= level:
                end = next_index
                break

        rows = extract_rows(lines[line_index + 1 : end])
        if len(rows) > len(charts[key]):
            charts[key] = rows

    return page_date, charts


def has_any_chart(service: dict[str, Any] | None) -> bool:
    if not service:
        return False
    charts = service.get("charts") or {}
    return any(bool(charts.get(key)) for key in ("movies", "tv", "overall"))


def parse_iso_date(value: str) -> date | None:
    try:
        return date.fromisoformat(value)
    except Exception:
        return None


def previous_service(
    previous: dict[str, Any],
    region_key: str,
    service_key: str,
) -> dict[str, Any] | None:
    try:
        item = previous["regions"][region_key]["services"][service_key]
        if isinstance(item, dict) and has_any_chart(item):
            return copy.deepcopy(item)
    except Exception:
        pass
    return None


def mark_source(items: list[dict[str, Any]], url: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for raw in items:
        item = dict(raw)
        item["source_url"] = url
        result.append(item)
    return result


def fetch_service(service_key: str, region_key: str) -> dict[str, Any]:
    config = SERVICES[service_key]
    reader = jina_url(config["slug"], region_key)
    public_url = source_url(config["slug"], region_key)

    markdown = fetch_reader(reader)
    page_date, charts = parse_charts(markdown)

    charts = {
        key: mark_source(value, public_url)
        for key, value in charts.items()
    }

    result = {
        "name": config["name"],
        "date": page_date,
        "scope": "local" if region_key == "UA" else "world",
        "source_url": public_url,
        "reader_url": reader,
        "stale": False,
        "charts": charts,
    }

    if not has_any_chart(result):
        raise RuntimeError(f"No Top 10 rows parsed for {service_key} / {region_key}")

    return result


def is_recent_enough(item: dict[str, Any], max_age_days: int = 3) -> bool:
    parsed = parse_iso_date(str(item.get("date") or ""))
    if not parsed:
        return False
    age = (datetime.now(timezone.utc).date() - parsed).days
    return 0 <= age <= max_age_days


def build() -> dict[str, Any]:
    previous = load_previous()

    world_services: dict[str, Any] = {}
    ua_services: dict[str, Any] = {}
    errors: list[str] = []

    # World data first so it can be used as a clean fallback for Ukraine.
    for service_key in SERVICES:
        try:
            print(f"[WORLD] Fetching {SERVICES[service_key]['name']}...")
            world_services[service_key] = fetch_service(service_key, "WORLD")
            print(
                f"  OK date={world_services[service_key].get('date') or '?'} "
                f"charts="
                + ",".join(
                    key
                    for key, value in world_services[service_key]["charts"].items()
                    if value
                )
            )
        except Exception as exc:
            message = f"WORLD {service_key}: {exc}"
            print("  WARNING", message)
            errors.append(message)

            old = previous_service(previous, "WORLD", service_key)
            if old:
                old["stale"] = True
                world_services[service_key] = old

        time.sleep(1)

    for service_key, config in SERVICES.items():
        if config.get("ua_local"):
            try:
                print(f"[UA] Fetching {config['name']}...")
                ua_services[service_key] = fetch_service(service_key, "UA")
                print(
                    f"  OK date={ua_services[service_key].get('date') or '?'} "
                    f"charts="
                    + ",".join(
                        key
                        for key, value in ua_services[service_key]["charts"].items()
                        if value
                    )
                )
            except Exception as exc:
                message = f"UA {service_key}: {exc}"
                print("  WARNING", message)
                errors.append(message)

                old = previous_service(previous, "UA", service_key)

                # Keep a recent local chart rather than replacing it immediately
                # with a global one because one Reader request failed.
                if old and old.get("scope") == "local" and is_recent_enough(old):
                    old["stale"] = True
                    ua_services[service_key] = old
                elif service_key in world_services and has_any_chart(world_services[service_key]):
                    fallback = copy.deepcopy(world_services[service_key])
                    fallback["scope"] = "world_fallback"
                    fallback["stale"] = False
                    fallback["note"] = (
                        "Локальный рейтинг Украины временно недоступен; "
                        "показан мировой рейтинг."
                    )
                    ua_services[service_key] = fallback
                elif old:
                    old["stale"] = True
                    ua_services[service_key] = old

            time.sleep(1)
        else:
            # Deliberate world fallback: no pretend Ukraine chart.
            world = world_services.get(service_key)
            if world and has_any_chart(world):
                fallback = copy.deepcopy(world)
                fallback["scope"] = "world_fallback"
                fallback["note"] = config.get("fallback_note", "")
                ua_services[service_key] = fallback
            else:
                old = previous_service(previous, "UA", service_key)
                if old:
                    old["stale"] = True
                    ua_services[service_key] = old

    if not world_services and not ua_services:
        raise RuntimeError(
            "No streaming charts could be fetched and no previous schema-4 data exists."
        )

    payload = {
        "schema": 4,
        "generated": True,
        "version": "2.0.0",
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "FlixPatrol public TOP 10 via Jina AI Reader",
        "source_note": (
            "Daily public rankings. Jina Reader is used as a free read-only proxy "
            "to reduce direct Cloudflare blocking."
        ),
        "regions": {
            "UA": {
                "name": "Украина",
                "services": ua_services,
            },
            "WORLD": {
                "name": "Мир",
                "services": world_services,
            },
        },
        "last_errors": errors[-20:],
    }

    return payload


def main() -> None:
    payload = build()

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    ua_count = len(payload["regions"]["UA"]["services"])
    world_count = len(payload["regions"]["WORLD"]["services"])
    print(f"Wrote {OUT}: UA services={ua_count}, WORLD services={world_count}")


if __name__ == "__main__":
    main()
