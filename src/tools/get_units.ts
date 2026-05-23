import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  query: z
    .string()
    .optional()
    .describe(
      "Case-insensitive substring filter over unit name + synonyms (e.g. 'kg', " +
        "'件', 'kWh', 'piece'). Use this to find one unit's id — the full registry " +
        "is large, so always filter unless you genuinely need every unit.",
    ),
  unit_group: z
    .string()
    .optional()
    .describe("Filter to one unit group by name substring (e.g. '质量' / '能量' / '数量')."),
});

interface Unit {
  id: string;
  name: string;
  uuid: string;
  synonyms?: string;
  conversionFactor: string;
  description?: string;
  unitGroup: string;
  isShow: number;
  isStandard?: number;
}

interface UnitGroup {
  id: string;
  uuid: string;
  name: string;
  description: string;
  referenceUnit: string;
  unitList: Unit[];
}

/** Compact projection — the registry's per-unit `description` blobs make the raw
 *  response ~270K chars / 8K lines, which blows the tool-result token cap. The
 *  agent only needs id + name (+ group / factor) to pick a unit, so we drop the
 *  prose and return a flat, filtered list. */
interface CompactUnit {
  id: string;
  name: string;
  unitGroup: string;
  conversionFactor: string;
  isStandard: boolean;
  synonyms?: string;
}

export const getUnits: ToolDef<typeof Args, CompactUnit[]> = {
  name: "get_units",
  description:
    "Find unit ids/names (kg / t / MJ / kWh / 件 / …). Reference data — rarely " +
    "needed since list_data_items rows already carry unitId+unitName; call when " +
    "you must *change* a unit (look up the target unitId) or convert within a " +
    "group via conversionFactor. **Pass `query`** (name/synonym substring) to find " +
    "a specific unit — the unfiltered registry is large.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const groups = await get<UnitGroup[]>(ctx, "/lca/v3/getAllUnits");
    const q = args.query?.trim().toLowerCase();
    const ug = args.unit_group?.trim();
    const out: CompactUnit[] = [];
    for (const g of groups ?? []) {
      if (ug && !g.name.includes(ug)) continue;
      for (const u of g.unitList ?? []) {
        if (q && !`${u.name} ${u.synonyms ?? ""}`.toLowerCase().includes(q)) continue;
        out.push({
          id: u.id,
          name: u.name,
          unitGroup: g.name,
          conversionFactor: u.conversionFactor,
          isStandard: Boolean(u.isStandard),
          ...(u.synonyms ? { synonyms: u.synonyms } : {}),
        });
      }
    }
    return out;
  },
  cli: {
    summary: "Find unit ids/names (filter with --query / --unit_group).",
    renderHuman: (units) =>
      units
        .map(
          (u) =>
            `${u.name.padEnd(12)} id=${u.id.padEnd(20)} [${u.unitGroup}]` +
            ` ×${u.conversionFactor}${u.isStandard ? " [reference]" : ""}`,
        )
        .join("\n"),
  },
};
