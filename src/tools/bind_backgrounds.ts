import { z } from "zod";
import type { ToolDef } from "../types.js";
import { saveStageBindings, type ResolvedBinding } from "../binding.js";

const Binding = z.object({
  element_id: z.string().describe("The data item's `elementId` field (from list_data_items / get_model_items) — NOT its row `id`. Passing the row id fails."),
  background_uuid: z.string().describe("search_backgrounds.bind_uuid (the dataset's standardUuid). MUST be bind_uuid, NOT dataset_uuid — the platform binds by standardUuid."),
  background_data_id: z.string().describe("Chosen dataset id (search_backgrounds.background_data_id) — REQUIRED: the platform resolves the LCI by this id."),
  background_name: z.string().describe("Chosen dataset CN name (search_backgrounds.name_cn)."),
  version_id: z.string().describe("Background-DB version the dataset belongs to."),
  location: z.string().optional().describe("Region (search_backgrounds.location)."),
  unit: z.string().optional().describe("Dataset unit, e.g. kg / kWh (search_backgrounds.unit) — must be in the same unit group as the flow."),
});

const Args = z.object({
  case_id: z.string().describe("Case id."),
  stage_id: z.string().describe("Stage id (get_case_overview → stages[].id). All bindings must be flows in this stage."),
  bindings: z.array(Binding).min(1).describe("Bind many flows in ONE call — pass every material/energy input of the stage."),
});

export const bindBackgrounds: ToolDef<typeof Args, unknown> = {
  name: "bind_backgrounds",
  description:
    "Bind background LCI datasets to a stage's flows — REQUIRED for inputs to " +
    "contribute (import_model leaves them unbound → 未配置上游背景数据 → no " +
    "result). Batched: pass every flow of the stage in one call. For each it " +
    "loads the item's full data-config (getDataDetail), sets the chosen dataset " +
    "(by standardUuid + backgroundDataId), and saves all in one saveConfiguration " +
    "(manager API). Pick datasets with search_backgrounds, passing its `bind_uuid` " +
    "(standardUuid) as background_uuid and `background_data_id`. Then validate_case " +
    "to confirm 未配置上游背景数据 + 单位组不一致 are clear.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const resolved: ResolvedBinding[] = args.bindings.map((b) => ({
      element_id: b.element_id,
      background_uuid: b.background_uuid,
      background_data_id: b.background_data_id,
      background_name: b.background_name,
      version_id: b.version_id,
      location: b.location,
      unit: b.unit,
    }));
    return await saveStageBindings(ctx, args.case_id, args.stage_id, resolved);
  },
  cli: { summary: "Bind background datasets to a stage's flows (batched)." },
};
