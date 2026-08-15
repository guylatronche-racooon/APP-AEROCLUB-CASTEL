#!/usr/bin/env python3
"""Add official SIA ARP coordinates to the packaged airfield catalogue.

The application keeps the AIRAC dataset offline.  This helper reads the SIA
AD 1.3 XHTML used by that dataset and copies only each ADHP latitude and
longitude into app/data/airfields.json.  It is a maintenance tool, not a
runtime network dependency.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOGUE = ROOT / "app" / "data" / "airfields.json"


def text_between(row: str, field: str) -> str | None:
    match = re.search(
        rf'<span[^>]+id="[^"]*ADHP\.{re.escape(field)}"[^>]*>(.*?)</span>',
        row,
        flags=re.DOTALL,
    )
    if not match:
        return None
    value = re.sub(r"<[^>]+>", "", match.group(1))
    value = html.unescape(value).strip()
    return re.sub(r"\s+", " ", value) or None


def dms_to_decimal(value: str) -> float:
    match = re.fullmatch(
        r"(\d{2,3})°(\d{2})'(\d{2}(?:\.\d+)?)\"([NSEW])",
        value.strip(),
    )
    if not match:
        raise ValueError(f"Coordonnée SIA non reconnue : {value!r}")
    degrees, minutes, seconds = map(float, match.groups()[:3])
    result = degrees + minutes / 60 + seconds / 3600
    return -result if match.group(4) in {"S", "W"} else result


def coordinates_from_ad13(source: str) -> dict[str, tuple[float, float]]:
    coordinates: dict[str, tuple[float, float]] = {}
    for row in re.findall(r"<tr\b[^>]*>.*?</tr>", source, flags=re.DOTALL):
        icao = text_between(row, "CODE_ICAO")
        latitude = text_between(row, "GEO_LAT")
        longitude = text_between(row, "GEO_LONG")
        if not icao or not latitude or not longitude or not re.fullmatch(r"[A-Z]{4}", icao):
            continue
        coordinates[icao] = (dms_to_decimal(latitude), dms_to_decimal(longitude))
    return coordinates


def read_source(path: Path | None, url: str) -> bytes:
    if path:
        return path.read_bytes()
    request = urllib.request.Request(url, headers={"User-Agent": "Outils-de-vol-ACJD/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalogue", type=Path, default=CATALOGUE)
    parser.add_argument("--html", type=Path, help="Copie locale du XHTML AD 1.3")
    args = parser.parse_args()

    payload = json.loads(args.catalogue.read_text(encoding="utf-8"))
    source_url = payload["sourceUrl"]
    source_bytes = read_source(args.html, source_url)
    source_text = source_bytes.decode("utf-8")
    coordinates = coordinates_from_ad13(source_text)

    missing: list[str] = []
    for airfield in payload["airfields"]:
        coordinate = coordinates.get(airfield["icao"])
        if not coordinate:
            missing.append(airfield["icao"])
            continue
        latitude, longitude = coordinate
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError(f"Coordonnées invraisemblables pour {airfield['icao']}")
        airfield["latitude"] = round(latitude, 7)
        airfield["longitude"] = round(longitude, 7)

    expected = len(payload["airfields"])
    if missing:
        raise RuntimeError(f"Coordonnées manquantes ({len(missing)}/{expected}) : {', '.join(missing[:20])}")
    if len(coordinates) < expected:
        raise RuntimeError(f"Seulement {len(coordinates)} coordonnées extraites pour {expected} terrains")

    payload["sourceHash"] = "sha256:" + hashlib.sha256(source_bytes).hexdigest()
    payload.setdefault("scope", {})["coordinates"] = "ARP SIA AD 1.3"
    args.catalogue.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{expected} terrains enrichis depuis {source_url}")


if __name__ == "__main__":
    main()
