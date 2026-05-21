/**
 * 🧩 Aggregator — collapses 5 upstream calls into one merged response:
 *
 * 1. getCaseDetail(id=case_id) — case metadata
 * 2. getCaseStage(caseId)       — list of stages
 * 3. getProcessList(stageId)    — N calls, one per stage
 * 4. getDataConfigurationList(caseId, stageId, page=1, size=200)
 *                                — N calls, one per stage (summary view)
 * 5. getCaseDisposals(caseId)   — product+disposal tree, grouped by stage
 *
 * Returns a stage-rooted nested structure so LLMs can answer scoped
 * questions ("what's in the 原材料 stage?") by looking at one node.
 */
import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get, post } from "../api.js";

const Args = z.object({
  case_id: z.string().describe("LCA case id, from get_product (lcaBrandCases[].id)."),
});

interface CaseDetail {
  id: string;
  uuid: string;
  brandId: string;
  reportDate: string;
  boundaryId: string;
  boundaryName: string;
  unitId: string;
  unitName: string;
  unitComment: string;
  consultProductName: string;
  consultProductCoefficient: string;
  status: string;
  statusName: string;
  description: string;
  versionId: string;
  versionName: string;
  [k: string]: unknown;
}

interface Stage {
  id: string;
  uuid: string;
  name: string;
  caseId: string;
  orderId: number;
  key?: string;
}

interface Process {
  id: string;
  uuid: string;
  name: string;
  caseId: string;
  stageId: string;
  categoryId: string;
  categoryName: string;
  orderId: number;
}

interface DataItemSummary {
  stageId: string;
  elementName: string;
  elementId: string;
  categoryIds: string;
  categoryName: string;
  ids: string;
  backgroundData: number;
  transportData: number;
  materialData: number;
  lciData: number;
  specialData: number;
}

interface DisposalChild {
  id: string;
  name: string;
  categoryIds: string;
  categoryName: string;
  processId: string;
  processName: string;
  processCategoryId: string;
  processCategoryName: string;
  unitId: string;
  unitName: string;
  unitGroup: string;
  stageId: string;
  stageName: string;
  processOrderId: number;
}

interface DisposalStage {
  id: string;
  name: string;
  caseId: string;
  orderId: number;
  children: DisposalChild[];
}

interface CaseOverview {
  case: {
    id: string;
    name: string;
    brand_id: string;
    status: string;
    boundary: string;
    version: { id: string; name: string };
    declared_unit: { id: string; name: string; comment: string };
    report_date: string;
    description: string;
  };
  stages: Array<{
    id: string;
    name: string;
    order_id: number;
    processes: Array<{
      id: string;
      name: string;
      category: string;
      order_id: number;
    }>;
    products_and_disposals: Array<{
      id: string;
      name: string;
      category: string;
      process_id: string;
      process_name: string;
      unit: string;
    }>;
    data_items: {
      total_loaded: number;
      rows: Array<{
        id: string;
        name: string;
        category: string;
        backing_counts: {
          background: number;
          transport: number;
          material: number;
          lci: number;
          special: number;
        };
      }>;
      note_if_truncated: string | null;
    };
  }>;
}

const DATA_ITEMS_PAGE_SIZE = 200;

export const getCaseOverview: ToolDef<typeof Args, CaseOverview> = {
  name: "get_case_overview",
  description:
    "Get a full overview of one LCA case in one call: case metadata + " +
    "life-cycle stages + processes per stage + products/disposals per stage + " +
    "data-item summary per stage (with backing counts showing what's filled). " +
    "This is an N+3 upstream-call aggregator; use it whenever you want the " +
    "agent to 'look at' a case before deciding what to do next.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const { case_id } = args;

    // Fan out the case-detail + stage-list + disposal-tree calls in parallel.
    const [detailRes, stagesRes, disposalsRes] = await Promise.all([
      get<CaseDetail>(ctx, "/lca/v3/getCaseDetail", { id: case_id }),
      get<Stage[]>(ctx, "/lca/v3/getCaseStage", { caseId: case_id }),
      get<DisposalStage[]>(ctx, "/lca/v3/getCaseDisposals", { caseId: case_id }),
    ]);

    // For each stage, fetch processes + data-items in parallel.
    const perStage = await Promise.all(
      stagesRes.map(async (stage) => {
        const [procs, items] = await Promise.all([
          get<Process[]>(ctx, "/lca/v3/getProcessList", { stageId: stage.id }),
          post<DataItemSummary[]>(ctx, "/lca/v3/getDataConfigurationList", {
            caseId: case_id,
            stageId: stage.id,
            page: 1,
            size: DATA_ITEMS_PAGE_SIZE,
          }),
        ]);
        return { stage, procs, items };
      }),
    );

    const disposalByStage = new Map<string, DisposalChild[]>(
      disposalsRes.map((d) => [d.id, d.children ?? []]),
    );

    return {
      case: {
        id: detailRes.id,
        name: "", // Filled by caller when wrapped in get_product_lcia; this endpoint doesn't return it.
        brand_id: detailRes.brandId,
        status: detailRes.statusName,
        boundary: detailRes.boundaryName,
        version: { id: detailRes.versionId, name: detailRes.versionName },
        declared_unit: {
          id: detailRes.unitId,
          name: detailRes.unitName,
          comment: detailRes.unitComment,
        },
        report_date: detailRes.reportDate,
        description: detailRes.description,
      },
      stages: perStage
        .sort((a, b) => a.stage.orderId - b.stage.orderId)
        .map(({ stage, procs, items }) => ({
          id: stage.id,
          name: stage.name,
          order_id: stage.orderId,
          processes: procs
            .sort((a, b) => a.orderId - b.orderId)
            .map((p) => ({
              id: p.id,
              name: p.name,
              category: p.categoryName,
              order_id: p.orderId,
            })),
          products_and_disposals: (disposalByStage.get(stage.id) ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            category: c.categoryName,
            process_id: c.processId,
            process_name: c.processName,
            unit: c.unitName,
          })),
          data_items: {
            total_loaded: items.length,
            rows: items.map((r) => ({
              id: r.ids,
              name: r.elementName,
              category: r.categoryName,
              backing_counts: {
                background: r.backgroundData,
                transport: r.transportData,
                material: r.materialData,
                lci: r.lciData,
                special: r.specialData,
              },
            })),
            note_if_truncated:
              items.length >= DATA_ITEMS_PAGE_SIZE
                ? `${DATA_ITEMS_PAGE_SIZE}+ rows; fetch deeper via list_data_items per process.`
                : null,
          },
        })),
    };
  },
  cli: {
    summary: "Aggregated overview of one LCA case.",
    renderHuman: (o) =>
      [
        `case ${o.case.id}  status=${o.case.status}  ${o.case.boundary}`,
        `  version: ${o.case.version.name}  unit: ${o.case.declared_unit.name} (${o.case.declared_unit.comment})`,
        `  stages: ${o.stages.length}`,
        ...o.stages.flatMap((s) => [
          `  ▸ [${s.id}] ${s.name} (${s.processes.length} procs, ${s.products_and_disposals.length} products+disposals, ${s.data_items.total_loaded} data items)`,
          ...s.processes.map((p) => `      proc: ${p.name} (${p.category})`),
          ...s.products_and_disposals.map((d) => `      ${d.category}: ${d.name}`),
        ]),
      ].join("\n"),
  },
};
