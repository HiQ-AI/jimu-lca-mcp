import { z } from "zod";
import { JimuLcaError } from "./types.js";

/**
 * Transport-agnostic file input. A file-bearing tool mixes `FileInput` into its
 * schema and calls `resolveFileInput` to get bytes, regardless of whether it runs
 * over the HTTP Worker (no filesystem), the CLI, or the stdio MCP.
 * See docs/architecture/file-input.md.
 */
export const FileInput = {
  file_base64: z
    .string()
    .optional()
    .describe(
      "File content as base64. Works on EVERY transport — use this from the desktop / HTTP host (read the local file's bytes and base64-encode them, e.g. `base64 -i model.xlsx`).",
    ),
  file_path: z
    .string()
    .optional()
    .describe(
      "Local path to the file. Resolved only on a host with a filesystem (CLI / stdio MCP); NOT available over the HTTP Worker — pass file_base64 there instead.",
    ),
  filename: z
    .string()
    .optional()
    .describe("Upload part name (e.g. model.xlsx). Defaults from file_path, else 'upload.xlsx'."),
};

/** Resolve {file_base64 | file_path} into bytes + a filename. Exactly one form. */
export async function resolveFileInput(args: {
  file_base64?: string;
  file_path?: string;
  filename?: string;
}): Promise<{ bytes: Buffer; filename: string }> {
  if (args.file_base64 != null && args.file_path != null) {
    throw new JimuLcaError("validation", "Provide exactly one of file_base64 or file_path, not both.");
  }

  if (args.file_base64 != null) {
    const bytes = Buffer.from(args.file_base64, "base64");
    if (bytes.byteLength === 0) {
      throw new JimuLcaError("validation", "file_base64 decoded to zero bytes — the content is empty or not valid base64.");
    }
    return { bytes, filename: args.filename ?? "upload.xlsx" };
  }

  if (args.file_path != null) {
    let fs: typeof import("node:fs/promises");
    try {
      fs = await import("node:fs/promises");
    } catch {
      throw new JimuLcaError(
        "transport",
        "file_path is only supported on a host with a filesystem (CLI / stdio MCP). Over the HTTP Worker (e.g. the desktop app), pass file_base64 instead.",
      );
    }
    const bytes = await fs.readFile(args.file_path);
    const { basename } = await import("node:path");
    return { bytes, filename: args.filename ?? basename(args.file_path) };
  }

  throw new JimuLcaError(
    "validation",
    "No file input. Provide file_base64 (any transport) or file_path (CLI / stdio MCP only).",
  );
}
