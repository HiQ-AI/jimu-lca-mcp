import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Binding = z.object({
  element_id: z.string().describe("Data-item elementId to bind (list_data_items / get_case_overview)."),
  background_uuid: z.string().describe("Chosen dataset uuid (search_background_data.uuid)."),
  background_data_id: z.string().describe("Chosen dataset id (search_background_data.background_data_id) — REQUIRED: the platform resolves the LCI by this id, not the uuid."),
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
    "EXPERIMENTAL — not reliable yet. Posts saveConfiguration (manager API) to " +
    "bind a stage's flows to background datasets, batched, sending the dataset's " +
    "uuid + backgroundDataId + conversionFactor. Despite mirroring the web UI's " +
    "payload, material (原辅料) flows still report 背景数据单位组不一致 and the calc " +
    "produces no result (a 21-dataset sweep all failed); the exact " +
    "saveConfiguration semantics aren't fully reproduced. Until resolved, do the " +
    "background BIND in the 积木 web UI. The DISCOVERY half (search_background_data) " +
    "is reliable — use it to tell the user which datasets (name/region/co2/uuid) " +
    "to bind in the UI.",
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
