import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Element = z.object({
  element_id: z.string().describe("Flow/element id to add (the substance/material/energy flow)."),
  element_name: z.string().describe("Element display name."),
  category_id: z.string().describe("Element category id (材料 / 能源 / 排放 / 产品 …)."),
  unit_id: z.string().describe("Unit id (get_units)."),
  val: z.union([z.number(), z.string()]).default(0).describe("Initial value (often 0; set real values later with edit_data_items)."),
});

const Args = z.object({
  process_id: z.string().describe("Process id (from add_case_process)."),
  elements: z.array(Element).min(1).describe("Data items (flows) to add to the process."),
});

export const addDataItems: ToolDef<typeof Args, unknown> = {
  name: "add_data_items",
  description:
    "Add data items (flows: inputs / outputs / emissions) to a process of a " +
    "CUSTOM product. Internal manager API (Bearer JWT from the memberKey). " +
    "Distinct from edit_data_items, which only changes VALUES of existing rows " +
    "(open API) — this ADDS new rows to a custom-built process. After adding, " +
    "set real quantities with edit_data_items, then completeness_check + " +
    "calculate_case. Note: discovering the right `element_id` for a flow needs " +
    "the platform's flow search (not yet wrapped) — supply known element ids.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    return await callManager(ctx, "/managerPro/brand/addBatchElement", {
      processId: args.process_id,
      dataList: args.elements.map((e) => ({
        categoryId: e.category_id,
        elementId: e.element_id,
        unitId: e.unit_id,
        val: String(e.val),
        elementName: e.element_name,
      })),
    });
  },
  cli: { summary: "Add data items to a process (custom product)." },
};
