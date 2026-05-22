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
import { get, post, getCaseValidation } from "../api.js";

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
  skip_validation: z
    .boolean()
    .default(false)
    .describe(
      "By default the wrapper runs the platform model validation first and refuses to submit if there are 修改项 (must-fix). Set true to bypass (rarely needed).",
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
    "product). First runs the platform model validation: if there are 修改项 " +
    "(must-fix), it REFUSES to submit and returns them (no wasted async calc). " +
    "Otherwise it prefetches the required metadata, submits, and returns " +
    "{submitted, validation_score, warnings, note} — surfacing 确认项 warnings, " +
    "especially 活动数据为0 ones that signal a broken inter-process flow chain " +
    "(which makes the calc finish with no result). Poll get_product_lcia / " +
    "list_products.co2Content for the async result; status:已计算 ≠ a result.",
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

    // 2. Pre-submit validation (manager API). A model can pass the open API's
    //    修改项 gate yet still produce no result because the inter-process flow
    //    chain is broken — that surfaces here as 确认项 (活动数据为0 downstream).
    //    Block on 修改项; surface 确认项 so the agent doesn't wait on a doomed calc.
    //    try/catch: if the manager API/JWT is unavailable, degrade to a plain submit.
    let validation: { score: number | null; warnings: string[] } | null = null;
    if (!args.skip_validation) {
      try {
        const v = await getCaseValidation(ctx, args.case_id);
        if (v.mustFix.length > 0) {
          throw new JimuLcaError(
            "validation",
            `model has ${v.mustFix.length} must-fix (修改项) — clear all before calculating: ` +
              v.mustFix.join(" | "),
          );
        }
        validation = { score: v.score, warnings: v.warnings };
      } catch (e) {
        if (e instanceof JimuLcaError && e.kind === "validation") throw e;
        // manager API unavailable → proceed without the extra check.
      }
    }

    // 3. Fetch the case meta (unit / declared-unit fields).
    const detail = await get<CaseDetail>(ctx, "/lca/v3/getCaseDetail", {
      id: args.case_id,
    });

    // 4. Submit the calc task with the full body.
    const result = await post(ctx, "/lca/v3/addCaseCalculationTask", {
      caseId: args.case_id,
      impactMethodId: args.method_id,
      targetProduct: target,
      unitComment: detail.unitComment,
      consultProductName: detail.consultProductName,
      unitId: detail.unitId,
      consultProductCoefficient: detail.consultProductCoefficient,
    });

    const chainWarnings = (validation?.warnings ?? []).filter((w) => w.includes("活动数据为0"));
    return {
      submitted: result,
      validation_score: validation?.score ?? null,
      warning_count: validation?.warnings.length ?? null,
      warnings: validation?.warnings ?? [],
      note:
        chainWarnings.length > 0
          ? `Submitted, BUT ${chainWarnings.length} 确认项 flag 活动数据为0 (likely a broken inter-process flow chain). The calc may finish with NO result — verify via get_product_lcia; if empty, fill those downstream items to connect the chain, then copy_case + recalculate.`
          : "Submitted. Poll get_product_lcia / list_products.co2Content for the result (async, up to ~5 min). status:已计算 alone is not a result.",
    };
  },
  cli: {
    summary: "Trigger LCIA calculation on a case (auto-prefetches metadata).",
  },
};
