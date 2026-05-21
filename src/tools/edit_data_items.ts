import { z } from "zod";
import type { ToolDef } from "../types.js";
import { post } from "../api.js";

const Edit = z.object({
  id: z.string().describe("Data-item id, from list_data_items."),
  val: z.number().describe("New numeric value."),
  unit_id: z.string().optional().describe("New unit id (from get_units). Omit to preserve."),
  source_id: z.string().optional().describe("New source enum id. Omit to preserve."),
});

const Args = z.object({
  edits: z.array(Edit).min(1).describe("Batch of partial edits."),
});

export const editDataItems: ToolDef<typeof Args, unknown> = {
  name: "edit_data_items",
  description:
    "Update one or more data items (values / units / source) in a case. " +
    "Pass an array of partial-update objects; `id` + `val` required, " +
    "`unit_id` and `source_id` optional. Skill rule: agent must surface a " +
    "diff summary and wait for user OK before calling — batch writes are " +
    "irreversible.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: true },
  async handler(args, ctx) {
    // Upstream takes a JSON ARRAY directly (not wrapped in an envelope).
    const payload = args.edits.map((e) => ({
      id: e.id,
      val: e.val,
      ...(e.unit_id !== undefined ? { unitId: e.unit_id } : {}),
      ...(e.source_id !== undefined ? { sourceId: e.source_id } : {}),
    }));
    return await post(ctx, "/lca/v3/editElements", payload);
  },
  cli: {
    summary: "Batch-edit data items in a case (json array of edits).",
  },
};
