#!/usr/bin/env bash
# Rebuild every file in public/data from public sources (≈5 min, ~1 GB cache).
#   python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
#   PY=.venv/bin/python pipeline/run_all.sh
set -euo pipefail
cd "$(dirname "$0")"
PY="${PY:-python3}"
export GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR GDAL_HTTP_MAX_RETRY=5 GDAL_HTTP_RETRY_DELAY=2
"$PY" 01_vectors.py
"$PY" 01b_sites.py
"$PY" 02_rasters.py
"$PY" 03_model.py
