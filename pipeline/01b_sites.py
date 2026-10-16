"""Step 1b — validation sites.

Flood sites are taken from contemporaneous reports of the December 2021
Selangor floods (sources listed per site). Coordinates are NOT typed by hand:
each site is resolved against Overture Maps names (divisions + places), and
the matched feature is recorded so it can be checked.

Hilly controls are chosen later from the DEM itself (03_model.py).
"""
from __future__ import annotations

import json

import numpy as np
import shapely

from common import CACHE, OUT
from overture import read_window

SITES = [
    {"id": "sri-muda", "name": "Taman Sri Muda, Shah Alam",
     "match": ["taman sri muda"],
     "report": "Worst-hit area in Selangor; boat-only access, several drowning deaths (18–20 Dec 2021).",
     "sources": ["https://www.malaymail.com/news/malaysia/2021/12/19/fire-dept-klang-valley-floods-begin-receding-in-most-places-taman-sri-muda/2029692",
                 "https://www.thevibes.com/index.php/articles/news/50101/floods-six-individuals-found-drowned-in-taman-sri-muda"]},
    {"id": "seksyen-13", "name": "Seksyen 13, Shah Alam",
     "match": ["seksyen 13 shah alam", "section 13 shah alam", "stadium shah alam", "stadium malawati"],
     "report": "Water still high on 19 Dec 2021; vehicles could not pass.",
     "sources": ["https://www.malaymail.com/news/malaysia/2021/12/19/fire-dept-klang-valley-floods-begin-receding-in-most-places-taman-sri-muda/2029692"]},
    {"id": "telok-gong", "name": "Telok Gong, Klang",
     "match": ["telok gong", "teluk gong"],
     "report": "Named among the most affected of ~20 flooded areas in Klang (18 Dec 2021).",
     "sources": ["https://www.malaymail.com/amp/news/malaysia/2021/12/18/more-than-3000-flood-victims-evacuated-to-30-relief-centres-in-selangor/2029404"]},
    {"id": "johan-setia", "name": "Kampung Johan Setia, Klang",
     "match": ["johan setia"],
     "report": "Residents wading through flood water, 18 Dec 2021; ~800 evacuated to the local relief centre.",
     "sources": ["https://selangorjournal.my/2021/12/800-flood-victims-evacuated-to-johan-setia-relief-centre"]},
    {"id": "pandamaran", "name": "Pandamaran, Klang",
     "match": ["kampung baru pandamaran", "pandamaran"],
     "report": "Listed among flooded areas of Klang, Dec 2021.",
     "sources": ["https://www.themalaysianinsight.com/s/357224"]},
    {"id": "sri-nanding", "name": "Taman Sri Nanding, Hulu Langat",
     "match": ["sri nanding"],
     "report": "Still flooded on 19 Dec 2021 (fire department).",
     "sources": ["https://www.malaymail.com/news/malaysia/2021/12/19/fire-dept-klang-valley-floods-begin-receding-in-most-places-taman-sri-muda/2029692"]},
    {"id": "dengkil", "name": "Dengkil, Sepang",
     "match": ["taman dengkil", "dengkil"],
     "report": "Two flood victims found in Dengkil (police, Dec 2021).",
     "sources": ["https://www.malaymail.com/amp/news/malaysia/2021/12/20/as-floodwaters-go-down-in-selangor-seven-found-dead-one-still-missing/2029844"]},
    # Outside Selangor (Kuala Lumpur): kept only as a regression check on the formula.
    {"id": "masjid-jamek", "name": "Masjid Jamek, Kuala Lumpur",
     "outside_scope": True, "match": ["masjid jamek sultan abdul samad", "masjid jamek kuala lumpur", "masjid jamek"],
     "report": "Mosque flooded on 18 Dec 2021 and the Masjid Jamek LRT station closed; also flooded Sept 2020. Sits at the Klang–Gombak confluence.",
     "sources": ["https://www.malaymail.com/amp/news/malaysia/2021/12/18/kuala-lumpurs-iconic-masjid-jamek-mosque-flooded-minister-warns-four-main-r/2029526",
                 "https://thestar.com.my/metro/metro-news/2020/09/12/the-job-after-the-storm"]},
]


def main():
    places = json.load(open(OUT / "places.json"))
    cands = [(p["n"], p["t"], p["c"]) for p in places]

    print("places theme …")
    t = read_window("places", "place", ["id", "geometry", "names", "basic_category", "bbox"])
    names = t.column("names").combine_chunks().field("primary").to_pylist()
    cats = t.column("basic_category").to_pylist()
    pts = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    xs, ys = shapely.get_x(pts), shapely.get_y(pts)
    print(f"  {len(names):,} places in window")
    for n, c, x, y in zip(names, cats, xs, ys):
        if n:
            cands.append((n, f"place:{c}", [round(float(x), 5), round(float(y), 5)]))

    out = []
    for s in SITES:
        hit = None
        for m in s["match"]:
            # prefer area-type features (divisions) and residential/neighbourhood places
            matches = [c for c in cands if m in c[0].lower()]
            if not matches:
                continue
            divs = [c for c in matches if not c[1].startswith("place:")]
            pool = divs or matches
            # centroid of all matches with this name pattern, then the match nearest to it
            arr = np.array([c[2] for c in pool])
            med = np.median(arr, axis=0)
            hit = min(pool, key=lambda c: (c[2][0] - med[0]) ** 2 + (c[2][1] - med[1]) ** 2)
            hit = {"matched": hit[0], "kind": hit[1], "lonlat": hit[2], "n_matches": len(pool), "pattern": m}
            break
        if hit is None:
            print(f"  ✗ {s['name']}: no match, dropped")
            continue
        print(f"  ✓ {s['name']}: '{hit['matched']}' ({hit['kind']}, {hit['n_matches']} matches) {hit['lonlat']}")
        out.append({k: v for k, v in s.items() if k != "match"} | {"resolved": hit})
    json.dump(out, open(CACHE / "flood_sites.json", "w"), indent=1)


if __name__ == "__main__":
    main()
