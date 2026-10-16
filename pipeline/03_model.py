"""Step 3 — Stage 1 susceptibility model, scenarios, aggregates, validation, export.

Susceptibility says WHERE riverine flooding is likely. It is not a forecast
(WHEN) and not a hydraulic simulation (no depths, no HEC-RAS).

    S = w_hand·HAND_score + w_prox·proximity_score + w_flat·flatness_score
      + w_elev·elevation_score + w_hist·history_score

Each term is mapped to 0–1 with a fixed physical transform (listed in
MODEL below and shipped to the app). Weights are illustrative, not fitted.
Stage 2 (a learned model) needs official flood-extent labels (JPS / DID)
that this build does not have, so it is not trained here.
"""
from __future__ import annotations

import gzip
import json
from datetime import date

import numpy as np
from scipy import ndimage

from common import CACHE, OUT, ROOT, write_json

DAERAH = ["Sabak Bernam", "Hulu Selangor", "Kuala Selangor", "Gombak", "Petaling",
          "Klang", "Kuala Langat", "Hulu Langat", "Sepang"]

MODEL = {
    "name": "Stage 1 weighted overlay",
    "weights_status": "illustrative — not calibrated against flood records",
    "terms": [
        {"key": "hand", "label": "Height above nearest drainage", "weight": 0.35,
         "transform": "exp(-HAND / 5 m)", "scale_m": 5.0,
         "why": "Water from an overflowing channel reaches ground that sits only a few metres above it (HAND < 5 m is the usual flood-prone band)."},
        {"key": "prox", "label": "Distance to river or canal", "weight": 0.20,
         "transform": "exp(-distance / 1500 m)", "scale_m": 1500.0,
         "why": "Riverine flooding spreads out from mapped channels."},
        {"key": "flat", "label": "Flatness", "weight": 0.15,
         "transform": "1 - min(slope / 8°, 1)", "scale_deg": 8.0,
         "why": "On flat ground water spreads and lingers instead of draining away."},
        {"key": "elev", "label": "Elevation above sea level", "weight": 0.15,
         "transform": "1 - min(elevation / 50 m, 1)", "scale_m": 50.0,
         "why": "Low coastal and valley-floor land is where rivers back up, especially at high tide."},
        {"key": "hist", "label": "Observed surface-water history", "weight": 0.15,
         "transform": "min(intermittent-water share / 25 %, 1)", "scale_share": 0.25,
         "why": "Places satellites have seen under water before (1984–2021) tend to be wet again."},
    ],
    # Rule table, not a hydraulic model: heavier rain lowers the score needed for each class.
    "scenarios": [
        {"key": "normal", "label": "Normal", "rain": "baseline", "high": 0.60, "moderate": 0.40,
         "note": "Susceptibility as computed."},
        {"key": "heavy", "label": "Heavy", "rain": "50 mm/hr (scenario)", "high": 0.55, "moderate": 0.35,
         "note": "Class thresholds lowered by 0.05 — more ground flagged."},
        {"key": "extreme", "label": "Extreme", "rain": "120 mm/hr (hypothetical stress scenario)", "high": 0.50, "moderate": 0.30,
         "note": "Thresholds lowered by 0.10. Hypothetical stress test, not an observed event."},
    ],
    "zone_min_km2": 0.5,
}

ANCHORS = [  # worked examples that fix the class thresholds in physical terms
    {"desc": "2 m above a river 300 m away, flat, 10 m above sea", "hand": 2, "dist": 300, "slope": 0.5, "elev": 10, "hist": 0},
    {"desc": "5 m above drainage, 1.5 km from a river, flat, 20 m above sea", "hand": 5, "dist": 1500, "slope": 1, "elev": 20, "hist": 0},
    {"desc": "10 m above drainage, 3 km from a river, 3° slope, 40 m above sea", "hand": 10, "dist": 3000, "slope": 3, "elev": 40, "hist": 0},
]


def terms(hand, dist, slope, elev, hist):
    t = {
        "hand": np.exp(-np.asarray(hand, float) / 5.0),
        "prox": np.exp(-np.asarray(dist, float) / 1500.0),
        "flat": 1.0 - np.clip(np.asarray(slope, float) / 8.0, 0, 1),
        "elev": 1.0 - np.clip(np.asarray(elev, float) / 50.0, 0, 1),
        "hist": np.clip(np.asarray(hist, float) / 0.25, 0, 1),
    }
    return t


def score_of(t):
    return sum(term["weight"] * t[term["key"]] for term in MODEL["terms"])


SCORE_STEPS = 200  # the app receives the score as one byte: round(score × 200)


def quantise(score):
    return np.clip(np.round(score * SCORE_STEPS), 0, SCORE_STEPS).astype(np.int16)


def classify(score_q, sc):
    """3 = High, 2 = Moderate, 1 = Low — on the quantised score, compared as integers,
    exactly as the app does it, so map, panels and these statistics agree."""
    hi, mo = round(sc["high"] * SCORE_STEPS), round(sc["moderate"] * SCORE_STEPS)
    return np.where(score_q >= hi, 3, np.where(score_q >= mo, 2, 1))


def main():
    g = dict(np.load(CACHE / "grid.npz"))
    X0, Y0, X1, Y1, RES, W, H, DX, DY = g["meta"]
    W, H = int(W), int(H)
    cell_km2 = DX * DY / 1e6
    daerah = g["daerah"]
    sel = (daerah >= 1) & (daerah <= 9)
    ft = daerah == 10
    water = (g["gsw_perm"] > 0.5) | (g["lc_water"] > 0.6)
    land = sel & ~water

    t = terms(g["hand"], g["chan_dist"], g["slope"], np.clip(g["dem"], 0, None), g["gsw_hist"])
    score_q = quantise(score_of(t))
    score = score_q / SCORE_STEPS

    for a in ANCHORS:
        s = float(score_of(terms(a["hand"], a["dist"], a["slope"], a["elev"], a["hist"])))
        a["score"] = round(s, 3)
        print(f"  anchor {s:.2f}  {a['desc']}")

    # ── population: HRSL distribution scaled to DOSM census district totals ──
    dosm = json.load(open(ROOT / "pipeline" / "dosm_census_2020.json"))
    pop = g["pop"].copy()
    pop[~(sel | ft)] = 0
    pop_scale = {}
    for i, n in enumerate(DAERAH):
        m = daerah == i + 1
        hrsl = pop[m].sum()
        target = dosm["districts"][n]["value"]
        pop_scale[n] = target / hrsl
        pop[m] *= pop_scale[n]

    # ── per-daerah aggregates ────────────────────────────────────────────────
    zone_min_cells = MODEL["zone_min_km2"] / cell_km2
    eight = np.ones((3, 3), bool)
    stats = []
    for i, n in enumerate(DAERAH):
        m = daerah == i + 1
        ml = m & land
        row = {
            "id": i + 1, "name": n,
            "area_km2": round(m.sum() * cell_km2, 1),
            "land_km2": round(ml.sum() * cell_km2, 1),
            "population": dosm["districts"][n]["value"],
            "population_hrsl": round(float(g["pop"][m].sum())),
            "built_pct": round(100 * float(g["lc_built"][m].mean()), 1),
            "built_km2": round(float(g["lc_built"][m].sum() * cell_km2), 1),
            "river_km": round(float(g["chan_len"][m].sum() / 1000), 1),
            "elev_min": round(float(np.percentile(g["dem"][ml], 1)), 1),
            "elev_max": round(float(g["dem"][ml].max()), 1),
            "hand_median": round(float(np.median(g["hand"][ml])), 1),
            "scenarios": {},
        }
        for sc in MODEL["scenarios"]:
            cls = classify(score_q, sc)
            hi = ml & (cls == 3)
            lab, nlab = ndimage.label(hi, structure=eight)
            sizes = np.bincount(lab.ravel())[1:] if nlab else np.array([])
            row["scenarios"][sc["key"]] = {
                "high_km2": round(hi.sum() * cell_km2, 1),
                "moderate_km2": round((ml & (cls == 2)).sum() * cell_km2, 1),
                "low_km2": round((ml & (cls == 1)).sum() * cell_km2, 1),
                "high_pct": round(100 * hi.sum() / ml.sum(), 1),
                "moderate_pct": round(100 * (ml & (cls == 2)).sum() / ml.sum(), 1),
                "zones": int((sizes >= zone_min_cells).sum()),
                "pop_high": round(float(pop[hi].sum()), -2),
                "pop_moderate": round(float(pop[ml & (cls == 2)].sum()), -2),
                "built_high_km2": round(float((g["lc_built"] * hi).sum() * cell_km2), 1),
            }
        stats.append(row)
        s = row["scenarios"]["normal"]
        print(f"  {n:15s} High {s['high_pct']:5.1f}%  Mod {s['moderate_pct']:5.1f}%  zones {s['zones']:3d}  pop-in-High {s['pop_high']:>9,.0f}")

    state = {"area_km2": round(sel.sum() * cell_km2, 1), "land_km2": round(land.sum() * cell_km2, 1),
             "population": dosm["state_total"]["value"], "scenarios": {}}
    for sc in MODEL["scenarios"]:
        k = sc["key"]
        hi = sum(r["scenarios"][k]["high_km2"] for r in stats)
        mo = sum(r["scenarios"][k]["moderate_km2"] for r in stats)
        state["scenarios"][k] = {
            "high_km2": round(hi, 1), "moderate_km2": round(mo, 1),
            "high_pct": round(100 * hi / state["land_km2"], 1),
            "moderate_pct": round(100 * mo / state["land_km2"], 1),
            "zones": sum(r["scenarios"][k]["zones"] for r in stats),
            "pop_high": round(sum(r["scenarios"][k]["pop_high"] for r in stats), -2),
        }
    print(f"  STATE High {state['scenarios']['normal']['high_pct']}%  Moderate {state['scenarios']['normal']['moderate_pct']}%")

    # ── validation ───────────────────────────────────────────────────────────
    def rc(lon, lat):
        return int((Y1 - lat) / RES), int((lon - X0) / RES)

    radius = 500.0
    ry, rx = int(np.ceil(radius / DY)), int(np.ceil(radius / DX))
    yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]
    disk = (yy * DY) ** 2 + (xx * DX) ** 2 <= radius ** 2

    def evaluate(lon, lat):
        r, c = rc(lon, lat)
        out = {"lonlat": [lon, lat], "score": round(float(score[r, c]), 3),
               "inputs": {"hand_m": round(float(g["hand"][r, c]), 1),
                          "river_m": round(float(g["chan_dist"][r, c])),
                          "slope_deg": round(float(g["slope"][r, c]), 1),
                          "elev_m": round(float(g["dem"][r, c]), 1),
                          "hist_pct": round(100 * float(g["gsw_hist"][r, c]), 1)},
               "scenarios": {}}
        win = (slice(r - ry, r + ry + 1), slice(c - rx, c + rx + 1))
        nb = disk & (sel | ft)[win] & ~water[win]
        for sc in MODEL["scenarios"]:
            cls = classify(score_q, sc)
            k = cls[win][nb]
            out["scenarios"][sc["key"]] = {
                "point": ["", "Low", "Moderate", "High"][int(cls[r, c])],
                "high_share_500m": round(float((k == 3).mean()), 2) if k.size else None,
            }
        return out

    sites = json.load(open(CACHE / "flood_sites.json"))
    val_sites = []
    for s in sites:
        ev = evaluate(*s["resolved"]["lonlat"])
        p = ev["scenarios"]["normal"]["point"]
        ev |= {k: s[k] for k in ("id", "name", "report", "sources")}
        # daerah from the boundary data at the point, not from the site list
        rr, cc = rc(*s["resolved"]["lonlat"])
        dz = int(daerah[rr, cc])
        ev["daerah"] = DAERAH[dz - 1] if 1 <= dz <= 9 else ("Federal territory" if dz == 10 else None)
        ev["outside_scope"] = bool(s.get("outside_scope"))
        ev["resolved_from"] = s["resolved"]["matched"]
        ev["kind"] = "reported_flood"
        ev["expect"] = "High"
        ev["pass"] = p == "High"
        val_sites.append(ev)
        print(f"  {'✓' if ev['pass'] else '✗'} {s['name']:32s} {p:8s} score {ev['score']:.2f}  "
              f"HAND {ev['inputs']['hand_m']} m  river {ev['inputs']['river_m']} m  High≤500m {ev['scenarios']['normal']['high_share_500m']}")

    # Hilly controls chosen from the DEM, not by assumption:
    # steepest 1-km neighbourhood that people live in (Hulu Langat / Gombak), and
    # steepest 1-km neighbourhood in Hulu Selangor.
    k = int(round(1000 / DX)) | 1
    slope_1km = ndimage.uniform_filter(g["slope"], size=k)
    pop_1km = ndimage.uniform_filter(pop, size=k) * k * k
    places = json.load(open(OUT / "places.json"))
    pl_xy = np.array([p["c"] for p in places])

    def nearest_name(lon, lat):
        d = np.hypot((pl_xy[:, 0] - lon) * np.cos(np.radians(lat)), pl_xy[:, 1] - lat) * 111.32
        i = int(np.argmin(d))
        return places[i]["n"], round(float(d[i]), 1)

    controls = [
        ("Populated hillside (steepest lived-in km²)", (daerah == 4) | (daerah == 8), pop_1km > 3000),
        ("Upland forest, Hulu Selangor", daerah == 2, np.ones_like(sel)),
    ]
    for label, region, extra in controls:
        cand = np.where(region & extra & land, slope_1km, -1)
        r, c = np.unravel_index(np.argmax(cand), cand.shape)
        lon, lat = X0 + (c + 0.5) * RES, Y1 - (r + 0.5) * RES
        ev = evaluate(lon, lat)
        name, dkm = nearest_name(lon, lat)
        ev |= {"id": f"control-{len(val_sites)}", "name": f"{label}: near {name}",
               "daerah": DAERAH[int(daerah[r, c]) - 1], "kind": "hilly_control", "expect": "Low",
               "report": f"Chosen from the DEM: mean slope {slope_1km[r, c]:.1f}° over 1 km "
                         f"(nearest named place {name}, {dkm} km).",
               "sources": [], "outside_scope": False}
        ev["pass"] = ev["scenarios"]["normal"]["point"] == "Low"
        val_sites.append(ev)
        print(f"  {'✓' if ev['pass'] else '✗'} {ev['name']:60s} {ev['scenarios']['normal']['point']}  slope1km {slope_1km[r, c]:.1f}°")

    # ── client grid (cropped to Selangor + federal territories) ─────────────
    rows = np.where((sel | ft).any(1))[0]
    cols = np.where((sel | ft).any(0))[0]
    r0, r1, c0, c1 = rows[0], rows[-1] + 1, cols[0], cols[-1] + 1
    crop = (slice(r0, r1), slice(c0, c1))
    inside = (sel | ft)[crop]

    def q(a, scale, dtype, lo, hi):
        v = np.clip(np.round(a[crop] * scale), lo, hi).astype(dtype)
        v[~inside] = 0
        return v

    sc_u8 = score_q[crop].astype(np.uint8)
    sc_u8[water[crop]] = 254
    sc_u8[~inside] = 255
    # HAND keeps 0.1 m precision below 20 m (where the model is sensitive) and
    # 1 m above; river distance is rounded to 10 m. Both only shrink the download.
    hand_q = np.where(g["hand"] < 20, g["hand"], np.round(g["hand"]))
    dist_q = np.round(g["chan_dist"] / 10) * 10
    core = [
        ("score", sc_u8, "uint8", 1 / 200, "0–200 = score×200; 254 permanent water; 255 outside"),
        ("daerah", daerah[crop].astype(np.uint8), "uint8", 1, "1–9 daerah (order in daerah.json), 10 federal territory, 0 outside"),
        ("pop", q(pop, 10, np.uint16, 0, 65535), "uint16", 0.1, "people per cell (HRSL scaled to DOSM 2020)"),
        ("built", q(g["lc_built"], 100, np.uint8, 0, 100), "uint8", 0.01, "WorldCover 2021 built-up share"),
        ("hist", q(g["gsw_hist"], 100, np.uint8, 0, 100), "uint8", 0.01, "JRC GSW intermittent-water share 1984–2021"),
        ("river_len", q(g["chan_len"], 1, np.uint16, 0, 65535), "uint16", 1, "metres of mapped river/canal in cell"),
    ]
    detail = [
        ("tree", q(g["lc_tree"], 100, np.uint8, 0, 100), "uint8", 0.01, "WorldCover 2021 tree cover share"),
        ("crop", q(g["lc_crop"], 100, np.uint8, 0, 100), "uint8", 0.01, "WorldCover 2021 cropland share"),
        ("water", q(g["lc_water"] + g["lc_wetland"], 100, np.uint8, 0, 100), "uint8", 0.01, "WorldCover 2021 water + wetland/mangrove share"),
        ("hand", q(hand_q, 10, np.uint16, 0, 65535), "uint16", 0.1, "HAND, m"),
        ("slope", q(g["slope"], 4, np.uint8, 0, 255), "uint8", 0.25, "slope, degrees"),
        ("elev", q(np.clip(g["dem"], 0, None), 1, np.int16, 0, 32767), "int16", 1, "elevation, m (GLO-30)"),
        ("river_dist", q(dist_q, 1, np.uint16, 0, 65535), "uint16", 1, "distance to nearest river/canal, m"),
    ]
    files = {}
    for fname, layers in (("grid_core.bin.gz", core), ("grid_detail.bin.gz", detail)):
        blob, index, off = bytearray(), [], 0
        for name, arr, dtype, scale, desc in layers:
            b = np.ascontiguousarray(arr).astype(np.dtype(dtype).newbyteorder("<")).tobytes()
            pad = (-off) % 4
            blob += b"\0" * pad
            off += pad
            index.append({"name": name, "dtype": dtype, "scale": scale, "offset": off, "desc": desc})
            blob += b
            off += len(b)
        gz = gzip.compress(bytes(blob), compresslevel=9, mtime=0)
        (OUT / fname).write_bytes(gz)
        files[fname] = index
        print(f"  {fname}: raw {len(blob) / 1e6:.1f} MB, gzip {len(gz) / 1e6:.2f} MB")
    (OUT / "grid.bin.gz").unlink(missing_ok=True)

    today = date.today().isoformat()
    write_json(OUT / "grid.json", {
        "x0": float(X0 + c0 * RES), "y1": float(Y1 - r0 * RES), "res": float(RES),
        "width": int(c1 - c0), "height": int(r1 - r0), "cell_m": [round(float(DX), 2), round(float(DY), 2)],
        "cell_km2": round(float(cell_km2), 6), "crs": "EPSG:4326", "files": files, "built": today})
    write_json(OUT / "stats.json", {"built": today, "state": state, "daerah": stats,
                                    "pop_scale": {k: round(v, 3) for k, v in pop_scale.items()}})
    write_json(OUT / "model.json", MODEL | {"anchors": ANCHORS, "built": today})
    write_json(OUT / "validation.json", {"built": today, "radius_m": radius, "sites": val_sites})


if __name__ == "__main__":
    main()
