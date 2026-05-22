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
    // 1. Resolve target product + capture product names for the reference-flow check.
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
    let target = args.target_product;
    if (!target) {
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

    // 3. Fetch the case meta (unit / declared-unit fields + version).
    const detail = await get<CaseDetail>(ctx, "/lca/v3/getCaseDetail", {
      id: args.case_id,
    });

    // 3a. Reference-flow guard. A custom-built case can validate clean (0 修改项)
    //     yet the async calc silently fails to resolve if the declared
    //     consultProductName doesn't match a 产品 output element (the FU has no
    //     reference flow). This is the #1 from-scratch silent-failure cause.
    const refMatch = products.some((p) => p.name === detail.consultProductName);
    if (!refMatch) {
      throw new JimuLcaError(
        "validation",
        `consultProductName "${detail.consultProductName}" does not match any 产品 output ` +
          `(${products.map((p) => `"${p.name}"`).join(", ")}). The calc would validate but ` +
          `silently fail to resolve — the declared functional unit has no reference flow. ` +
          `Set add_case's consult_product_name to exactly one of the 产品 output names, or rename the output.`,
      );
    }

    // 3b. Guard: method_id MUST belong to THIS case's background version. A
    //     wrong-version method id is accepted at submit but the async calc then
    //     silently FAILS ("计算失败") even with clean validation — so reject it
    //     loudly here, naming the valid methods. (try/catch: don't block calc if
    //     the method list is briefly unavailable.)
    const versionId = (detail as Record<string, unknown>).versionId as string | undefined;
    if (versionId) {
      try {
        const methods = await get<Array<{ id: string; name?: string; methodName?: string }>>(
          ctx,
          "/lca/v3/getAssignedCalculationMethods",
          { versionId },
        );
        if (methods.length && !methods.some((m) => String(m.id) === String(args.method_id))) {
          throw new JimuLcaError(
            "validation",
            `method_id ${args.method_id} is not a calculation method of this case's version (${versionId}) — ` +
              `the calc would submit but then silently fail. Use one of: ` +
              methods.slice(0, 12).map((m) => `${m.id} (${m.name ?? m.methodName})`).join(", "),
          );
        }
      } catch (e) {
        if (e instanceof JimuLcaError && e.kind === "validation") throw e;
        // method list unavailable → proceed.
      }
    }

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

    // Warnings that empirically cause the async calc to finish with NO result.
    const RESULT_BREAKERS = ["活动数据为0", "单位组不一致"]; // broken chain; defective bg-dataset binding
    const breakers = (validation?.warnings ?? []).filter((w) =>
      RESULT_BREAKERS.some((p) => w.includes(p)),
    );
    return {
      submitted: result,
      validation_score: validation?.score ?? null,
      warning_count: validation?.warnings.length ?? null,
      warnings: validation?.warnings ?? [],
      result_breaker_warnings: breakers,
      note:
        breakers.length > 0
          ? `Submitted, BUT ${breakers.length} 确认项 are known result-breakers — the calc may finish with NO result. ` +
            `活动数据为0 = broken inter-process flow chain (fill those downstream items, copy_case, recalc). ` +
            `背景数据单位组不一致 = a defective background-dataset binding (often an Ecoinvent 3.10 template) — ` +
            `re-create the product on a newer version (e.g. Ecoinvent 3.12+HiQ) and refill. Verify via get_product_lcia.`
          : "Submitted. Poll get_product_lcia / list_products.co2Content (async, ~up to 5 min). " +
            "Then run get_top_contributors — if a major input shows ~0% contribution, its branch is orphaned/unbound (result understated).",
    };
  },
  cli: {
    summary: "Trigger LCIA calculation on a case (auto-prefetches metadata).",
  },
};
