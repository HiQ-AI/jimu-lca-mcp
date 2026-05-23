# Local-catalog binding bridge

Binding a background LCI dataset to a flow normally takes two server round trips:
search 积木's background database by name (`search_backgrounds`), then save the
chosen dataset onto the flow (`bind_backgrounds`). The search is fuzzy — it ranks
name matches and the caller disambiguates by region and unit — so it is both the
slowest step and the one most prone to a wrong pick.

Hosts that already ship a local copy of the LCI catalogs (HiQ Cortex Desktop
bundles them as TSV) can skip the search entirely: grep the catalog locally, then
hand the chosen dataset's identifier straight to a save call. `bind_backgrounds_local`
is that save call. This document explains why it is possible and how the bridge
that powers it is built.

## Why a bridge is needed

积木 re-identifies every dataset when a background database is imported into a
version. A dataset's 积木-internal `uuid`, its `standardUuid`, and its numeric
`backgroundDataId` are all assigned at import time and share nothing with the
identifiers in the source catalog. So a local catalog row cannot name a 积木
dataset directly — the two id spaces are disjoint.

What *does* survive the import is the dataset's **original pre-import uuid**. 积木's
per-version mapping export (背景数据映射管理) records it in the
`配置版本背景数据原UUID` column, and that value is exactly the activity uuid the
local catalogs carry as the prefix of their `dataset_key` (`{activityUuid}_{version}`).
That single shared column is the bridge.

For each dataset the export also carries the two identifiers a bind needs:

| Export column | Bind field | Notes |
|---|---|---|
| `配置版本背景数据原UUID` | — (join key) | equals the local `dataset_key` prefix |
| `配置版本背景数据ID` | `background_data_id` | 17-digit id; the platform resolves the LCI by it |
| `基准版本背景数据UUID` | `bind_uuid` (`standardUuid`) | the value the platform binds by |

`bind_uuid` comes from the **baseline** version (基准版本) rather than the
configured version, because every configured version binds against one shared
baseline; this also means `bind_uuid` is stable across versions for the same
dataset.

## Coverage

The bridge resolves an activity uuid within one background-DB version and system
model. Coverage, measured against the bundled catalogs:

- **Ecoinvent (Cut-off, Consequential)** — complete. Every catalog activity uuid
  has a bridge row.
- **HiQ-specific datasets** — a few percent are absent from the export and resolve
  as misses.
- **EN15804** — partial.
- **Older HiQ-overlay versions** (e.g. Ecoinvent3.10+HiQ1.2) record a compound
  `uuidA+uuidB` origin from an earlier id scheme that does not line up with the
  current catalogs; both halves are indexed, but most resolve as misses.

`bind_backgrounds_local` returns any uuid it cannot resolve in an `unresolved`
list. The caller falls back to `search_backgrounds` + `bind_backgrounds` for just
those, so partial coverage never blocks a model — it only changes how many flows
take the fast path.

## Data store

The bridge lives in a [Cloudflare D1](https://developers.cloudflare.com/d1/)
database bound to the Worker as `DB`. The binding is **optional**: with no `DB`
bound, `bind_backgrounds_local` reports the bridge unavailable and callers use the
search path. This keeps the Worker deployable before the database is provisioned.

Table shape (see [`scripts/build-bridge.py`](../../scripts/build-bridge.py) and
[`src/bridge.ts`](../../src/bridge.ts)):

```sql
CREATE TABLE bridge (
  version_key        TEXT NOT NULL,  -- normalised version name
  system_model_key   TEXT NOT NULL,  -- normalised Cut-off / Consequential / EN15804
  system_model       TEXT,
  orig_uuid          TEXT NOT NULL,  -- activity uuid = local dataset_key prefix
  background_data_id TEXT NOT NULL,
  bind_uuid          TEXT NOT NULL,
  name_cn TEXT, name_en TEXT, location TEXT, unit TEXT
);
CREATE INDEX idx_bridge ON bridge (version_key, system_model_key, orig_uuid);
```

Lookups normalise the version name (so the live API's version string and the
export's version name compare equal despite spacing) and the system-model label
(so the catalog's `cut_off` matches the export's `Cut-off`).

## Building and refreshing

The export files are operator artifacts; neither they nor the generated SQL are
committed (see `.gitignore`). Refresh when 积木 re-imports a background database.

```bash
# 1. Build the SQL dump from the per-version mapping exports. Pass only the
#    versions you need; --system-model narrows it further (see the write budget below).
python3 scripts/build-bridge.py Ecoinvent3.12+HiQ1.4.0.xlsx --system-model Cut-off -o bridge.sql

# 2. Provision the database once (records database_id for wrangler.toml).
wrangler d1 create jimu-lca-bridge

# 3. Load (or reload) the data.
wrangler d1 execute jimu-lca-bridge --file=bridge.sql --remote
```

Then set the `database_id` in `wrangler.toml`'s `[[d1_databases]]` block (binding
`DB`). The next push to `main` deploys a Worker that resolves local datasets
through the bridge.

### Write budget

D1's free plan allows 100,000 row writes per day, so the full multi-version dump
(~500k rows) cannot load in one pass on it. Load incrementally — one version and
system model at a time fits comfortably (e.g. Ecoinvent3.12+HiQ1.4.0 Cut-off is
~55k rows) — or load the whole set at once on a paid plan. `bind_backgrounds_local`
falls back to search for anything not yet loaded, so a partial bridge is always safe.
