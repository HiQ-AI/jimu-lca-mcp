import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("Case id."),
});

interface Stage { id: string; name?: string; cnName?: string }
interface Process { id: string; name?: string }
interface Element {
  id: string; elementId: string; elementName: string;
  categoryName: string; inOutType: string; val: string;
  unitName: string; sourceName?: string;
}

/** Walk the whole case (stages → processes → data items) in one tool call, so
 *  the agent doesn't fan out list_data_items per process. Feeds completeness_check
 *  and the per-line provenance view directly. */
export const getModelItems: ToolDef<typeof Args, unknown> = {
  name: "get_model_items",
  description:
    "Return EVERY data item of a case across all stages/processes in one call " +
    "(stage, process, category, name, in/out, value, unit, data source). Use " +
    "instead of walking get_case_overview + list_data_items per process — feeds " +
    "completeness_check and lets you see the whole model + each item's data " +
    "source (现场/文献/缺省) for a provenance review at a glance.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const stages = await get<Stage[]>(ctx, "/lca/v3/getCaseStage", { caseId: args.case_id });
    const items: Array<Record<string, unknown>> = [];
    for (const st of stages ?? []) {
      const procs = await get<Process[]>(ctx, "/lca/v3/getProcessList", { stageId: st.id });
      for (const p of procs ?? []) {
        const els = await get<Element[]>(ctx, "/lca/v3/getElementList", { processId: p.id });
        for (const e of els ?? []) {
          items.push({
            stage: st.cnName ?? st.name ?? st.id,
            stage_id: st.id,
            process: p.name ?? p.id,
            process_id: p.id,
            element_id: e.elementId,
            data_id: e.id,
            category: e.categoryName,
            name: e.elementName,
            in_out: e.inOutType,
            value: e.val,
            unit: e.unitName,
            source: e.sourceName ?? "",
          });
        }
      }
    }
    const bySource = items.reduce<Record<string, number>>((acc, it) => {
      const s = (it.source as string) || "(none)";
      acc[s] = (acc[s] ?? 0) + 1;
      return acc;
    }, {});
    return { count: items.length, by_source: bySource, items };
  },
  cli: { summary: "List every data item of a case (all processes) in one call." },
};
