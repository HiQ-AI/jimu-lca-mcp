/**
 * 🧩 Aggregator — calculates a case's LCIA in one call, prefetching the
 * metadata the upstream API requires (unit / declared product / target id)
 * so the agent only has to pass the semantic inputs.
 *
 * Wire flow:
 *   1. getCaseDetail(id=case_id) → unitId, unitComment, consultProductName, consultProductCoefficient
 *   2. (if target_product not given) getCaseDisposals(caseId) → discover target
 *   3. addCaseCalculationTask(POST) — submit
 *
 * Skill rule: every call requires explicit user confirmation up the stack —
 * this tool does NOT gate the call itself (that's the skill's job).
 */
import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { get, post } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id."),
  method_id: z
    .string()
    .describe(
      "LCIA method id, from list_calculation_methods under the case's background-DB version.",
    ),
  target_product: z
    .string()
    .optional()
    .describe(
      "Product or disposal id to calculate for. Omit when the case has exactly one product; the wrapper picks it. Errors with the candidate list if the case has multiple.",
    ),
});

interface CaseDetail {
  unitId: string;
  unitComment: string;
  consultProductName: string;
  consultProductCoefficient: string;
  [k: string]: unknown;
}

interface DisposalStage {
  id: string;
  children: Array<{ id: string; name: string; categoryName: string }>;
}

export const calculateCase: ToolDef<typeof Args, unknown> = {
  name: "calculate_case",
  description:
    "Trigger an LCIA calculation on a case (one LCIA method × one target " +
    "product). The wrapper prefetches the case's product/disposal list and " +
    "the metadata fields the upstream API requires (unitComment / " +
    "consultProductName / unitId / consultProductCoefficient), so the " +
    "agent passes only semantic inputs. Returns the upstream response, " +
    "which on success includes the new caseCalMethodId; on validation " +
    "failure (code 600) returns a list of model-validation errors.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    // 1. Resolve target product if not provided.
    let target = args.target_product;
    if (!target) {
      const disposalStages = await get<DisposalStage[]>(
        ctx,
        "/lca/v3/getCaseDisposals",
        { caseId: args.case_id },
      );
      const products = disposalStages
        .flatMap((s) => s.children)
        .filter((c) => c.categoryName === "产品");
      if (products.length === 0) {
        throw new JimuLcaError(
          "validation",
          `case ${args.case_id} has no product entries in getCaseDisposals; nothing to calculate.`,
        );
      }
      if (products.length > 1) {
        throw new JimuLcaError(
          "validation",
          `case has ${products.length} products; pass target_product explicitly. Candidates: ` +
            products.map((p) => `${p.id} (${p.name})`).join(", "),
        );
      }
      target = products[0]!.id;
    }

    // 2. Fetch the case meta (unit / declared-unit fields).
    const detail = await get<CaseDetail>(ctx, "/lca/v3/getCaseDetail", {
      id: args.case_id,
    });

    // 3. Submit the calc task with the full body.
    return await post(ctx, "/lca/v3/addCaseCalculationTask", {
      caseId: args.case_id,
      impactMethodId: args.method_id,
      targetProduct: target,
      unitComment: detail.unitComment,
      consultProductName: detail.consultProductName,
      unitId: detail.unitId,
      consultProductCoefficient: detail.consultProductCoefficient,
    });
  },
  cli: {
    summary: "Trigger LCIA calculation on a case (auto-prefetches metadata).",
  },
};
