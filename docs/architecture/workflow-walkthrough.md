# End-to-end workflow walkthrough — source material for the companion skill

> A real, traced run of the full product-carbon-footprint workflow against
> **prod** (`open.ecdigit.com`) on 2026-05-22, using the `jimu-lca` CLI (which
> mirrors the MCP tool surface 1:1). Captured so the companion skill
> (`jimu-lca-product-carbon`, under construction) is written from observed
> behavior, not from the API docs alone. Every gotcha below cost a round-trip
> to discover — the skill exists to spend the agent's attempt budget on the
> *modeling*, not on re-learning these.

## The functional-unit story this run modeled

"Carbon footprint of **1 kg coke (焦炭)**, cradle-to-gate, Ecoinvent 3.10,
IPCC 2021 GWP." A single industrial product with many co-products — the
common shape, not a toy.

## The traced call sequence (with the exact IDs, as a worked example)

| # | Tool | Key args | What came back / what it taught |
|---|---|---|---|
| 1 | `create_space` | `name="Kirby 的工作空间"` | space `51717046776025093`, **private** (`dicPermissionId 1801221779521712142`), one default root group. Auth = memberKey, not company appkey. **No delete-space tool — naming is one-shot.** |
| 2 | `list_background_db_versions` | — | picked **Ecoinvent3.10** = `41712481948418053`. (Also: 3.11, 3.12, Ecoinvent+HiQ combined.) |
| 3 | `list_models` | — | 20 GB-24067 templates. picked **焦炭(GB 24067)** = `42117744155881477`. Each model carries its own `industryId`/`categoryId`/`modelFlag` — `create_product` re-derives these, don't pass them. |
| 4 | `create_product` | `name, model_id, space_id, version_id` | returns `brandId 51718125075222533` + **case id `51718125075746821`**. Instantiating a template **pre-builds the whole case**: 1 stage (生产阶段), 6 processes, **60 data items — all `val=0`**, and **10 co-products** (焦炭 + 氧气/氮气/氩气/蒸汽/煤气电力/…). |
| 5 | `get_case_overview` | `case_id` | stage→process→data_item tree with `backing_counts`. `case.name` empty, `status 待计算`, boundary 摇篮到大门, declared unit "1kg焦炭". |
| 6 | `list_data_items` | **`process_id`** (NOT stage_id) — 炼焦 = `51718125075746825` | 49 rows in the main process, each with `val`/`unit`/`source` + the `id` you edit. |
| 7 | `edit_data_items` | `edits=[{id,val},…]` | set the **product reference output** 焦炭=1000 kg (`51718125096194056`) + inputs 中压电力=5000 kWh, 柴油=50 kg. Returns **empty data on success** — verify by re-listing. |
| 8a | `calculate_case` | `case_id, method_id` (no target) | **validation error listing all 10 product candidates** — the wrapper refuses to guess which co-product is the reference. This is correct behavior, not a bug. |
| 8b | `list_calculation_methods` | `version_id` | 45 methods. **IPCC 2021** = `41780714908987398` (also IPCC 2013, EF v3.x, ReCiPe, TRACI, USEtox…). |
| 8c | `calculate_case` | `case_id, method_id, target_product=42594965612429322` (焦炭) | returns empty data on success — **async task submit**. |
| 9 | `get_product_lcia` / `get_top_contributors` | `product` (brandId), `indicator='GWP'`, `target_product` | result fetch with built-in version discovery. **See the calc-result gap below.** |

## Skill-critical lessons (these are the deliverables for the skill)

**L1 — A freshly created product is a fully-structured but ALL-ZERO template.**
`create_product` does not produce a calculable case. Every quantity, *including
the declared product's own output (reference flow)*, starts at 0. The skill's
modeling step must (a) set the product reference output first, then (b) fill
inputs. Never assume the template is ready to calculate.

**L2 — `calculate_case` almost always needs an explicit `target_product`.**
Industrial models carry many co-products (10 here). The wrapper returns the
candidate list instead of guessing — the skill should feed that list back to
the user / pick the one matching the product name, then re-call.

**L3 — `status: 已计算` is NOT proof of results. This is the headline footgun.**
After submit, the case status flips to 已计算 almost immediately, but LCIA
result records may not exist. In this run `list_case_calculation_methods`
returned **0 records in every background-DB version** and `get_product_lcia`
reported *"no calculation results in any background-DB version yet"* — and
**kept doing so for the full ~7 min of polling, even after** the reference
flow was set to a non-zero value. The skill MUST verify results by actually
fetching LCIA rows, treat an empty result as a real failure to investigate,
and **never report a footprint number it didn't read back.** Two distinct
root cause: the model failed validation (see the model-completeness ruleset
below) so the submit was accepted but the async calc produced nothing.

**L3a — `status: 已计算` flips on *submit*, independent of validation.** The
status is not a calc-success signal — a model that fails the 修改项 validation
still shows 已计算 after submit, with no result. Only `co2Content` on the
`list_products` row (or a non-empty `get_product_lcia`) proves a real result.

**L4 — Don't query results by the case's nominal versionId.**
`list_case_calculation_methods` requires a `version_id`, and the *calculated*
versionId can differ from `getCaseDetail.versionId`. Prefer the
`get_product_lcia` / `get_top_contributors` aggregators — they loop versions
internally so the agent never guesses.

**L5 — Writes return empty data on success.** `edit_data_items`,
`calculate_case`, `create_product`(data subset) come back with `null`/empty
`data`. Confirm a write by reading state back (re-list / overview), not by the
return value.

**L6 — Isolate first.** `create_space` (private) before any product write, so
modeling never lands in the org-public shared spaces. There were 7 org-public
spaces visible to this memberKey before this run; none were a safe sandbox.

**L7 — CLI/arg ergonomics.** CLI flags derive from the zod schema *keys*
(`--product`, not `--name-or-brand-id`; `--case-id`, `--version-id`). Array
args are passed as JSON-encoded strings (`--edits='[{"id":"…","val":1000}]'`).
Env var must precede the command (`JIMU_LCA_MEMBER_KEY=… node cli.js …`).

**L8 — `sourceId` is a data-*provenance* tag (缺省值/文献/现场数据), NOT the
background-dataset link.** Early in this run an item read `src=-` and I assumed
"no background bound." Wrong — `getDataConfigurationDetail` showed the input
*did* have a `backgroundList` entry with a real `upElementUuid`. The
`sourceId` column is a separate quality/provenance enum:
`15889436508619973`=缺省值, `15889436508619974`=文献, (现场数据 = another id).
`edit_data_items(source_id=…)` sets it fine. Don't conflate it with background
matching.

**L9 — `calculate_case` surfaces model-validation errors synchronously
(code 600). This is the real shape of "can't calculate".** When the model is
invalid, `calculate_case` returns a **JSON array of validation messages**
(not the async "提交成功" message, not an empty result). The wrapper passes
them straight through — good. Example real payload from this run:
`["【生产阶段】-【空气分离】工序-【氩气】产品活动数据为0或空，请输入非零数值", …]`.
So the skill should always inspect the `calculate_case` return: an **array**
== validation failure (show the user the list, fix, retry); a string message
== async submitted.

## The model-completeness ruleset (the headline deliverable)

The platform's model validation (visible in the web UI, also returned by
`calculate_case` on failure) splits into **修改项 (must-fix, blocks calc)** and
**确认项 (warnings, don't block)**. From the real coke case:

**修改项 — blocks calculation until cleared:**
- **Every process's product / co-product / disposal OUTPUT must have non-zero
  activity data.** The coke template had 6 processes (空气分离, 炼焦, 煤气发电,
  蒸汽生产, 废水处理, 空气压缩); each emits products (氧气/氮气/氩气/液氧/…,
  煤气电力, 蒸汽, 压缩空气, 废水-处置). All start at 0 → 10 blocking errors. The
  declared/target product alone being non-zero is **not** enough.

**确认项 — quality warnings, calc still runs:**
- `未配置上游背景数据` — an input has no background dataset matched.
- `质量相对偏差 X%` — per-process input/output mass imbalance.
- `未配置运输数据` — a material input has no transport leg.
- `产品未被其他工序引用` — a co-product isn't consumed downstream.

The skill's modeling step must drive the **修改项** to zero before calling
`calculate_case`, and surface 确认项 to the user as quality flags.

## ✅ RESOLVED — the full create→fill→calculate→result flow, with a real number

End-to-end success on **my own** product:

```
product E2E测试-焦炭 (51718125075222533) → case 51719101933604869 已计算
method IPCC 2021, version Ecoinvent3.10, case_cal_method_id 51719109555441669
焦炭 GWP100 (IPCC 2021)        = 0.1980 kg CO2-Eq/kg
焦炭 GWP100 化石源              = 0.1980 kg CO2-Eq/kg
焦炭 GWP20  化石源              = 0.2261 kg CO2-Eq/kg  (indirect 0.068 + direct 0.158)
```

Two things had been blocking, and **both are platform/model issues, not tool
bugs** — `edit_data_items` writes were correct all along:

**Blocker 1 — I edited the wrong same-named item.** The 修改项 named
"【废水处理】工序-【废水-处置】". There are *two* `废水-处置` items: an OUTPUT in
the 炼焦 process and an **INPUT (处置物) in the 废水处理 process**. I'd set the
炼焦 one. `list_data_items` is per-process — always match the validation
message's `【工序】` to the right process before editing.

**Blocker 2 — model validation freezes a snapshot on the first calc submit.**
Once you call `calculate_case`, the validation result is cached against that
submission; later `edit_data_items` changes are **not** re-validated, so the
same stale errors keep coming back even though `getElementList` shows the new
values. (That's why 焦炭, edited *before* the first submit, was never flagged,
while the co-products edited *after* stayed flagged.) **There is no API
"re-validate" trigger we found.**

**The fix that worked — and the pattern the skill must use:** get a **fresh
validation snapshot** by `copy_case`. The copy inherits all data-item values
(verified: 焦炭=1000, all 10 product outputs=100, sources, the 废水-处置 input)
but starts with a clean validation state. Procedure:

1. Build/fill the model completely (every process product output non-zero,
   reference flow set, disposal inputs non-zero, sources set).
2. If you've *already* submitted a calc on this case and got cached errors:
   `copy_case` → work on the **copy** (fresh validation).
3. `calculate_case` on the fresh case **once**. Array back ⇒ a real remaining
   gap (fix on a *new* copy); empty/`提交成功` ⇒ submitted.
4. Result is near-instant for a small model (was queryable ~2 s after submit,
   well under the platform's "预计5分钟" estimate). Read via `get_product_lcia`
   or `list_products.co2Content`.

> Tooling implication for the skill / wrapper: treat `calculate_case` as
> **fire-once-per-case**. If it returns 修改项, don't retry the same case —
> fix, `copy_case`, retry on the copy. A future `calculate_case` wrapper could
> auto-copy on a cache-stale retry, but document the behavior loudly either way.

## Also proven — the read path on a pre-existing product

`get_product_lcia` against an already-calculated product, one call, version
discovery included:

```
product 计算20260521 → case 已计算, method "CISA-EPD PCR", version Ecoinvent3.10
GWP100 = 162.86 kg CO2-Eq  (indirect 1.32 + transport 0.09 + direct 161.45)
```

This is what most Cortex chat users will do ("what's the footprint of product
X"). Both halves of the workflow — author and query — now work end to end.

## Open questions remaining (nice-to-have, not blockers)

1. **A `re-validate` / pre-submit-validation tool** — so the skill can check
   修改项 == 0 *without* burning a calc submit (which freezes the snapshot).
   Could wrap the validation endpoint the web UI calls, or reuse
   `calculate_case`'s code-600 array on a throwaway copy.
2. **Calc async window on large models** — was ~2 s here; the "5 分钟" estimate
   may matter for big models. The skill should poll, not assume instant.

## Tool bugs found + fixed during this run

- **`copy_case` sent `caseId` in the JSON body; upstream wants a query param.**
  `POST /lca/v3/copyCase` with body `{caseId}` → `caseId不能为空`; `?caseId=…`
  → `成功`. The doc's own curl uses the query form. **Fixed** (`postQuery` in
  `api.ts`, `src/tools/copy_case.ts`). Note `copyCase` returns no new-case id,
  just `成功` — discover the copy via `get_product`'s `lcaBrandCases` (highest
  `orderNum`). `copy_case` is now load-bearing: it's the validation-cache reset.
- **`edit_data_items` makes `unit_id` optional though `editElements` lists it
  必填.** Writes landed fine without it (and adding it didn't change the
  validation outcome — Blocker 2 above was the real cause), so left as-is; a
  defensive wrapper could pass through the existing `unitId`.

## Artifacts this run left in prod (private space "Kirby 的工作空间" 51717046776025093)

- Product/brand `51718125075222533` "E2E测试-焦炭" with 3 cases:
  - `51718125075746821` (order 1) — original, hit the stale-validation cache
  - `51719053673918469` (order 2) — copy, narrowed to 1 error
  - `51719101933604869` (order 3) — **fully calculated, GWP100 0.1980 kg
    CO2-Eq/kg** — keep as the working end-to-end fixture
  (model intentionally left mid-completion as a validation-failure fixture)
