import { z } from "zod";
import type { ToolDef } from "../types.js";
import { getCaseValidation } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id to validate (from create_product / add_case / get_case_overview)."),
});

export const validateCase: ToolDef<typeof Args, unknown> = {
  name: "validate_case",
  description:
    "Run the platform's authoritative model validation on a case and return " +
    "the score + must-fix (修改项) and warning (确认项) lists. Call this AFTER " +
    "filling/editing and BEFORE calculate_case — it is the reliable check that " +
    "the model will actually produce a result, catching more than " +
    "completeness_check.py does (broken inter-process flow chains, mass " +
    "imbalance, missing transport/background, zero activity data downstream). " +
    "must_fix must be empty before calc; surface warnings to the user. " +
    "Internally mints a Bearer token from the memberKey (manager API).",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const v = await getCaseValidation(ctx, args.case_id);
    const must = v.mustFix;
    const warn = v.warnings;
    return {
      score: v.score,
      ready: must.length === 0,
      must_fix: must,
      must_fix_count: must.length,
      warnings: warn,
      warning_count: warn.length,
      note:
        must.length === 0
          ? "No 修改项 — validation passes. But passing ≠ a result will compute: also confirm the inter-process flow chain reaches the declared product (see workflow.md)."
          : `${must.length} must-fix (修改项) — clear all before calculate_case.`,
    };
  },
  cli: { summary: "Validate a case (score + 修改项/确认项)." },
};
