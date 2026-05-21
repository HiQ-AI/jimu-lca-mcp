import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id."),
  version_id: z
    .string()
    .describe(
      "Background-DB version id. Must match the version the case was actually calculated against, which may differ from getCaseDetail.versionId. If you're unsure, use the get_product_lcia or get_top_contributors aggregators — they handle version discovery for you.",
    ),
});

interface InnerCalcRecord {
  id: string;
  uuid: string;
  caseId: string;
  calculationMethodId: string;
  status: string;
  targetProduct: string;
  orderNum: number;
  calState: number;
}

interface MethodBucket {
  id: string;
  uuid: string;
  name: string;
  version: string;
  category: string;
  orderNo: number;
  versionName: string;
  calculationMethods: InnerCalcRecord[];
}

export const listCaseCalculationMethods: ToolDef<typeof Args, MethodBucket[]> = {
  name: "list_case_calculation_methods",
  description:
    "List LCIA methods that have been run on a case under a specific " +
    "background-DB version. Each bucket contains per-target-product " +
    "calculation records; the inner `id` field (caseCalMethodId) is the " +
    "key get_lcia_detail / get_sensitivity / publish_data / uncertainty " +
    "all consume downstream.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await get<MethodBucket[]>(ctx, "/lca/v3/getCaseCalculationMethods", {
      caseId: args.case_id,
      versionId: args.version_id,
    });
  },
  cli: {
    summary: "List historical calc methods + records on a case.",
    renderHuman: (rows) =>
      rows
        .flatMap((b) => [
          `[${b.id}] ${b.name} (${b.versionName})`,
          ...b.calculationMethods.map(
            (r) =>
              `    caseCalMethodId=${r.id}  target=${r.targetProduct}  state=${r.calState}`,
          ),
        ])
        .join("\n"),
  },
};
