"""Read only the Selangor rows out of Overture Maps GeoParquet files.

Overture files are spatially clustered and every row group carries bbox
min/max statistics, so we fetch the footer, skip row groups that cannot touch
our window, and range-read the rest.
"""
from __future__ import annotations

import pyarrow as pa
import pyarrow.parquet as pq

from common import BBOX, OVERTURE_BASE, OVERTURE_RELEASE, HttpRangeFile, list_s3


def _rg_bbox(md, rg: int, cols: dict[str, int]):
    out = {}
    g = md.row_group(rg)
    for name, idx in cols.items():
        st = g.column(idx).statistics
        if st is None or not st.has_min_max:
            return None
        out[name] = (st.min, st.max)
    return out


def read_window(theme: str, typ: str, columns: list[str], bbox=BBOX) -> pa.Table:
    xmin, ymin, xmax, ymax = bbox
    keys = list_s3(f"release/{OVERTURE_RELEASE}/theme={theme}/type={typ}/")
    tables = []
    for key, size in keys:
        f = HttpRangeFile(f"{OVERTURE_BASE}/{key}", size)
        pf = pq.ParquetFile(f)
        md = pf.metadata
        paths = {md.schema.column(i).path: i for i in range(md.num_columns)}
        cols = {k: paths[f"bbox.{k}"] for k in ("xmin", "xmax", "ymin", "ymax")}
        hits = []
        for rg in range(md.num_row_groups):
            s = _rg_bbox(md, rg, cols)
            if s is None:
                hits.append(rg)
                continue
            # row group's union bbox: min of xmin .. max of xmax
            if s["xmin"][0] <= xmax and s["xmax"][1] >= xmin and s["ymin"][0] <= ymax and s["ymax"][1] >= ymin:
                hits.append(rg)
        if not hits:
            continue
        print(f"  {key.rsplit('/', 1)[-1][:16]}: {len(hits)}/{md.num_row_groups} row groups")
        t = pf.read_row_groups(hits, columns=columns)
        bb = t.column("bbox").combine_chunks()
        bx0 = bb.field("xmin").to_numpy(zero_copy_only=False)
        bx1 = bb.field("xmax").to_numpy(zero_copy_only=False)
        by0 = bb.field("ymin").to_numpy(zero_copy_only=False)
        by1 = bb.field("ymax").to_numpy(zero_copy_only=False)
        mask = (bx0 <= xmax) & (bx1 >= xmin) & (by0 <= ymax) & (by1 >= ymin)
        t = t.filter(pa.array(mask))
        if t.num_rows:
            tables.append(t)
    return pa.concat_tables(tables) if tables else None
