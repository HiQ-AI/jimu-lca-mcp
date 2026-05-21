/**
 * Cloudflare Worker HTTP MCP entry. Deployed at https://jimulca-mcp.hiq.earth/mcp
 * (custom domain), this is the URL future Cortex Desktop Connectors and
 * Claude Desktop Connectors point at.
 *
 * Routes:
 *   POST/GET /mcp           — MCP wire protocol over Streamable HTTP / SSE
 *   GET      /healthz       — liveness probe (no auth)
 *   GET      /manifest.json — Connector directory metadata (no auth)
 *
 * Auth: memberKey comes from `X-Member-Key` or `Authorization: Bearer app:...`
 * header per request. Stateless — no session storage on the Worker side.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { allTools } from "./tools/index.js";
import { contextFromRequest } from "./auth.js";
import { consoleLogger } from "./logger.js";
import { JimuLcaError } from "./types.js";
import { VERSION } from "./env.js";
import manifest from "./connector/manifest.json" with { type: "json" };

interface Env {
  JIMU_LCA_BASE_URL?: string;
  JIMU_LCA_ENV?: string;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS, DELETE",
  "access-control-allow-headers": "content-type, x-member-key, authorization, mcp-session-id, last-event-id",
  "access-control-expose-headers": "mcp-session-id",
  "access-control-max-age": "86400",
};

function withCors(resp: Response): Response {
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return withCors(
    new Response(JSON.stringify(body, null, 2), {
      ...init,
      headers: { ...JSON_HEADERS, ...(init.headers as Record<string, string> | undefined) },
    }),
  );
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  let ctx;
  try {
    ctx = contextFromRequest(
      request,
      { baseUrl: env.JIMU_LCA_BASE_URL, env: env.JIMU_LCA_ENV },
      consoleLogger,
    );
  } catch (err) {
    if (err instanceof JimuLcaError && err.kind === "auth") {
      return jsonResponse(
        { error: "auth", message: err.message },
        { status: 401, headers: { "www-authenticate": 'Bearer realm="jimu-lca-mcp"' } },
      );
    }
    throw err;
  }

  const server = new McpServer({ name: "jimu-lca", version: VERSION });
  for (const tool of allTools) {
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
          const parsed = tool.inputSchema.parse(args ?? {});
          const result = await tool.handler(parsed, ctx);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const errMsg =
            err instanceof JimuLcaError
              ? `[${err.kind}${err.upstreamCode ? `:${err.upstreamCode}` : ""}] ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
          return {
            content: [{ type: "text" as const, text: errMsg }],
            isError: true,
          };
        }
      },
    );
  }

  // Stateless mode (no sessionIdGenerator) — each request is self-contained,
  // perfect for serverless / Worker environments where there's no in-process
  // state between requests.
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  return withCors(response);
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS pre-flight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/healthz") {
      return jsonResponse({ ok: true, version: VERSION, toolCount: allTools.length });
    }

    if (url.pathname === "/manifest.json") {
      return jsonResponse(manifest);
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      try {
        return await handleMcp(request, env);
      } catch (err) {
        consoleLogger.error("mcp fetch failed", { error: String(err) });
        return jsonResponse(
          { error: "internal", message: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        );
      }
    }

    if (url.pathname === "/") {
      return jsonResponse({
        name: "jimu-lca-mcp",
        version: VERSION,
        endpoints: ["/mcp (POST + GET for MCP wire protocol)", "/healthz", "/manifest.json"],
      });
    }

    return jsonResponse({ error: "not_found", path: url.pathname }, { status: 404 });
  },
};

export default worker;
