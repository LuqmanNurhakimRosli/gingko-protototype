"""Step 1 — vector layers from Overture Maps (OpenStreetMap-derived).

Outputs
  .cache/vectors.pkl            full-precision geometries for the raster steps
  public/data/daerah.json       9 Selangor daerah, simplified for the map
  public/data/rivers.json       river / canal / stream lines, simplified
  public/data/places.json       gazetteer for the map search box
"""
from __future__ import annotations

import pickle
from datetime import date

import shapely
from shapely.geometry import mapping

from common import CACHE, OUT, OVERTURE_RELEASE, write_json
from overture import read_window

SELANGOR_DAERAH = [
    "Sabak Bernam", "Hulu Selangor", "Kuala Selangor", "Gombak", "Petaling",
    "Klang", "Kuala Langat", "Hulu Langat", "Sepang",
]


def rounded(geom, nd=5):
    return shapely.set_precision(geom, 10 ** -nd)


def main():
    print("divisions …")
    t = read_window("divisions", "division_area",
                    ["id", "geometry", "country", "subtype", "class", "names", "region", "bbox"])
    names = t.column("names").combine_chunks().field("primary").to_pylist()
    rows = t.select(["country", "subtype", "class", "region"]).to_pylist()
    geoms = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))

    daerah, places = {}, []
    selangor = kl = putrajaya = None
    for r, n, g in zip(rows, names, geoms):
        if r["country"] != "MY":
            continue
        if r["subtype"] == "county" and r["region"] == "MY-10" and r["class"] == "land":
            daerah[n] = g
        elif r["subtype"] == "region" and r["class"] == "land":
            if r["region"] == "MY-10":
                selangor = g
            elif r["region"] == "MY-14":
                kl = g
            elif r["region"] == "MY-16":
                putrajaya = g
        elif r["subtype"] in ("locality", "macrohood", "neighborhood") and n:
            places.append((n, r["subtype"], g))

    missing = set(SELANGOR_DAERAH) - set(daerah)
    extra = set(daerah) - set(SELANGOR_DAERAH)
    assert not missing and not extra, (missing, extra)
    assert selangor is not None and kl is not None and putrajaya is not None
    ft = shapely.union(kl, putrajaya)
    for n in list(daerah):
        overlap = shapely.intersection(daerah[n], ft).area / daerah[n].area
        if overlap > 1e-4:
            print(f"  {n}: removing {overlap:.2%} overlap with federal territories")
            daerah[n] = shapely.difference(daerah[n], ft)

    # Gazetteer: only places whose centroid is inside Selangor, KL or Putrajaya.
    scope = shapely.union_all([selangor, kl, putrajaya])
    shapely.prepare(scope)
    gaz = []
    for n, sub, g in places:
        c = shapely.point_on_surface(g)
        if scope.contains(c):
            x0, y0, x1, y1 = g.bounds
            gaz.append({"n": n, "t": sub, "c": [round(c.x, 5), round(c.y, 5)],
                        "b": [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)]})
    for name, g in list(daerah.items()) + [("Kuala Lumpur (WP)", kl), ("Putrajaya (WP)", putrajaya)]:
        c = shapely.point_on_surface(g)
        x0, y0, x1, y1 = g.bounds
        gaz.append({"n": name, "t": "daerah" if name in daerah else "federal territory",
                    "c": [round(c.x, 5), round(c.y, 5)],
                    "b": [round(x0, 4), round(y0, 4), round(x1, 4), round(y1, 4)]})
    print(f"  {len(gaz)} gazetteer entries")

    print("water …")
    w = read_window("base", "water", ["id", "geometry", "subtype", "class", "names", "is_intermittent", "bbox"])
    wn = w.column("names").combine_chunks().field("primary").to_pylist()
    wr = w.select(["subtype", "class", "is_intermittent"]).to_pylist()
    wg = shapely.from_wkb(w.column("geometry").to_numpy(zero_copy_only=False))
    lines, areas = [], []
    for r, n, g in zip(wr, wn, wg):
        gt = shapely.get_type_id(g)
        if gt in (1, 5):  # LineString / MultiLineString
            if r["class"] in ("river", "stream", "canal", "drain", "ditch", "tidal_channel"):
                lines.append({"name": n, "class": r["class"], "geom": g})
        elif gt in (3, 6):  # Polygon / MultiPolygon
            if r["subtype"] in ("river", "canal", "lake", "reservoir", "water", "pond", "lagoon") \
                    and r["class"] not in ("swimming_pool", "fountain"):
                areas.append({"name": n, "subtype": r["subtype"], "class": r["class"], "geom": g})
    print(f"  {len(lines)} waterway lines, {len(areas)} water polygons")

    pickle.dump({"daerah": daerah, "selangor": selangor, "kl": kl, "putrajaya": putrajaya,
                 "lines": lines, "areas": areas}, open(CACHE / "vectors.pkl", "wb"))

    # ── map-ready, simplified GeoJSON ─────────────────────────────────────
    feats = []
    for i, n in enumerate(SELANGOR_DAERAH):
        g = rounded(shapely.simplify(daerah[n], 0.0006, preserve_topology=True))
        feats.append({"type": "Feature", "id": i + 1,
                      "properties": {"id": i + 1, "name": n},
                      "geometry": mapping(g)})
    for name, g in (("Kuala Lumpur", kl), ("Putrajaya", putrajaya)):
        feats.append({"type": "Feature", "properties": {"id": 0, "name": name, "excluded": True},
                      "geometry": mapping(rounded(shapely.simplify(g, 0.0006, preserve_topology=True)))})
    write_json(OUT / "daerah.json", {
        "type": "FeatureCollection", "features": feats,
        "source": f"Overture Maps divisions {OVERTURE_RELEASE} (OpenStreetMap contributors, ODbL)",
        "retrieved": date.today().isoformat()})

    # Display rivers: rivers and canals always; streams only if long enough to read.
    rfeats = []
    for l in lines:
        g = l["geom"]
        length_km = shapely.length(g) * 111.0
        if l["class"] in ("river", "canal") or (l["class"] == "stream" and length_km > 2.0 and l["name"]):
            gs = rounded(shapely.simplify(g, 0.0002, preserve_topology=False), 5)
            if gs.is_empty:
                continue
            rfeats.append({"type": "Feature",
                           "properties": {"n": l["name"], "c": l["class"]},
                           "geometry": mapping(gs)})
    write_json(OUT / "rivers.json", {
        "type": "FeatureCollection", "features": rfeats,
        "source": f"Overture Maps base/water {OVERTURE_RELEASE} (OpenStreetMap contributors, ODbL)",
        "retrieved": date.today().isoformat()})
    write_json(OUT / "places.json", sorted(gaz, key=lambda p: p["n"]))

    for n in SELANGOR_DAERAH:
        a = shapely.area(daerah[n])
        print(f"  {n:15s} area {a:.4f} deg²")


if __name__ == "__main__":
    main()
