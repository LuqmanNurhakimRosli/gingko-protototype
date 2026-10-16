"""Step 5 — a Google-Maps-style vector basemap for the study window.

Roads, water, land cover, land use, airports and place names come from
Overture Maps (which repackages OpenStreetMap, ESA WorldCover and other open
data). They are sorted into a small tile schema here, cut into Mapbox Vector
Tiles (zoom 5–14) by tiles.mjs, and packed into a single PMTiles archive that
the app serves itself, so the map needs no tile server, API key or internet
connection at the booth.

Tile schema (layer: kind values)
  landcover  forest farmland grass scrub wetland mangrove urban barren
  landuse    park golf sport cemetery medical education industrial military
  water      ocean lake river (polygons)
  waterway   river canal stream drain (lines, with name)
  aeroway    airport runway taxiway apron
  roads      motorway trunk primary secondary tertiary minor service track path (+ link, name, ref)
  places     state city town village hamlet suburb neighbourhood (points, rank)
  labels     water park airport (points, name)

Outputs
  public/basemap/selangor.pmtiles
  public/basemap/fonts/<font>/<range>.pbf   (Noto Sans SDF glyphs, SIL OFL 1.1)
"""
from __future__ import annotations

import gzip
import json
import math
import re
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path

import numpy as np
import pyarrow.compute as pc
import pyarrow.parquet as pq
import shapely

from common import BBOX, CACHE, OVERTURE_RELEASE, ROOT, download
from overture import read_window

BASEMAP = ROOT / "public" / "basemap"
WORK = CACHE / "basemap"
MINZOOM, MAXZOOM = 5, 14

LAYERS = {
    ("base", "land_cover"): ["id", "subtype", "cartography", "geometry", "bbox"],
    ("base", "land_use"): ["id", "subtype", "class", "names", "geometry", "bbox"],
    ("base", "water"): ["id", "subtype", "class", "names", "geometry", "bbox"],
    ("base", "infrastructure"): ["id", "subtype", "class", "names", "geometry", "bbox"],
    ("transportation", "segment"): ["id", "subtype", "class", "subclass", "names", "road_flags", "routes", "geometry", "bbox"],
    ("divisions", "division"): ["id", "names", "subtype", "class", "population", "cartography", "geometry", "bbox"],
}

# Glyphs for map labels (Latin ranges only; names are reduced to these below).
FONTS_URL = "https://raw.githubusercontent.com/protomaps/basemaps-assets/main/fonts"
FONTS = {"NotoSans-Regular": "Noto Sans Regular", "NotoSans-Medium": "Noto Sans Medium", "NotoSans-Italic": "Noto Sans Italic"}
GLYPH_RANGES = [(0, 255), (256, 511), (512, 767), (7680, 7935), (8192, 8447)]
_ALLOWED = re.compile(r"[^ -˿Ḁ-ỿ -⁯]")


def clean_name(s: str | None) -> str | None:
    """Keep names the bundled Latin glyphs can draw; drop names that are mostly other scripts."""
    if not s:
        return None
    kept = _ALLOWED.sub("", s)
    kept = re.sub(r"\(\s*\)|\s{2,}", " ", kept).strip(" -·,")
    if len(kept) < max(2, 0.6 * len(s.strip())):
        return None
    return kept


def load(theme: str, typ: str):
    path = CACHE / f"bm_{typ}.parquet"
    if not path.exists():
        t = read_window(theme, typ, LAYERS[(theme, typ)])
        pq.write_table(t, path)
    return pq.read_table(path)


def geoms(t):
    return shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))


def primary_names(t):
    return [clean_name(n) for n in t.column("names").combine_chunks().field("primary").to_pylist()]


KM2_PER_DEG2 = (111.32 ** 2) * math.cos(math.radians(3.2))


def area_minzoom(area_deg2: float, big: int = 8) -> int:
    """Smaller areas appear later, roughly when they reach a few pixels."""
    a = area_deg2 * KM2_PER_DEG2
    for km2, z in ((5, big), (1, 10), (0.2, 11), (0.05, 12), (0.01, 13)):
        if a >= km2:
            return z
    return 14


class Layer:
    def __init__(self, name: str):
        self.name = name
        self.features: list[dict] = []

    def add(self, geom, props: dict, minz: int, maxz: int = MAXZOOM):
        if geom is None or geom.is_empty:
            return
        p = {k: v for k, v in props.items() if v is not None and v != ""}
        self.features.append({"type": "Feature", "geometry": shapely.geometry.mapping(geom),
                              "properties": p, "_z": (minz, maxz)})

    def write(self) -> dict:
        """One GeoJSON file per (min, max) zoom band; tiles.mjs builds an index for each."""
        bands = defaultdict(list)
        for f in self.features:
            bands[f.pop("_z")].append(f)
        out = {}
        for (lo, hi), feats in sorted(bands.items()):
            path = WORK / f"{self.name}.{lo}-{hi}.geojson"
            with open(path, "w") as fh:
                json.dump({"type": "FeatureCollection", "features": feats}, fh, separators=(",", ":"))
            out[path.name] = {"layer": self.name, "minzoom": lo, "maxzoom": hi, "count": len(feats)}
        return out


def window_clip(g):
    xmin, ymin, xmax, ymax = BBOX
    return shapely.clip_by_rect(g, xmin - 0.05, ymin - 0.05, xmax + 0.05, ymax + 0.05)


def polygons_only(g):
    if g is None or g.is_empty:
        return None
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    if g.geom_type == "GeometryCollection":
        parts = [p for p in g.geoms if p.geom_type in ("Polygon", "MultiPolygon")]
        return shapely.union_all(parts) if parts else None
    return None


# ── land cover (ESA WorldCover, generalised by Overture per zoom band) ─────
LANDCOVER = {"forest": "forest", "crop": "farmland", "grass": "grass", "shrub": "scrub", "wetland": "wetland",
             "mangrove": "mangrove", "urban": "urban", "barren": "barren"}


def build_landcover(L: Layer):
    t = load("base", "land_cover")
    g = window_clip(geoms(t))
    for sub, carto, geom in zip(t.column("subtype").to_pylist(), t.column("cartography").to_pylist(), g):
        kind = LANDCOVER.get(sub)
        geom = polygons_only(geom)
        if not kind or geom is None:
            continue
        lo, hi = (carto or {}).get("min_zoom") or 0, (carto or {}).get("max_zoom") or MAXZOOM
        lo, hi = max(lo, MINZOOM), min(hi, MAXZOOM)
        if lo > hi:
            continue
        L.add(geom, {"kind": kind}, lo, hi)


# ── land use (OpenStreetMap) ────────────────────────────────────────────────
def landuse_kind(sub: str, cls: str) -> str | None:
    if sub in ("park", "protected") or cls in ("park", "garden", "recreation_ground", "nature_reserve", "national_park", "village_green", "dog_park"):
        return "park"
    if sub == "golf":
        return "golf" if cls == "golf_course" else None
    if cls in ("pitch", "stadium", "track", "sports_centre"):
        return "sport"
    if sub == "cemetery":
        return "cemetery"
    if sub == "medical" and cls in ("hospital", "clinic"):
        return "medical"
    if sub == "education" and cls in ("school", "college", "university"):
        return "education"
    if cls in ("industrial", "works", "port"):
        return "industrial"
    if sub == "military":
        return "military"
    if sub == "agriculture" or cls in ("orchard", "plantation", "farmland", "meadow"):
        return "farmland"
    if cls in ("grass",):
        return "grass"
    return None


def build_landuse(L: Layer, labels: Layer):
    t = load("base", "land_use")
    g = window_clip(geoms(t))
    names = primary_names(t)
    for sub, cls, name, geom in zip(t.column("subtype").to_pylist(), t.column("class").to_pylist(), names, g):
        geom = polygons_only(geom)
        kind = landuse_kind(sub or "", cls or "")
        if geom is None or not kind:
            continue
        a = shapely.area(geom)
        minz = area_minzoom(a, big=9)
        if kind in ("sport", "medical", "education"):
            minz = max(minz, 12)
        L.add(geom, {"kind": kind}, minz)
        if name and kind in ("park", "golf", "cemetery"):
            labels.add(shapely.point_on_surface(geom), {"kind": "park", "name": name}, min(minz + 2, MAXZOOM))


# ── water ───────────────────────────────────────────────────────────────────
WATER_AREAS = {"ocean", "lake", "pond", "reservoir", "river", "canal", "stream", "water", "wastewater"}
WATERWAY_MINZ = {"river": 9, "canal": 11, "tidal_channel": 11, "stream": 12, "drain": 13, "ditch": 13}


def build_water(W: Layer, WW: Layer, labels: Layer):
    t = load("base", "water")
    g = window_clip(geoms(t))
    names = primary_names(t)
    for sub, cls, name, geom in zip(t.column("subtype").to_pylist(), t.column("class").to_pylist(), names, g):
        if geom is None or geom.is_empty:
            continue
        gt = geom.geom_type
        if gt in ("Polygon", "MultiPolygon"):
            if sub not in WATER_AREAS or cls in ("swimming_pool", "reflecting_pool"):
                continue
            kind = "ocean" if sub == "ocean" else "river" if sub in ("river", "canal", "stream") else "lake"
            minz = MINZOOM if kind == "ocean" else area_minzoom(shapely.area(geom))
            W.add(geom, {"kind": kind}, minz)
            if name and kind == "lake" and shapely.area(geom) * KM2_PER_DEG2 > 0.05:
                labels.add(shapely.point_on_surface(geom), {"kind": "water", "name": name}, min(minz + 1, MAXZOOM))
        elif gt in ("LineString", "MultiLineString"):
            if sub == "physical" and cls == "strait" and name:
                labels.add(shapely.line_interpolate_point(shapely.line_merge(geom) if gt == "MultiLineString" else geom, 0.5, normalized=True),
                           {"kind": "sea", "name": name}, 7)
                continue
            kind = "river" if cls == "river" else "canal" if cls in ("canal", "tidal_channel") else "stream" if cls == "stream" else "drain" if cls in ("drain", "ditch") else None
            if not kind:
                continue
            WW.add(geom, {"kind": kind, "name": name if kind in ("river", "canal") else None}, WATERWAY_MINZ.get(cls, 13))


# ── airports ────────────────────────────────────────────────────────────────
def build_aeroway(A: Layer, labels: Layer):
    t = load("base", "infrastructure")
    t = t.filter(pc.equal(t.column("subtype"), "airport"))
    g = window_clip(geoms(t))
    names = primary_names(t)
    for cls, name, geom in zip(t.column("class").to_pylist(), names, g):
        if geom is None or geom.is_empty:
            continue
        poly = geom.geom_type in ("Polygon", "MultiPolygon")
        if cls in ("airport", "international_airport", "regional_airport") and poly:
            A.add(geom, {"kind": "airport"}, 9)
            if name:
                labels.add(shapely.point_on_surface(geom), {"kind": "airport", "name": name}, 10 if cls == "international_airport" else 12)
        elif cls == "apron" and poly:
            A.add(geom, {"kind": "apron"}, 12)
        elif cls in ("runway", "stopway"):
            A.add(geom, {"kind": "runway"}, 10)
        elif cls == "taxiway":
            A.add(geom, {"kind": "taxiway"}, 12)


# ── roads ───────────────────────────────────────────────────────────────────
ROAD_KIND = {"motorway": "motorway", "trunk": "trunk", "primary": "primary", "secondary": "secondary", "tertiary": "tertiary",
             "residential": "minor", "unclassified": "minor", "living_street": "minor", "unknown": "minor",
             "service": "service", "track": "track", "pedestrian": "path"}
ROAD_MINZ = {"motorway": 5, "trunk": 6, "primary": 8, "secondary": 9, "tertiary": 10, "minor": 13,
             "service": 14, "track": 14, "path": 14}
LINK_MINZ = {"motorway": 10, "trunk": 11, "primary": 12, "secondary": 13, "tertiary": 13}


def route_ref(routes) -> str | None:
    """Expressway (E1…) or federal route number, for road shields."""
    if not routes:
        return None
    best = None
    for r in routes:
        ref, net = (r.get("ref") or "").strip(), r.get("network") or ""
        if not ref or len(ref) > 5:
            continue
        if net == "MY:expressway" or re.fullmatch(r"E\d{1,2}", ref):
            return ref
        if net == "MY:Federal" or re.fullmatch(r"\d{1,4}", ref):
            best = best or ref
    return best


def whole_segment(flags, name: str) -> bool:
    return any(name in (f.get("values") or []) and not f.get("between") for f in (flags or []))


def build_roads(R: Layer):
    t = load("transportation", "segment")
    t = t.filter(pc.equal(t.column("subtype"), "road"))
    cls = t.column("class").to_pylist()
    sub = t.column("subclass").to_pylist()
    names = primary_names(t)
    flags = t.column("road_flags").to_pylist()
    routes = t.column("routes").to_pylist()
    g = geoms(t)
    groups: dict[tuple, list] = defaultdict(list)
    for c, s, n, fl, ro, geom in zip(cls, sub, names, flags, routes, g):
        # footpaths, sidewalks, driveways and parking aisles are left out: they add
        # most of the tile weight and nothing a flood map needs
        kind = ROAD_KIND.get(c or "unknown")
        if not kind or s in ("sidewalk", "crosswalk", "cycle_crossing", "driveway", "parking_aisle"):
            continue
        if s == "alley":
            kind = "service"
        link = s == "link"
        minz = LINK_MINZ.get(kind, ROAD_MINZ[kind]) if link else ROAD_MINZ[kind]
        if c == "unclassified" and not link:
            minz = 12  # rural connectors between villages
        ref = route_ref(ro) if kind in ("motorway", "trunk", "primary") else None
        tunnel = whole_segment(fl, "is_tunnel")
        bridge = whole_segment(fl, "is_bridge")
        name = n if kind not in ("path", "track") else None
        groups[(kind, link, name, ref, tunnel, bridge, minz)].append(geom)
    n_in = n_out = 0
    for (kind, link, name, ref, tunnel, bridge, minz), parts in groups.items():
        merged = shapely.line_merge(shapely.multilinestrings(parts)) if len(parts) > 1 else parts[0]
        lines = list(merged.geoms) if merged.geom_type == "MultiLineString" else [merged]
        n_in += len(parts)
        props = {"kind": kind, "link": 1 if link else None, "name": name, "ref": ref,
                 "tunnel": 1 if tunnel else None, "bridge": 1 if bridge else None}
        for line in lines:
            R.add(line, props, minz)
            n_out += 1
    print(f"  roads: {n_in:,} segments merged into {n_out:,} lines")


# ── place names ─────────────────────────────────────────────────────────────
def place_minzoom(sub: str, cls: str | None, prominence: int | None) -> tuple[int, str] | None:
    if sub == "region":
        return 6, "state"
    if sub == "locality":
        kind = {"city": "city", "town": "town", "village": "village", "hamlet": "hamlet"}.get(cls or "", "town")
        if prominence:
            for p, z in ((90, 5), (80, 7), (70, 8), (60, 9), (50, 10)):
                if prominence >= p:
                    return z, "city" if prominence >= 70 else kind
        return {"city": 9, "town": 10, "village": 11, "hamlet": 12}.get(cls or "", 11), kind
    if sub == "macrohood":
        return 11, "suburb"
    if sub == "neighborhood":
        return 13, "neighbourhood"
    if sub == "microhood":
        return 14, "neighbourhood"
    return None


def build_places(P: Layer):
    t = load("divisions", "division")
    names = [n for n in t.column("names").combine_chunks().field("primary").to_pylist()]
    best: dict[str, tuple] = {}
    for sub, cls, pop, carto, raw, geom in zip(t.column("subtype").to_pylist(), t.column("class").to_pylist(),
                                              t.column("population").to_pylist(), t.column("cartography").to_pylist(),
                                              names, geoms(t)):
        if not raw or geom is None or geom.geom_type != "Point" or raw.startswith("Majlis "):
            continue
        name = clean_name(re.sub(r"^(Bandaraya|Bandar Raya)\s+", "", raw))
        prom = (carto or {}).get("prominence")
        mz = place_minzoom(sub, cls, prom)
        if not name or not mz:
            continue
        minz, kind = mz
        rank = 100 - (prom or {"state": 60, "city": 50, "town": 40, "village": 30, "hamlet": 20, "suburb": 25}.get(kind, 10))
        key = name.lower()
        if key in best and best[key][0] <= rank:
            continue
        best[key] = (rank, minz, kind, name, geom, pop)
    for rank, minz, kind, name, geom, pop in best.values():
        P.add(geom, {"kind": kind, "name": name, "rank": rank}, minz)


def fetch_fonts():
    for folder, remote in FONTS.items():
        for lo, hi in GLYPH_RANGES:
            dest = BASEMAP / "fonts" / folder / f"{lo}-{hi}.pbf"
            if not dest.exists():
                download(f"{FONTS_URL}/{remote.replace(' ', '%20')}/{lo}-{hi}.pbf", dest)


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    for f in WORK.glob("*.geojson"):
        f.unlink()
    print(f"Overture release {OVERTURE_RELEASE}")
    layers = {n: Layer(n) for n in ("landcover", "landuse", "water", "waterway", "aeroway", "roads", "places", "labels")}
    build_landcover(layers["landcover"])
    build_landuse(layers["landuse"], layers["labels"])
    build_water(layers["water"], layers["waterway"], layers["labels"])
    build_aeroway(layers["aeroway"], layers["labels"])
    build_roads(layers["roads"])
    build_places(layers["places"])
    manifest = {}
    for L in layers.values():
        print(f"  {L.name}: {len(L.features):,} features")
        manifest.update(L.write())
    xmin, ymin, xmax, ymax = BBOX
    job = {"bands": manifest, "bbox": [xmin, ymin, xmax, ymax], "minzoom": MINZOOM, "maxzoom": MAXZOOM,
           "out": str(WORK / "tiles")}
    (WORK / "job.json").write_text(json.dumps(job, indent=1))
    shutil.rmtree(WORK / "tiles", ignore_errors=True)
    subprocess.run(["node", str(Path(__file__).with_name("tiles.mjs")), str(WORK / "job.json")], check=True)
    pack(job)
    fetch_fonts()


def pack(job: dict):
    """Pack tiles/z/x/y.pbf (gzipped) into one PMTiles v3 archive."""
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    tiles = []
    for p in Path(job["out"]).glob("*/*/*.pbf"):
        z, x, y = int(p.parts[-3]), int(p.parts[-2]), int(p.stem)
        tiles.append((zxy_to_tileid(z, x, y), p))
    tiles.sort()
    BASEMAP.mkdir(parents=True, exist_ok=True)
    out = BASEMAP / "selangor.pmtiles"
    xmin, ymin, xmax, ymax = job["bbox"]
    vector_layers = sorted({v["layer"] for v in job["bands"].values()})
    with open(out, "wb") as f:
        w = Writer(f)
        for tid, p in tiles:
            w.write_tile(tid, p.read_bytes())
        w.finalize(
            {"tile_type": TileType.MVT, "tile_compression": Compression.GZIP,
             "min_lon_e7": int(xmin * 1e7), "min_lat_e7": int(ymin * 1e7),
             "max_lon_e7": int(xmax * 1e7), "max_lat_e7": int(ymax * 1e7),
             "center_zoom": 9, "center_lon_e7": int((xmin + xmax) / 2 * 1e7), "center_lat_e7": int((ymin + ymax) / 2 * 1e7)},
            {"name": "Ginkgo Selangor basemap",
             "attribution": "© OpenStreetMap contributors, Overture Maps Foundation, ESA WorldCover",
             "vector_layers": [{"id": v, "fields": {}} for v in vector_layers]},
        )
    print(f"  wrote {out.relative_to(ROOT)}: {len(tiles):,} tiles, {out.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
