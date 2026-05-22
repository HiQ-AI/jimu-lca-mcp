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
root causes were found feeding the same silent "已计算-with-no-results" state
(see L3a / L8).

**L3a — A zero reference flow alone produces no LCIA.** The first submit had
the declared product output (焦炭) at 0; setting it to 1000 kg was *necessary*
but **not sufficient** (see L8).

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

**L8 — A data-item value with no bound background source contributes
nothing — and this is the *other* cause of the silent empty result.** After
setting non-zero values, the edited items still read back `sourceId: null`
(`src=-`). A flow with a quantity but no linked background LCI dataset adds
zero to the LCIA, so even a non-zero reference flow + non-zero inputs yields
no result. The model template's `backing_counts` (e.g. `background: 2`) means
candidate background datasets *exist* for the item, but **none is selected by
default**. `edit_data_items` accepts a `source_id`, but **selecting the right
one is the missing modeling step** — and see the tool-surface gap below.

## Tool-surface gap this run exposed

**Discovering + binding a background source per data item is not yet a
first-class v0 capability.** To make an input actually contribute, the agent
must pick a `source_id` from that item's candidate background datasets and
pass it to `edit_data_items`. But the tool that drills an item's candidate
backings — `get_data_config` (`getDataConfigurationDetail`) — is **deferred
(⏸)** in [tools.md](tools.md). So today an agent can build the model skeleton
and set quantities, but **cannot complete the "bind each input to a background
dataset" step that calculation actually requires.** This is precisely the
"a concrete task can't be done with the v0 surface" trigger from
[non-goals.md](non-goals.md) — `get_data_config` (and possibly a
`list_background_candidates` helper) should be promoted from ⏸ before the
skill can drive a clean fill→calculate→result flow end to end.

## Open questions to close before the skill ships

1. **Background-source binding** (the blocker): promote `get_data_config` so
   the agent can enumerate an item's candidate background datasets, then
   `edit_data_items(source_id=…)` to bind them. Without this, fill→calculate
   can't complete from the agent alone.
2. **Calc async window**: how long until LCIA records appear, and is there a
   queue to poll? (Couldn't be measured here because the model never became
   complete enough to produce a result.)
3. **Pre-submit validation**: `calculate_case` should ideally refuse (loud
   "model incomplete: reference flow / N inputs unbound") instead of letting
   the platform flip status to 已计算 with no result.

Until these close, the skill's calculate step must: verify reference flow
**and** that key inputs have a bound `sourceId` *before* `calculate_case`,
then confirm with `get_product_lcia` — and surface "no results / model
incomplete" rather than ever implying success from `status: 已计算` alone.

## Artifacts this run left in prod (private space, safe to reuse/delete via web UI)

- Space `51717046776025093` "Kirby 的工作空间" (private)
- Product/brand `51718125075222533` "E2E测试-焦炭", case `51718125075746821`
