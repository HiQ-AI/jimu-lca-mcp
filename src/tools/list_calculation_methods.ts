import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  version_id: z
    .string()
    .describe(
      "Background-DB version id, from list_background_db_versions. Required — the upstream documents it under its '请求参数' table separately from '请求头', so it's easy to miss.",
    ),
});

interface Method {
  id: string;
  uuid: string;
  name: string;
  version: string;
  category: string;
  orderNo: number;
  enable: string;
  versionId: string;
  versionName: string;
}

export const listCalculationMethods: ToolDef<typeof Args, Method[]> = {
  name: "list_calculation_methods",
  description:
    "List LCIA methods (EF v3.x / EN15804 / CISA-EPD / USEtox / IPCC GWP100 / etc.) available under one background-DB version. The returned `id` is what calculate_case takes as `method_id`. Call list_background_db_versions first to obtain a valid version_id.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await get<Method[]>(ctx, "/lca/v3/getAssignedCalculationMethods", {
      versionId: args.version_id,
    });
  },
  cli: {
    summary: "List LCIA methods for a background-DB version.",
    renderHuman: (rows) =>
      rows
        .map((r) => `[${r.id}] ${r.name} (${r.versionName})`)
        .join("\n"),
  },
};
