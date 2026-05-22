import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { getMemberToken } from "../api.js";
import { resolveManagerBaseUrl } from "../env.js";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const Args = z.object({
  case_id: z.string().describe("Target case id (from create_custom_product → add_case, or an existing case)."),
  file_path: z.string().describe("Local path to the filled import .xlsx (one sheet per stage; rows = 工序类型/工序名/数据项类别/数据项名/单位/数值/数据来源). Generate it from structured data with the skill's build_import_xlsx script."),
});

export const importModel: ToolDef<typeof Args, unknown> = {
  name: "import_model",
  description:
    "Build a whole LCA model in ONE call by importing the platform's model " +
    "template xlsx (manager API excel/importModelData, Bearer token from the " +
    "memberKey). Each sheet = a life-cycle stage; each row = a data item " +
    "(工序类型/工序名/数据项类别/数据项名/单位/数值/数据来源). The import creates the " +
    "processes + data items and auto-matches backgrounds by name. This is the " +
    "primary way to author a model — far cheaper than add_case_process / " +
    "add_data_items per row. After importing, validate_case → fix → " +
    "calculate_case. (Differs from import_elements_excel, which is the open-API " +
    "value-only round-trip on an existing structure.)",
  inputSchema: Args,
  annotations: { destructiveHint: true, idempotentHint: false },
  async handler(args, ctx) {
    const bearer = await getMemberToken(ctx);
    const base = resolveManagerBaseUrl(ctx.baseUrl);
    const file = await readFile(args.file_path);
    const form = new FormData();
    form.append("caseId", args.case_id);
    const blob = new Blob([file], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    form.append("file", blob, basename(args.file_path));

    const resp = await ctx.fetch(`${base}/managerPro/excel/importModelData`, {
      method: "POST",
      headers: { Authorization: bearer, Origin: base.replace(/\/ecdigit\/api$/, "") },
      body: form,
    });
    if (!resp.ok) {
      throw new JimuLcaError("transport", `HTTP ${resp.status} ${resp.statusText} calling excel/importModelData`);
    }
    const json = (await resp.json()) as { success: boolean; code: string; message: string; data: unknown };
    if (!json.success) {
      throw new JimuLcaError("upstream", json.message || `import failed (code ${json.code})`, undefined, json.code);
    }
    return json.data ?? { ok: true, message: json.message };
  },
  cli: { summary: "Import a whole model from a template xlsx (one-shot build)." },
};
