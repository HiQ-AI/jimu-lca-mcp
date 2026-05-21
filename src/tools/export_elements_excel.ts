import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callBinary } from "../api.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const Args = z.object({
  case_id: z.string().describe("Case id."),
  out_path: z
    .string()
    .optional()
    .describe(
      "Local file path to save the Excel. Defaults to a tmpdir path " +
      "(`<tmp>/jimu-lca-export-<case>.xlsx`).",
    ),
});

interface ExportResult {
  path: string;
  bytes: number;
  content_type: string;
}

export const exportElementsExcel: ToolDef<typeof Args, ExportResult> = {
  name: "export_elements_excel",
  description:
    "Export a case's data items to an Excel file the user can edit offline. " +
    "Returns the local file path. The exported file matches the schema " +
    "import_elements_excel expects, so a round-trip (export → user edits → " +
    "import) is supported by design.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const resp = await callBinary(ctx, "GET", "/lca/v3/exportElementData", {
      query: { caseId: args.case_id },
    });
    const buf = new Uint8Array(await resp.arrayBuffer());
    const path =
      args.out_path ??
      join(tmpdir(), `jimu-lca-export-${args.case_id}.xlsx`);
    await writeFile(path, buf);
    return {
      path,
      bytes: buf.length,
      content_type: resp.headers.get("content-type") ?? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  },
  cli: {
    summary: "Export a case's data items to a local .xlsx.",
    renderHuman: (r) => `wrote ${r.bytes.toLocaleString()} bytes → ${r.path}`,
  },
};
