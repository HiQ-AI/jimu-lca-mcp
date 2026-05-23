# MCP tool surface

**38 tools** cover the runtime LCA loop — reference data, spaces, products and
cases, model building, data items, background binding, calculation, and results.
All three entry points (stdio MCP, CLI, Worker) iterate the same registry
(`src/tools/index.ts`); the CLI exposes each as a subcommand.

Status legend:

- 📖 **read** — no state change; safe to call freely.
- ✍️ **destructive** — `destructiveHint` is set (bulk overwrite or delete); a host
  should require user confirmation. Note that `create_*` / `add_*` / `edit_*` /
  `calculate_*` also mutate server state but are not flagged destructive because
  they are additive and reversible in the UI; the companion skill still gates the
  high-impact ones (calculate, create) behind confirmation.
- 🧩 **aggregator** — fuses several upstream calls into one (avoids a multi-call
  trap or a silent-failure shape).
- 🎯 **convenience aggregator** — collapses a common high-value user intent into a
  single call for LLM ergonomics; the primitives remain available underneath.

## Tool list

### Reference data

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `get_units` | `getAllUnits` | Unit groups + units; filter with `query` / `unit_group`. Reference data for reading/writing exchange values. |
| 📖 `list_background_db_versions` | `getAllocationVersions` | Background-DB versions (Ecoinvent / HiQ / combined). Returns the `versionId` other tools need. |
| 📖 `list_calculation_methods` | `getAssignedCalculationMethods` | LCIA methods (IPCC GWP100, CML-IA, …) for a given background-DB version. |
| 📖 `list_industries` | — | Industry tags (the `industry_id` source for product creation). |
| 📖 `check_connectivity` | (probe) | Health-checks the open + manager API surfaces. |

### Spaces

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `list_spaces` | `getProjectSpaces` | Workspaces the member can see. |
| 📖 `list_space_members` | `getMembersBySpaceId` | Members of a workspace. |
| 📖 `create_space` | `addProjectSpace` | Creates a **private** workspace owned by the caller (+ default root group). Confirm the name first — there is no delete-space tool (web-UI only). |

Membership/role governance (`addMemberToSpaceBatch`, `deleteMemberFromSpaceBatch`,
`getAllUser`) is **not wrapped** — see [non-goals.md](non-goals.md#group-2--space-membership-writes).

### Models, products & cases

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `list_models` | `getModelList` | Process-model templates to start a case from. |
| 📖 `create_product` | `addBrand` | Create a product (brand) from a model template. |
| 📖 `create_custom_product` | `addBrand` | Create a custom product (no template; empty shell). |
| 📖 `create_blank_product` | (chain) | 🧩 Create custom product + case + stages in one call (baked enums). |
| 📖 `list_products` | `getBrandPage` | Paginated products in a space, with headline GWP. |
| 📖 `get_product` | `getBrandInfo` | Product detail + the LCA cases under it. |
| 🧩📖 `get_case_overview` | `getCaseDetail` + `getCaseStage` + N×`getProcessList` + N×`getDataConfigurationList` + `getCaseDisposals` | Full case picture in one response (see the aggregator shape below). |
| 📖 `copy_case` | `copyCase` | Duplicate a case (e.g. to model a variant). |
| ✍️ `delete_case` | `deleteCase` | Delete a case. Previews unless confirmed. |

### Model building (custom products)

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `add_case` | (chain) | Create an LCA case + stages on a custom product. |
| 📖 `add_case_process` | (chain) | Add a process to a stage. |
| 📖 `add_data_items` | (chain) | Add data items to a process. |

### Data items

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `list_data_items` | `getElementList` | Data items inside a process. |
| 📖 `get_model_items` | (chain) | 🧩 Every data item of a case (all processes) in one call. |
| 📖 `edit_data_items` | `editElements` | Batch-edit data items (array of edits). |
| 📖 `export_elements_excel` | `exportElementData` | Export a case's data items to a local `.xlsx`. |
| ✍️ `import_elements_excel` | `importModelData` | Bulk-overwrite data items from a local `.xlsx`. Pair with an export + diff first. |
| ✍️ `import_model` | `excel/importModelData` | One-shot: build a whole model from a filled template `.xlsx`. |

### Background matching

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `search_backgrounds` | `lcaUpPageList` (+ ZH fallback) | Batch fuzzy-search background datasets, ranked; returns `bind_uuid` + `background_data_id`. |
| 📖 `bind_backgrounds` | `saveConfiguration` | Bind chosen datasets to a stage's flows (batched). |
| 📖 `bind_backgrounds_local` | bridge + `saveConfiguration` | Bind by **local catalog `dataset_key`** — resolves to binding ids through the version bridge, no jimu-side search. Unresolved ones fall back to search. See [local-bridge.md](local-bridge.md). |

### Calculation & results

| Tool | Upstream | Notes |
|---|---|---|
| 📖 `validate_case` | (validation) | Validate a case — score + 修改项 / 确认项 before calculating. |
| 🧩📖 `calculate_case` | `getCaseDisposals` (prefetch) + `addCaseCalculationTask` | Triggers the LCIA calc; auto-prefetches the disposal/product metadata the task body needs. The skill must surface what's about to run and **ask before submit**. |
| 📖 `get_calc_status` | (poll) | Async calc status (done / failed / running). |
| 📖 `list_case_calculation_methods` | `getCaseCalculationMethods` | Historical calc methods + records on a case. |
| 📖 `get_lcia_detail` | `getCaseLciaDetails` | LCIA result rows for a (case, method). |
| 📖 `get_sensitivity` | `getCaseSensitive` | Per-data-item contribution share. |
| 🎯📖 `get_result` | (chain) | GWP + data-quality/provenance + an estimate disclaimer, in one read. |
| 🎯📖 `get_product_lcia` | `getBrandPage`→`getBrandInfo`→`getCaseDetail`→version discovery→`getCaseLciaDetails` | "LCIA for product X" in one call; collapses up to ~10 raw calls. |
| 🎯📖 `get_top_contributors` | the above + `getCaseSensitive` | "What's driving product X's GWP" — sorted top contributors with their share. |

The 🎯 aggregators also accept the primitives' params, so an agent that wants full
control (multi-target, indicator switching, threshold tuning) can still call the
primitives directly — the aggregator is the **default** path for the intent, not
the only one.

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
- `publish_data` — semantics unclear in the docs; needs a real use case
- `submit_uncertainty_analysis` — async; needs a polling story

These remain documented in `docs/api/` for completeness but are intentionally
unwrapped until a concrete need appears.
