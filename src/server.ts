#!/usr/bin/env node
/**
 * Stdio MCP server entry. What `npx -y jimu-lca-mcp` runs.
 *
 * Reads {@link JIMU_LCA_MEMBER_KEY} from env (or OS keychain if set up via
 * `jimu-lca login`), wires all 22 tools, speaks the MCP wire protocol over
 * stdin/stdout.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { allTools } from "./tools/index.js";
import { contextFromEnv } from "./auth.js";
import { openLocalBridge } from "./sqliteBridge.js";
import { stderrLogger } from "./logger.js";
import { JimuLcaError } from "./types.js";
import { VERSION } from "./env.js";

async function main(): Promise<void> {
  const ctx = await contextFromEnv(stderrLogger);
  // stdio has no D1 — back the catalog→jimu binding bridge with the local
  // SQLite so bind_backgrounds_local works (undefined when no DB is present).
  ctx.bridge = openLocalBridge(stderrLogger);
  stderrLogger.info("jimu-lca-mcp starting", {
    version: VERSION,
    baseUrl: ctx.baseUrl,
    toolCount: allTools.length,
    bridge: ctx.bridge ? "local-sqlite" : "unavailable",
  });

  const server = new McpServer({
    name: "jimu-lca",
    version: VERSION,
  });

  for (const tool of allTools) {
    // The MCP SDK's registerTool expects a flat Zod-shape object, not the
    // wrapped ZodObject — extract .shape if the schema is a ZodObject.
    const shape =
      tool.inputSchema instanceof z.ZodObject
        ? (tool.inputSchema as z.ZodObject<z.ZodRawShape>).shape
        : ({} as z.ZodRawShape);

    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: shape,
        annotations: tool.annotations as Record<string, boolean> | undefined,
      },
      async (args: unknown) => {
        try {
          // Parse args through the schema so defaults are applied and the
          // handler receives a validated, fully-populated object.
          const parsed = tool.inputSchema.parse(args ?? {});
          const result = await tool.handler(parsed, ctx);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          const errMsg =
            err instanceof JimuLcaError
              ? `[${err.kind}${err.upstreamCode ? `:${err.upstreamCode}` : ""}] ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
          stderrLogger.error("tool failed", { tool: tool.name, error: errMsg });
          return {
            content: [{ type: "text", text: errMsg }],
            isError: true,
          };
        }
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown — Cortex Desktop / Claude Code sends SIGTERM on cleanup.
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      stderrLogger.info("shutting down", { signal: sig });
      await server.close();
      process.exit(0);
    });
  }
}

main().catch((err) => {
  const msg = err instanceof JimuLcaError ? err.message : String(err);
  process.stderr.write(`[fatal] ${msg}\n`);
  process.exit(err instanceof JimuLcaError && err.kind === "auth" ? 2 : 1);
});
