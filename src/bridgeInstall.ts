import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { JimuLcaError } from "./types.js";

// Reuse the published bridge bytes formerly consumed by Cortex Desktop.
export const BRIDGE_RELEASE = "v0.2.0";
const BRIDGE_SHA256 = "7ffe3c0b68018322c02b4d7bd46cdf04ecdc188eec1ae22a2bd996075bf32bb6";
const BRIDGE_URL = `https://download.hiq.earth/resources/jimu-lca/${BRIDGE_RELEASE}/bridge.db.gz`;
export const DEFAULT_BRIDGE_DB = join(homedir(), ".jimu-lca", BRIDGE_RELEASE, "bridge.db");

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function installBridge(): Promise<{ path: string; release: string; sha256: string }> {
  const receipt = { path: DEFAULT_BRIDGE_DB, release: BRIDGE_RELEASE, sha256: BRIDGE_SHA256 };
  try {
    if (await sha256(DEFAULT_BRIDGE_DB) === BRIDGE_SHA256) return receipt;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  await mkdir(dirname(DEFAULT_BRIDGE_DB), { recursive: true });
  const temporary = await mkdtemp(join(dirname(DEFAULT_BRIDGE_DB), ".install-"));
  try {
    const response = await fetch(BRIDGE_URL, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok || !response.body) {
      throw new JimuLcaError("transport", `bridge download failed: HTTP ${response.status}`);
    }
    const path = join(temporary, "bridge.db");
    await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), createGunzip(), createWriteStream(path));
    if (await sha256(path) !== BRIDGE_SHA256) {
      throw new JimuLcaError("config", "bridge checksum mismatch; existing installation was not replaced");
    }
    await rename(path, DEFAULT_BRIDGE_DB);
    return receipt;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
