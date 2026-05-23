import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { saveStageBindings, type ResolvedBinding } from "../binding.js";
import { versionKey } from "../bridge.js";
import { getAllocationVersionName } from "../api.js";

const Binding = z.object({
  element_id: z.string().describe(
    "The flow's `elementId` (from get_model_items / list_data_items) — NOT its row `id`.",
  ),
  dataset_key: z.string().describe(
    "The chosen dataset's `dataset_key` from the local Cortex catalog (e.g. " +
      "'4a7b2b18-6393-3d95-84ea-0272d39b9eb6_3.12.0'), or its bare activity-uuid " +
      "prefix. The bridge keys on the uuid before the version suffix — NOT the " +
      "catalog's `dataset_uuid` column.",
  ),
});

const Args = z.object({
  case_id: z.string().describe("Case id."),
  stage_id: z.string().describe("Stage id (get_case_overview → stages[].id). All bindings must be flows in this stage."),
  version_id: z.string().describe(
    "Background-DB version id (list_background_db_versions). Must be the same " +
      "version whose local catalog you grepped (e.g. the id of Ecoinvent3.12+HiQ1.4.0).",
  ),
  system_model: z.enum(["Cut-off", "Consequential", "EN15804"]).describe(
    "System model of the catalog you grepped — Cut-off (the catalog file's " +
      "`cut_off`), Consequential, or EN15804. Disambiguates datasets that exist " +
      "under more than one model.",
  ),
  bindings: z.array(Binding).min(1).describe("Bind many flows in ONE call."),
});

/** Strip the `_<version>` suffix off a catalog dataset_key to recover the bare
 *  activity uuid. A uuid contains no underscore, so the first underscore is the
 *  boundary; a bare uuid (no underscore) is returned unchanged. */
function toOrigUuid(datasetKey: string): string {
  const i = datasetKey.indexOf("_");
  return i === -1 ? datasetKey : datasetKey.slice(0, i);
}

export const bindBackgroundsLocal: ToolDef<typeof Args, unknown> = {
  name: "bind_backgrounds_local",
  description:
    "Cortex-only: bind a stage's flows to background datasets identified by their " +
    "LOCAL catalog `dataset_key` — no jimu-side search needed. For each binding it " +
    "resolves the catalog activity uuid to jimu's binding ids (background_data_id + " +
    "standardUuid) via the bundled version bridge, then saves them all in one " +
    "saveConfiguration. Use this when you picked datasets by grepping the local " +
    "Cortex catalogs; it is faster and exact. Datasets the bridge doesn't cover " +
    "(some HiQ-specific entries, versions with no bridge) come back in `unresolved` " +
    "— fall back to search_backgrounds + bind_backgrounds for just those.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    if (!ctx.bridge) {
      throw new JimuLcaError(
        "config",
        "local bridge not provisioned on this server — use search_backgrounds + bind_backgrounds instead.",
      );
    }

    const versionName = await getAllocationVersionName(ctx, args.version_id);
    if (!versionName) {
      throw new JimuLcaError(
        "validation",
        `unknown version_id ${args.version_id} — call list_background_db_versions and pass a listed id.`,
      );
    }

    const origByElement = args.bindings.map((b) => ({
      element_id: b.element_id,
      orig_uuid: toOrigUuid(b.dataset_key),
      dataset_key: b.dataset_key,
    }));
    const rows = await ctx.bridge.resolve(
      versionKey(versionName),
      args.system_model,
      origByElement.map((e) => e.orig_uuid),
    );
    const byUuid = new Map(rows.map((r) => [r.orig_uuid, r]));

    const resolved: ResolvedBinding[] = [];
    const unresolved: Array<{ element_id: string; dataset_key: string }> = [];
    for (const e of origByElement) {
      const row = byUuid.get(e.orig_uuid);
      if (!row) {
        unresolved.push({ element_id: e.element_id, dataset_key: e.dataset_key });
        continue;
      }
      resolved.push({
        element_id: e.element_id,
        background_uuid: row.bind_uuid,
        background_data_id: row.background_data_id,
        background_name: row.name_cn ?? row.name_en ?? "",
        version_id: args.version_id,
        location: row.location ?? undefined,
        unit: row.unit ?? undefined,
      });
    }

    const saveResult =
      resolved.length > 0
        ? await saveStageBindings(ctx, args.case_id, args.stage_id, resolved)
        : null;

    return {
      bound: resolved.map((r) => ({
        element_id: r.element_id,
        background_data_id: r.background_data_id,
        name: r.background_name,
      })),
      unresolved,
      save_result: saveResult,
    };
  },
  cli: { summary: "Bind a stage's flows via local catalog dataset_key (resolved through the version bridge)." },
};
