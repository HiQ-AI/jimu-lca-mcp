import { z } from "zod";
import type { ToolDef } from "../types.js";
import { post } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Source case id to duplicate."),
});

export const copyCase: ToolDef<typeof Args, unknown> = {
  name: "copy_case",
  description:
    "Duplicate an existing LCA case. Returns the new case id. Useful for " +
    "variant analysis (copy → edit → recalculate without disturbing the " +
    "original). Behaviour to verify on first use: whether data-item values, " +
    "background matches, and calc history carry over to the copy or get reset.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    return await post(ctx, "/lca/v3/copyCase", { caseId: args.case_id });
  },
  cli: {
    summary: "Duplicate an LCA case.",
  },
};
