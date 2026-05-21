/**
 * memberKey resolution. Two entry sources:
 *
 * - Stdio MCP + CLI: env var `JIMU_LCA_MEMBER_KEY` (or OS keychain if
 *   `keytar` is available and a `jimu-lca login` flow has stored it).
 * - HTTP MCP (Cloudflare Worker): `X-Member-Key` header, or
 *   `Authorization: Bearer app:...` header.
 *
 * Both paths funnel into {@link validateMemberKey}, which is the single
 * format check anywhere in the codebase.
 */

import { JimuLcaError, type Logger, type ToolContext } from "./types.js";
import { resolveBaseUrl, VERSION } from "./env.js";

const MEMBER_KEY_RE = /^app:[A-Za-z0-9]{8,}$/;
const KEYCHAIN_SERVICE = "jimu-lca-mcp";
const KEYCHAIN_ACCOUNT = "member-key";

/**
 * Reject anything that isn't a credible memberKey. Catches the most common
 * footgun — passing the raw digits without the `app:` prefix (returns
 * "还未配置成员" from the upstream API, which historically looked like an
 * auth failure but was actually a malformed key).
 */
export function validateMemberKey(raw: string | undefined | null): string {
  if (!raw || raw.trim() === "") {
    throw new JimuLcaError(
      "auth",
      "memberKey missing — set JIMU_LCA_MEMBER_KEY env var, run `jimu-lca login`, or pass `X-Member-Key` header for HTTP transport.",
    );
  }
  const v = raw.trim();
  if (!MEMBER_KEY_RE.test(v)) {
    throw new JimuLcaError(
      "auth",
      `invalid memberKey format: expected '${"app:" + "<id>"}' (with the 'app:' prefix), got ${v.slice(0, 8)}... — the open platform's most common 401-looking error is actually a missing 'app:' prefix on a syntactically correct id.`,
    );
  }
  return v;
}

/**
 * Lazily try to read a stored memberKey from the OS keychain (macOS / Linux
 * libsecret / Windows credential store) via the optional `keytar` dep.
 *
 * Returns null if keytar isn't installed (it's optional) or if no entry has
 * been stored yet. Errors during keychain access bubble up so the user can
 * see them.
 */
export async function readKeychain(logger?: Logger): Promise<string | null> {
  try {
    const keytar = await import("keytar").catch(() => null);
    if (!keytar) {
      logger?.debug("keytar not installed — skipping keychain lookup");
      return null;
    }
    const stored = await keytar.default.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    return stored ?? null;
  } catch (err) {
    logger?.warn("keychain lookup failed", { error: String(err) });
    return null;
  }
}

/**
 * Store a memberKey in the OS keychain. Used by `jimu-lca login`.
 */
export async function writeKeychain(key: string): Promise<void> {
  const validated = validateMemberKey(key);
  const keytar = await import("keytar").catch(() => null);
  if (!keytar) {
    throw new JimuLcaError(
      "config",
      "keytar not installed — install the optional `keytar` dependency or set JIMU_LCA_MEMBER_KEY env var instead.",
    );
  }
  await keytar.default.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, validated);
}

/**
 * Build a {@link ToolContext} from process env. Used by the stdio MCP entry
 * and by the CLI. Reads JIMU_LCA_MEMBER_KEY first, falls back to keychain.
 */
export async function contextFromEnv(logger: Logger): Promise<ToolContext> {
  const fromEnv = process.env.JIMU_LCA_MEMBER_KEY;
  const fromKeychain = fromEnv ? null : await readKeychain(logger);
  const memberKey = validateMemberKey(fromEnv ?? fromKeychain);
  const baseUrl = resolveBaseUrl(
    process.env.JIMU_LCA_BASE_URL,
    process.env.JIMU_LCA_ENV,
  );
  return { memberKey, baseUrl, fetch: globalThis.fetch.bind(globalThis), logger };
}

/**
 * Build a {@link ToolContext} from an inbound HTTP request. Used by the
 * Cloudflare Worker entry.
 *
 * Header conventions supported (the Connector UI passes whichever it likes):
 *
 * - `X-Member-Key: app:xxxxx`
 * - `Authorization: Bearer app:xxxxx`
 */
export function contextFromRequest(
  req: Request,
  envOverrides: { baseUrl?: string; env?: string } = {},
  logger: Logger,
): ToolContext {
  const headerKey = req.headers.get("x-member-key");
  const authHeader = req.headers.get("authorization");
  const bearerKey = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const memberKey = validateMemberKey(headerKey ?? bearerKey ?? null);
  const baseUrl = resolveBaseUrl(envOverrides.baseUrl ?? null, envOverrides.env ?? null);
  return {
    memberKey,
    baseUrl,
    fetch: globalThis.fetch.bind(globalThis),
    logger,
  };
}

/** Re-exports for convenience. */
export { VERSION };
