import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Binding = z.object({
  element_id: z.string().describe("Data-item elementId to bind (list_data_items / get_case_overview)."),
  background_uuid: z.string().describe("Chosen dataset uuid (search_background_data)."),
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
    "EXPERIMENTAL. Bind background LCI datasets to a stage's flows (import_model " +
    "leaves them unbound → 未配置上游背景数据 → no result). Batched: pass every " +
    "flow of the stage in one call — for each it loads the item's full " +
    "data-config (getDataDetail) and keeps the slci/material/transport sub-config " +
    "intact, then saves all in one saveConfiguration (manager API). Pick datasets " +
    "with Cortex + search_background_data, choosing one whose unit_group matches " +
    "the flow (search returns unit + unit_group; many same-named datasets differ " +
    "in unit). KNOWN ISSUE: even with matching unit_groups this can still leave " +
    "背景数据单位组不一致 (a residual saveConfiguration-payload detail) — so " +
    "verify with validate_case, and if it persists do the bind in the web UI.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    const backgroundList: Array<Record<string, unknown>> = [];
    const slciList: unknown[] = [];
    const materialList: unknown[] = [];
    const transportList: unknown[] = [];

    for (const b of args.bindings) {
      const dd = await callManager<DataDetail>(ctx, "/managerPro/dataConfiguration/getDataDetail", {
        caseId: args.case_id,
        stageId: args.stage_id,
        elementId: b.element_id,
      });
      const bg0 = (dd.backgroundList ?? [])[0];
      if (!bg0) {
        throw new Error(`no background slot for element ${b.element_id} (not a matchable input?)`);
      }
      backgroundList.push({
        ...bg0,
        upElementUuid: b.background_uuid,
        upElementName: b.background_name,
        location: b.location ?? "",
        unitName: b.unit ?? "",
        equivalentCoefficient: "1",
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
