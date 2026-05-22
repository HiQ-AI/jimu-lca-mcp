/**
 * Shared HTTP client for open.ecdigit.com. Wraps fetch with:
 *
 * - `appId` header injection
 * - response envelope unwrap (`{ success, code, message, data }` → either
 *   `data` or thrown {@link JimuLcaError})
 * - retry-friendly error classification (transport vs upstream-business)
 * - request logging at debug level
 */

import { JimuLcaError, type ToolContext } from "./types.js";
import { resolveManagerBaseUrl } from "./env.js";

interface OpenApiEnvelope<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  data: T;
  /** Pagination envelope siblings of `data` on some endpoints (e.g. getBrandPage). */
  page?: number;
  size?: number;
  total?: number;
  totalPageNum?: number;
}

/** Result of a paginated read. */
export interface Paginated<T> {
  rows: T[];
  page: number;
  size: number;
  total: number;
  totalPageNum: number;
}

const TIMEOUT_MS = 20_000;

async function call<T = unknown>(
  ctx: ToolContext,
  method: "GET" | "POST",
  path: string,
  init: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<OpenApiEnvelope<T>> {
  const url = new URL(ctx.baseUrl + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    appId: ctx.memberKey,
  };
  let bodyInit: BodyInit | undefined;
  if (init.body !== undefined) {
    bodyInit = JSON.stringify(init.body);
    headers["Content-Type"] = "application/json";
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  ctx.logger.debug("api request", { method, url: url.pathname + url.search });

  let resp: Response;
  try {
    resp = await ctx.fetch(url.toString(), {
      method,
      headers,
      body: bodyInit,
      signal: ac.signal,
    });
  } catch (err) {
    throw new JimuLcaError(
      "transport",
      `network error calling ${path}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new JimuLcaError(
      "transport",
      `HTTP ${resp.status} ${resp.statusText} calling ${path}`,
    );
  }

  const ct = resp.headers.get("content-type") ?? "";
  if (!ct.includes("json")) {
    // Binary endpoints (e.g. exportElementData) bypass this client; call
    // them via {@link callBinary} instead.
    throw new JimuLcaError(
      "transport",
      `expected JSON response from ${path}, got content-type=${ct}; use callBinary for file-returning endpoints.`,
    );
  }

  const envelope = (await resp.json()) as OpenApiEnvelope<T>;

  if (!envelope.success) {
    throw new JimuLcaError(
      "upstream",
      envelope.message || `upstream API returned success=false (code ${envelope.code})`,
      undefined,
      envelope.code,
    );
  }

  ctx.logger.debug("api response", {
    path,
    code: envelope.code,
    rows: Array.isArray(envelope.data) ? envelope.data.length : undefined,
  });

  return envelope;
}

/** GET wrapper. */
export async function get<T = unknown>(
  ctx: ToolContext,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const env = await call<T>(ctx, "GET", path, { query });
  return env.data;
}

/** POST wrapper. */
export async function post<T = unknown>(
  ctx: ToolContext,
  path: string,
  body?: unknown,
): Promise<T> {
  const env = await call<T>(ctx, "POST", path, { body });
  return env.data;
}

/**
 * POST wrapper for endpoints that read their inputs from the **query string**
 * rather than a JSON body (e.g. `copyCase` — body `{caseId}` yields
 * "caseId不能为空", `?caseId=…` works).
 */
export async function postQuery<T = unknown>(
  ctx: ToolContext,
  path: string,
  query: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const env = await call<T>(ctx, "POST", path, { query });
  return env.data;
}

/**
 * POST wrapper that also returns the pagination envelope siblings — needed
 * for endpoints like `getBrandPage` where pagination fields sit at the top
 * level of the response, not nested in `data`.
 */
export async function postPaginated<T = unknown>(
  ctx: ToolContext,
  path: string,
  body?: unknown,
): Promise<Paginated<T>> {
  const env = await call<T[]>(ctx, "POST", path, { body });
  return {
    rows: env.data ?? [],
    page: env.page ?? 1,
    size: env.size ?? 0,
    total: env.total ?? (env.data?.length ?? 0),
    totalPageNum: env.totalPageNum ?? 1,
  };
}

// ─── Internal manager API (custom products + structure editing) ──────────
//
// These live on a different host (cloud.ecdigit.*/ecdigit/api) behind a Bearer
// JWT minted from the memberKey, NOT the open API's appId header. The MCP layer
// hides this entirely: the caller still only supplies a memberKey.

interface CachedToken {
  bearer: string;
  expMs: number;
}
const _tokenCache = new Map<string, CachedToken>();

/** Mint (and cache) a Bearer JWT from the memberKey via the open API's
 *  `/open/memberToken/get`. The token embeds an `exp`; we decode it to cache
 *  until ~1 min before expiry, re-minting as needed. */
export async function getMemberToken(ctx: ToolContext): Promise<string> {
  const cached = _tokenCache.get(ctx.memberKey);
  if (cached && cached.expMs - 60_000 > Date.now()) return cached.bearer;

  const resp = await ctx.fetch(`${ctx.baseUrl}/open/memberToken/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberKey: ctx.memberKey }),
  });
  if (!resp.ok) {
    throw new JimuLcaError("transport", `HTTP ${resp.status} minting member token`);
  }
  const env = (await resp.json()) as OpenApiEnvelope<string>;
  if (!env.success || typeof env.data !== "string" || !env.data.startsWith("Bearer")) {
    throw new JimuLcaError("auth", env.message || "could not mint member token from memberKey", undefined, env.code);
  }
  const bearer = env.data;
  // Decode the JWT exp (seconds) to set cache TTL; fall back to 30 min.
  let expMs = Date.now() + 30 * 60_000;
  try {
    const payload = JSON.parse(Buffer.from(bearer.split(".")[1]!, "base64").toString());
    if (payload.exp) expMs = payload.exp * 1000;
  } catch {
    /* keep fallback */
  }
  _tokenCache.set(ctx.memberKey, { bearer, expMs });
  return bearer;
}

/** POST to the internal manager API with a minted Bearer JWT. Used for custom
 *  products + structure editing, which the open API does not expose. */
export async function callManager<T = unknown>(
  ctx: ToolContext,
  path: string,
  body: unknown,
): Promise<T> {
  const bearer = await getMemberToken(ctx);
  const base = resolveManagerBaseUrl(ctx.baseUrl);
  const resp = await ctx.fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: bearer,
      Origin: base.replace(/\/ecdigit\/api$/, ""),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new JimuLcaError("transport", `HTTP ${resp.status} ${resp.statusText} calling manager ${path}`);
  }
  const env = (await resp.json()) as OpenApiEnvelope<T>;
  if (!env.success) {
    throw new JimuLcaError("upstream", env.message || `manager API returned success=false (code ${env.code})`, undefined, env.code);
  }
  return env.data;
}

/**
 * Binary response wrapper (e.g. `exportElementData` returns Excel). Returns
 * the raw `Response` so the caller can stream / save to disk as needed.
 */
export async function callBinary(
  ctx: ToolContext,
  method: "GET" | "POST",
  path: string,
  init: { query?: Record<string, string | number | boolean | undefined>; body?: unknown } = {},
): Promise<Response> {
  const url = new URL(ctx.baseUrl + path);
  if (init.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { appId: ctx.memberKey };
  let bodyInit: BodyInit | undefined;
  if (init.body !== undefined) {
    bodyInit = JSON.stringify(init.body);
    headers["Content-Type"] = "application/json";
  }
  const resp = await ctx.fetch(url.toString(), { method, headers, body: bodyInit });
  if (!resp.ok) {
    throw new JimuLcaError(
      "transport",
      `HTTP ${resp.status} ${resp.statusText} calling ${path}`,
    );
  }
  return resp;
}
