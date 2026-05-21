import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const Args = z.object({
  case_id: z.string().describe("Case id."),
  file_path: z
    .string()
    .describe(
      "Local path to the .xlsx (typically obtained from export_elements_excel after user edits).",
    ),
});

export const importElementsExcel: ToolDef<typeof Args, unknown> = {
  name: "import_elements_excel",
  description:
    "Bulk-update a case's data items from an Excel file. The file must " +
    "match the schema returned by export_elements_excel — round-trip flow: " +
    "export → user edits in Excel → import. DESTRUCTIVE: the upstream's " +
    "merge-vs-replace semantics are not documented; treat every call as a " +
    "potential wipe of values not present in the file. Skill rule: require " +
    "an export+diff before each import.",
  inputSchema: Args,
  annotations: { destructiveHint: true, idempotentHint: false },
  async handler(args, ctx) {
    const file = await readFile(args.file_path);
    const form = new FormData();
    form.append("caseId", args.case_id);
    // node FormData accepts a Blob; build one from the file bytes.
    const blob = new Blob([file], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    form.append("file", blob, basename(args.file_path));

    const url = new URL(ctx.baseUrl + "/lca/v3/importModelData");
    const resp = await ctx.fetch(url.toString(), {
      method: "POST",
      headers: { appId: ctx.memberKey },
      body: form,
    });
    if (!resp.ok) {
      throw new JimuLcaError(
        "transport",
        `HTTP ${resp.status} ${resp.statusText} calling importModelData`,
      );
    }
    const json = (await resp.json()) as { success: boolean; code: string; message: string; data: unknown };
    if (!json.success) {
      throw new JimuLcaError("upstream", json.message, undefined, json.code);
    }
    return json.data;
  },
  cli: {
    summary: "Import a case's data items from a local .xlsx (destructive).",
  },
};
