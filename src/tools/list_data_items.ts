import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  process_id: z
    .string()
    .describe("Process id, from get_case_overview (stages[].processes[].id)."),
});

interface DataItem {
  id: string;
  caseId: string;
  processId: string;
  elementId: string;
  categoryId: string;
  categoryName?: string;
  val: string;
  unitId: string;
  unitName: string;
  unitGroup?: string;
  sourceId?: string;
  sourceName?: string;
  inOutType?: "INPUT" | "OUTPUT" | string;
  elementName: string;
}

export const listDataItems: ToolDef<typeof Args, DataItem[]> = {
  name: "list_data_items",
  description:
    "List all data items (exchanges = inputs / outputs / emissions) attached " +
    "to a process. Each row has the current value (val), unit, source " +
    "(measured / literature / etc.), and the data-item `id` needed by " +
    "edit_data_items. Call after get_case_overview when you need to see or " +
    "edit specific values inside a process — the overview's data_items has " +
    "backing counts only, not the values.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await get<DataItem[]>(ctx, "/lca/v3/getElementList", {
      processId: args.process_id,
    });
  },
  cli: {
    summary: "List data items inside a process.",
    renderHuman: (rows) =>
      rows
        .map(
          (r) =>
            `[${r.id}] ${r.inOutType ?? "?"} ${r.elementName.padEnd(20).slice(0, 20)}  ${r.val.padStart(20)} ${r.unitName} (${r.categoryName ?? "?"})`,
        )
        .join("\n"),
  },
};
