# Proposed MCP tool surface (v0)

Aggregates the 32 LCA-runtime endpoints into a **22-tool** MCP surface for the
Cortex agent. Status legend:

- 📖 read-only — safe to call freely
- ✍️ write — `destructiveHint=True`; skill rules will require user confirmation
- 🧩 aggregator — wraps multiple upstream calls into one
- ⏸ deferred — wrapping postponed until use case appears

## Tool list

### Public data (3 / 3 upstream endpoints — no aggregation)

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `get_units` | `GET /lca/v3/getAllUnits` | Unit groups (mass, energy, ...) and each group's unit list. Reference data the agent uses when reading / writing exchange values. |
| 📖 `list_background_db_versions` | `GET /lca/v3/getAllocationVersions` | Background database versions (Ecoinvent 3.10 / 3.11 / HiQ 1.2 / combined). Returns `versionId` needed by `list_calculation_methods` and `addCaseCalculationTask`. |
| 📖 `list_calculation_methods(version_id)` | `GET /lca/v3/getAssignedCalculationMethods` | LCIA methods (e.g. IPCC GWP100, CML-IA, etc.) available to the tenant under a given background DB version. **Docs lie about params** — the endpoint requires `versionId` as a query string even though the docs table doesn't list it. |

### Space management — read only (2 / 7 upstream endpoints — 5 writes deferred to web UI)

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `list_spaces` | `GET /lca/v3/getProjectSpaces` | Lists workspaces the member can see. Returns name, id, permission level, group list. |
| 📖 `list_space_members(space_id)` | `GET /lca/v3/getMembersBySpaceId` | Lists members of a specific workspace. |

`addProjectSpace` / `addMemberToSpaceBatch` (also used for role updates) /
`getAllUser` / `deleteMemberFromSpaceBatch` are **not wrapped**. See
[non-goals.md](non-goals.md#group-2--space-membership-writes-5-endpoints).

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
| 🧩📖 `get_case_overview(case_id)` | `getCaseDetail` + `getCaseStage` + `getProcessList` + `getDataConfigurationList` + `getCaseDisposals` | **Aggregator** — five upstream calls fused into one response so the LLM gets a full case picture (metadata, life-cycle stages, processes, data configs, products + disposals) in one shot. |
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
- **Hide schema quirks at the boundary.** `getAssignedCalculationMethods`
  requires `versionId` as a query param even though the published docs don't
  list it. Wrapping it means the agent doesn't have to know.

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

- `get_data_config` — singular drilldown; wrap once we see a recurring need
- `publish_data` — semantics unclear in docs; need a real case
- `submit_uncertainty_analysis` — async; need polling story

These exist in `docs/api/` for completeness but get no MCP tool until phase 1.
