"""Step 2 — raster layers on one common analysis grid.

Grid: EPSG:4326, 3 arc-second cells (~92 m), 100.80–102.00 °E, 2.50–4.00 °N.
Every source is binned onto this grid by pixel centre, so totals (population)
are conserved and nothing is interpolated.

  dem       Copernicus GLO-30 DSM, minimum of the 3×3 one-arcsec pixels per cell
            (the minimum reduces the building / canopy bias of a surface model)
  slope     degrees, from the gridded DEM
  acc       D8 flow accumulation (cells), after stream burning + depression fill
  hand      height above nearest drainage (m)
  river_*   OSM rivers & canals (Overture): presence, metres of channel per cell,
            distance to nearest channel (m)
  gsw_hist  share of the cell seen as water in some, but not most, Landsat
            observations 1984–2021 (JRC Global Surface Water occurrence 1–50 %)
  gsw_perm  share of the cell that is permanent water (occurrence > 50 %)
  lc_*      ESA WorldCover 2021 class shares (built, tree, crop, water, …)
  pop       Meta HRSL v1.5 people per cell
  daerah    1..9 Selangor daerah, 10 = federal territory, 0 = outside
"""
from __future__ import annotations

import pickle
import time

import numpy as np
import rasterio
import shapely
from rasterio import features
from rasterio.transform import from_origin
from rasterio.windows import from_bounds
from scipy import ndimage

from common import CACHE, download

RES = 1 / 1200
X0, X1, Y0, Y1 = 100.80, 102.00, 2.50, 4.00
W = round((X1 - X0) / RES)
H = round((Y1 - Y0) / RES)
TRANSFORM = from_origin(X0, Y1, RES, RES)
LAT_C = 3.2
M_PER_DEG = 111_320.0
DX = RES * M_PER_DEG * np.cos(np.radians(LAT_C))  # metres, east–west
DY = RES * M_PER_DEG                               # metres, north–south

DEM_TILES = ["N02_00_E100_00", "N02_00_E101_00", "N03_00_E100_00", "N03_00_E101_00"]
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{t}_DEM/Copernicus_DSM_COG_10_{t}_DEM.tif"
GSW_URL = "/vsicurl/https://storage.googleapis.com/global-surface-water/downloads2021/occurrence/occurrence_100E_10Nv1_4_2021.tif"
WC_URLS = ["/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N00E099_Map.tif",
           "/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N03E099_Map.tif"]
HRSL_URL = "/vsicurl/https://dataforgood-fb-data.s3.amazonaws.com/hrsl-cogs/hrsl_general/hrsl_general-latest.vrt"

WC_CLASSES = {"tree": [10], "shrub_grass": [20, 30], "crop": [40], "built": [50],
              "bare": [60, 70], "water": [80], "wetland": [90, 95, 100]}


def flat_index(transform, shape):
    """Flat grid-cell index of every source pixel centre (-1 if outside the grid)."""
    h, w = shape
    xs = transform.c + (np.arange(w) + 0.5) * transform.a
    ys = transform.f + (np.arange(h) + 0.5) * transform.e
    ci = np.floor((xs - X0) / RES).astype(np.int64)
    ri = np.floor((Y1 - ys) / RES).astype(np.int64)
    ci[(ci < 0) | (ci >= W)] = -(W * H + 1)
    ri[(ri < 0) | (ri >= H)] = -(W * H + 1)
    idx = ri[:, None] * W + ci[None, :]
    idx[idx < 0] = -1
    return idx


def bin_sum(values, idx, valid=None):
    """Sum source pixels into grid cells (by pixel centre). Returns (sum, count)."""
    ok = idx >= 0
    if valid is not None:
        ok &= valid
    flat = idx[ok]
    s = np.bincount(flat, weights=values[ok].astype(np.float64), minlength=W * H).reshape(H, W)
    n = np.bincount(flat, minlength=W * H).reshape(H, W)
    return s, n


def read_window(url, bounds=(X0, Y0, X1, Y1), band=1):
    with rasterio.open(url) as ds:
        win = from_bounds(*bounds, ds.transform).round_offsets().round_lengths()
        win = win.intersection(rasterio.windows.Window(0, 0, ds.width, ds.height))
        arr = ds.read(band, window=win)
        return arr, ds.window_transform(win), ds.nodata


# ── DEM ──────────────────────────────────────────────────────────────────────
def build_dem():
    """Mosaic GLO-30 at 1 arc-second, then take the 3rd-lowest of each 3×3 block.

    GLO-30 pixel centres sit on whole arc-seconds and the grid origin is a
    multiple of 3", so every cell holds exactly nine pixels. A low order
    statistic pulls the surface model towards the ground (streets between
    buildings, canopy gaps) without letting one bad pixel through, which a
    plain minimum does.
    """
    mosaic = np.full((H * 3, W * 3), np.nan, dtype=np.float32)
    for t in DEM_TILES:
        path = download(DEM_URL.format(t=t), CACHE / "dem" / f"{t}.tif")
        with rasterio.open(path) as ds:
            a = ds.read(1).astype(np.float32)
            x0 = ds.transform.c + 0.5 * ds.transform.a
            y0 = ds.transform.f + 0.5 * ds.transform.e
        c0 = round((x0 - X0) * 3600)
        r0 = round((Y1 - y0) * 3600)
        rs, cs = max(0, -r0), max(0, -c0)
        re, ce = min(a.shape[0], H * 3 - r0), min(a.shape[1], W * 3 - c0)
        if re <= rs or ce <= cs:
            continue
        block = a[rs:re, cs:ce]
        block[(block < -100) | ~np.isfinite(block)] = np.nan
        mosaic[r0 + rs:r0 + re, c0 + cs:c0 + ce] = block
        print(f"  DEM {t}: {np.isfinite(block).sum():,} px")
    cells = mosaic.reshape(H, 3, W, 3).transpose(0, 2, 1, 3).reshape(H, W, 9)
    cells = np.sort(cells, axis=2)  # NaNs sort last
    dem = cells[:, :, 2].astype(np.float64)
    dem[~np.isfinite(dem)] = 0.0
    return dem


def fix_inland_negatives(dem, sea):
    """GLO-30 has a few negative blobs over inland lakes (old mining ponds).
    Replace them with the nearest valid land height."""
    bad = (dem < 0) & ~sea
    if bad.any():
        _, (ri, ci) = ndimage.distance_transform_edt(bad, return_indices=True)
        dem = dem.copy()
        dem[bad] = dem[ri[bad], ci[bad]]
        print(f"  fixed {bad.sum()} inland cells below 0 m")
    return dem


def sea_mask(dem):
    """Sea = cells at or below 0 m connected to the grid's west/south edge."""
    low = dem <= 0.0
    lab, _ = ndimage.label(low)
    edge = np.unique(np.concatenate([lab[:, 0], lab[-1, :], lab[0, :]]))
    edge = edge[edge > 0]
    return np.isin(lab, edge)


# ── Vectors → grid ──────────────────────────────────────────────────────────
def channel_layers(vec):
    chans = [l["geom"] for l in vec["lines"] if l["class"] in ("river", "canal")]
    chan_areas = [a["geom"] for a in vec["areas"] if a["subtype"] in ("river", "canal")]
    present = features.rasterize([(g, 1) for g in chans + chan_areas], out_shape=(H, W),
                                 transform=TRANSFORM, all_touched=True, dtype="uint8").astype(bool)
    # metres of mapped channel centre-line per cell (channels split into ≤5 m pieces,
    # each piece credited to the cell containing its midpoint)
    length = np.zeros(H * W)
    for g in chans:
        g = shapely.segmentize(g, 0.00005)
        for part in getattr(g, "geoms", [g]):
            c = np.asarray(part.coords)
            if len(c) < 2:
                continue
            mid = (c[1:] + c[:-1]) / 2
            d = c[1:] - c[:-1]
            seg_m = np.hypot(d[:, 0] * M_PER_DEG * np.cos(np.radians(mid[:, 1])), d[:, 1] * M_PER_DEG)
            ci = np.floor((mid[:, 0] - X0) / RES).astype(int)
            ri = np.floor((Y1 - mid[:, 1]) / RES).astype(int)
            ok = (ci >= 0) & (ci < W) & (ri >= 0) & (ri < H)
            np.add.at(length, ri[ok] * W + ci[ok], seg_m[ok])
    length = length.reshape(H, W)
    dist = ndimage.distance_transform_edt(~present, sampling=(DY, DX))
    streams = [l["geom"] for l in vec["lines"] if l["class"] == "stream"]
    stream_present = features.rasterize([(g, 1) for g in streams], out_shape=(H, W),
                                        transform=TRANSFORM, all_touched=False, dtype="uint8").astype(bool)
    return present, length, dist, stream_present


def daerah_raster(vec):
    order = ["Sabak Bernam", "Hulu Selangor", "Kuala Selangor", "Gombak", "Petaling",
             "Klang", "Kuala Langat", "Hulu Langat", "Sepang"]
    shapes = [(vec["daerah"][n], i + 1) for i, n in enumerate(order)]
    shapes += [(vec["kl"], 10), (vec["putrajaya"], 10)]
    return features.rasterize(shapes, out_shape=(H, W), transform=TRANSFORM, dtype="uint8")


# ── Hydrology ───────────────────────────────────────────────────────────────
def hydrology(dem, sea, channels, streams):
    from pysheds.grid import Grid
    from pysheds.sview import Raster, ViewFinder

    burned = dem.copy()
    burned[channels] -= 8.0   # enforce mapped rivers/canals
    burned[streams & ~channels] -= 3.0
    burned[sea] = -9999.0
    vf = ViewFinder(affine=TRANSFORM, shape=(H, W), crs="EPSG:4326", nodata=-9999.0)
    r = Raster(burned.astype(np.float64), viewfinder=vf)
    grid = Grid(viewfinder=vf)
    print("  conditioning DEM …")
    filled = grid.fill_pits(r)
    filled = grid.fill_depressions(filled)
    flat = grid.resolve_flats(filled)
    dirmap = (64, 128, 1, 2, 4, 8, 16, 32)
    print("  flow direction / accumulation …")
    fdir = grid.flowdir(flat, dirmap=dirmap, nodata_out=np.int64(0))
    acc = grid.accumulation(fdir, dirmap=dirmap, nodata_out=np.float64(0))
    acc_np = np.asarray(acc, dtype=np.float64)
    # Drainage: mapped channels, plus any cell draining > 6 km² (~700 cells),
    # plus the coastline (cells next to the sea).
    coast = ndimage.binary_dilation(sea, structure=np.ones((3, 3), bool)) & ~sea
    drain = (channels | (acc_np > 700) | coast) & ~sea
    print("  HAND …")
    dem_r = Raster(np.where(sea, -9999.0, dem).astype(np.float64), viewfinder=vf)
    vf_mask = ViewFinder(affine=TRANSFORM, shape=(H, W), crs="EPSG:4326", nodata=False)
    hand = grid.compute_hand(fdir, dem_r, Raster(drain.astype(bool), viewfinder=vf_mask),
                             dirmap=dirmap, nodata_out=np.nan)
    hand = np.asarray(hand, dtype=np.float64)
    # Flow paths that end without meeting drainage (unresolved flats, coastal
    # islands): fall back to Euclidean HAND — height above the nearest drainage
    # cell (or the coast) in straight-line distance.
    missing = np.isnan(hand) & ~sea
    _, (ri, ci) = ndimage.distance_transform_edt(~(drain | sea), return_indices=True)
    ref = np.where(sea[ri, ci], 0.0, dem[ri, ci])
    hand[missing] = np.clip(dem[missing] - ref[missing], 0, None)
    print(f"  HAND: Euclidean fallback for {missing.sum():,} cells "
          f"({missing.sum() / (~sea).sum():.2%} of land)")
    hand[sea] = 0.0
    return acc_np, np.clip(hand, 0, None), drain


def slope_deg(dem):
    gy, gx = np.gradient(dem, DY, DX)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


# ── Remote rasters ──────────────────────────────────────────────────────────
def build_gsw():
    occ, tr, _ = read_window(GSW_URL)
    idx = flat_index(tr, occ.shape)
    valid = occ <= 100
    hist, n = bin_sum(((occ >= 1) & (occ <= 50)).astype(np.uint8), idx, valid)
    perm, _ = bin_sum((occ > 50).astype(np.uint8), idx, valid)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, hist / n, 0), np.where(n > 0, perm / n, 0)


def build_worldcover():
    sums = {k: np.zeros((H, W)) for k in WC_CLASSES}
    total = np.zeros((H, W))
    for url in WC_URLS:
        with rasterio.open(url) as ds:
            full = from_bounds(X0, Y0, X1, Y1, ds.transform).round_offsets().round_lengths()
            full = full.intersection(rasterio.windows.Window(0, 0, ds.width, ds.height))
            step = 3000
            for r0 in range(int(full.row_off), int(full.row_off + full.height), step):
                win = rasterio.windows.Window(full.col_off, r0, full.width,
                                              min(step, full.row_off + full.height - r0))
                a = ds.read(1, window=win)
                idx = flat_index(ds.window_transform(win), a.shape)
                idx[a == 0] = -1
                ok = idx >= 0
                flat, cls = idx[ok], a[ok]
                total += np.bincount(flat, minlength=W * H).reshape(H, W)
                for k, codes in WC_CLASSES.items():
                    m = np.isin(cls, codes)
                    sums[k] += np.bincount(flat[m], minlength=W * H).reshape(H, W)
                print(f"  WorldCover rows {r0}–{r0 + win.height}")
    with np.errstate(invalid="ignore", divide="ignore"):
        return {k: np.where(total > 0, v / total, 0) for k, v in sums.items()}


def build_population():
    pop, tr, _ = read_window(HRSL_URL)
    pop = np.nan_to_num(pop.astype(np.float64), nan=0.0)
    pop[pop < 0] = 0
    s, _ = bin_sum(pop, flat_index(tr, pop.shape))
    return s


T0 = time.time()
_print = print


def print(*a, **k):  # noqa: A001 — timestamped progress output
    _print(f"[{time.time() - T0:6.0f}s]", *a, **k, flush=True)


def main():
    vec = pickle.load(open(CACHE / "vectors.pkl", "rb"))
    print(f"grid {W}×{H} cells, {DX:.1f}×{DY:.1f} m")
    print("DEM …")
    dem = build_dem()
    sea = sea_mask(dem)
    print(f"  sea cells {sea.sum():,}")
    dem = fix_inland_negatives(dem, sea)
    print("channels …")
    chan, chan_len, chan_dist, streams = channel_layers(vec)
    print("daerah …")
    daerah = daerah_raster(vec)
    print("hydrology …")
    acc, hand, drain = hydrology(dem, sea, chan, streams)
    slope = slope_deg(np.where(sea, 0, dem))
    print("JRC GSW …")
    gsw_hist, gsw_perm = build_gsw()
    print("WorldCover …")
    lc = build_worldcover()
    print("HRSL population …")
    pop = build_population()
    np.savez_compressed(
        CACHE / "grid.npz", dem=dem, sea=sea, slope=slope, acc=acc, hand=hand, drain=drain,
        chan=chan, chan_len=chan_len, chan_dist=chan_dist, daerah=daerah,
        gsw_hist=gsw_hist, gsw_perm=gsw_perm, pop=pop,
        **{f"lc_{k}": v for k, v in lc.items()},
        meta=np.array([X0, Y0, X1, Y1, RES, W, H, DX, DY]))
    print("saved grid.npz")
    sel = (daerah >= 1) & (daerah <= 9)
    print(f"  Selangor cells {sel.sum():,}; area ≈ {sel.sum() * DX * DY / 1e6:,.0f} km²")
    print(f"  HRSL population in Selangor ≈ {pop[sel].sum():,.0f}")
    print(f"  HAND median {np.nanmedian(hand[sel]):.1f} m; NaN share {np.isnan(hand[sel]).mean():.3%}")


if __name__ == "__main__":
    main()
