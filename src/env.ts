/**
 * Environment-resolved configuration. Three environments, two base hosts
 * (.cn for dev, .com for pre/prod).
 *
 * Centralised so the value spreads consistently across the stdio MCP, the
 * CLI, and the Cloudflare Worker.
 */

export type JimuEnv = "prod" | "pre" | "dev";

const BASE_URLS: Record<JimuEnv, string> = {
  prod: "https://open.ecdigit.com/openapi",
  pre: "https://open-pre.ecdigit.com/openapi",
  dev: "https://open.ecdigit.cn/openapi",
};

/**
 * Resolve a base URL. Order of precedence:
 * 1. Explicit `JIMU_LCA_BASE_URL` (override; useful for local proxy / dev).
 * 2. `JIMU_LCA_ENV` (`prod` / `pre` / `dev`).
 * 3. Default: `prod`.
 */
export function resolveBaseUrl(
  explicit?: string | null,
  envName?: string | null,
): string {
  if (explicit) return explicit.replace(/\/+$/, "");
  if (envName && envName in BASE_URLS) return BASE_URLS[envName as JimuEnv];
  return BASE_URLS.prod;
}

/** Library version stamp surfaced via the `version` subcommand + MCP server `serverInfo`. */
export const VERSION = "0.1.0-alpha.1";
