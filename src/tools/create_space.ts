import { z } from "zod";
import type { ToolDef } from "../types.js";
import { post } from "../api.js";

const Args = z.object({
  name: z.string().describe("Workspace display name."),
  description: z.string().optional().describe("Optional workspace description."),
});

/** Shape of `data` returned by addProjectSpace. `dicPermissionId` of a freshly
 *  created space is the 私有 (private) permission id — the upstream creates
 *  private spaces by default, plus a default root group. */
interface CreatedSpace {
  id: string;
  name: string;
  dicPermissionId: string;
  description: string;
  topCompanyId: string;
  companyId: string;
  createId: string;
  createTime: string;
  isDeleted: number;
}

export const createSpace: ToolDef<typeof Args, CreatedSpace> = {
  name: "create_space",
  description:
    "Create a new private workspace (项目空间) owned by this memberKey, with a " +
    "default root group. Use this to give the user an isolated space so their " +
    "modeling work does not land in shared org-public spaces. The new space is " +
    "private (only the creator sees it until members are added in the web UI). " +
    "Returns the new space id, consumed downstream as `space_id`. " +
    "Skill rule: agent must confirm the workspace name with the user before " +
    "creating — there is no delete-space tool, removal is web-UI only.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    return await post<CreatedSpace>(ctx, "/lca/v3/addProjectSpace", {
      name: args.name,
      description: args.description,
    });
  },
  cli: {
    summary: "Create a new private project workspace.",
    renderHuman: (s) =>
      `created space [${s.id}] ${s.name} (private) — created ${s.createTime}`,
  },
};
