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

async function queryRaw(ctx: Parameters<ToolDef<typeof Args, unknown>["handler"]>[1], versionId: string, elementName: string, size: number): Promise<BgRow[]> {
  const rows = await callManager<BgRow[]>(ctx, "/managerPro/lcaAdminFeign/queryBackgroundData", {
    versionId, elementName, keyword: "", flowUuid: "", allocationMethod: "",
    locationId: "", status: 0, unit: "", uuid: "", type: "0", page: 1, size,
  });
  return rows ?? [];
}

const tokens = (s: string): string[] => s.split(/[，,、\s]+/).map((t) => t.trim()).filter(Boolean);

/**
 * jimu's elementName match is a LEFT-PREFIX match on the Chinese name, not a
 * contains/fuzzy. So "聚乙烯，高密度，颗粒" returns nothing because the real dataset is
 * "聚乙烯生产，高密度，颗粒" (the inserted 生产 breaks the prefix), yet querying the head
 * noun "聚乙烯" returns it. We therefore query the full term, and on a miss progressively
 * drop trailing comma-segments down to the head noun, then rank the candidates by how
 * many of the requested name's tokens appear in each candidate's Chinese name.
 */
async function smartSearch(ctx: Parameters<ToolDef<typeof Args, unknown>["handler"]>[1], versionId: string, name: string, size: number): Promise<BgRow[]> {
  const segs = name.split(/[，,]/).map((s) => s.trim()).filter(Boolean);
  const attempts: string[] = [];
  for (let i = segs.length; i >= 1; i--) attempts.push(segs.slice(0, i).join("，"));
  if (!attempts.includes(name)) attempts.unshift(name);

  let rows: BgRow[] = [];
  for (const q of [...new Set(attempts)]) {
    rows = await queryRaw(ctx, versionId, q, Math.max(size, 30));
    if (rows.length) break;
  }
  const want = tokens(name);
  return rows
    .map((r) => ({ r, score: want.filter((t) => (r.nameCn || "").includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, size)
    .map((x) => x.r);
}

export const searchBackgrounds: ToolDef<typeof Args, unknown> = {
  name: "search_backgrounds",
  description:
    "Batch search of the background LCI database for several material/flow names in " +
    "ONE call. Handles jimu's left-prefix Chinese-name matching for you: it queries " +
    "the head noun and ranks candidates by qualifier match, so a natural name like " +
    "'聚乙烯，高密度，颗粒' still finds '聚乙烯生产，高密度，颗粒'. Returns, per name, candidates " +
    "with `bind_uuid` (standardUuid) + `background_data_id` (both needed to bind via " +
    "match_backgrounds), CN/EN name, region, unit, unit_group, per-unit co2. Bind by " +
    "`bind_uuid` (NOT dataset_uuid). NOTE: datasets with no Chinese name (e.g. freight " +
    "transport) are not searchable here — an empty result means 'mark unbound', not 'retry'.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const out: Record<string, ReturnType<typeof toCandidate>[]> = {};
    for (const name of args.element_names) {
      const rows = await smartSearch(ctx, args.version_id, name, args.size);
      out[name] = rows.map(toCandidate);
    }
    return out;
  },
  cli: { summary: "Batch-search background datasets (handles prefix-match + ranks)." },
};
