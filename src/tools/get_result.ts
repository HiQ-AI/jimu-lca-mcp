import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  brand_id: z.string().describe("Product (brand) id — for the headline GWP (co2Content)."),
  case_id: z.string().describe("Case id — for the data-provenance breakdown."),
});

interface ProductInfo { id?: string; name?: string; co2Content?: string; co2Unit?: string }
interface Stage { id: string }
interface Process { id: string }
interface Element { categoryName: string; inOutType: string; sourceName?: string; elementName: string }

/** Primary = measured on site; the rest are literature/default assumptions. */
function quality(bySource: Record<string, number>, totalInputs: number) {
  const primary = bySource["现场数据"] ?? 0;
  const primaryPct = totalInputs ? Math.round((primary / totalInputs) * 100) : 0;
  return { primary_pct: primaryPct, default_pct: 100 - primaryPct, by_source: bySource };
}

export const getResult: ToolDef<typeof Args, unknown> = {
  name: "get_result",
  description:
    "Read a finished result WITH its data quality, in one call: the headline GWP " +
    "(per the declared unit), plus a provenance breakdown of how much of the model " +
    "is the user's primary data (现场数据) vs literature/default assumptions " +
    "(文献/缺省值), plus a standard estimate disclaimer. Use this to report to the " +
    "user — a clean number built mostly on defaults must be presented as an " +
    "estimate, not an audited footprint. (Pair with get_top_contributors for " +
    "hotspots.) GWP is per the declared unit — multiply by piece mass for per-item.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    // headline number (single-product read)
    const prod = await get<ProductInfo>(ctx, "/lca/v3/getBrandInfo", { brandId: args.brand_id });
    const gwp = prod?.co2Content && prod.co2Content !== "" ? prod.co2Content : null;

    // provenance: walk the model's input items by data source
    const stages = await get<Stage[]>(ctx, "/lca/v3/getCaseStage", { caseId: args.case_id });
    const bySource: Record<string, number> = {};
    let inputs = 0;
    for (const st of stages ?? []) {
      const procs = await get<Process[]>(ctx, "/lca/v3/getProcessList", { stageId: st.id });
      for (const p of procs ?? []) {
        const els = await get<Element[]>(ctx, "/lca/v3/getElementList", { processId: p.id });
        for (const e of els ?? []) {
          if (e.inOutType !== "in") continue; // burdens come from inputs
          inputs += 1;
          const s = e.sourceName || "(none)";
          bySource[s] = (bySource[s] ?? 0) + 1;
        }
      }
    }
    const dq = quality(bySource, inputs);
    return {
      gwp: gwp,
      gwp_unit: prod?.co2Unit ?? "kg CO2-Eq / declared unit",
      resolved: gwp != null,
      data_quality: dq,
      disclaimer:
        `Estimate — ~${dq.primary_pct}% from the user's primary data, ~${dq.default_pct}% ` +
        `literature/default assumptions. This is a screening-level estimate, NOT an ` +
        `audited LCA; not for regulatory/compliance submission without expert review. ` +
        `Report the value as an order-of-magnitude / range, not false precision.`,
      note: gwp == null
        ? "co2Content not populated — check get_calc_status; if done, read the GWP via get_product_lcia(brand_id) (co2Content can lag the LCIA result). The provenance + disclaimer above still apply."
        : "Present GWP with the disclaimer + the primary-vs-default split; surface assumptions the user should replace with real data.",
    };
  },
  cli: { summary: "Read GWP + data-quality/provenance + estimate disclaimer." },
};
