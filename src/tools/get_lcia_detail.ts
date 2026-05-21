import { z } from "zod";
import type { ToolDef } from "../types.js";
import { post } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id."),
  case_cal_method_id: z
    .string()
    .describe(
      "Calculation-record id, from list_case_calculation_methods (the *inner* calculationMethods[].id, NOT the outer method id).",
    ),
  target_product: z
    .string()
    .describe("Target product / disposal id (from get_case_overview or get_case_disposals)."),
});

interface LciaRow {
  stageName: string;
  stageOrderId: number;
  influenceFactorId: string;
  influenceFactorName: string;
  influenceFactorNameEn: string;
  influenceFactorUnit: string;
  productElementId: string;
  productName: string;
  unit: string;
  indirect: string;
  transport: string;
  direct: string;
  summary: string;
  co2Content?: string | null;
}

export const getLciaDetail: ToolDef<typeof Args, LciaRow[]> = {
  name: "get_lcia_detail",
  description:
    "Return the LCIA result table for one (case, calculation-method, " +
    "target product) triple. Each row is one impact factor × stage with " +
    "indirect / transport / direct / summary contributions (string-decimal " +
    "for precision). The `influenceFactorId` on each row is what " +
    "get_sensitivity consumes to drill into per-data-item contribution " +
    "shares.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await post<LciaRow[]>(ctx, "/lca/v3/getCaseLciaDetails", {
      caseId: args.case_id,
      id: args.case_cal_method_id,
      targetProduct: args.target_product,
    });
  },
  cli: {
    summary: "Fetch LCIA detail rows.",
    renderHuman: (rows) =>
      rows
        .map(
          (r) =>
            `[${r.stageName.padEnd(20).slice(0, 20)}] ${r.influenceFactorName.padEnd(40).slice(0, 40)}  ${Number(r.summary).toExponential(3)} ${r.influenceFactorUnit}`,
        )
        .join("\n"),
  },
};
