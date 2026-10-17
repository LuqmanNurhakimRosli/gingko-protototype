"""Step 6 — road graph and evacuation centres for the flood simulation.

Road graph: Overture transportation segments (roads only; footways, service
roads, driveways and parking aisles left out) are split at their connectors,
chains of same-named roads are merged, and only connected networks of 30+
junctions are kept. Each edge stores its length, road class, name, simplified
geometry and the grid cell with the lowest height above drainage (HAND) along
it — bridges excluded — so the app can tell when a simulated flood cuts it.

Evacuation centres: buildings of the kinds Malaysia opens as Pusat Pemindahan
Sementara (PPS) — schools, community halls, mosques, stadiums and sports
complexes — from Overture places. They are candidates, not the official
NADMA/JKM list. Capacity is estimated from the Overture building footprints at
each site: usable floor area / 3.5 m² per person (Sphere minimum covered
living space). Sites in High-susceptibility cells under the Extreme scenario
are dropped; the rest are marked flood-safe (Low) or caution (Moderate).

Outputs
  public/data/roads.bin.gz   typed arrays, layout in roads.json
  public/data/roads.json
  public/data/shelters.json
"""
from __future__ import annotations

import gzip
import json
import math
import re
from collections import defaultdict
from datetime import date

import numpy as np
import pyarrow.compute as pc
import pyarrow.parquet as pq
import shapely

from common import CACHE, OUT, OVERTURE_BASE, OVERTURE_RELEASE, HttpRangeFile, list_s3, write_json
from overture import read_window

# ── road graph ──────────────────────────────────────────────────────────────
# class code: (name, km/h in normal traffic)
CLASSES = [("motorway", 90), ("trunk", 70), ("primary", 60), ("secondary", 50), ("tertiary", 40),
           ("residential", 30), ("unclassified", 30)]
CLASS_CODE = {name: i for i, (name, _) in enumerate(CLASSES)}
CLASS_CODE["living_street"] = CLASS_CODE["residential"]
SKIP_SUB = {"sidewalk", "crosswalk", "cycle_crossing", "driveway", "parking_aisle", "alley"}
SAMPLE_M = 40          # HAND is sampled every 40 m along each road (cells are ~92 m)
SIMPLIFY_DEG = 0.00003  # ~3 m
MIN_COMPONENT = 30
Q = 1e6                # coordinates stored as integer micro-degrees

KM_PER_DEG = 111.32


def load_cached(name: str, theme: str, typ: str, cols: list[str]):
    path = CACHE / f"ev_{typ}.parquet"
    if not path.exists():
        pq.write_table(read_window(theme, typ, cols), path)
    return pq.read_table(path)


def load_grid():
    meta = json.load(open(OUT / "grid.json"))
    n = meta["width"] * meta["height"]
    out = {}
    for fname, layers in meta["files"].items():
        raw = gzip.decompress((OUT / fname).read_bytes())
        for l in layers:
            out[l["name"]] = np.frombuffer(raw, np.dtype(l["dtype"]), n, l["offset"])
    return meta, out


def cells_of(meta, lon, lat):
    c = np.floor((lon - meta["x0"]) / meta["res"]).astype(np.int64)
    r = np.floor((meta["y1"] - lat) / meta["res"]).astype(np.int64)
    ok = (c >= 0) & (c < meta["width"]) & (r >= 0) & (r < meta["height"])
    return np.where(ok, r * meta["width"] + c, -1)


def bridge_ranges(flags) -> list[tuple[float, float]]:
    out = []
    for f in flags or []:
        if "is_bridge" in (f.get("values") or []):
            b = f.get("between")
            out.append((b[0], b[1]) if b else (0.0, 1.0))
    return out


class DSU:
    def __init__(self):
        self.p: dict[int, int] = {}

    def find(self, a):
        p = self.p
        p.setdefault(a, a)
        while p[a] != a:
            p[a] = p[p[a]]
            a = p[a]
        return a

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


def build_graph(meta, grid):
    print("road graph …")
    t = load_cached("segment", "transportation", "segment",
                    ["id", "subtype", "class", "subclass", "names", "connectors", "road_flags", "geometry", "bbox"])
    t = t.filter(pc.equal(t.column("subtype"), "road"))
    cls = t.column("class").to_pylist()
    sub = t.column("subclass").to_pylist()
    keep = [CLASS_CODE.get(c) is not None and s not in SKIP_SUB for c, s in zip(cls, sub)]
    t = t.filter(np.array(keep))
    cls = [CLASS_CODE[c] for c in t.column("class").to_pylist()]
    names = [(n or "").strip() or None for n in t.column("names").combine_chunks().field("primary").to_pylist()]
    conns = t.column("connectors").to_pylist()
    flags = t.column("road_flags").to_pylist()
    geoms = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    coords, owner = shapely.get_coordinates(geoms, return_index=True)
    starts = np.searchsorted(owner, np.arange(len(geoms)))
    ends = np.append(starts[1:], len(coords))
    print(f"  {len(geoms):,} road segments")

    node_id: dict[str, int] = {}
    node_xy: list[tuple[float, float]] = []
    dsu = DSU()
    E_a, E_b, E_cls, E_name, E_len, E_geo = [], [], [], [], [], []
    S_lon, S_lat, S_edge = [], [], []

    def nid(cid, xy):
        i = node_id.get(cid)
        if i is None:
            i = node_id[cid] = len(node_xy)
            node_xy.append(xy)
        return i

    for s in range(len(geoms)):
        P = coords[starts[s]:ends[s]]
        if len(P) < 2 or not conns[s]:
            continue
        kx = KM_PER_DEG * 1000 * math.cos(math.radians(P[0, 1]))
        d = np.hypot(np.diff(P[:, 0]) * kx, np.diff(P[:, 1]) * KM_PER_DEG * 1000)
        cum = np.concatenate([[0.0], np.cumsum(d)])
        total = cum[-1]
        if total <= 0:
            continue
        cs = sorted(conns[s], key=lambda c: c["at"])
        # connectors sit on vertices: snap each to the vertex nearest its linear position
        vix = []
        for c in cs:
            j = int(np.searchsorted(cum, c["at"] * total))
            j = min(len(cum) - 1, j)
            if j > 0 and abs(cum[j - 1] - c["at"] * total) < abs(cum[j] - c["at"] * total):
                j -= 1
            vix.append(j)
        nodes = [nid(c["connector_id"], (float(P[j, 0]), float(P[j, 1]))) for c, j in zip(cs, vix)]
        seg_edges = []
        for k in range(len(cs) - 1):
            j0, j1 = vix[k], vix[k + 1]
            if j1 <= j0:
                dsu.union(nodes[k], nodes[k + 1])  # two connectors on one vertex
                continue
            E_a.append(nodes[k]); E_b.append(nodes[k + 1])
            E_cls.append(cls[s]); E_name.append(names[s])
            E_len.append(float(cum[j1] - cum[j0]))
            E_geo.append(P[j0:j1 + 1])
            seg_edges.append((cum[j0], cum[j1], len(E_a) - 1))
        if not seg_edges:
            continue
        # HAND samples along the segment, outside bridges
        n_s = max(2, int(total / SAMPLE_M) + 1)
        pos = np.linspace(0, total, n_s)
        br = bridge_ranges(flags[s])
        if br:
            f = pos / total
            ok = np.ones(n_s, bool)
            for a, b in br:
                ok &= ~((f >= a) & (f <= b))
            pos = pos[ok]
        if not len(pos):
            continue
        lon = np.interp(pos, cum, P[:, 0])
        lat = np.interp(pos, cum, P[:, 1])
        e_lo = np.array([e[0] for e in seg_edges])
        e_id = np.array([e[2] for e in seg_edges])
        which = np.clip(np.searchsorted(e_lo, pos, side="right") - 1, 0, len(e_id) - 1)
        S_lon.append(lon); S_lat.append(lat); S_edge.append(e_id[which])

    # merge nodes that shared a vertex
    remap = np.array([dsu.find(i) if i in dsu.p else i for i in range(len(node_xy))])
    E_a = remap[np.array(E_a)]
    E_b = remap[np.array(E_b)]
    E_len = np.array(E_len)
    E_cls = np.array(E_cls, np.uint8)
    print(f"  {len(node_xy):,} connectors, {len(E_a):,} edges before merging")

    # lowest-HAND cell per edge. Cells holding a mapped river or canal are where
    # roads cross on culverts and bridges, so they are skipped unless the road
    # has no other samples (a ~92 m cell would otherwise cut every road at every drain).
    s_lon, s_lat, s_edge = np.concatenate(S_lon), np.concatenate(S_lat), np.concatenate(S_edge)
    cell = cells_of(meta, s_lon, s_lat)
    hand = np.where(cell >= 0, grid["hand"][np.maximum(cell, 0)], 65535).astype(np.int64)
    crossing = (cell >= 0) & (grid["river_len"][np.maximum(cell, 0)] > 0)
    dry = np.zeros(len(E_a), bool)
    dry[s_edge[~crossing & (cell >= 0)]] = True
    hand = np.where(crossing & dry[s_edge], 65535, hand)
    order = np.lexsort((hand, s_edge))
    first = np.ones(len(order), bool)
    first[1:] = s_edge[order][1:] != s_edge[order][:-1]
    low_cell = np.full(len(E_a), -1, np.int64)
    low_hand = np.full(len(E_a), 65535, np.int64)
    pick = order[first]
    low_cell[s_edge[pick]] = np.where(hand[pick] < 65535, cell[pick], -1)
    low_hand[s_edge[pick]] = hand[pick]

    # ── merge chains of degree-2 nodes along the same road ──
    adj: dict[int, list[int]] = defaultdict(list)
    for e in range(len(E_a)):
        if E_a[e] == E_b[e]:
            continue
        adj[int(E_a[e])].append(e)
        adj[int(E_b[e])].append(e)

    def same(e1, e2):
        return E_cls[e1] == E_cls[e2] and E_name[e1] == E_name[e2]

    junction = {v for v, es in adj.items() if len(es) != 2 or not same(es[0], es[1])}
    used = np.zeros(len(E_a), bool)
    out = []  # (a, b, len, cls, name, low_cell, low_hand, coords)

    def walk(start, e):
        a, v = start, start
        parts, length, lc, lh = [], 0.0, -1, 65535
        while True:
            used[e] = True
            g = E_geo[e]
            other = int(E_b[e]) if int(E_a[e]) == v else int(E_a[e])
            g = g if int(E_a[e]) == v else g[::-1]
            parts.append(g if not parts else g[1:])
            length += E_len[e]
            if low_hand[e] < lh:
                lh, lc = int(low_hand[e]), int(low_cell[e])
            v = other
            if v in junction or v == a:
                break
            nxt = [x for x in adj[v] if not used[x]]
            if not nxt:
                break
            e = nxt[0]
        return (a, v, length, int(E_cls[e]), E_name[e], lc, lh, np.concatenate(parts))

    for v in junction:
        for e in adj[v]:
            if not used[e]:
                out.append(walk(v, e))
    for v, es in adj.items():  # closed loops with no junction
        for e in es:
            if not used[e]:
                junction.add(v)
                out.append(walk(v, e))
    out = [o for o in out if o[0] != o[1] or o[2] > 50]
    print(f"  {len(out):,} edges after merging same-road chains")

    # keep connected networks of MIN_COMPONENT+ junctions
    comp = DSU()
    for a, b, *_ in out:
        comp.union(a, b)
    size = defaultdict(int)
    for v in {x for o in out for x in (o[0], o[1])}:
        size[comp.find(v)] += 1
    out = [o for o in out if size[comp.find(o[0])] >= MIN_COMPONENT]

    # keep only networks that reach Selangor or the federal territories
    nodes = sorted({x for o in out for x in (o[0], o[1])})
    xy = np.array([node_xy[v] for v in nodes])
    inside = grid["daerah"][np.maximum(cells_of(meta, xy[:, 0], xy[:, 1]), 0)] > 0
    inside &= cells_of(meta, xy[:, 0], xy[:, 1]) >= 0
    keep_v = {v for v, ok in zip(nodes, inside) if ok}
    out = [o for o in out if o[0] in keep_v or o[1] in keep_v]
    nodes = sorted({x for o in out for x in (o[0], o[1])})
    index = {v: i for i, v in enumerate(nodes)}
    print(f"  {len(nodes):,} junctions, {len(out):,} edges in the routing graph")

    lines = shapely.simplify([shapely.LineString(o[7]) for o in out], SIMPLIFY_DEG)
    name_ix: dict[str, int] = {}
    names_out: list[str] = []
    a = np.array([index[o[0]] for o in out], np.uint32)
    b = np.array([index[o[1]] for o in out], np.uint32)
    ln = np.array([o[2] for o in out], np.float32)
    cl = np.array([o[3] for o in out], np.uint8)
    nm = np.full(len(out), -1, np.int32)
    for i, o in enumerate(out):
        if o[4]:
            if o[4] not in name_ix:
                name_ix[o[4]] = len(names_out)
                names_out.append(o[4])
            nm[i] = name_ix[o[4]]
    lc = np.array([o[5] for o in out], np.int32)
    lh = np.array([min(o[6], 65535) for o in out], np.uint16)
    geo_off = np.zeros(len(out) + 1, np.uint32)
    gx, gy = [], []
    for i, (o, line) in enumerate(zip(out, lines)):
        c = shapely.get_coordinates(line)
        mid = c[1:-1]  # endpoints are the junctions
        gx.append(mid[:, 0]); gy.append(mid[:, 1])
        geo_off[i + 1] = geo_off[i] + len(mid)
    gx = np.concatenate(gx) if gx else np.zeros(0)
    gy = np.concatenate(gy) if gy else np.zeros(0)
    nx = np.array([node_xy[v][0] for v in nodes])
    ny = np.array([node_xy[v][1] for v in nodes])

    arrays = [  # 4-byte arrays first, then 2-byte, then 1-byte: every view stays aligned
        ("node_lon", np.round(nx * Q).astype(np.int32)), ("node_lat", np.round(ny * Q).astype(np.int32)),
        ("edge_a", a), ("edge_b", b), ("edge_len", ln), ("edge_name", nm), ("edge_low", lc),
        ("edge_geo", geo_off),
        ("geo_lon", np.round(gx * Q).astype(np.int32)), ("geo_lat", np.round(gy * Q).astype(np.int32)),
        ("edge_hand", lh), ("edge_cls", cl),
    ]
    blob, layout, off = bytearray(), [], 0
    for name, arr in arrays:
        raw = arr.astype(arr.dtype.newbyteorder("<")).tobytes()
        layout.append({"name": name, "dtype": str(arr.dtype), "offset": off, "length": int(arr.size)})
        blob += raw
        off += len(raw)
    (OUT / "roads.bin.gz").write_bytes(gzip.compress(bytes(blob), 9))
    print(f"  wrote public/data/roads.bin.gz ({(OUT / 'roads.bin.gz').stat().st_size / 1e6:.1f} MB, "
          f"{len(gx):,} shape points)")
    write_json(OUT / "roads.json", {
        "source": f"Overture Maps transportation {OVERTURE_RELEASE} (OpenStreetMap contributors, ODbL)",
        "retrieved": date.today().isoformat(),
        "note": "Roads only (no footways, service roads or parking aisles). Undirected. Coordinates in "
                "micro-degrees. edge_low = grid cell with the lowest HAND along the edge (bridges and "
                "river/canal crossing cells excluded), edge_hand = that HAND in dm.",
        "nodes": len(nodes), "edges": len(out),
        "classes": [{"name": n, "kmh": v} for n, v in CLASSES],
        "names": names_out,
        "layout": layout,
    })
    return nx, ny


# ── evacuation centres ──────────────────────────────────────────────────────
SHELTER_KINDS = {
    # kind: (categories, name must match, exclude, dedupe m, building search radius m,
    #        max buildings summed, effective floors, usable share, default footprint m², min building m²)
    "school": ({"elementary_school", "high_school", "middle_school"},
               r"\b(sk|sjk|sjkc|sjkt|smk|sma|smka|sekolah|school)\b",
               r"tadika|kindergarten|preschool|taska|tuition|tuisyen|memandu|driving|music|muzik|swim|renang|"
               r"international|antarabangsa|private|swasta|montessori|kafa|tahfiz|pondok|sdn bhd|\bbhd\b|confession",
               120, 80, 6, 1.5, 0.30, 2500, 150),
    "hall": ({"community_center", "event_venue", "event_or_party_service", "social_or_community_service",
              "community_and_government", "civic_organization", "government_office", None},
             r"dewan orang ramai|dewan serbaguna|dewan komuniti|balai raya|dewan masyarakat|dewan sivik|"
             r"community hall|\bdor\b|dewan seri|dewan kampung|dewan raya",
             r"bankuet|banquet|perkahwinan|wedding|restoran|restaurant|hotel|kedai|sdn bhd|catering|katering|"
             r"butik|bridal|pengantin",
             80, 45, 1, 1.0, 0.70, 500, 80),
    "mosque": ({"muslim_place_of_worship", "religious_organization", None},
               # closed compounds (prisons, camps, police and army bases) cannot take the public
               r"^masjid\b", r"surau|madrasah|kedai|parking|penjara|prison|tentera|army|\bkem\b|camp|polis|police|\batm\b",
               120, 45, 1, 1.0, 0.50, 800, 150),
    "sports": ({"stadium_arena", "sport_or_fitness_facility", "sports_and_recreation", "sport_court", "gym",
                "community_center", None},
               r"stadium|kompleks sukan|sports complex|dewan sukan|arena|dewan badminton",
               r"futsal|kedai|shop|parking|gym\b|fitness|paintball|golf|kart|bowling|snooker|sdn bhd|\bbhd\b|\bplt\b|"
               r"physio|enterprise|trading|academy|akademi", 200, 150, 3, 1.0,
               0.40, 4000, 300),
}
M2_PER_PERSON = 3.5      # Sphere: minimum covered living space per person
CAP_MIN, CAP_MAX = 40, 1500


def dedupe(rows, radius_m):
    k = radius_m / 111_320
    kept, buckets = [], defaultdict(list)
    for r in sorted(rows, key=lambda r: (-round(r["cf"], 1), len(r["n"]))):
        bx, by = int(r["c"][0] / k), int(r["c"][1] / k)
        clash = any(np.hypot((o["c"][0] - r["c"][0]), o["c"][1] - r["c"][1]) < k
                    for dx in (-1, 0, 1) for dy in (-1, 0, 1) for o in buckets[(bx + dx, by + dy)])
        if not clash:
            kept.append(r)
            buckets[(bx, by)].append(r)
    return kept


def nearby_buildings(points: list[tuple[float, float, float]]):
    """Overture building footprints within r metres of each point (streamed, row-group filtered)."""
    cache = CACHE / "ev_buildings.parquet"
    if cache.exists():
        return pq.read_table(cache)
    pts = np.array([(x, y) for x, y, _ in points])
    rad = np.array([r / 111_320 for _, _, r in points])
    cell = 0.01
    hashed = defaultdict(list)
    for i, (x, y) in enumerate(pts):
        hashed[(int(x / cell), int(y / cell))].append(i)

    def near_any(x0, y0, x1, y1):
        pad = rad.max()
        for gx in range(int((x0 - pad) / cell), int((x1 + pad) / cell) + 1):
            for gy in range(int((y0 - pad) / cell), int((y1 + pad) / cell) + 1):
                for i in hashed.get((gx, gy), ()):
                    x, y = pts[i]
                    if x0 - rad[i] <= x <= x1 + rad[i] and y0 - rad[i] <= y <= y1 + rad[i]:
                        return True
        return False

    import pyarrow as pa
    xmin, ymin = pts.min(0) - rad.max()
    xmax, ymax = pts.max(0) + rad.max()
    keys = list_s3(f"release/{OVERTURE_RELEASE}/theme=buildings/type=building/")
    tables = []
    for key, size in keys:
        pf = pq.ParquetFile(HttpRangeFile(f"{OVERTURE_BASE}/{key}", size))
        md = pf.metadata
        paths = {md.schema.column(i).path: i for i in range(md.num_columns)}
        cols = {k: paths[f"bbox.{k}"] for k in ("xmin", "xmax", "ymin", "ymax")}
        hits = []
        for rg in range(md.num_row_groups):
            g = md.row_group(rg)
            st = {k: g.column(i).statistics for k, i in cols.items()}
            if any(s is None or not s.has_min_max for s in st.values()):
                continue
            x0, x1, y0, y1 = st["xmin"].min, st["xmax"].max, st["ymin"].min, st["ymax"].max
            if x0 > xmax or x1 < xmin or y0 > ymax or y1 < ymin:
                continue
            if near_any(x0, y0, x1, y1):
                hits.append(rg)
        if not hits:
            continue
        print(f"  {key.rsplit('/', 1)[-1][:16]}: {len(hits)}/{md.num_row_groups} row groups")
        for rg in hits:
            t = pf.read_row_group(rg, columns=["id", "geometry", "bbox", "num_floors", "height"])
            bb = t.column("bbox").combine_chunks()
            cx = (bb.field("xmin").to_numpy(zero_copy_only=False) + bb.field("xmax").to_numpy(zero_copy_only=False)) / 2
            cy = (bb.field("ymin").to_numpy(zero_copy_only=False) + bb.field("ymax").to_numpy(zero_copy_only=False)) / 2
            m = np.zeros(len(cx), bool)
            for j in range(len(cx)):
                gxy = (int(cx[j] / cell), int(cy[j] / cell))
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        for i in hashed.get((gxy[0] + dx, gxy[1] + dy), ()):
                            if abs(pts[i, 0] - cx[j]) < rad[i] + 0.002 and abs(pts[i, 1] - cy[j]) < rad[i] + 0.002:
                                m[j] = True
                                break
                        if m[j]:
                            break
                    if m[j]:
                        break
            if m.any():
                tables.append(t.filter(pa.array(m)))
    out = pa.concat_tables(tables)
    pq.write_table(out, cache)
    return out


def build_shelters(meta, grid, model):
    print("evacuation centres …")
    t = load_cached("place", "places", "place", ["id", "geometry", "names", "basic_category", "confidence", "bbox"])
    names = t.column("names").combine_chunks().field("primary").to_pylist()
    cats = t.column("basic_category").to_pylist()
    conf = t.column("confidence").to_pylist()
    pts = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    xs, ys = shapely.get_x(pts), shapely.get_y(pts)
    extreme = next(s for s in model["scenarios"] if s["key"] == "extreme")
    cand = []
    for kind, (catset, must, excl, dd, rad, *_rest) in SHELTER_KINDS.items():
        must_re, excl_re = re.compile(must, re.I), re.compile(excl, re.I)
        rows = []
        for n, c, cf, x, y in zip(names, cats, conf, xs, ys):
            if not n or c not in catset or (cf or 0) < 0.4:
                continue
            n = " ".join(n.split())
            if not must_re.search(n) or excl_re.search(n):
                continue
            i = int(cells_of(meta, np.array([x]), np.array([y]))[0])
            if i < 0 or grid["daerah"][i] == 0 or grid["score"][i] > 200:
                continue
            rows.append({"n": n, "c": [round(float(x), 5), round(float(y), 5)], "cf": cf or 0, "i": i, "k": kind})
        kept = dedupe(rows, dd)
        print(f"  {kind:7s} {len(rows):5d} candidates → {len(kept):5d} after de-duplication")
        cand += kept

    # flood suitability: drop High under Extreme (like Japan's per-hazard shelter designation)
    hi, mod = extreme["high"] * 200, extreme["moderate"] * 200
    ok = [r for r in cand if grid["score"][r["i"]] < hi]
    print(f"  {len(cand) - len(ok)} dropped as High under Extreme; {len(ok)} kept")

    pts_r = [(r["c"][0], r["c"][1], SHELTER_KINDS[r["k"]][4]) for r in ok]
    b = nearby_buildings(pts_r)
    bg = shapely.from_wkb(b.column("geometry").to_numpy(zero_copy_only=False))
    floors = b.column("num_floors").to_pylist()
    tree = shapely.STRtree(bg)
    shelters = []
    for r in ok:
        _, _, _, _, rad, nmax, eff_floors, usable, default_fp, min_b = SHELTER_KINDS[r["k"]]
        p = shapely.Point(r["c"])
        kx = 111_320 * math.cos(math.radians(r["c"][1]))
        idx = tree.query(shapely.buffer(p, rad / 111_320))
        parts = []
        for j in idx:
            g = bg[j]
            d = shapely.distance(g, p) * 111_320
            if d > rad:
                continue
            area = shapely.area(g) * kx * 111_320
            if area < min_b:  # houses, sheds and kiosks next to the site
                continue
            parts.append((d, area, floors[j]))
        parts.sort(key=lambda x: (x[0] > 1, -x[1]))  # the building at the pin first, then the largest
        parts = parts[:nmax]
        if parts:
            fp = sum(a for _, a, _ in parts)
            # only the lower floors of a multi-storey block are opened to evacuees
            floor_area = sum(a * (min(f, eff_floors) if f else eff_floors) for _, a, f in parts)
            est = "footprint"
        else:
            fp, floor_area, est = default_fp, default_fp * eff_floors, "type default"
        cap = int(round(min(CAP_MAX, max(CAP_MIN, floor_area * usable / M2_PER_PERSON)), -1))
        i = r["i"]
        s = int(grid["score"][i])
        shelters.append({
            "k": r["k"], "n": r["n"], "c": r["c"], "d": int(grid["daerah"][i]), "s": s,
            "safe": "low" if s < mod else "moderate",
            "cap": cap, "fp": int(round(fp)), "nb": len(parts), "est": est,
            "hand": round(int(grid["hand"][i]) / 10, 1), "elev": int(grid["elev"][i]),
        })
    shelters.sort(key=lambda s: (s["d"], s["k"], s["n"]))
    for i, s in enumerate(shelters):
        s["id"] = i
    by = defaultdict(lambda: [0, 0])
    for s in shelters:
        by[s["k"]][0] += 1
        by[s["k"]][1] += s["cap"]
    for k, (n, c) in by.items():
        print(f"  {k:7s} {n:5d} centres, {c:7,d} places")
    write_json(OUT / "shelters.json", {
        "source": f"Overture Maps places and buildings {OVERTURE_RELEASE} (OpenStreetMap and other open sources)",
        "retrieved": date.today().isoformat(),
        "note": "Candidate evacuation centres (PPS-type buildings), not the official NADMA/JKM list. "
                f"Capacity = usable floor area / {M2_PER_PERSON} m² per person (Sphere minimum covered living "
                "space), from Overture footprints at the site; 'type default' where no footprint was found. "
                "Sites High under the Extreme scenario are excluded.",
        "m2_per_person": M2_PER_PERSON,
        "kinds": {"school": "School", "hall": "Community hall", "mosque": "Mosque", "sports": "Stadium / sports hall"},
        "items": shelters,
    })


def main():
    meta, grid = load_grid()
    model = json.load(open(OUT / "model.json"))
    build_graph(meta, grid)
    build_shelters(meta, grid, model)


if __name__ == "__main__":
    main()
