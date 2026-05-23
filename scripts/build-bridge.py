#!/usr/bin/env python3
"""Build the local-catalog -> jimu binding bridge as a Cloudflare D1 SQL dump.

jimu re-IDs every dataset on import, so a catalog's activity uuid never equals
jimu's internal uuid. jimu's per-version mapping export ("背景数据映射管理"),
however, keeps the original pre-import uuid (配置版本背景数据原UUID), which DOES
equal the local catalog's `dataset_key` prefix. This script reads those exports
(one xlsx per background-DB version) and emits a `bridge` table keyed by
(version, system model, activity uuid) -> jimu binding ids
(background_data_id + standardUuid). The Worker queries it from D1; see
docs/architecture/local-bridge.md and src/bridge.ts.

The id columns are 17-digit integers that exceed IEEE-754 safe range, so this is
written in Python: openpyxl reads them as exact arbitrary-precision ints. Reading
the same cells through a float64-based parser would silently corrupt the ids.

Usage:
    python3 scripts/build-bridge.py EXPORT1.xlsx [EXPORT2.xlsx ...] -o bridge.sql

Each xlsx is a 背景数据映射管理 export. The raw exports and the generated SQL are
operator artifacts and are not committed (see .gitignore). Load with:
    wrangler d1 execute <db> --file=bridge.sql --remote
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl required: pip install openpyxl")

# 1-based column positions in the 背景数据映射管理 export.
COL_VERSION = 2          # 配置版本名称, e.g. "Ecoinvent3.12+HiQ1.4.0"
COL_BG_ID = 4            # 配置版本背景数据ID  -> background_data_id
COL_NAME_EN = 5          # 配置版本背景数据名称(英文)
COL_NAME_CN = 6          # 配置版本背景数据名称(中文)
COL_LOCATION = 7         # 配置版本地理位置
COL_SYSTEM_MODEL = 9     # 配置版本系统模型, Cut-off / Consequential / EN15804
COL_UNIT = 10            # 配置版本单位(英文)
COL_ORIG_UUID = 13       # 配置版本背景数据原UUID  -> activity uuid (= catalog dataset_key prefix)
COL_BIND_UUID = 22       # 基准版本背景数据UUID    -> standardUuid the platform binds by

INSERT_COLUMNS = (
    "version_key, system_model_key, system_model, orig_uuid, "
    "background_data_id, bind_uuid, name_cn, name_en, location, unit"
)
BATCH = 1000


def version_key(name: str) -> str:
    return name.strip().lower().replace(" ", "")


def system_model_key(model: str) -> str:
    return re.sub(r"[\s_-]+", "", model.strip().lower())


def cell(row, idx: int) -> str | None:
    v = row[idx - 1]
    if v is None:
        return None
    s = str(v).strip()
    return s or None


def sql_str(v: str | None) -> str:
    if v is None:
        return "NULL"
    return "'" + v.replace("'", "''") + "'"


def parse_file(path: Path, rows: dict) -> int:
    # read_only=True is intentionally avoided: these exports ship a malformed
    # sheet dimension ("A1"), and openpyxl's read-only iterator trusts it and
    # yields zero rows. The full loader recomputes dimensions and reads correctly.
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    added = 0
    for i, raw in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:  # header
            continue
        version = cell(raw, COL_VERSION)
        orig = cell(raw, COL_ORIG_UUID)
        bg_id = cell(raw, COL_BG_ID)
        bind_uuid = cell(raw, COL_BIND_UUID)
        system_model = cell(raw, COL_SYSTEM_MODEL)
        if not (version and orig and bg_id and bind_uuid and system_model):
            continue
        vkey = version_key(version)
        smkey = system_model_key(system_model)
        name_cn = cell(raw, COL_NAME_CN)
        name_en = cell(raw, COL_NAME_EN)
        location = cell(raw, COL_LOCATION)
        unit = cell(raw, COL_UNIT)
        # A HiQ-overlay export can carry a compound origin "uuidA+uuidB"; either
        # part may be what a local catalog row's dataset_key carries, so index both.
        for part in orig.split("+"):
            part = part.strip()
            if not part:
                continue
            key = (vkey, smkey, part)
            if key in rows:
                continue
            rows[key] = (
                vkey, smkey, system_model, part,
                bg_id, bind_uuid, name_cn, name_en, location, unit,
            )
            added += 1
    wb.close()
    return added


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="+", help="背景数据映射管理 export xlsx files")
    ap.add_argument("-o", "--out", default="bridge.sql", help="output SQL path")
    args = ap.parse_args()

    rows: dict = {}
    for name in args.inputs:
        path = Path(name).expanduser()
        if not path.exists():
            sys.exit(f"missing input: {path}")
        added = parse_file(path, rows)
        print(f"  {path.name}: +{added} rows (cumulative {len(rows)})", file=sys.stderr)

    out = Path(args.out).expanduser()
    with out.open("w", encoding="utf-8") as f:
        f.write("PRAGMA foreign_keys=OFF;\n")
        f.write("DROP TABLE IF EXISTS bridge;\n")
        f.write(
            "CREATE TABLE bridge (\n"
            "  version_key TEXT NOT NULL,\n"
            "  system_model_key TEXT NOT NULL,\n"
            "  system_model TEXT,\n"
            "  orig_uuid TEXT NOT NULL,\n"
            "  background_data_id TEXT NOT NULL,\n"
            "  bind_uuid TEXT NOT NULL,\n"
            "  name_cn TEXT, name_en TEXT, location TEXT, unit TEXT\n"
            ");\n"
        )
        batch: list[str] = []
        for r in rows.values():
            batch.append("(" + ",".join(sql_str(v) for v in r) + ")")
            if len(batch) >= BATCH:
                f.write(f"INSERT INTO bridge ({INSERT_COLUMNS}) VALUES\n")
                f.write(",\n".join(batch))
                f.write(";\n")
                batch = []
        if batch:
            f.write(f"INSERT INTO bridge ({INSERT_COLUMNS}) VALUES\n")
            f.write(",\n".join(batch))
            f.write(";\n")
        f.write(
            "CREATE INDEX idx_bridge ON bridge "
            "(version_key, system_model_key, orig_uuid);\n"
        )
    print(f"wrote {len(rows)} rows -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
