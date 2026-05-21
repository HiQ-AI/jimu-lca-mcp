import { z } from "zod";
import type { ToolDef } from "../types.js";
import { post } from "../api.js";

const Args = z.object({
  case_cal_method_id: z.string().describe("From list_case_calculation_methods."),
  impact_factor_id: z
    .string()
    .describe(
      "Impact-factor id, from get_lcia_detail (the influenceFactorId on each row). Docs call it impactFactorId here but the value is identical.",
    ),
  product_element_id: z.string().describe("Target product / disposal id."),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe(
      "0-1 filter; rows with contribution share below this are dropped server-side. Default 0 = return everything; 0.05 = only items contributing ≥5%.",
    ),
});

interface SensitivityRow {
  elementId: string;
  name: string;
  val: string;
}

export const getSensitivity: ToolDef<typeof Args, SensitivityRow[]> = {
  name: "get_sensitivity",
  description:
    "Per-data-item contribution share toward one (impact factor, product). " +
    "Sorted by val descending; the top row is the data item driving the " +
    "result. val is fractional (0-1; 0.376 = 37.6%). Pass threshold to " +
    "trim long lists down to items meaningfully driving the result.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await post<SensitivityRow[]>(ctx, "/lca/v3/getCaseSensitive", {
      caseCalMethodId: args.case_cal_method_id,
      impactFactorId: args.impact_factor_id,
      productElementId: args.product_element_id,
      basicLine: args.threshold,
    });
  },
  cli: {
    summary: "Per-data-item contribution share (sensitivity).",
    renderHuman: (rows) =>
      rows
        .map(
          (r) =>
            `${(Number(r.val) * 100).toFixed(1).padStart(5)}%  ${r.name}`,
        )
        .join("\n"),
  },
};
