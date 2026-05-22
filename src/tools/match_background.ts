import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Binding = z.object({
  element_id: z.string().describe("Data-item elementId to bind (list_data_items / get_case_overview)."),
  background_uuid: z.string().describe("search_background_data.bind_uuid (the dataset's standardUuid). MUST be bind_uuid, NOT dataset_uuid — the platform binds by standardUuid."),
  background_data_id: z.string().describe("Chosen dataset id (search_background_data.background_data_id) — REQUIRED: the platform resolves the LCI by this id."),
  background_name: z.string().describe("Chosen dataset CN name (search_background_data.name_cn)."),
  version_id: z.string().describe("Background-DB version the dataset belongs to."),
  location: z.string().optional().describe("Region (search_background_data.location)."),
  unit: z.string().optional().describe("Dataset unit, e.g. kg / kWh (search_background_data.unit) — must be in the same unit group as the flow."),
});

const Args = z.object({
  case_id: z.string().describe("Case id."),
  stage_id: z.string().describe("Stage id (get_case_overview → stages[].id). All bindings must be flows in this stage."),
  bindings: z.array(Binding).min(1).describe("Bind many flows in ONE call — pass every material/energy input of the stage."),
});

interface DataDetail {
  backgroundList?: Array<Record<string, unknown>>;
  slciList?: unknown[];
  materialList?: unknown[];
  transportList?: unknown[];
}

export const matchBackgrounds: ToolDef<typeof Args, unknown> = {
  name: "match_backgrounds",
  description:
    "Bind background LCI datasets to a stage's flows — REQUIRED for inputs to " +
    "contribute (import_model leaves them unbound → 未配置上游背景数据 → no " +
    "result). Batched: pass every flow of the stage in one call. For each it " +
    "loads the item's full data-config (getDataDetail), sets the chosen dataset " +
    "(by standardUuid + backgroundDataId), and saves all in one saveConfiguration " +
    "(manager API). Pick datasets with Cortex + search_background_data, passing " +
    "its `bind_uuid` (standardUuid) as background_uuid and `background_data_id`. " +
    "Then validate_case to confirm 未配置上游背景数据 + 单位组不一致 are clear.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const backgroundList: Array<Record<string, unknown>> = [];
    const slciList: unknown[] = [];
    const materialList: unknown[] = [];
    const transportList: unknown[] = [];

    const prepared: string[] = [];
    for (const b of args.bindings) {
      const dd = await callManager<DataDetail>(ctx, "/managerPro/dataConfiguration/getDataDetail", {
        caseId: args.case_id,
        stageId: args.stage_id,
        elementId: b.element_id,
      });
      const bg0 = (dd.backgroundList ?? [])[0];
      if (!bg0) {
        throw new Error(
          `no background slot for element ${b.element_id} (not a matchable input?). ` +
            `Nothing was saved. Prepared before failure: [${prepared.join(", ") || "none"}]; ` +
            `not yet processed: [${args.bindings.slice(args.bindings.indexOf(b)).map((x) => x.element_id).join(", ")}]. ` +
            `Fix or drop that binding and call again.`,
        );
      }
      prepared.push(b.element_id);
      backgroundList.push({
        ...bg0,
        upElementUuid: b.background_uuid,
        backgroundDataId: b.background_data_id,
        upElementName: b.background_name,
        location: b.location ?? "",
        unitName: b.unit ?? "",
        equivalentCoefficient: "1",
        conversionFactor: "1",
        upVersionId: b.version_id,
        useAiRecommend: false,
        oldName: "-",
      });
      slciList.push(...(dd.slciList ?? []));
      materialList.push(...(dd.materialList ?? []));
      transportList.push(...(dd.transportList ?? []));
    }

    return await callManager(ctx, "/managerPro/dataConfiguration/saveConfiguration", {
      caseId: args.case_id,
      stageId: args.stage_id,
      backgroundList,
      slciList,
      materialList,
      transportList,
      lciList: [],
      transportRemoveIds: [],
      materialRemoveIds: [],
    });
  },
  cli: { summary: "Bind background datasets to a stage's flows (batched)." },
};
