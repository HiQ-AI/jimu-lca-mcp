/**
 * Shared types. Used by every entry point (stdio MCP server, CLI, Cloudflare
 * Worker) and by every tool implementation.
 *
 * The split between {@link ToolDef} and {@link ToolContext} is deliberate:
 *
 * - ToolDef is the *static* metadata + handler — declared once per tool file,
 *   imported by all three entries.
 * - ToolContext is the *per-request* state — built freshly per request, holds
 *   the resolved memberKey + base URL + a request-scoped fetch.
 */

import type { z } from "zod";
import type { BridgeLookup } from "./bridge.js";

/**
 * Logger shape — minimal. Stdio MCP uses stderr; CLI uses stderr; Worker uses
 * `console.*` which Cloudflare ships to Logs.
 */
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

/**
 * Resolved per-request state every tool handler receives.
 */
export interface ToolContext {
  /** Validated memberKey of the form `app:xxxxxxxxxxxxxxxxxxx`. */
  memberKey: string;
  /** open.ecdigit.com / .cn base URL, no trailing slash. */
  baseUrl: string;
  /** Workers-compatible fetch. Node entries pass globalThis.fetch. */
  fetch: typeof globalThis.fetch;
  logger: Logger;
  /**
   * Local-catalog → jimu binding bridge, when a backing store is bound (the
   * Worker's D1). Undefined on transports without one (stdio / CLI today); the
   * Cortex save tool then reports the bridge unavailable.
   */
  bridge?: BridgeLookup;
}

/**
 * One tool's static definition. Each src/tools/*.ts exports one of these.
 *
 * The Args generic is the args type derived from the Zod schema; the Result
 * generic is whatever the handler returns. Both are surfaced via TS inference
 * — no need to spell them out.
 */
export interface ToolDef<
  TSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TResult = unknown,
> {
  /** Tool id used by the MCP protocol and by the CLI subcommand name. */
  name: string;

  /** Description shown to the LLM. Keep tight; aim for one sentence. */
  description: string;

  /** Zod schema for the tool's arguments. */
  inputSchema: TSchema;

  /** MCP standard annotations. */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };

  /** Implementation. Receives parsed args + per-request context. */
  handler: (args: z.infer<TSchema>, ctx: ToolContext) => Promise<TResult>;

  /** CLI-only optional helpers. */
  cli?: {
    /** One-line --help text for the CLI subcommand. */
    summary: string;
    /** Pretty-print mode renderer. JSON mode is automatic. */
    renderHuman?: (result: TResult) => string;
  };
}

/**
 * Domain-specific error type. Distinguishes our errors (config / validation)
 * from upstream API errors (which carry codes + messages from open.ecdigit.com)
 * from transport errors (network / timeout).
 */
export class JimuLcaError extends Error {
  constructor(
    public readonly kind: "config" | "auth" | "validation" | "upstream" | "transport",
    message: string,
    public readonly cause?: unknown,
    /** Upstream-API error code, when kind === "upstream". */
    public readonly upstreamCode?: string,
  ) {
    super(message);
    this.name = "JimuLcaError";
  }
}
