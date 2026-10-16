"""Shared helpers for the Ginkgo offline data pipeline.

Everything heavy runs once, here, and writes small files into public/data/.
The web app only ever reads those precomputed files.
"""
from __future__ import annotations

import io
import json
import os
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "data"
CACHE = Path(os.environ.get("GINKGO_CACHE", ROOT / "pipeline" / ".cache"))
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)

# Search window around Selangor (lon/lat, EPSG:4326). Includes KL and Putrajaya,
# which are federal territories and are excluded from every Selangor statistic.
BBOX = (100.70, 2.50, 102.05, 3.95)  # xmin, ymin, xmax, ymax

OVERTURE_RELEASE = "2026-09-23.1"
OVERTURE_BASE = "https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com"

SESSION = requests.Session()


def http_get(url: str, headers: dict | None = None, retries: int = 4) -> bytes:
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            r = SESSION.get(url, headers=headers or {}, timeout=120)
            if r.status_code in (200, 206):
                return r.content
            if r.status_code == 404:
                raise FileNotFoundError(url)
            raise RuntimeError(f"HTTP {r.status_code} for {url}")
        except (requests.ConnectionError, requests.Timeout, RuntimeError):
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2
    raise RuntimeError("unreachable")


def download(url: str, dest: Path) -> Path:
    """Download once into the cache; later runs reuse the file."""
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with SESSION.get(url, stream=True, timeout=300) as r:
        if r.status_code == 404:
            raise FileNotFoundError(url)
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.rename(dest)
    return dest


class HttpRangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests, with a block cache.

    Lets pyarrow read a Parquet footer and only the row groups we need from
    multi-hundred-MB Overture files.
    """

    BLOCK = 1 << 20

    def __init__(self, url: str, size: int):
        self.url = url
        self.size = size
        self.pos = 0
        self.blocks: dict[int, bytes] = {}

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_SET:
            self.pos = offset
        elif whence == io.SEEK_CUR:
            self.pos += offset
        else:
            self.pos = self.size + offset
        return self.pos

    def _block(self, i: int) -> bytes:
        if i not in self.blocks:
            start = i * self.BLOCK
            end = min(self.size, start + self.BLOCK) - 1
            self.blocks[i] = http_get(self.url, {"Range": f"bytes={start}-{end}"})
        return self.blocks[i]

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            bi, off = divmod(self.pos, self.BLOCK)
            chunk = self._block(bi)[off : off + n]
            out += chunk
            self.pos += len(chunk)
            n -= len(chunk)
        return bytes(out)

    def readinto(self, b):
        data = self.read(len(b))
        b[: len(data)] = data
        return len(data)


def list_s3(prefix: str) -> list[tuple[str, int]]:
    """List keys under an Overture prefix (public bucket, ListObjectsV2)."""
    import re

    keys: list[tuple[str, int]] = []
    token = None
    while True:
        url = f"{OVERTURE_BASE}/?list-type=2&prefix={requests.utils.quote(prefix, safe='/')}"
        if token:
            url += f"&continuation-token={requests.utils.quote(token, safe='')}"
        xml = http_get(url).decode()
        for k, s in re.findall(r"<Key>([^<]+)</Key>.*?<Size>(\d+)</Size>", xml):
            keys.append((k, int(s)))
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", xml)
        if not m:
            return keys
        token = m.group(1)


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))
    print(f"  wrote {path.relative_to(ROOT)} ({path.stat().st_size/1024:.0f} KB)")
