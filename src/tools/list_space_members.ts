import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

/**
 * Friendly role enum ↔ open-platform dicRoleId mapping. The dicRoleId
 * values are stable but documentation-only — no upstream endpoint lists
 * them, so we hard-code (verified via Story-2 / Story-4 smoke).
 */
const ROLE_IDS = {
  owner: "1801221779521712138",
  admin: "1801221779521712139",
  member: "1801221779521712140",
} as const;

const Args = z.object({
  space_id: z.string().describe("Space id, from list_spaces."),
  role: z
    .enum(["owner", "admin", "member"])
    .optional()
    .describe(
      "Optional role filter. Omit to return all members merged across all roles.",
    ),
});

interface Member {
  id: string;
  uuid: string;
  username: string;
  name: string;
  mobile: string;
  email: string;
  gender?: string;
  pic?: string;
  roleTypeId: string[];
  roleTypeOrder: number;
  addToSpaceTime: string;
  isUserAdmin: number;
}

export const listSpaceMembers: ToolDef<typeof Args, Member[]> = {
  name: "list_space_members",
  description:
    "List members of a project workspace, optionally filtered to a single " +
    "role (owner / admin / member). Returns id, username, display name, " +
    "contact info, the role ids the user holds in this space, and when they " +
    "joined. Omit `role` for all roles merged.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await get<Member[]>(ctx, "/lca/v3/getMembersBySpaceId", {
      spaceId: args.space_id,
      dicRoleId: args.role ? ROLE_IDS[args.role] : undefined,
    });
  },
  cli: {
    summary: "List members in a workspace.",
    renderHuman: (rows) =>
      rows
        .map(
          (m) =>
            `[${m.id}] ${m.name.padEnd(20)} mobile=${m.mobile.padEnd(13)} email=${m.email}`,
        )
        .join("\n"),
  },
};
