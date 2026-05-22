import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Args = z.object({
  version_id: z.string().describe("Background-DB version id (list_background_db_versions). Prefer the latest Ecoinvent 3.12+HiQ."),
  element_names: z.array(z.string()).min(1).describe("Material/flow names to search, e.g. ['聚丙烯','中压电力','玻璃']. One batched call instead of N search_background_data calls."),
  size: z.number().default(15).describe("Max candidates per name."),
});

interface BgRow {
  id: string;
  uuid: string;
  standardUuid: string;
  name: string;
  nameCn: string;
  locationName: string;
  co2Content: string;
  unitName: string;
  unitGroup: string;
}

/** Map one queryBackgroundData row to the bind-ready candidate shape. bind_uuid
 *  is the dataset's standardUuid (what the platform binds by), NOT its own uuid. */
function toCandidate(r: BgRow) {
  return {
    bind_uuid: r.standardUuid,
    background_data_id: r.id,
    dataset_uuid: r.uuid,
    name_cn: r.nameCn,
    name_en: r.name,
    location: r.locationName,
    unit: r.unitName,
    unit_group: r.unitGroup,
    co2_per_unit: r.co2Content,
  };
}

export const searchBackgrounds: ToolDef<typeof Args, unknown> = {
  name: "search_backgrounds",
  description:
    "Batch version of search_background_data: search the background LCI database " +
    "for several material/flow names in ONE call. Returns, per name, candidate " +
    "datasets with `bind_uuid` (standardUuid) + `background_data_id` (both needed " +
    "to bind via match_backgrounds), CN/EN name, region, unit, unit_group, and " +
    "per-unit co2. Use when binding a whole model's flows — saves N round-trips. " +
    "Then bind by `bind_uuid` (NOT dataset_uuid).",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const out: Record<string, ReturnType<typeof toCandidate>[]> = {};
    for (const name of args.element_names) {
      const rows = await callManager<BgRow[]>(ctx, "/managerPro/lcaAdminFeign/queryBackgroundData", {
        versionId: args.version_id,
        elementName: name,
        keyword: "",
        flowUuid: "",
        allocationMethod: "",
        locationId: "",
        status: 0,
        unit: "",
        uuid: "",
        type: "0",
        page: 1,
        size: args.size,
      });
      out[name] = (rows ?? []).map(toCandidate);
    }
    return out;
  },
  cli: { summary: "Batch-search background datasets for several material names." },
};
