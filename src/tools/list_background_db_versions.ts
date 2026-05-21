import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({});

interface BgVersion {
  id: string;
  uuid: string;
  version: string;
  description: string;
  createTime: string;
}

export const listBackgroundDbVersions: ToolDef<typeof Args, BgVersion[]> = {
  name: "list_background_db_versions",
  description:
    "List background-database versions the tenant can use (Ecoinvent 3.10 / " +
    "3.11 / 3.12 / HiQ-combined variants). The returned `id` is the " +
    "`versionId` that list_calculation_methods, calculate_case, and most " +
    "downstream LCA operations require. Pick one version per case; do not " +
    "mix versions inside one case.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(_args, ctx) {
    return await get<BgVersion[]>(ctx, "/lca/v3/getAllocationVersions");
  },
  cli: {
    summary: "List background-DB versions available to the tenant.",
    renderHuman: (rows) =>
      rows
        .map(
          (r) =>
            `[${r.id}] ${r.version.padEnd(28)} — ${r.description}`,
        )
        .join("\n"),
  },
};
