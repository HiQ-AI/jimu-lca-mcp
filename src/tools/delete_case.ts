import { z } from "zod";
import type { ToolDef } from "../types.js";
import { post } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id to delete."),
});

export const deleteCase: ToolDef<typeof Args, unknown> = {
  name: "delete_case",
  description:
    "Delete an LCA case. Destructive — the case's data items, background " +
    "matches, and calc history are gone (soft- vs hard-delete behaviour to " +
    "be verified). Skill rule: never call without explicit user confirmation " +
    "showing the case name, status, and any calc records that will be lost.",
  inputSchema: Args,
  annotations: { destructiveHint: true, idempotentHint: true },
  async handler(args, ctx) {
    // Quirk: parameter name on the wire is `id`, not `caseId`.
    return await post(ctx, "/lca/v3/deleteCase", { id: args.case_id });
  },
  cli: {
    summary: "Delete an LCA case (destructive).",
  },
};
