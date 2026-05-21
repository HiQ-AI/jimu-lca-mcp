import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  name: z
    .string()
    .optional()
    .describe("Optional fuzzy filter on space name."),
});

interface Group {
  id: string;
  name: string;
  description: string;
  spaceId: string;
  isRoot: number;
  level: number;
}

interface Space {
  id: string;
  name: string;
  dicPermission: string;
  dicPermissionId?: string;
  description: string;
  groupList: Group[];
}

export const listSpaces: ToolDef<typeof Args, Space[]> = {
  name: "list_spaces",
  description:
    "List project workspaces visible to this memberKey: org-public spaces, " +
    "private spaces the user owns, and private spaces the user has been " +
    "added to (all merged). Each space carries its group/folder tree. The " +
    "returned `id` is the `space_id` consumed by downstream tools.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await get<Space[]>(ctx, "/lca/v3/getProjectSpaces", { name: args.name });
  },
  cli: {
    summary: "List visible project workspaces.",
    renderHuman: (rows) =>
      rows
        .map(
          (s) =>
            `[${s.id}] ${s.name.padEnd(28)} (${s.dicPermission}) — ${s.groupList.length} groups`,
        )
        .join("\n"),
  },
};
