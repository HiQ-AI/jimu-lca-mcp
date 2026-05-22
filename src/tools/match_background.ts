import { z } from "zod";
import type { ToolDef } from "../types.js";
import { post, callManager } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id."),
  stage_id: z.string().describe("Stage id (get_case_overview → stages[].id)."),
  element_id: z.string().describe("Data-item elementId to bind a background to (list_data_items → elementId)."),
  background_uuid: z.string().describe("Chosen background dataset uuid (from search_background_data)."),
  background_name: z.string().describe("Chosen background CN name (search_background_data.name_cn)."),
  version_id: z.string().describe("Background-DB version id the dataset belongs to."),
  location: z.string().optional().describe("Region (search_background_data.location)."),
  unit: z.string().optional().describe("Unit (search_background_data.unit)."),
});

interface DataConfig {
  backgroundList?: Array<Record<string, unknown>>;
  slciList?: unknown[];
  materialList?: unknown[];
  transportList?: unknown[];
  lciList?: unknown[];
}

export const matchBackground: ToolDef<typeof Args, unknown> = {
  name: "match_background",
  description:
    "EXPERIMENTAL — incomplete. Binds a background dataset to a data item via " +
    "saveConfiguration. It clears 未配置上游背景数据 but currently produces " +
    "背景数据单位组不一致 (the calc still won't resolve): the platform's config " +
    "payload needs the dataset's allocationMethod + unit (uuid) + a unit-group " +
    "that matches the flow, which search_background_data doesn't return and the " +
    "config-UI lookups (lcaUpPageList) don't filter reliably. Until reworked, do " +
    "the final background BIND in the 积木 web UI (search_background_data is fine " +
    "for discovery). Run validate_case after to confirm.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    // 1. current data-config for this item (open API).
    const dc = await post<DataConfig>(ctx, "/lca/v3/getDataConfigurationDetail", {
      caseId: args.case_id,
      stageId: args.stage_id,
      elementId: args.element_id,
    });
    const bgEntry = (dc.backgroundList ?? [])[0];
    if (!bgEntry) {
      throw new Error(`no background slot for element ${args.element_id} (not a matchable input?)`);
    }
    // 2. set the chosen background on the structural entry.
    const boundBg = {
      ...bgEntry,
      upElementUuid: args.background_uuid,
      upElementName: args.background_name,
      location: args.location ?? "",
      unitName: args.unit ?? "",
      equivalentCoefficient: "1",
      upVersionId: args.version_id,
      useAiRecommend: false,
      oldName: "-",
    };
    // 3. save (manager API).
    return await callManager(ctx, "/managerPro/dataConfiguration/saveConfiguration", {
      caseId: args.case_id,
      stageId: args.stage_id,
      backgroundList: [boundBg],
      slciList: dc.slciList ?? [],
      materialList: dc.materialList ?? [],
      transportList: dc.transportList ?? [],
      lciList: dc.lciList ?? [],
      transportRemoveIds: [],
      materialRemoveIds: [],
    });
  },
  cli: { summary: "Bind a background dataset to a data item." },
};
