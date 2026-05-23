import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { getMemberToken } from "../api.js";
import { resolveManagerBaseUrl } from "../env.js";
import { FileInput, resolveFileInput } from "../files.js";

const Args = z.object({
  case_id: z.string().describe("Target case id (from create_blank_product / add_case, or an existing case)."),
  ...FileInput,
});

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const importModel: ToolDef<typeof Args, unknown> = {
  name: "import_model",
  description:
    "Build an entire LCA model in a single call by importing a filled model-template " +
    ".xlsx (manager API excel/importModelData; Bearer token derived from the memberKey). " +
    "Each sheet is a life-cycle stage and each row is a data item " +
    "(工序类型/工序名称/数据项类别/数据项名称/单位/数值/数据来源); the import creates the " +
    "processes and data items and auto-matches background datasets by name. This is the " +
    "primary way to author a model — far cheaper than per-row add_case_process / " +
    "add_data_items calls. Provide the spreadsheet as file_base64 (works on every " +
    "transport, including the HTTP Worker used by the desktop app) or file_path (CLI / " +
    "stdio MCP only). After importing: validate_case, then calculate_case. (Distinct from " +
    "import_elements_excel, which is the open-API value-only round-trip on an existing structure.)",
  inputSchema: Args,
  annotations: { destructiveHint: true, idempotentHint: false },
  async handler(args, ctx) {
    const bearer = await getMemberToken(ctx);
    const base = resolveManagerBaseUrl(ctx.baseUrl);
    const { bytes, filename } = await resolveFileInput(args);

    const form = new FormData();
    form.append("caseId", args.case_id);
    // Copy into a fresh ArrayBuffer-backed view so the Blob part type is exact
    // across the Worker and Node typed-array libs.
    form.append("file", new Blob([Uint8Array.from(bytes)], { type: XLSX_MIME }), filename);

    const resp = await ctx.fetch(`${base}/managerPro/excel/importModelData`, {
      method: "POST",
      headers: { Authorization: bearer, Origin: base.replace(/\/ecdigit\/api$/, "") },
      body: form,
    });
    if (!resp.ok) {
      throw new JimuLcaError("transport", `HTTP ${resp.status} ${resp.statusText} calling excel/importModelData`);
    }

    // The endpoint may return an empty 200 body on success; treat that as success
    // rather than a parse error.
    const raw = await resp.text();
    if (!raw.trim()) {
      return { ok: true, message: "import accepted (empty response body)" };
    }
    const json = JSON.parse(raw) as { success: boolean; code: string; message: string; data: unknown };
    if (!json.success) {
      throw new JimuLcaError("upstream", json.message || `import failed (code ${json.code})`, undefined, json.code);
    }
    return json.data ?? { ok: true, message: json.message };
  },
  cli: { summary: "Import a whole model from a template .xlsx (one-shot build)." },
};
