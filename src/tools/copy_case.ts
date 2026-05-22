import { z } from "zod";
import type { ToolDef } from "../types.js";
import { postQuery } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Source case id to duplicate."),
});

export const copyCase: ToolDef<typeof Args, unknown> = {
  name: "copy_case",
  description:
    "Duplicate an existing LCA case (clones into the source product). Useful " +
    "for variant analysis (copy → edit → recalculate without disturbing the " +
    "original). Note: upstream returns only success, NOT the new case id — " +
    "after copying, re-read the product's cases to find the clone.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    // Upstream reads caseId from the query string, not the JSON body —
    // a body {caseId} yields "caseId不能为空". The doc's own curl uses ?caseId=.
    return await postQuery(ctx, "/lca/v3/copyCase", { caseId: args.case_id });
  },
  cli: {
    summary: "Duplicate an LCA case.",
  },
};
