import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get, post } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id to delete."),
  confirm: z
    .boolean()
    .default(false)
    .describe("Safety gate. Leave false (default) to PREVIEW what would be deleted (name + status, no deletion). Set true to actually delete."),
});

interface CaseDetail {
  consultProductName?: string;
  status?: string;
  statusName?: string;
  brandId?: string;
  [k: string]: unknown;
}

export const deleteCase: ToolDef<typeof Args, unknown> = {
  name: "delete_case",
  description:
    "Delete an LCA case. Destructive — the case's data items, background matches, " +
    "and calc history are gone. Two-step by design: call with confirm:false " +
    "(default) to PREVIEW the case name + status without deleting, show it to the " +
    "user, then call with confirm:true to delete. Never delete without that " +
    "confirmation.",
  inputSchema: Args,
  annotations: { destructiveHint: true, idempotentHint: true },
  async handler(args, ctx) {
    // Pre-flight read so the name/status are surfaced even when the agent skips it.
    let detail: CaseDetail | null = null;
    try {
      detail = await get<CaseDetail>(ctx, "/lca/v3/getCaseDetail", { id: args.case_id });
    } catch {
      /* case may not exist / be readable — fall through */
    }
    const preview = {
      case_id: args.case_id,
      name: detail?.consultProductName ?? "(unknown)",
      status: detail?.statusName ?? detail?.status ?? "(unknown)",
    };
    if (!args.confirm) {
      return {
        deleted: false,
        would_delete: preview,
        note: "Preview only — confirm with the user, then call again with confirm:true to delete.",
      };
    }
    // Quirk: parameter name on the wire is `id`, not `caseId`.
    const result = await post(ctx, "/lca/v3/deleteCase", { id: args.case_id });
    return { deleted: true, deleted_case: preview, result };
  },
  cli: { summary: "Delete an LCA case (preview unless --confirm; destructive)." },
};
