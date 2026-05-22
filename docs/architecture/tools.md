# MCP tool surface (v0)

The 32 LCA-runtime endpoints map to **23 MCP tools** in v0 (21 primitives wrapping the surface, plus 2 convenience aggregators for high-frequency user intents). Status legend:

- 📖 read-only — safe to call freely
- ✍️ write — `destructiveHint=True`; skill rules will require user confirmation
- 🧩 aggregator — wraps multiple upstream calls into one
- 🎯 convenience aggregator — captures a common high-value user-intent in
  one call (different from 🧩 which is mostly about avoiding silent failure
  modes); high LLM ergonomics
- ⏸ deferred — wrapping postponed until use case appears

The surface was sized by walking 6 representative Cortex agent user stories
end-to-end against prod (see `tests/user_story_trace.py`). Findings that
drove tool decisions:

- Story 2 ("LCIA detail for product X") and Story 5 ("top contributors to
  GWP") each take 5–10 wire calls in the raw API. Both got new 🎯
  convenience aggregators (`get_product_lcia`, `get_top_contributors`).
- Story 1 ("highest GWP in space") needs only `list_products` — its
  `co2Content` is on every row, no drill required. No aggregator.
- Story 4 ("locate data item to edit") drills the same stage→process→items
  path `get_case_overview` already aggregates. Reuse, don't duplicate.
- `getCaseDetail.versionId` ≠ the actually-calculated `versionId` in
  some cases (real footgun observed in Story 2). The
  `list_case_calculation_methods` MCP wrapper plus
  `get_product_lcia` aggregator both handle this internally so the agent
  never has to loop over versions by hand.

## Tool list

### Public data (3 / 3 upstream endpoints — no aggregation)

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `get_units` | `GET /lca/v3/getAllUnits` | Unit groups (mass, energy, ...) and each group's unit list. Reference data the agent uses when reading / writing exchange values. |
| 📖 `list_background_db_versions` | `GET /lca/v3/getAllocationVersions` | Background database versions (Ecoinvent 3.10 / 3.11 / HiQ 1.2 / combined). Returns `versionId` needed by `list_calculation_methods` and `addCaseCalculationTask`. |
| 📖 `list_calculation_methods(version_id)` | `GET /lca/v3/getAssignedCalculationMethods` | LCIA methods (e.g. IPCC GWP100, CML-IA, etc.) available to the tenant under a given background DB version. `versionId` is required (it sits in the "请求参数" sub-table separately from the "请求头" table). |

### Space management (3 / 7 upstream endpoints — 4 membership/governance writes deferred to web UI)

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `list_spaces` | `GET /lca/v3/getProjectSpaces` | Lists workspaces the member can see. Returns name, id, permission level, group list. |
| 📖 `list_space_members(space_id)` | `GET /lca/v3/getMembersBySpaceId` | Lists members of a specific workspace. |
| ✍️ `create_space(name, description?)` | `POST /lca/v3/addProjectSpace` | Creates a **private** workspace owned by the memberKey (+ a default root group). Gives the user an isolated space so modeling work doesn't land in shared org-public spaces. Skill rule: confirm name before creating — there is no delete-space tool (web-UI only). |

`addMemberToSpaceBatch` (also used for role updates) / `getAllUser` /
`deleteMemberFromSpaceBatch` are **not wrapped** — those are teammate/role
governance the user does in the web UI. See
[non-goals.md](non-goals.md#group-2--space-membership-writes).

### Model library (1 / 1 upstream endpoint)

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `list_models` | `GET /lca/v3/getModelList` | LCA process model templates the user can copy from when starting a new case. |

### Product management (5 / 10 upstream endpoints — case-read aggregated, write separated)

| Tool | Upstream | Notes |
|---|---|---|
| ✍️ `create_product(...)` | `POST /lca/v3/addBrand` | Creates a product "brand". One per product line. |
| 📖 `list_products(space_id, page, ...)` | `POST /lca/v3/getBrandPage` | Paginated product list scoped to a space. |
| 📖 `get_product(brand_id)` | `GET /lca/v3/getBrandInfo` | Product metadata (name, description, units, ...). |
| 🧩📖 `get_case_overview(case_id)` | `getCaseDetail` + `getCaseStage` + N × `getProcessList` + N × `getDataConfigurationList(page=1, size=200)` + `getCaseDisposals` | **Aggregator** — N+3 upstream calls (where N = number of life-cycle stages) fused into one response so the LLM gets the full case picture in one shot. See the aggregator shape below. |
| ⏸ `get_data_config(config_id)` | `POST /lca/v3/getDataConfigurationDetail` | Single config drill-down. Kept separate from `get_case_overview` because it can be heavy; the agent calls it after deciding which config matters. |
| ✍️ `copy_case(case_id)` | `POST /lca/v3/copyCase` | Clone an existing LCA case (e.g. to model a variant). |
| ✍️ `delete_case(case_id)` | `POST /lca/v3/deleteCase` | Soft-delete an LCA case. |

### Data input (4 / 4 upstream endpoints — no aggregation)

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `list_data_items(case_id, ...)` | `GET /lca/v3/getElementList` | Lists the fillable data items (inputs / outputs / emissions) of a case. |
| ✍️ `edit_data_items(case_id, items[])` | `POST /lca/v3/editElements` | Updates one or more data items. Batched write — `destructiveHint=True`. |
| 📖 `export_elements_excel(case_id, out_path)` | `GET /lca/v3/exportElementData` | Saves the data-items workbook to a local path. Returns the path for downstream tools (e.g. user manual review). |
| ✍️ `import_elements_excel(case_id, file_path)` | `POST /lca/v3/importModelData` | Bulk-updates data items from a local Excel file. **Big-blast-radius write** — must be preceded by an `export` + diff confirmation. |

### Submit calculation (5 / 6 upstream endpoints — `getCaseDisposals` folded into `calculate_case`)

| Tool | Upstream | Notes |
|---|---|---|
| 🧩✍️ `calculate_case(case_id, ...)` | `GET /lca/v3/getCaseDisposals` (prefetch) + `POST /lca/v3/addCaseCalculationTask` | **Aggregator** — the calc task body requires the product+disposal list as input; the prefetch automates that. Skill rule: agent must surface what's about to be calculated and **ask before submit**. |
| 📖 `list_case_calculation_methods(case_id)` | `GET /lca/v3/getCaseCalculationMethods` | Historical calculation methods previously run on this case version. |
| 📖 `get_lcia_detail(case_id, method_id)` | `POST /lca/v3/getCaseLciaDetails` | LCIA results for one (case, method) pair. The agent's headline result fetcher. |
| ⏸ ✍️ `publish_data(...)` | `POST /lca/v3/publishData` | Upload report data. Semantics unclear from docs; wrap once a real use case appears. |
| 📖 `get_sensitivity(case_id)` | `POST /lca/v3/getCaseSensitive` | Sensitivity analysis results. |

### Uncertainty analysis (1 / 1)

| Tool | Upstream | Notes |
|---|---|---|
| ⏸ ✍️ `submit_uncertainty_analysis(...)` | `POST /lca/v3/submitUncertaintyAnalysis` | Monte Carlo / uncertainty calc trigger. Async — need to clarify polling. |

### Convenience aggregators (added after user-story testing)

| Tool | Upstream chain it collapses | Notes |
|---|---|---|
| 🎯📖 `get_product_lcia(name_or_brand_id, indicator='GWP', target_product=None)` | `getBrandPage` → `getBrandInfo` → `getCaseDetail` → version-discovery loop over `getCaseCalculationMethods` → `getCaseLciaDetails` | Story 2 collapsed: "show me the LCIA for product X" goes from 5 raw calls (worst case 10 if version-discovery loops) to one tool. Filters indicator (default GWP), picks the first target product if not specified. |
| 🎯📖 `get_top_contributors(product_or_case_id, indicator='GWP', threshold=0.05)` | All of the above + `getCaseSensitive` | Story 5 collapsed: "what's driving the GWP of product X" goes from 10 raw calls to one tool. Returns the sorted top-N contributing data items with their share. |

Both also accept the primitive tools' params for flexibility — agents that
want full control (multi-target, indicator switching, threshold tuning) can
still call the primitives directly. The 🎯 tools are not the only path,
they're the **default** path for their respective intents.

## `get_case_overview` aggregator shape

The agent calls `get_case_overview(case_id="<id>")` once; the server runs
N+3 upstream calls in parallel where possible, joins on stageId, and
returns a single merged structure:

```python
{
  "case": {
    # from getCaseDetail (id=case_id)
    "id": "...", "uuid": "...", "name": "...",  # `name` joined from getBrandInfo
    "brand_id": "...", "brand_name": "...",     # joined from getBrandInfo
    "status": "待计算",                          # statusName
    "boundary": "摇篮到大门",
    "version": {"id": "...", "name": "Ecoinvent3.10"},  # versionId+versionName
    "declared_unit": {"id": "...", "name": "kg", "comment": "..."},
    "report_date": "2026-01~2026-05",
    "description": "...",
  },
  "stages": [
    {
      # from getCaseStage
      "id": "...", "name": "原材料生产与制造阶段", "order_id": 2,
      "processes": [
        # from getProcessList(stageId=stage.id)
        {
          "id": "...", "name": "机车生产",
          "category": "主工序",
          "order_id": 1,
        }
      ],
      "products_and_disposals": [
        # joined from getCaseDisposals (children of this stage)
        {
          "id": "...", "name": "机车",
          "category": "产品",         # 产品 / 副产品 / 废弃物
          "process_id": "...", "process_name": "机车生产",
          "unit": "kg",
        }
      ],
      "data_items": {
        # from getDataConfigurationList(caseId, stageId, page=1, size=200)
        "total_loaded": 5,
        "rows": [
          {
            "id": "...", "name": "不锈钢",
            "category": "原辅料",
            "backing_counts": {
              "background": 2, "transport": 1,
              "material": 1, "lci": 0, "special": 1,
            },
          }
        ],
        "note_if_truncated": null,  # set when size cap (200) was hit; agent
                                    # then calls list_data_items for full
      },
    }
  ],
}
```

Three design points:

1. **Headline + drill-down in one shot.** The agent gets case metadata,
   the stage tree, processes inside each stage, products/disposals
   attached to each stage's processes, and the data-item summary (with
   "what's filled vs missing" backing counts) — without needing to issue
   the 4-to-8 round trips this represents at the wire level.
2. **stage-rooted view.** All sub-collections (processes,
   products+disposals, data items) live under their owning stage, so the
   LLM can answer scoped questions ("what's in the 原材料 stage?") by
   looking at one node.
3. **Truncation signal.** `data_items.note_if_truncated` is non-null
   when the first page of `getDataConfigurationList` didn't capture all
   rows — the agent then falls back to `list_data_items(case_id,
   stage_id, page=N)` for deep paging. Most cases never hit this.

### Cost analysis

For a typical case (3 stages):
- Wire calls: 1 (`getCaseDetail`) + 1 (`getBrandInfo` for name) +
  1 (`getCaseStage`) + 3 (`getProcessList` × 3) +
  3 (`getDataConfigurationList` × 3) + 1 (`getCaseDisposals`) = **10 calls**
- Latency budget: ~3 s wall-clock if serialised; ~600 ms if fanned out
- Tokens to LLM: one ~2 KB response vs ten ~300 B responses with
  per-call tool descriptions reloaded — saves ~3 KB and one
  decision-cycle per call

## Why this aggregation, not 1:1

- **LLM tool-selection accuracy** degrades with many similar-sounding tools.
  32 raw endpoints means ~5800 tokens of tool descriptions injected on every
  agent invocation, and the LLM has to disambiguate 6 different `getCase*`
  variants. Aggregating the case-read endpoints into `get_case_overview` is
  the highest-leverage win.
- **Avoid the "agent must call 3 things in sequence" trap.** `calculate_case`
  is the cleanest example: the docs require you to read the disposal list
  first, then submit. If the MCP exposes both separately, agents will skip the
  prefetch and submit with empty disposals — a silent-failure shape we've seen
  repeatedly with editor-mcp.
- **Make required-param chains obvious from the signature.** E.g. the agent
  can't call `getAssignedCalculationMethods` without first calling
  `getAllocationVersions` to obtain a `versionId`. Reflecting that in the
  TS signature (`list_calculation_methods({ version_id })`) is clearer
  than the raw HTTP shape where the dependency is documented but easy to
  overlook.

## Aggregation tradeoffs

Wrapper tools cost:

- **Less flexibility** — `get_case_overview` is opinionated about which 5
  reads to do. If a future need wants a different cross-section, we either
  extend the wrapper or expose the underlying tools too.
- **Hidden errors** — if `getCaseDisposals` inside `calculate_case` fails, the
  user sees "calculate_case failed", not "getCaseDisposals failed". Mitigation:
  surface intermediate error payloads in the wrapper's response.

If aggregator pain mounts during real use, split back to 1:1. Aggregation is a
default, not a vow.

## What we deferred (⏸)

- `get_data_config` — singular drilldown into one data item's backings
  (background datasets, LCI rows, transport, validation messages). Useful for
  "why is this item not matched?" inspection. Not a calc blocker — the
  [workflow walkthrough](workflow-walkthrough.md) confirmed template items come
  with backgrounds pre-bound; the real fill→calculate gotchas were
  product-output activity data + the validation-snapshot cache, not source
  binding. Promote when an agent needs to debug an item's backing.
- `publish_data` — semantics unclear in docs; need a real case
- `submit_uncertainty_analysis` — async; need polling story

These exist in `docs/api/` for completeness but get no MCP tool until phase 1.
