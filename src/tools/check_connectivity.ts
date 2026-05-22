import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get, callManagerGet } from "../api.js";

const Args = z.object({});

/** Probe both API surfaces so failures are loud and attributable, rather than
 *  surfacing mid-workflow as a mysterious 4xx. The manager API is undocumented
 *  and has no SLA — if it changes (auth/CORS/paths), authoring breaks while the
 *  query path (open API) keeps working; this canary tells them apart. */
export const checkConnectivity: ToolDef<typeof Args, unknown> = {
  name: "check_connectivity",
  description:
    "Health-check both 积木 API surfaces with the configured memberKey: the open " +
    "API (query path) and the internal manager API (authoring path — custom " +
    "products, background binding, validation). Run this first if anything fails " +
    "unexpectedly. manager_api:false means the authoring tools (create_blank_product, " +
    "import_model, match_backgrounds, validate_case, calculate_case's pre-checks) " +
    "won't work — the undocumented manager API or the memberKey→JWT mint is down.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(_args, ctx) {
    const open = await probe(() => get(ctx, "/lca/v3/getAllUnits", {}));
    const manager = await probe(() =>
      callManagerGet(ctx, "/managerPro/dataConfiguration/getMaterialUnits", {}),
    );
    const ok = open.ok && manager.ok;
    return {
      open_api: open.ok,
      manager_api: manager.ok,
      ok,
      open_error: open.error,
      manager_error: manager.error,
      note: ok
        ? "Both surfaces reachable."
        : !manager.ok
          ? "manager_api unavailable — authoring tools will fail. The internal manager API (undocumented, no SLA) or the memberKey→JWT mint may have changed. Query-only tools may still work."
          : "open_api unavailable — check the memberKey and network.",
    };
  },
  cli: { summary: "Health-check the open + manager API surfaces." },
};

async function probe(fn: () => Promise<unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
