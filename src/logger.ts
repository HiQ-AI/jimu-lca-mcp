/**
 * stderr logger. Stdio MCP requires stdout to carry ONLY the MCP wire protocol,
 * so all logging must go to stderr. The CLI uses the same logger; the Worker
 * uses `console.*` (Cloudflare Logs).
 */
import type { Logger } from "./types.js";

const DEBUG = (process.env.JIMU_LCA_DEBUG ?? "").toLowerCase() in { "1": 1, "true": 1, "yes": 1 };

function fmt(level: string, msg: string, fields?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const tail = fields && Object.keys(fields).length > 0 ? " " + JSON.stringify(fields) : "";
  return `[${ts}] ${level} ${msg}${tail}`;
}

export const stderrLogger: Logger = {
  debug(msg, fields) {
    if (DEBUG) process.stderr.write(fmt("DEBUG", msg, fields) + "\n");
  },
  info(msg, fields) {
    process.stderr.write(fmt("INFO ", msg, fields) + "\n");
  },
  warn(msg, fields) {
    process.stderr.write(fmt("WARN ", msg, fields) + "\n");
  },
  error(msg, fields) {
    process.stderr.write(fmt("ERROR", msg, fields) + "\n");
  },
};

export const consoleLogger: Logger = {
  debug(msg, fields) { if (DEBUG) console.debug(msg, fields ?? {}); },
  info(msg, fields) { console.info(msg, fields ?? {}); },
  warn(msg, fields) { console.warn(msg, fields ?? {}); },
  error(msg, fields) { console.error(msg, fields ?? {}); },
};
