"""Step 7 — a 3D massing model of one area, for the sketch-style 3D view.

Taman Sri Muda (Shah Alam) and its surroundings: the December 2021 flood site
that the flood drill's demo route starts from, the Klang river and the
evacuation centres to the north. Building footprints, roads and water come
from Overture Maps; heights use Overture's `height` or `num_floors` where
mapped, otherwise an estimate from the footprint size (most houses here are
two-storey terraces).

Coordinates are local metres from the model origin, stored as int16 at 0.25 m.

Outputs
  public/data/model3d.bin.gz   typed arrays, layout in model3d.json
  public/data/model3d.json
"""
from __future__ import annotations

import gzip
import json
import math
import re
from datetime import date

import numpy as np
import pyarrow.compute as pc
import pyarrow.parquet as pq
import shapely

from common import CACHE, OUT, OVERTURE_RELEASE, write_json
from overture import read_window

NAME = "Taman Sri Muda, Shah Alam"
LON0, LAT0 = 101.5340, 3.0385           # model origin
HALF_LON, HALF_LAT = 0.0225, 0.0265      # ~5.0 × 5.9 km
BOX = (LON0 - HALF_LON, LAT0 - HALF_LAT, LON0 + HALF_LON, LAT0 + HALF_LAT)
KX = 111_320 * math.cos(math.radians(LAT0))
KY = 110_574
Q = 4                                    # 0.25 m units
FLOOR_M = 3.3

ROAD_WIDTH = {"motorway": 22, "trunk": 18, "primary": 14, "secondary": 12, "tertiary": 10,
              "residential": 7, "living_street": 6, "unclassified": 7, "service": 4.5}
ROAD_CODE = {k: i for i, k in enumerate(ROAD_WIDTH)}
RIVER_WIDTH = {"river": 36, "canal": 14, "stream": 8, "drain": 5}
RIVER_CODE = {k: i for i, k in enumerate(RIVER_WIDTH)}
SKIP_LABEL = re.compile(r"^(to |exit )|\(|sewage|wastewater|flood", re.I)


def local(lon, lat):
    return (np.asarray(lon) - LON0) * KX, (np.asarray(lat) - LAT0) * KY


def cached(name: str, theme: str, typ: str, cols: list[str]):
    path = CACHE / f"m3d_{name}.parquet"
    if not path.exists():
        pq.write_table(read_window(theme, typ, cols, bbox=BOX), path)
    return pq.read_table(path)


def estimate_height(area_m2: float) -> float:
    if area_m2 < 60:
        return 3.5           # sheds, kiosks, single rooms
    if area_m2 < 220:
        return 7.0           # two-storey terrace or semi-detached house
    if area_m2 < 1000:
        return 10.0          # shophouse rows, small blocks
    if area_m2 < 5000:
        return 12.0          # schools, factories, halls
    return 15.0              # warehouses, malls


def main():
    print(f"3D model: {NAME}")
    clip = shapely.box(*BOX)

    # buildings
    t = cached("buildings", "buildings", "building", ["id", "geometry", "bbox", "height", "num_floors", "is_underground"])
    g = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    heights = t.column("height").to_pylist()
    floors = t.column("num_floors").to_pylist()
    under = t.column("is_underground").to_pylist()
    rings, hs, est = [], [], 0
    for geom, h, f, u in zip(g, heights, floors, under):
        if u or geom is None or not clip.contains(shapely.centroid(geom)):
            continue
        poly = max(geom.geoms, key=lambda p: p.area) if geom.geom_type == "MultiPolygon" else geom
        if poly.geom_type != "Polygon":
            continue
        x, y = local(*np.asarray(poly.exterior.coords).T)
        lp = shapely.Polygon(np.c_[x, y]).simplify(0.3)
        if lp.is_empty or lp.area < 12 or lp.geom_type != "Polygon":
            continue
        lp = shapely.orient_polygons(lp)  # counter-clockwise exterior
        c = np.asarray(lp.exterior.coords)[:-1]
        if len(c) < 3:
            continue
        if h and h > 0:
            height = float(h)
        elif f and f > 0:
            height = float(f) * FLOOR_M
        else:
            height = estimate_height(lp.area)
            est += 1
        rings.append(np.round(c * Q).astype(np.int16))
        hs.append(min(250.0, height))
    print(f"  {len(rings):,} buildings ({est:,} heights estimated from footprint size)")

    # roads (the drill's road cache covers the whole state)
    seg = pq.read_table(CACHE / "ev_segment.parquet")
    seg = seg.filter(pc.equal(seg.column("subtype"), "road"))
    bb = seg.column("bbox").combine_chunks()
    inside = ((bb.field("xmax").to_numpy() >= BOX[0]) & (bb.field("xmin").to_numpy() <= BOX[2]) &
              (bb.field("ymax").to_numpy() >= BOX[1]) & (bb.field("ymin").to_numpy() <= BOX[3]))
    import pyarrow as pa
    seg = seg.filter(pa.array(inside))
    cls = seg.column("class").to_pylist()
    sub = seg.column("subclass").to_pylist()
    names = seg.column("names").combine_chunks().field("primary").to_pylist()
    sg = shapely.from_wkb(seg.column("geometry").to_numpy(zero_copy_only=False))
    lines, codes, road_names = [], [], {}
    for c, s, n, geom in zip(cls, sub, names, sg):
        if c not in ROAD_CODE or s in ("driveway", "parking_aisle", "sidewalk", "crosswalk"):
            continue
        part = shapely.intersection(geom, clip)
        for p in getattr(part, "geoms", [part]):
            if p.is_empty or p.geom_type != "LineString":
                continue
            x, y = local(*np.asarray(p.coords).T)
            lp = shapely.LineString(np.c_[x, y]).simplify(0.5)
            pts = np.round(np.asarray(lp.coords) * Q).astype(np.int16)
            if len(pts) < 2:
                continue
            lines.append(pts)
            codes.append(ROAD_CODE[c])
            if n and c in ("motorway", "trunk", "primary", "secondary") and lp.length > 300 and not SKIP_LABEL.search(n):
                mid = lp.interpolate(0.5, normalized=True)
                road_names.setdefault(n.replace("–", "-"), (round(mid.x), round(mid.y), lp.length))
    print(f"  {len(lines):,} road lines")

    # water (rivers, ponds)
    w = cached("water", "base", "water", ["id", "subtype", "class", "names", "geometry", "bbox"])
    wg = shapely.from_wkb(w.column("geometry").to_numpy(zero_copy_only=False))
    wnames = w.column("names").combine_chunks().field("primary").to_pylist()
    wclass = w.column("class").to_pylist()
    water, water_labels = [], {}
    rivers, river_codes, river_len = [], [], {}
    for geom, n, c in zip(wg, wnames, wclass):
        if geom.geom_type in ("LineString", "MultiLineString") and c in RIVER_CODE:
            part = shapely.intersection(geom, clip)
            for p in getattr(part, "geoms", [part]):
                if p.is_empty or p.geom_type != "LineString":
                    continue
                x, y = local(*np.asarray(p.coords).T)
                lp = shapely.LineString(np.c_[x, y]).simplify(1.0)
                rivers.append(np.round(np.asarray(lp.coords) * Q).astype(np.int16))
                river_codes.append(RIVER_CODE[c])
                if n and c == "river":
                    key = n.replace("Kelang", "Klang")
                    if lp.length > river_len.get(key, (0, 0, 0))[2]:
                        mid = lp.interpolate(0.5, normalized=True)
                        river_len[key] = (round(mid.x), round(mid.y), lp.length)
            continue
        if geom.geom_type not in ("Polygon", "MultiPolygon") or c in ("strait", "sea", "ocean"):
            continue
        part = shapely.intersection(geom, clip)
        for p in getattr(part, "geoms", [part]):
            if p.is_empty or p.geom_type != "Polygon" or p.area < 1e-9:
                continue
            x, y = local(*np.asarray(p.exterior.coords).T)
            lp = shapely.orient_polygons(shapely.Polygon(np.c_[x, y]).simplify(1.0))
            if lp.is_empty or lp.geom_type != "Polygon" or lp.area < 200:
                continue
            water.append(np.round(np.asarray(lp.exterior.coords)[:-1] * Q).astype(np.int16))
            if n and lp.area > 20_000 and not SKIP_LABEL.search(n):
                rp = lp.representative_point()
                water_labels.setdefault(n, (round(rp.x), round(rp.y)))
    print(f"  {len(water):,} water polygons, {len(rivers):,} river and drain lines")

    def pack(polys):
        counts = np.array([len(p) for p in polys], np.uint32)
        flat = np.concatenate(polys).astype(np.int16) if polys else np.zeros((0, 2), np.int16)
        return counts, flat.reshape(-1)

    b_counts, b_xy = pack(rings)
    r_counts, r_xy = pack(lines)
    w_counts, w_xy = pack(water)
    v_counts, v_xy = pack(rivers)
    arrays = [
        ("building_counts", b_counts), ("road_counts", r_counts), ("water_counts", w_counts), ("river_counts", v_counts),
        ("building_xy", b_xy), ("road_xy", r_xy), ("water_xy", w_xy), ("river_xy", v_xy),
        ("building_h", np.round(np.array(hs) * 2).astype(np.uint16)),   # 0.5 m units
        ("road_class", np.array(codes, np.uint8)), ("river_class", np.array(river_codes, np.uint8)),
    ]
    blob, layout, off = bytearray(), [], 0
    for name, arr in arrays:
        raw = arr.astype(arr.dtype.newbyteorder("<")).tobytes()
        layout.append({"name": name, "dtype": str(arr.dtype), "offset": off, "length": int(arr.size)})
        blob += raw
        off += len(raw)
        pad = (-off) % 4
        blob += b"\0" * pad
        off += pad
    (OUT / "model3d.bin.gz").write_bytes(gzip.compress(bytes(blob), 9))
    print(f"  wrote public/data/model3d.bin.gz ({(OUT / 'model3d.bin.gz').stat().st_size / 1e6:.1f} MB)")

    shelters = json.load(open(OUT / "shelters.json"))["items"]
    centres = []
    for s in shelters:
        if BOX[0] <= s["c"][0] <= BOX[2] and BOX[1] <= s["c"][1] <= BOX[3]:
            x, y = local(*s["c"])
            centres.append({"id": s["id"], "n": s["n"], "k": s["k"], "x": round(float(x)), "y": round(float(y))})
    places = json.load(open(OUT / "places.json"))
    labels = []
    for p in places:
        if p["t"] in ("macrohood", "locality", "neighborhood") and BOX[0] <= p["c"][0] <= BOX[2] and BOX[1] <= p["c"][1] <= BOX[3]:
            bw = (p["b"][2] - p["b"][0]) * KX
            if (p["t"] != "neighborhood" or bw > 500) and len(p["n"]) > 4:
                x, y = local(*p["c"])
                labels.append({"n": p["n"], "kind": "place", "x": round(float(x)), "y": round(float(y)), "w": round(bw)})
    labels += [{"n": n, "kind": "water", "x": x, "y": y} for n, (x, y) in water_labels.items()]
    labels += [{"n": n, "kind": "water", "x": x, "y": y} for n, (x, y, _) in river_len.items()]
    labels += [{"n": n, "kind": "road", "x": x, "y": y} for n, (x, y, _) in sorted(road_names.items(), key=lambda kv: -kv[1][2])[:8]]

    write_json(OUT / "model3d.json", {
        "name": NAME,
        "source": f"Overture Maps buildings, transportation and base {OVERTURE_RELEASE} (OpenStreetMap and other open sources)",
        "retrieved": date.today().isoformat(),
        "origin": [LON0, LAT0], "bbox": list(BOX), "metres_per_degree": [round(KX, 2), KY], "unit_m": 1 / Q,
        "note": f"Heights from Overture height or floors × {FLOOR_M} m where mapped; otherwise estimated from footprint size "
                f"({est:,} of {len(rings):,} buildings).",
        "buildings": len(rings), "heights_estimated": est,
        "road_classes": list(ROAD_WIDTH), "road_width_m": list(ROAD_WIDTH.values()),
        "river_classes": list(RIVER_WIDTH), "river_width_m": list(RIVER_WIDTH.values()),
        "centres": centres, "labels": labels,
        "layout": layout,
    })


if __name__ == "__main__":
    main()
