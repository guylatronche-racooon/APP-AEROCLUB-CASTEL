#!/usr/bin/env python3
"""Enrich the local airfield catalogue from the official SIA VAC PDFs.

The importer deliberately keeps only full-runway declared distances. Reduced
distances from a taxiway/intersection are never used for automatic prefilling.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT / "app" / "data" / "airfields.json"
DEFAULT_REPORT = ROOT / "data" / "sia-vac-import-report.json"
DEFAULT_CACHE = ROOT / "tmp" / "sia-vac"
MONTHS = {
    1: "JAN",
    2: "FEB",
    3: "MAR",
    4: "APR",
    5: "MAY",
    6: "JUN",
    7: "JUL",
    8: "AUG",
    9: "SEP",
    10: "OCT",
    11: "NOV",
    12: "DEC",
}
USER_AGENT = "Outils-de-vol-ACJD/0.9 (official SIA VAC data import)"


@dataclass(frozen=True)
class VacDocument:
    icao: str
    url: str
    path: Path | None
    error: str | None = None


def cycle_folder(effective_date: str) -> str:
    value = date.fromisoformat(effective_date)
    return f"eAIP_{value.day:02d}_{MONTHS[value.month]}_{value.year}"


def vac_url(folder: str, icao: str) -> str:
    return (
        "https://www.sia.aviation-civile.gouv.fr/media/dvd/"
        f"{folder}/Atlas-VAC/PDF_AIPparSSection/VAC/AD/AD-2.{icao}.pdf"
    )


def valid_pdf(path: Path) -> bool:
    try:
        return path.stat().st_size > 1_000 and path.read_bytes()[:5] == b"%PDF-"
    except OSError:
        return False


def download_vac(icao: str, url: str, cache_dir: Path, refresh: bool) -> VacDocument:
    target = cache_dir / f"AD-2.{icao}.pdf"
    if not refresh and valid_pdf(target):
        return VacDocument(icao, url, target)

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            payload = response.read()
        if not payload.startswith(b"%PDF-"):
            return VacDocument(icao, url, None, f"réponse non PDF ({content_type or 'type inconnu'})")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        return VacDocument(icao, url, target)
    except urllib.error.HTTPError as error:
        return VacDocument(icao, url, None, f"HTTP {error.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return VacDocument(icao, url, None, str(error))


def pdf_text(path: Path) -> str:
    process = subprocess.run(
        ["pdftotext", "-layout", str(path), "-"],
        check=False,
        capture_output=True,
    )
    if process.returncode != 0:
        raise RuntimeError(process.stderr.decode("utf-8", errors="replace").strip() or "pdftotext a échoué")
    return process.stdout.decode("utf-8", errors="replace").replace("\u00a0", " ")


def standalone_token(text: str, token: str) -> bool:
    return re.search(rf"(?<![A-Z0-9]){re.escape(token.upper())}(?![A-Z0-9])", text.upper()) is not None


def runway_id_token(text: str, runway_id: str) -> bool:
    match = re.fullmatch(r"(\d{2})([LRC]?)", runway_id.upper())
    if not match:
        return standalone_token(text, runway_id)
    number, suffix = match.groups()
    if suffix:
        pattern = rf"(?<![A-Z0-9]){re.escape(number)}\s*{suffix}(?![A-Z0-9])"
    else:
        # A bare QFU such as 14 must never match 14L/14R when the PDF inserts
        # a space between the number and the suffix. This is safety-critical:
        # parallel runways can have different declared distances.
        pattern = rf"(?<![A-Z0-9]){re.escape(number)}(?!\s*[LRC](?![A-Z0-9]))(?![A-Z0-9])"
    return re.search(pattern, text.upper()) is not None


def heading_tokens(runway: dict) -> tuple[str, ...]:
    heading = runway.get("trueHeadingDeg")
    if not isinstance(heading, (int, float)):
        return ()
    rounded = int(round(heading)) % 360
    tokens = {f"{rounded:03d}"}
    if rounded == 0:
        tokens.add("360")
    return tuple(sorted(tokens))


def distance_from_segment(segment: str) -> int | None:
    cleaned = re.sub(r"\(\s*\d+\s*\)", " ", segment)
    match = re.search(r"(?<![\d.,])(\d{3,4})(?![\d.,])", cleaned)
    return int(match.group(1)) if match else None


def table_rows(text: str) -> list[dict]:
    lines = text.splitlines()
    headers = []
    seen_headers = set()
    for index, line in enumerate(lines):
        if not any(label in line.upper() for label in ("TODA", "ASDA", "LDA")):
            continue
        window_start = max(0, index - 2)
        window_end = min(len(lines), index + 3)
        surrounding_header = " ".join(lines[window_start:window_end]).upper()
        if not all(label in surrounding_header for label in ("TODA", "ASDA", "LDA")):
            continue
        if "QFU" not in surrounding_header or "RWY" not in surrounding_header:
            continue
        positions = {}
        label_lines = {}
        for name in ("TODA", "ASDA", "LDA"):
            for label_index in range(window_start, window_end):
                position = lines[label_index].upper().find(name)
                if position >= 0:
                    positions[name] = position
                    label_lines[name] = label_index
                    break
        if min(positions.values()) < 0 or not (positions["TODA"] < positions["ASDA"] < positions["LDA"]):
            continue
        header_index = max(label_lines.values())
        header_key = (header_index, tuple(positions.values()))
        if header_key not in seen_headers:
            headers.append((header_index, positions))
            seen_headers.add(header_key)

    if not headers:
        return []

    rows = []
    seen_lines = set()
    for header_index, _columns in headers:
        for offset in range(header_index + 1, min(len(lines), header_index + 45)):
            line = lines[offset]
            upper = line.upper()
            if "AIDES LUMINEUSES" in upper or "LIGHTING AIDS" in upper or "BALISAGE" in upper:
                break
            if not line.strip() or offset in seen_lines:
                continue
            cleaned = re.sub(r"\(\s*\d+\s*\)", " ", upper)
            tokens = re.findall(r"(?<![\d.,])(?:\d{3,4}|NIL)(?![\d.,])", cleaned)
            if len(tokens) < 3:
                continue
            toda_token, asda_token, lda_token = tokens[-3:]
            value = lambda token: None if token == "NIL" else int(token)
            rows.append(
                {
                    "lineIndex": offset,
                    "prefix": upper,
                    "todaM": value(toda_token),
                    "asdaM": value(asda_token),
                    "ldaM": value(lda_token),
                    "lines": lines,
                }
            )
            seen_lines.add(offset)
    return rows


def surface_family(text: str) -> str | None:
    upper = text.upper()
    if any(marker in upper for marker in ("NON REV", "UNPAVED", "HERBE", "GRASS", "GAZON")):
        return "unpaved"
    if any(marker in upper for marker in ("REVÊT", "REVET", "PAVED", "ASPHALT", "BÉTON", "BETON")):
        return "hard"
    return None


def candidate_score(row: dict, runway: dict) -> int | None:
    runway_id = str(runway.get("id", "")).upper()
    prefix = row["prefix"]
    if any(marker in prefix for marker in ("TWY", "INTERSECTION", "DEPUIS", "FROM")):
        return None
    runway_surface = "hard" if runway.get("surface") == "hard" else "unpaved"
    # Only use the row itself for the surface discriminator. A wrapped row can
    # sit between two different surfaces, so borrowing both neighbours would
    # incorrectly reject the continuation line.
    detected_surface = surface_family(prefix)
    if detected_surface is not None and detected_surface != runway_surface:
        return None
    surface_penalty = 0 if detected_surface == runway_surface else 1
    has_id = bool(runway_id) and runway_id_token(prefix, runway_id)
    has_heading = any(standalone_token(prefix, token) for token in heading_tokens(runway))
    if has_id and has_heading:
        return surface_penalty
    if has_id:
        return 2 + surface_penalty
    row_starts_with_other_qfu = re.match(r"^\s*\d{2}(?!\d)", prefix) is not None
    if not row_starts_with_other_qfu:
        nearby_scores = []
        for delta in (-1, 1, -2, 2):
            line_index = row["lineIndex"] + delta
            if line_index < 0 or line_index >= len(row["lines"]):
                continue
            context_line = row["lines"][line_index].upper()
            if not runway_id_token(context_line, runway_id):
                continue
            context_heading = any(
                standalone_token(context_line, token) for token in heading_tokens(runway)
            )
            nearby_scores.append(4 + 2 * abs(delta) + (0 if context_heading else 1) + surface_penalty)
        if nearby_scores:
            return min(nearby_scores)
    return None


def explicit_tora(text: str, runway_id: str) -> int | None:
    runway_id = runway_id.upper()
    patterns = (
        rf"\bTORA\s+(?:RWY|PISTE)\s*{re.escape(runway_id)}\s*[:=]\s*(\d{{3,4}})\s*M\b",
        rf"\b(?:RWY|PISTE)\s*{re.escape(runway_id)}\b[^\n]{{0,35}}\bTORA\s*[:=]\s*(\d{{3,4}})\s*M\b",
    )
    for line in text.upper().splitlines():
        if any(marker in line for marker in ("TWY", "INTERSECTION", "DEPUIS", "FROM", "MIL", "RÉDUIT", "REDUIT")):
            continue
        for pattern in patterns:
            match = re.search(pattern, line)
            if match:
                return int(match.group(1))
    return None


def declared_distances(text: str, runway: dict) -> tuple[dict | None, str | None]:
    candidates = []
    for row in table_rows(text):
        score = candidate_score(row, runway)
        if score is not None:
            candidates.append((score, row))
    if not candidates:
        return None, "ligne QFU non reconnue dans la table des distances déclarées"

    candidates.sort(key=lambda item: item[0])
    best_score = candidates[0][0]
    best_rows = [row for score, row in candidates if score == best_score]
    unique_values = {(row["todaM"], row["asdaM"], row["ldaM"]) for row in best_rows}
    if len(unique_values) != 1:
        return None, "plusieurs lignes de distances possibles"
    row = best_rows[0]

    if row["todaM"] is None or row["asdaM"] is None:
        return {
            "toraM": None,
            "todaM": row["todaM"],
            "asdaM": row["asdaM"],
            "ldaM": row["ldaM"],
            "toraMethod": None,
            "declaredDistanceStatus": "takeoff_not_published",
        }, None

    length = runway.get("lengthM")
    tora_candidates = [row["todaM"], row["asdaM"]]
    if isinstance(length, (int, float)) and length > 0:
        tora_candidates.append(int(round(length)))
    tora = min(tora_candidates)
    explicit = explicit_tora(text, str(runway.get("id", "")))
    method = "explicit" if explicit is not None else "inferred_from_declared_table"
    if explicit is not None:
        tora = explicit

    result = {
        "toraM": tora,
        "todaM": row["todaM"],
        "asdaM": row["asdaM"],
        "ldaM": row["ldaM"],
        "toraMethod": method,
        "declaredDistanceStatus": "published",
    }
    if not (0 < result["toraM"] <= result["todaM"] and result["toraM"] <= result["asdaM"]):
        return None, f"distances incohérentes {result}"
    return result, None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--strict", action="store_true", help="fail if a published VAC or a runway row cannot be read")
    args = parser.parse_args()

    catalogue = json.loads(args.data.read_text(encoding="utf-8"))
    airfields = catalogue.get("airfields", [])
    folder = cycle_folder(catalogue["effectiveDate"])
    cache_dir = args.cache_dir / folder
    cache_dir.mkdir(parents=True, exist_ok=True)

    documents: dict[str, VacDocument] = {}
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as executor:
        futures = {}
        for airfield in airfields:
            icao = airfield["icao"]
            url = vac_url(folder, icao)
            futures[executor.submit(download_vac, icao, url, cache_dir, args.refresh)] = icao
        completed = 0
        for future in as_completed(futures):
            document = future.result()
            documents[document.icao] = document
            completed += 1
            if completed % 25 == 0 or completed == len(futures):
                print(f"Téléchargement VAC : {completed}/{len(futures)}", flush=True)

    report = {
        "cycle": catalogue.get("cycle"),
        "effectiveDate": catalogue.get("effectiveDate"),
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "sourceTemplate": vac_url(folder, "{ICAO}"),
        "airfields": len(airfields),
        "vacAvailable": 0,
        "vacMissing": [],
        "runways": 0,
        "runwaysMatched": 0,
        "runwaysEnriched": 0,
        "runwaysTakeoffNotPublished": 0,
        "runwaysUnresolved": [],
    }

    for airfield in airfields:
        icao = airfield["icao"]
        document = documents[icao]
        runways = airfield.get("runways", [])
        report["runways"] += len(runways)
        for runway in runways:
            for key in ("toraM", "todaM", "asdaM", "ldaM"):
                runway[key] = None
            runway.pop("toraMethod", None)
            runway.pop("declaredDistanceSource", None)
            runway.pop("declaredDistanceStatus", None)
        airfield.pop("vacSource", None)
        airfield.pop("vacAvailability", None)
        if document.path is None:
            report["vacMissing"].append({"icao": icao, "reason": document.error})
            airfield["vacUrl"] = "https://www.sia.aviation-civile.gouv.fr/atlas-vac.html"
            airfield["vacAvailability"] = "not_published_in_atlas"
            continue

        report["vacAvailable"] += 1
        airfield["vacUrl"] = document.url
        airfield["vacAvailability"] = "direct"
        airfield["vacSource"] = {
            "provider": "SIA",
            "publication": "Atlas VAC",
            "cycle": catalogue.get("cycle"),
            "effectiveDate": catalogue.get("effectiveDate"),
            "url": document.url,
        }
        try:
            text = pdf_text(document.path)
        except RuntimeError as error:
            for runway in runways:
                report["runwaysUnresolved"].append({"icao": icao, "runway": runway.get("id"), "reason": str(error)})
            continue

        for runway in runways:
            distances, error = declared_distances(text, runway)
            if distances is None:
                runway["declaredDistanceStatus"] = (
                    "conditional_or_ambiguous"
                    if error == "plusieurs lignes de distances possibles"
                    else "not_listed_in_vac_table"
                )
                report["runwaysUnresolved"].append({"icao": icao, "runway": runway.get("id"), "reason": error})
                continue
            runway.update(distances)
            runway["declaredDistanceSource"] = "SIA VAC"
            report["runwaysMatched"] += 1
            if distances.get("declaredDistanceStatus") == "takeoff_not_published":
                report["runwaysTakeoffNotPublished"] += 1
            else:
                report["runwaysEnriched"] += 1

        airfield["sourceNote"] = (
            f"Données physiques SIA AD 1.3 et distances déclarées de la VAC {catalogue.get('cycle')} ; "
            "contrôler la VAC/AD 2, les NOTAM et les informations du jour."
        )

    report["vacMissingCount"] = len(report["vacMissing"])
    report["runwaysUnresolvedCount"] = len(report["runwaysUnresolved"])
    report["catalogueSha256BeforeWrite"] = hashlib.sha256(
        json.dumps(catalogue, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()

    field_notes = catalogue.setdefault("fieldNotes", {})
    field_notes["declaredDistances"] = (
        "TORA/TODA/ASDA/LDA proviennent de la table des distances déclarées de la VAC du cycle indiqué. "
        "Les départs depuis intersection/TWY sont exclus. Une valeur non lue demeure nulle."
    )
    catalogue["vacImport"] = {
        "cycle": catalogue.get("cycle"),
        "effectiveDate": catalogue.get("effectiveDate"),
        "source": "SIA — Atlas VAC",
        "sourceTemplate": report["sourceTemplate"],
        "vacAvailable": report["vacAvailable"],
        "runwaysMatched": report["runwaysMatched"],
        "runwaysEnriched": report["runwaysEnriched"],
        "runwaysTakeoffNotPublished": report["runwaysTakeoffNotPublished"],
        "runwaysUnresolved": report["runwaysUnresolvedCount"],
        "generatedAt": report["generatedAt"],
    }
    catalogue["schemaVersion"] = max(2, int(catalogue.get("schemaVersion", 1)))

    args.data.write_text(json.dumps(catalogue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"VAC disponibles : {report['vacAvailable']}/{report['airfields']} ; "
        f"QFU enrichis : {report['runwaysEnriched']}/{report['runways']} ; "
        f"non résolus : {report['runwaysUnresolvedCount']}",
        flush=True,
    )
    if args.strict and (report["vacMissingCount"] or report["runwaysUnresolvedCount"]):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
