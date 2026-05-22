import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManagerGet, getUserUuid } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id whose calculation status to check."),
});

interface InboxMsg {
  content?: string;
  sendType?: string;
  billId?: string;
  createTime?: string;
}

/** Map a calc-task inbox message to a coarse status. */
function classify(content: string): "done" | "failed" | "running" | "queued" | "unknown" {
  if (content.includes("计算完成") || content.includes("计算成功")) return "done";
  if (content.includes("计算失败")) return "failed";
  if (content.includes("正在计算")) return "running";
  if (content.includes("队列")) return "queued";
  return "unknown";
}

export const getCalcStatus: ToolDef<typeof Args, unknown> = {
  name: "get_calc_status",
  description:
    "Check a case's async calculation status WITHOUT polling co2Content for " +
    "minutes. Reads the platform's task message inbox (manager API) and returns " +
    "the latest calc signal for this case: status (done / failed / running / " +
    "queued), the message, and timestamp. Use this after calculate_case instead " +
    "of repeatedly reading list_products — a 'failed' here means the calc errored " +
    "(often a method_id from the wrong background version, or a model issue) even " +
    "if validation looked clean; 'done' means read the result via get_product_lcia.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const uuid = await getUserUuid(ctx);
    const msgs = await callManagerGet<InboxMsg[] | { list?: InboxMsg[]; records?: InboxMsg[] }>(
      ctx,
      `/message/messages/${uuid}`,
      { page: 1, size: 20, readType: 0 },
    );
    const list: InboxMsg[] = Array.isArray(msgs)
      ? msgs
      : (msgs?.list ?? msgs?.records ?? []);
    // billId is "<brandId>-<caseId>"; match the case.
    const mine = list
      .filter((m) => (m.billId ?? "").includes(args.case_id) || (m.content ?? "").includes(args.case_id))
      .sort((a, b) => String(b.createTime ?? "").localeCompare(String(a.createTime ?? "")));
    const latest = mine[0];
    if (!latest) {
      return { status: "unknown", message: "no calc-task message found for this case yet", case_id: args.case_id };
    }
    const status = classify(latest.content ?? "");
    return {
      status,
      message: latest.content ?? "",
      at: latest.createTime ?? null,
      note:
        status === "failed"
          ? "Calc FAILED. Common cause: method_id not from list_calculation_methods for THIS case's version (accepted at submit, fails async). Re-check the method, then recalculate."
          : status === "done"
            ? "Calc done — read the number via get_product_lcia / get_result."
            : "Calc not finished; check again shortly.",
    };
  },
  cli: { summary: "Check a case's async calculation status (done/failed/running)." },
};
