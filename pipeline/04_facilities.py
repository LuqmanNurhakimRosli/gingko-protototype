"""Step 4 — critical facilities and the rail network, for exposure analysis.

Facilities (hospitals, clinics, schools, police, fire stations, rail stations)
come from Overture Maps places (OpenStreetMap and other open sources). They
are filtered by category, name and confidence, de-duplicated, kept only when
inside Selangor or the federal territories, and tagged with the score byte of
the grid cell they sit in. The app classifies that byte with the scenario
thresholds, exactly as it does for the map.

Rail lines come from Overture transportation segments; only operational lines
are kept (lines under construction such as ECRL and MRT3 are excluded).

Outputs
  public/data/facilities.json
  public/data/rail.json
"""
from __future__ import annotations

import gzip
import json
import pickle
import re
from collections import defaultdict
from datetime import date

import numpy as np
import pyarrow.compute as pc
import shapely
from shapely.geometry import mapping, shape

from common import CACHE, OUT, OVERTURE_RELEASE, write_json
from overture import read_window

KINDS = {
    # kind: (categories, must-match name regex, exclude regex, dedupe radius m, min confidence)
    "hospital": ({"hospital", "specialty_hospital", "emergency_department", "medical_center"},
                 r"\b(hospital|hospitál)\b",
                 r"farmasi|pharmacy|parking|parkir|letak kereta|caf[eé]|kafe|kantin|surau|\bwad\b|\bward\b|\bzon\b|"
                 r"\bunit\b|jabatan|department|emergency|kecemasan|klinik|clinic|makmal|\blab\b|dental|pergigian|"
                 r"veterin|haiwan|animal|pet\b|koperasi|kedai|shop|hostel|asrama|kuarters|quarters|pesakit luar|"
                 r"outpatient|fisio|physio|bilik|home care|to home|rumah",
                 300, 0.7),
    "clinic": ({"primary_care_or_general_clinic", "hospital", "medical_service", "walk_in_clinic",
                "urgent_care_clinic", "pediatric_clinic", "emergency_or_urgent_care_facility"},
               r"\b(klinik|clinic|poliklinik|polyclinic)\b",
               r"pergigian|dental|gigi|veterin|haiwan|animal|\bpet\b|eye|mata|optik|optical|hospital|"
               r"kecantikan|beauty|aesthetic|estetik|fisio|physio|spa\b",
               80, 0.5),
    "school": ({"elementary_school", "high_school", "middle_school"},
               r"\b(sk|sjk|sjkc|sjkt|smk|sma|smka|sekolah|school)\b",
               r"tadika|kindergarten|preschool|taska|tuition|tuisyen|memandu|driving|music|muzik|swim|renang",
               120, 0.5),
    "police": ({"police_station"}, r"\b(polis|police|ipd|ibu pejabat polis)\b",
               r"koperasi|kedai|shop|supplier|pembekal", 150, 0.5),
    "fire": ({"fire_station"}, r"\b(bomba|fire)\b",
             r"pembekal|alat|supplier|extinguisher|pemadam api|kementerian|sdn bhd|enterprise|trading|kelab|club|"
             r"latihan|training|kejuruteraan|engineering|bahagian|kebajikan|koperasi", 150, 0.5),
    # stations are additionally required to lie within 300 m of an operational rail line
    "station": ({"train_station"}, r".", r"\bbus\b|parking|taxi|teksi|depot|depoh|future|cadangan|platform|"
                r"darul ehsan|terminal udara|railway$", 250, 0.4),
}

LINES = [  # key, label, colour (operator colours, used only when the risk layer is off), name patterns
    ("kj", "LRT Kelana Jaya Line", "#D50032", [r"kelana jaya"]),
    ("ag", "LRT Ampang Line", "#E57200", [r"^ampang line$", r"ampang and sri petaling", r"安邦线和大城堡线"]),
    ("sp", "LRT Sri Petaling Line", "#76232F", [r"sri petaling", r"大城堡线"]),
    ("kg", "MRT Kajang Line", "#047940", [r"laluan kajang", r"kajang line"]),
    ("py", "MRT Putrajaya Line", "#C9A300", [r"laluan putrajaya", r"putrajaya line"]),
    ("sa", "LRT Shah Alam Line (LRT3)", "#00A9E0", [r"\blrt ?3\b", r"shah alam line"]),
    ("mr", "KL Monorail", "#84BD00", [r"monorail", r"monorel"]),
    ("erl", "KLIA Ekspres / Transit (ERL)", "#8D2A90", [r"^erl$", r"klia", r"吉隆坡机场快铁"]),
    ("ktm", "KTM", "#1D4E89", [r"\bktm\b", r"port klang", r"pelabuhan klang"]),
]
NOT_OPERATIONAL = r"east coast rail|ecrl|mrt ?3|circle line|future|depot|tunnel|spacewalk|\bapm\b"
# Overture has some pins whose name places them outside the study area; drop those.
OUT_OF_SCOPE = re.compile(
    r"port dickson|seremban|nilai\b|melaka|malacca|ipoh|tanjung rambutan|perak|pahang|kuantan|bentong|raub|"
    r"johor|penang|pulau pinang|kedah|kelantan|terengganu|sabah|sarawak|negeri sembilan|singapore|saudi|king fahd",
    re.I)


def load_grid():
    meta = json.load(open(OUT / "grid.json"))
    raw = gzip.decompress((OUT / "grid_core.bin.gz").read_bytes())
    n = meta["width"] * meta["height"]
    layers = {l["name"]: l for l in meta["files"]["grid_core.bin.gz"]}
    score = np.frombuffer(raw, np.uint8, n, layers["score"]["offset"])
    daerah = np.frombuffer(raw, np.uint8, n, layers["daerah"]["offset"])
    return meta, score, daerah


def cell_of(meta, lon, lat):
    c = int((lon - meta["x0"]) / meta["res"])
    r = int((meta["y1"] - lat) / meta["res"])
    if 0 <= c < meta["width"] and 0 <= r < meta["height"]:
        return r * meta["width"] + c
    return -1


def dedupe(rows, radius_m, prefer):
    """Greedy clustering on a coarse hash; keeps the preferred name per cluster."""
    if not rows:
        return []
    k = radius_m / 111_320
    rows = sorted(rows, key=prefer)
    kept, buckets = [], defaultdict(list)
    for r in rows:
        bx, by = int(r["c"][0] / k), int(r["c"][1] / k)
        clash = False
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for o in buckets[(bx + dx, by + dy)]:
                    if np.hypot((o["c"][0] - r["c"][0]) * np.cos(np.radians(r["c"][1])), o["c"][1] - r["c"][1]) < k:
                        clash = True
                        break
        if not clash:
            kept.append(r)
            buckets[(bx, by)].append(r)
    return kept


def build_rail(scope):
    print("rail …")
    seg = read_window("transportation", "segment", ["id", "geometry", "subtype", "class", "names", "bbox"])
    seg = seg.filter(pc.equal(seg.column("subtype"), "rail"))
    snames = seg.column("names").combine_chunks().field("primary").to_pylist()
    scls = seg.column("class").to_pylist()
    sgeo = shapely.from_wkb(seg.column("geometry").to_numpy(zero_copy_only=False))
    near = shapely.buffer(scope, 0.03)
    shapely.prepare(near)
    by_line: dict[str, list] = defaultdict(list)
    skipped = defaultdict(float)
    for n, c, g in zip(snames, scls, sgeo):
        label = (n or "").strip()
        if c in ("unknown", "tram", "funicular") or re.search(NOT_OPERATIONAL, label, re.I):
            skipped[label or c] += shapely.length(g) * 111
            continue
        if not near.intersects(g):
            continue
        key = "other"
        for k, _, _, pats in LINES:
            if any(re.search(p, label, re.I) for p in pats):
                key = k
                break
        by_line[key].append(shapely.intersection(g, near))
    feats = []
    for k, parts in by_line.items():
        merged = shapely.line_merge(shapely.union_all(parts))
        merged = shapely.set_precision(shapely.simplify(merged, 0.00008), 1e-5)
        feats.append({"type": "Feature", "properties": {"k": k}, "geometry": mapping(merged)})
        print(f"  {k:5s} {shapely.length(merged) * 111:6.1f} km")
    print("  excluded (not operational):", {k: round(v) for k, v in skipped.items() if v > 1})
    lines = {k: {"name": name, "color": col} for k, name, col, _ in LINES}
    lines["other"] = {"name": "Other rail", "color": "#6B7280"}
    write_json(OUT / "rail.json", {
        "type": "FeatureCollection", "features": feats, "lines": lines,
        "source": f"Overture Maps transportation {OVERTURE_RELEASE} (OpenStreetMap contributors, ODbL)",
        "retrieved": date.today().isoformat()})
    return feats


def main():
    vec = pickle.load(open(CACHE / "vectors.pkl", "rb"))
    scope = shapely.union_all([vec["selangor"], vec["kl"], vec["putrajaya"]])
    shapely.prepare(scope)
    meta, score, daerah = load_grid()
    rail_feats = build_rail(scope)
    rail_lines = shapely.union_all([shape(f["geometry"]) for f in rail_feats])
    near_rail = shapely.buffer(rail_lines, 300 / 111_320)
    shapely.prepare(near_rail)

    print("places …")
    t = read_window("places", "place", ["id", "geometry", "names", "basic_category", "confidence", "bbox"])
    names = t.column("names").combine_chunks().field("primary").to_pylist()
    cats = t.column("basic_category").to_pylist()
    conf = t.column("confidence").to_pylist()
    pts = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    xs, ys = shapely.get_x(pts), shapely.get_y(pts)

    facilities = []
    for kind, (catset, must, excl, radius, minconf) in KINDS.items():
        must_re, excl_re = re.compile(must, re.I), re.compile(excl, re.I)
        rows = []
        for n, c, cf, x, y in zip(names, cats, conf, xs, ys):
            if not n or c not in catset or (cf or 0) < minconf:
                continue
            n = " ".join(n.split())
            if not must_re.search(n) or excl_re.search(n) or OUT_OF_SCOPE.search(n):
                continue
            if not scope.contains(shapely.Point(x, y)):
                continue
            if kind == "station" and not near_rail.contains(shapely.Point(x, y)):
                continue
            rows.append({"n": n, "c": [round(float(x), 5), round(float(y), 5)], "cf": cf or 0})
        if kind == "hospital":
            prefer = lambda r: (not re.match(r"^hospital\b", r["n"], re.I), len(r["n"]), -r["cf"])  # noqa: E731
        else:
            prefer = lambda r: (-round(r["cf"], 1), len(r["n"]))  # noqa: E731
        kept = dedupe(rows, radius, prefer)
        for r in kept:
            i = cell_of(meta, *r["c"])
            if i < 0 or daerah[i] == 0:
                continue
            facilities.append({"k": kind, "n": r["n"], "c": r["c"], "d": int(daerah[i]), "s": int(score[i])})
        print(f"  {kind:8s} {len(rows):5d} candidates → {len(kept):5d} after de-duplication")

    write_json(OUT / "facilities.json", {
        "source": f"Overture Maps places {OVERTURE_RELEASE} (OpenStreetMap and other open sources)",
        "retrieved": date.today().isoformat(),
        "note": "Filtered by category, name and confidence and de-duplicated; s = score byte of the grid cell.",
        "kinds": {"hospital": "Hospitals", "clinic": "Clinics", "school": "Schools",
                  "police": "Police stations", "fire": "Fire & rescue (Bomba)", "station": "Rail stations"},
        "items": facilities})

if __name__ == "__main__":
    main()
