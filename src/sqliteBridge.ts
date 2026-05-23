/**
 * Local SQLite {@link BridgeLookup} for the stdio / CLI transport.
 *
 * The Worker backs the bridge with Cloudflare D1 ({@link d1Bridge}); a local
 * subprocess has no D1, so it reads the same data from a bundled SQLite file.
 * `node:sqlite` is built into Node 22.5+ (no native addon, no electron-rebuild),
 * so this ships clean under Electron-as-node.
 *
 * ⚠️ Imported ONLY by the stdio entry (server.ts / cli.ts), never by worker.ts —
 * keep `node:sqlite` out of the Cloudflare Worker bundle.
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Logger } from "./types.js";
import { type BridgeLookup, type BridgeRow, systemModelKey } from "./bridge.js";

// Same projection d1Bridge selects, so both backings return identical rows.
const SELECT_COLUMNS =
  "orig_uuid, system_model, background_data_id, bind_uuid, name_cn, name_en, location, unit";
const PARAM_CHUNK = 80;

/** SQLite-file-backed {@link BridgeLookup}. Opens read-only; queries on demand
 *  (never loads the whole table into memory). */
export function sqliteBridge(dbPath: string): BridgeLookup {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  return {
    async resolve(versionKeyValue, systemModel, origUuids) {
      if (origUuids.length === 0) return [];
      const smKey = systemModelKey(systemModel);
      const out: BridgeRow[] = [];
      for (let i = 0; i < origUuids.length; i += PARAM_CHUNK) {
        const slice = origUuids.slice(i, i + PARAM_CHUNK);
        const placeholders = slice.map(() => "?").join(",");
        const stmt = db.prepare(
          `SELECT ${SELECT_COLUMNS} FROM bridge ` +
            `WHERE version_key = ? AND system_model_key = ? AND orig_uuid IN (${placeholders})`,
        );
        out.push(...(stmt.all(versionKeyValue, smKey, ...slice) as unknown as BridgeRow[]));
      }
      return out;
    },
  };
}

/**
 * Resolve the local bridge DB and open it. Path priority:
 *   1. `JIMU_LCA_BRIDGE_DB` env (explicit / dev override)
 *   2. bundled `<pkg>/data/bridge.db` (dist/../data/bridge.db)
 * Returns undefined when no DB is present — the bridge then stays unavailable
 * and callers fall back exactly as before (no regression for hosts without it).
 */
export function openLocalBridge(logger?: Logger): BridgeLookup | undefined {
  const candidates = [
    process.env.JIMU_LCA_BRIDGE_DB,
    fileURLToPath(new URL("../data/bridge.db", import.meta.url)),
  ].filter((p): p is string => Boolean(p));

  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const bridge = sqliteBridge(path);
        logger?.info("local bridge opened", { path });
        return bridge;
      } catch (err) {
        logger?.error("local bridge open failed", {
          path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  logger?.info("local bridge unavailable — no bridge DB found", { tried: candidates });
  return undefined;
}
