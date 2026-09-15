#!/usr/bin/env python3
"""
Streaming Tops updater v2.0.2

Free sources:
  FlixPatrol public aggregate Streaming TOP 10 pages
    -> Jina Reader first
    -> direct FlixPatrol fallback
    -> data/top10.json

Why aggregate pages:
- only 2 source pages are needed: Ukraine + World;
- they contain sections for multiple streaming services;
- far fewer anonymous Jina requests;
- no separate-service URL/slugs have to succeed independently.

The old filename update_netflix.py is intentionally preserved.
"""

from __future__ import annotations

import copy
import json
import re
import time
import urllib.request
from datetime import datetime, timedelta, timezone, date
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "top10.json"

UA_SLUG = "ukraine"
WORLD_SLUG = "world"

SERVICES = {
    "netflix": {"name": "Netflix"},
    "hbo_max": {"name": "HBO Max"},
    "prime_video": {"name": "Prime Video"},
    "apple_tv": {"name": "Apple TV"},
    "disney_plus": {"name": "Disney+"},
    "paramount_plus": {"name": "Paramount+"},
}

HEADING_RE = re.compile(r"^(#{1,4})\s+(.+?)\s*$")
RANK_RE = re.compile(r"^\s*(\d{1,2})\.")
TITLE_LINK_RE = re.compile(
    r"\[([^\]]+)\]\(https?://(?:www\.)?flixpatrol\.com/title/[^)]+\)",
    re.IGNORECASE,
)
ANY_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]+\)")
COMPACT_RE = re.compile(
    r"^(\d{1,2})\.[^[]*"
    r"\[([^\]]+)\]"
    r"\(https?://(?:www\.)?flixpatrol\.com/title/[^)]+\)",
    re.IGNORECASE,
)

CHANGE_RE = re.compile(r"^(?:[+\-]\d+|n/?a|–|—|-)$", re.IGNORECASE)
DAYS_RE = re.compile(r"^\d+\s*(?:d|day|days)$", re.IGNORECASE)
NUMERIC_RE = re.compile(r"^[\d,\.\s]+$")

MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}
DATE_RE = re.compile(
    r"\bon\s+"
    r"(January|February|March|April|May|June|July|August|September|October|November|December)"
    r"\s+(\d{1,2}),\s+(\d{4})\b",
    re.IGNORECASE,
)


def load_previous() -> dict[str, Any]:
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        if isinstance(data, dict) and int(data.get("schema", 0)) >= 4:
            return data
    except Exception:
        pass
    return {}


def clean_md(value: str) -> str:
    value = ANY_LINK_RE.sub(lambda m: m.group(1), value)
    value = value.replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", value).strip(" \t|")


def page_date(text: str) -> str:
    m = DATE_RE.search(text[:15000])
    if not m:
        return ""
    try:
        return date(int(m.group(3)), MONTHS[m.group(1).capitalize()], int(m.group(2))).isoformat()
    except Exception:
        return ""


def service_from_heading(text: str) -> str | None:
    low = clean_md(text).lower()

    # Apple TV Store is TVOD and is intentionally not the Apple TV SVOD service.
    if "apple tv store" in low:
        return None

    if "netflix" in low:
        return "netflix"
    if "hbo max" in low:
        return "hbo_max"
    if "amazon prime video" in low or "amazon prime" in low or "prime video" in low:
        return "prime_video"
    if "apple tv" in low:
        return "apple_tv"
    if "disney+" in low or "disney plus" in low:
        return "disney_plus"
    if "paramount+" in low or "paramount plus" in low:
        return "paramount_plus"
    return None


def chart_from_heading(text: str) -> str | None:
    low = clean_md(text).lower()

    if "kids" in low or "ranked" in low or "by day" in low or "by country" in low:
        return None
    if "tv show" in low or "tv shows" in low or "series" in low:
        return "tv"
    if "movie" in low or "movies" in low or "films" in low:
        return "movies"
    if "overall" in low:
        return "overall"
    return None


def extract_title(line: str) -> str:
    line = line.strip()

    compact = COMPACT_RE.match(line)
    if compact:
        return clean_md(compact.group(2))

    linked = TITLE_LINK_RE.search(line)
    if linked:
        return clean_md(linked.group(1))

    cells = [clean_md(x) for x in line.split("|")]
    cells = [x for x in cells if x]
    if not cells:
        return ""

    # Remove rank cell.
    if re.fullmatch(r"\d{1,2}\.", cells[0]):
        cells = cells[1:]

    # FlixPatrol country rows have a change column.
    if cells and CHANGE_RE.fullmatch(cells[0]):
        cells = cells[1:]

    for cell in cells:
        if not cell:
            continue
        if CHANGE_RE.fullmatch(cell):
            continue
        if DAYS_RE.fullmatch(cell):
            continue
        if NUMERIC_RE.fullmatch(cell):
            continue
        if cell.lower() in {"overview", "full details"}:
            continue
        return cell

    return ""


def extract_rows(lines: list[str]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen_exact: set[tuple[int, str]] = set()

    for raw in lines:
        line = raw.strip()
        m = RANK_RE.match(line)
        if not m:
            continue

        rank = int(m.group(1))
        if not 1 <= rank <= 10:
            continue

        title = extract_title(line)
        if not title:
            continue

        sig = (rank, title)
        if sig in seen_exact:
            continue
        seen_exact.add(sig)

        result.append({
            "rank": rank,
            "title": title,
            "search_title": title,
        })

    result.sort(key=lambda x: x["rank"])
    return result[:10]


def parse_aggregate(markdown: str) -> tuple[str, dict[str, Any]]:
    lines = markdown.splitlines()
    date_value = page_date(markdown)

    headings: list[tuple[int, int, str]] = []
    for i, line in enumerate(lines):
        m = HEADING_RE.match(line.strip())
        if m:
            headings.append((i, len(m.group(1)), m.group(2).strip()))

    services: dict[str, Any] = {}
    active_service: str | None = None

    for pos, (line_index, level, heading_text) in enumerate(headings):
        found_service = service_from_heading(heading_text)
        found_chart = chart_from_heading(heading_text)

        # Country aggregate:
        #   ## Netflix TOP 10 in Ukraine...
        #   ### TOP 10 Movies
        # World aggregate:
        #   ## TOP TV Shows on Netflix...
        if found_service and not found_chart:
            active_service = found_service
            continue

        service_key = found_service or active_service
        chart_key = found_chart

        if not service_key or not chart_key:
            continue

        # Stop at the next heading of the same or higher level.
        end = len(lines)
        for next_index, next_level, _ in headings[pos + 1:]:
            if next_level <= level:
                end = next_index
                break

        rows = extract_rows(lines[line_index + 1:end])
        if not rows:
            continue

        service = services.setdefault(service_key, {
            "name": SERVICES[service_key]["name"],
            "date": date_value,
            "charts": {"movies": [], "tv": [], "overall": []},
        })

        # Prefer the fuller section if the same chart appears twice.
        if len(rows) > len(service["charts"].get(chart_key, [])):
            service["charts"][chart_key] = rows

    return date_value, services


def target_urls(region_slug: str) -> list[str]:
    base = f"https://flixpatrol.com/top10/streaming/{region_slug}/"
    today = datetime.now(timezone.utc).date()

    # Current alias first; then explicit recent dates.
    urls = [base]
    for days_back in range(0, 4):
        d = today - timedelta(days=days_back)
        urls.append(f"{base}{d.isoformat()}/")

    # preserve order, remove duplicates
    return list(dict.fromkeys(urls))


def http_get(url: str, via_jina: bool) -> str:
    fetch_url = f"https://r.jina.ai/{url}" if via_jina else url

    headers = {
        "User-Agent": "streaming-tops-lampa/2.0.2 (+https://github.com/)",
        "Accept": "text/plain" if via_jina else "text/html,application/xhtml+xml,*/*",
    }
    if via_jina:
        headers["X-Return-Format"] = "markdown"

    req = urllib.request.Request(fetch_url, headers=headers)
    with urllib.request.urlopen(req, timeout=70 if via_jina else 35) as response:
        raw = response.read()

    return raw.decode("utf-8", errors="replace")


def content_looks_useful(text: str, region_slug: str) -> bool:
    if len(text.strip()) < 200:
        return False
    if "Page Not Found" in text:
        return False

    # We intentionally do not require one exact title sentence. The aggregate
    # page only needs a recognisable streaming/Top 10 heading + ranked rows.
    has_top = bool(re.search(r"TOP\s+10|TOP\s+(?:TV Shows|Movies)", text, re.IGNORECASE))
    has_region = (
        "Ukraine" in text if region_slug == UA_SLUG
        else bool(re.search(r"\bWorld\b|\bWorldwide\b", text, re.IGNORECASE))
    )
    has_ranks = bool(re.search(r"(?m)^\s*1\.", text))

    return has_top and has_region and has_ranks


def fetch_region(region_slug: str) -> tuple[str, dict[str, Any], str]:
    errors: list[str] = []

    # Jina first. We try explicit dates too because root aliases occasionally
    # return a non-target response from a cache/proxy.
    for target in target_urls(region_slug):
        for via_jina in (True, False):
            transport = "Jina" if via_jina else "direct"
            try:
                print(f"  trying {transport}: {target}")
                text = http_get(target, via_jina=via_jina)

                if not content_looks_useful(text, region_slug):
                    errors.append(f"{transport} invalid content: {target}")
                    continue

                date_value, services = parse_aggregate(text)
                if services:
                    return date_value, services, target

                errors.append(f"{transport} parsed zero services: {target}")
            except Exception as exc:
                errors.append(f"{transport} {target}: {exc}")

            # Keep anonymous requests gentle.
            if via_jina:
                time.sleep(2.2)

    raise RuntimeError("; ".join(errors[-8:]))


def previous_region(previous: dict[str, Any], key: str) -> dict[str, Any] | None:
    try:
        region = previous["regions"][key]
        if isinstance(region, dict) and region.get("services"):
            return copy.deepcopy(region)
    except Exception:
        pass
    return None


def add_source_metadata(
    services: dict[str, Any],
    scope: str,
    source_url: str,
    stale: bool = False,
) -> dict[str, Any]:
    out: dict[str, Any] = {}

    for key, raw in services.items():
        if key not in SERVICES:
            continue

        item = copy.deepcopy(raw)
        item["scope"] = scope
        item["source_url"] = source_url
        item["stale"] = stale

        for chart_key, rows in (item.get("charts") or {}).items():
            for row in rows:
                row["source_url"] = source_url

        out[key] = item

    return out


def build() -> dict[str, Any]:
    previous = load_previous()
    errors: list[str] = []

    ua_region = None
    world_region = None

    print("[UA] Fetching aggregate Streaming page...")
    try:
        ua_date, ua_services, ua_source = fetch_region(UA_SLUG)
        ua_region = {
            "name": "Украина",
            "date": ua_date,
            "services": add_source_metadata(ua_services, "local", ua_source),
        }
        print("  OK services:", ", ".join(ua_region["services"].keys()))
    except Exception as exc:
        msg = f"UA aggregate: {exc}"
        print("  WARNING", msg)
        errors.append(msg)
        ua_region = previous_region(previous, "UA")
        if ua_region:
            for item in ua_region.get("services", {}).values():
                item["stale"] = True

    print("[WORLD] Fetching aggregate Streaming page...")
    try:
        world_date, world_services, world_source = fetch_region(WORLD_SLUG)
        world_region = {
            "name": "Мир",
            "date": world_date,
            "services": add_source_metadata(world_services, "world", world_source),
        }
        print("  OK services:", ", ".join(world_region["services"].keys()))
    except Exception as exc:
        msg = f"WORLD aggregate: {exc}"
        print("  WARNING", msg)
        errors.append(msg)
        world_region = previous_region(previous, "WORLD")
        if world_region:
            for item in world_region.get("services", {}).values():
                item["stale"] = True

    if world_region is None and ua_region is None:
        raise RuntimeError(
            "Both aggregate pages failed and there is no previous Streaming Tops data."
        )

    if world_region is None:
        world_region = {"name": "Мир", "services": {}}

    if ua_region is None:
        ua_region = {"name": "Украина", "services": {}}

    # For services without a Ukraine local chart, explicitly use World.
    for service_key in ("disney_plus", "paramount_plus"):
        if service_key not in ua_region["services"]:
            world_item = world_region["services"].get(service_key)
            if world_item:
                fallback = copy.deepcopy(world_item)
                fallback["scope"] = "world_fallback"
                fallback["note"] = (
                    "Локального рейтинга Украины для этого сервиса нет; "
                    "показан мировой рейтинг."
                )
                ua_region["services"][service_key] = fallback

    # If a normally local service temporarily disappears from the Ukraine
    # aggregate, prefer yesterday's local data; only then use World.
    old_ua = previous_region(previous, "UA") or {"services": {}}
    for service_key in ("netflix", "hbo_max", "prime_video", "apple_tv"):
        if service_key in ua_region["services"]:
            continue

        old_item = old_ua.get("services", {}).get(service_key)
        if old_item and old_item.get("scope") == "local":
            fallback = copy.deepcopy(old_item)
            fallback["stale"] = True
            ua_region["services"][service_key] = fallback
            continue

        world_item = world_region["services"].get(service_key)
        if world_item:
            fallback = copy.deepcopy(world_item)
            fallback["scope"] = "world_fallback"
            fallback["note"] = (
                "Локальный рейтинг Украины временно недоступен; "
                "показан мировой рейтинг."
            )
            ua_region["services"][service_key] = fallback

    return {
        "schema": 4,
        "generated": True,
        "version": "2.0.2",
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "FlixPatrol public aggregate Streaming TOP 10",
        "source_note": (
            "Two aggregate pages are fetched (Ukraine and World), preferably "
            "through Jina Reader with direct FlixPatrol fallback."
        ),
        "regions": {
            "UA": ua_region,
            "WORLD": world_region,
        },
        "last_errors": errors[-20:],
    }


def main() -> None:
    payload = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print("Wrote", OUT)
    print("UA:", ", ".join(payload["regions"]["UA"]["services"].keys()) or "(none)")
    print("WORLD:", ", ".join(payload["regions"]["WORLD"]["services"].keys()) or "(none)")


if __name__ == "__main__":
    main()
