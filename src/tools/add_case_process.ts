import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id (from add_case / get_case_overview)."),
  stage_id: z.string().describe("Stage id within the case (from add_case's result / get_case_overview)."),
  name: z.string().describe("Process name (工序名称)."),
  category_id: z.string().describe("Process category id."),
  industry_id: z.string().describe("Process industry id."),
});

export const addCaseProcess: ToolDef<typeof Args, unknown> = {
  name: "add_case_process",
  description:
    "Add a process (工序) to a stage of a CUSTOM product's case. Internal " +
    "manager API (Bearer JWT from the memberKey). Use after add_case; then add " +
    "data items with add_data_items. Returns the new process id needed by " +
    "add_data_items.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    return await callManager(ctx, "/managerPro/brand/addCaseProcess", {
      name: args.name,
      categoryId: args.category_id,
      industryId: args.industry_id,
      icoPath: "",
      stageId: args.stage_id,
      caseId: args.case_id,
    });
  },
  cli: { summary: "Add a process to a stage (custom product)." },
};
