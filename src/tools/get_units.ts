import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({});

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

export const getUnits: ToolDef<typeof Args, UnitGroup[]> = {
  name: "get_units",
  description:
    "List all unit groups and their units (kg / t / MJ / kWh / …). " +
    "Reference data; rarely needed in v0 because data-item rows from " +
    "list_data_items already carry unitId+unitName. Call when the agent " +
    "needs to *change* a unit (must look up the target unitId) or to " +
    "convert between units in the same group via conversionFactor.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(_args, ctx) {
    return await get<UnitGroup[]>(ctx, "/lca/v3/getAllUnits");
  },
  cli: {
    summary: "List all unit groups and their units.",
    renderHuman: (groups) =>
      groups
        .map(
          (g) =>
            `${g.name} (${g.description}) — ${g.unitList.length} units\n` +
            g.unitList
              .map(
                (u) =>
                  `  ${u.name.padEnd(10)} ×${u.conversionFactor.padEnd(10)} ${
                    u.isStandard ? "[reference]" : ""
                  }`,
              )
              .join("\n"),
        )
        .join("\n\n"),
  },
};
