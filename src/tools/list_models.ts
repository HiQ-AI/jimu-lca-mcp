import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  name: z
    .string()
    .optional()
    .describe("Optional fuzzy filter on model name. Recommended on the smoked tenant: 500+ models exist; without a filter the LLM sees a summary-only view (see `summarize`)."),
  flag: z
    .enum(["own", "EC"])
    .optional()
    .describe(
      "own = tenant-authored; EC = 易碳 platform-shipped. Omit to include both.",
    ),
  summarize: z
    .boolean()
    .default(true)
    .describe(
      "When true (default) AND no `name` filter, return a summary view: " +
      "first 20 rows + counts grouped by industryName / categoryName / " +
      "modelFlag. Pass false to force the full catalog (warning: hundreds " +
      "of rows; bloats prompt).",
    ),
});

interface Model {
  id: string;
  uuid: string;
  name: string;
  categoryName: string;
  industryName: string;
  boundaryName: string;
  unitName: string;
  industryId: string;
  categoryId: string;
  modelFlag: "own" | "EC" | string;
  [k: string]: unknown;
}

interface ModelListResult {
  total: number;
  rows: Model[];
  summary?: {
    by_industry: Record<string, number>;
    by_category: Record<string, number>;
    by_flag: Record<string, number>;
    note: string;
  };
}

export const listModels: ToolDef<typeof Args, ModelListResult> = {
  name: "list_models",
  description:
    "List LCA process model templates the tenant can use as starting points " +
    "for create_product. With no filter, returns a summary view (counts + " +
    "first 20 rows) because the catalog can run to hundreds of models. Pass " +
    "`name` for a focused search.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const all = await get<Model[]>(ctx, "/lca/v3/getModelList", { name: args.name });
    const filtered = args.flag ? all.filter((m) => m.modelFlag === args.flag) : all;
    if (args.name || !args.summarize || filtered.length <= 20) {
      return { total: filtered.length, rows: filtered };
    }
    const tally = (k: keyof Model) => {
      const o: Record<string, number> = {};
      for (const m of filtered) {
        const v = String(m[k] ?? "(unspecified)");
        o[v] = (o[v] ?? 0) + 1;
      }
      return o;
    };
    return {
      total: filtered.length,
      rows: filtered.slice(0, 20),
      summary: {
        by_industry: tally("industryName"),
        by_category: tally("categoryName"),
        by_flag: tally("modelFlag"),
        note: `Showing 20 of ${filtered.length}. Pass \`name\` to narrow, or summarize=false for full list.`,
      },
    };
  },
  cli: {
    summary: "List model templates (summary by default).",
    renderHuman: (r) => {
      const lines = [`total: ${r.total}, showing ${r.rows.length}`];
      for (const m of r.rows) lines.push(`  [${m.id}] ${m.name} — ${m.industryName} / ${m.categoryName} (${m.modelFlag})`);
      if (r.summary) lines.push(`\n${r.summary.note}`);
      return lines.join("\n");
    },
  },
};
