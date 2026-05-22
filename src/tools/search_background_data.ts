import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Args = z.object({
  version_id: z.string().describe("Background-DB version id (list_background_db_versions). Prefer the latest Ecoinvent 3.12+HiQ."),
  element_name: z.string().describe("Material/flow name to search, e.g. '聚丙烯' / '中压电力' / '玻璃'. Matches Chinese flow names."),
  location_id: z.string().optional().describe("Optional region filter."),
  page: z.number().default(1),
  size: z.number().default(20),
});

interface BgRow {
  id: string;
  uuid: string;
  name: string;
  nameCn: string;
  locationName: string;
  co2Content: string;
  flowProductId: string;
  flowProductName: string;
  unitName: string;
  unitGroup: string;
  methodName: string;
}

export const searchBackgroundData: ToolDef<typeof Args, unknown> = {
  name: "search_background_data",
  description:
    "Search the background LCI database (e.g. Ecoinvent) for datasets matching " +
    "a material/flow name, under a given DB version. Returns candidates with " +
    "their `uuid` and `background_data_id` (BOTH required to bind via " +
    "match_backgrounds), Chinese/English name, " +
    "region, unit, and the dataset's own per-unit `co2Content` (handy for " +
    "picking the right one). Use this when building/curating a custom model or " +
    "to replace a wrong/default background match (e.g. the closest plastic " +
    "template binds PP; search '聚酯/PET' to match the real resin). Internal " +
    "manager API (Bearer token minted from the memberKey).",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const rows = await callManager<BgRow[]>(ctx, "/managerPro/lcaAdminFeign/queryBackgroundData", {
      versionId: args.version_id,
      elementName: args.element_name,
      keyword: "",
      flowUuid: "",
      allocationMethod: "",
      locationId: args.location_id ?? "",
      status: 0,
      unit: "",
      uuid: "",
      type: "0",
      page: args.page,
      size: args.size,
    });
    return (rows ?? []).map((r) => ({
      background_data_id: r.id,
      uuid: r.uuid,
      name_cn: r.nameCn,
      name_en: r.name,
      location: r.locationName,
      unit: r.unitName,
      unit_group: r.unitGroup,
      co2_per_unit: r.co2Content,
      flow_product_id: r.flowProductId,
      flow_product_name: r.flowProductName,
    }));
  },
  cli: {
    summary: "Search background LCI datasets by material name.",
    renderHuman: (rows) =>
      (rows as Array<Record<string, string>>)
        .map((r) => `[${r.uuid}] ${r.name_cn} (${r.name_en}) — ${r.location}, ${r.unit}, co2/unit=${r.co2_per_unit}`)
        .join("\n"),
  },
};
