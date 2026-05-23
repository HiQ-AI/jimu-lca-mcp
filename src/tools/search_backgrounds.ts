import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Args = z.object({
  version_id: z.string().describe("Background-DB version id (list_background_db_versions). Prefer the latest Ecoinvent 3.12+HiQ."),
  element_names: z.array(z.string()).min(1).describe("Material/flow names to search — English OR Chinese, e.g. ['transport, freight, lorry, >32 metric ton','聚丙烯','medium voltage electricity']. One batched call instead of N searches."),
  size: z.number().default(15).describe("Max candidates per name."),
});

type Ctx = Parameters<ToolDef<typeof Args, unknown>["handler"]>[1];

// queryBackgroundData row (Chinese-name prefix search; carries standardUuid).
interface BgRow {
  id: string; uuid: string; standardUuid: string;
  name: string; nameCn: string; locationName: string;
  co2Content: string; unitName: string; unitGroup: string;
}
// lcaUpPageList row (English-name search; carries processUuid === standardUuid === bind_uuid).
interface UpRow {
  id: string; uuid: string; processUuid: string;
  name: string; nameCn: string; locationName: string;
  co2Content: string; unitName: string; unitGroup: string;
}

interface Candidate {
  bind_uuid: string; background_data_id: string; dataset_uuid: string;
  name_cn: string; name_en: string; location: string;
  unit: string; unit_group: string; co2_per_unit: string;
}
const fromBg = (r: BgRow): Candidate => ({
  bind_uuid: r.standardUuid, background_data_id: r.id, dataset_uuid: r.uuid,
  name_cn: r.nameCn, name_en: r.name, location: r.locationName,
  unit: r.unitName, unit_group: r.unitGroup, co2_per_unit: r.co2Content,
});
// bind_uuid is the processUuid — verified equal to queryBackgroundData's standardUuid.
const fromUp = (r: UpRow): Candidate => ({
  bind_uuid: r.processUuid, background_data_id: r.id, dataset_uuid: r.uuid,
  name_cn: r.nameCn, name_en: r.name, location: r.locationName,
  unit: r.unitName, unit_group: r.unitGroup, co2_per_unit: r.co2Content,
});

const tokens = (s: string): string[] => s.split(/[，,、\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);

/** English-name search via lcaUpPageList — its `keyword` matches the English name and
 *  covers datasets with no Chinese index (e.g. freight transport). */
async function searchEn(ctx: Ctx, versionId: string, keyword: string, size: number): Promise<UpRow[]> {
  const rows = await callManager<UpRow[]>(ctx, "/managerPro/dataConfiguration/lcaUpPageList", {
    versionId, keyword, flowUuid: "", allocationMethod: "", locationId: "",
    status: 0, unit: "", uuid: "", page: 1, size: Math.max(size, 30),
  });
  return rows ?? [];
}

/** Chinese-name search via queryBackgroundData. jimu matches elementName as a LEFT-PREFIX
 *  of the Chinese name, so "聚乙烯，高密度，颗粒" misses (real name "聚乙烯生产，高密度，颗粒");
 *  we drop trailing comma-segments to the head noun, then rank by qualifier match. */
async function searchZh(ctx: Ctx, versionId: string, name: string, size: number): Promise<BgRow[]> {
  const segs = name.split(/[，,]/).map((s) => s.trim()).filter(Boolean);
  const attempts = [name, ...Array.from({ length: segs.length }, (_, i) => segs.slice(0, segs.length - i).join("，"))];
  let rows: BgRow[] = [];
  for (const q of [...new Set(attempts)]) {
    rows = await callManager<BgRow[]>(ctx, "/managerPro/lcaAdminFeign/queryBackgroundData", {
      versionId, elementName: q, keyword: "", flowUuid: "", allocationMethod: "",
      locationId: "", status: 0, unit: "", uuid: "", type: "0", page: 1, size: Math.max(size, 30),
    });
    if ((rows ?? []).length) break;
  }
  return rows ?? [];
}

/** Rank candidates by how many of the query's tokens appear in the EN or CN name. */
function rank(cands: Candidate[], name: string, size: number): Candidate[] {
  const want = tokens(name);
  return cands
    .map((c) => ({ c, score: want.filter((t) => (c.name_en || "").toLowerCase().includes(t) || (c.name_cn || "").includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, size)
    .map((x) => x.c);
}

export const searchBackgrounds: ToolDef<typeof Args, unknown> = {
  name: "search_backgrounds",
  description:
    "Search the background LCI database for several material/flow names in ONE call. " +
    "Works with ENGLISH or Chinese names: it searches the English name via lcaUpPageList " +
    "(which covers datasets that have no Chinese index — e.g. freight transport — and is " +
    "usually the precise path; English names come straight from a report or the catalog), " +
    "and falls back to the Chinese-name search for Chinese terms. Returns, per name, ranked " +
    "candidates with `bind_uuid` + `background_data_id` (both needed by bind_backgrounds), " +
    "CN/EN name, region, unit, unit_group, per-unit co2. Pick by region + unit, then bind by " +
    "`bind_uuid`. Tip: prefer the dataset's EN name (e.g. 'market for transport, freight, lorry, " +
    ">32 metric ton') for the most precise hit.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const out: Record<string, Candidate[]> = {};
    for (const name of args.element_names) {
      const hasCjk = /[一-鿿]/.test(name);
      // English (lcaUpPageList) is primary; Chinese search is the fallback (or primary for CJK).
      let cands: Candidate[] = [];
      if (!hasCjk) {
        cands = (await searchEn(ctx, args.version_id, name, args.size)).map(fromUp);
        if (!cands.length) cands = (await searchZh(ctx, args.version_id, name, args.size)).map(fromBg);
      } else {
        cands = (await searchZh(ctx, args.version_id, name, args.size)).map(fromBg);
        if (!cands.length) cands = (await searchEn(ctx, args.version_id, name, args.size)).map(fromUp);
      }
      out[name] = rank(cands, name, args.size);
    }
    return out;
  },
  cli: { summary: "Batch-search background datasets (EN via lcaUpPageList + ZH fallback, ranked)." },
};
