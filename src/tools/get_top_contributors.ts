/**
 * 🎯 Convenience aggregator. Story 5 collapsed: "what's driving the GWP
 * of product X" goes from 10 raw calls to one tool. Internally reuses the
 * get_product_lcia chain to find the case + the indicator, then runs the
 * sensitivity drill.
 */
import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { get, post, postPaginated } from "../api.js";

const Args = z.object({
  product: z
    .string()
    .describe(
      "Product name (fuzzy) or brandId. Auto-detected: /^\\d+$/ → brandId, else name.",
    ),
  indicator: z
    .string()
    .default("GWP")
    .describe(
      "Impact-factor name fragment. The first matching factor on the case's first calc method is used. Default 'GWP' (global warming potential).",
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.05)
    .describe(
      "0-1 filter: only contributors with share >= threshold are returned. Default 0.05 (5%).",
    ),
  case_index: z.number().int().min(0).default(0).describe("Which case if multiple."),
  target_product: z.string().optional().describe("Which target product if multiple."),
});

interface BrandRow {
  id: string;
  name: string;
}
interface LcaCase {
  id: string;
  versionId: string;
  versionName: string;
  statusName: string;
}
interface ProductInfo {
  id: string;
  name: string;
  lcaBrandCases: LcaCase[];
}
interface BgVersion {
  id: string;
  version: string;
}
interface InnerCalcRecord {
  id: string;
  targetProduct: string;
}
interface MethodBucket {
  name: string;
  calculationMethods: InnerCalcRecord[];
}
interface LciaRow {
  influenceFactorId: string;
  influenceFactorName: string;
  influenceFactorNameEn?: string;
  influenceFactorUnit: string;
  productName: string;
  summary: string;
  stageName: string;
}
interface SensitivityRow {
  elementId: string;
  name: string;
  val: string;
}

interface TopContributorsResult {
  product: { id: string; name: string };
  case: { id: string; status: string; method: string; version: string };
  indicator: { id: string; name: string; unit: string; case_total: string };
  target_product: string;
  threshold: number;
  rows: Array<{ element_id: string; name: string; share: number; share_pct: string }>;
  covered_share_pct: string;
  unaccounted_share_pct: string;
}

export const getTopContributors: ToolDef<typeof Args, TopContributorsResult> = {
  name: "get_top_contributors",
  description:
    "Convenience aggregator: 'what's driving the GWP of product X'. Goes " +
    "from product name to a sorted sensitivity ranking in one call. " +
    "Picks the case's first calc method, finds the requested impact " +
    "factor (default GWP), then runs the per-data-item sensitivity drill. " +
    "Returns covered_share and unaccounted_share so the caller knows if " +
    "the threshold trimmed away meaningful contributions.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    // Step 1: Resolve brand
    const looksLikeId = /^\d+$/.test(args.product);
    let brandId: string;
    if (looksLikeId) {
      brandId = args.product;
    } else {
      const products = await postPaginated<BrandRow>(ctx, "/lca/v3/getBrandPage", {
        name: args.product,
        page: 1,
        size: 1,
      });
      if (products.rows.length === 0) {
        throw new JimuLcaError("validation", `no product matching '${args.product}'.`);
      }
      brandId = products.rows[0]!.id;
    }
    // Step 2: Get product → cases
    const info = await get<ProductInfo>(ctx, "/lca/v3/getBrandInfo", { brandId });
    if (info.lcaBrandCases.length === 0) {
      throw new JimuLcaError("validation", `product '${info.name}' has no LCA cases.`);
    }
    const lcaCase = info.lcaBrandCases[args.case_index]!;
    // Step 3: discover calc record
    let calcRecord: InnerCalcRecord | null = null;
    let methodName: string | null = null;
    let versionUsed: string | null = null;
    let buckets = await get<MethodBucket[]>(ctx, "/lca/v3/getCaseCalculationMethods", {
      caseId: lcaCase.id,
      versionId: lcaCase.versionId,
    });
    if (buckets.length === 0) {
      const versions = await get<BgVersion[]>(ctx, "/lca/v3/getAllocationVersions");
      for (const v of versions) {
        if (v.id === lcaCase.versionId) continue;
        const probe = await get<MethodBucket[]>(ctx, "/lca/v3/getCaseCalculationMethods", {
          caseId: lcaCase.id,
          versionId: v.id,
        });
        if (probe.length > 0) {
          buckets = probe;
          versionUsed = v.version;
          break;
        }
      }
    } else {
      versionUsed = lcaCase.versionName;
    }
    if (buckets.length === 0) {
      throw new JimuLcaError(
        "validation",
        `case ${lcaCase.id} (${lcaCase.statusName}) has no calculation results yet.`,
      );
    }
    calcRecord = buckets[0]!.calculationMethods[0] ?? null;
    methodName = buckets[0]!.name;
    if (!calcRecord) {
      throw new JimuLcaError("validation", `method bucket has no calc records.`);
    }
    const targetProduct = args.target_product ?? calcRecord.targetProduct;

    // Step 4: LCIA → find indicator
    const lciaRows = await post<LciaRow[]>(ctx, "/lca/v3/getCaseLciaDetails", {
      caseId: lcaCase.id,
      id: calcRecord.id,
      targetProduct,
    });
    const indQ = args.indicator.toLowerCase();
    const indicatorRow = lciaRows.find(
      (r) =>
        r.influenceFactorName.toLowerCase().includes(indQ) ||
        (r.influenceFactorNameEn?.toLowerCase().includes(indQ) ?? false),
    );
    if (!indicatorRow) {
      throw new JimuLcaError(
        "validation",
        `no impact factor matching '${args.indicator}'. Available: ${[...new Set(lciaRows.map((r) => r.influenceFactorName))].slice(0, 10).join(", ")}...`,
      );
    }
    // Sum the indicator across stages for the case_total
    const caseTotal = lciaRows
      .filter((r) => r.influenceFactorId === indicatorRow.influenceFactorId)
      .reduce((s, r) => s + Number(r.summary), 0);

    // Step 5: sensitivity
    const sensRows = await post<SensitivityRow[]>(ctx, "/lca/v3/getCaseSensitive", {
      caseCalMethodId: calcRecord.id,
      impactFactorId: indicatorRow.influenceFactorId,
      productElementId: targetProduct,
      basicLine: args.threshold,
    });
    const covered = sensRows.reduce((s, r) => s + Number(r.val), 0);

    return {
      product: { id: brandId, name: info.name },
      case: {
        id: lcaCase.id,
        status: lcaCase.statusName,
        method: methodName ?? "",
        version: versionUsed ?? "",
      },
      indicator: {
        id: indicatorRow.influenceFactorId,
        name: indicatorRow.influenceFactorName,
        unit: indicatorRow.influenceFactorUnit,
        case_total: caseTotal.toExponential(6),
      },
      target_product: targetProduct,
      threshold: args.threshold,
      rows: sensRows.map((r) => ({
        element_id: r.elementId,
        name: r.name,
        share: Number(r.val),
        share_pct: (Number(r.val) * 100).toFixed(1) + "%",
      })),
      covered_share_pct: (covered * 100).toFixed(1) + "%",
      unaccounted_share_pct: ((1 - covered) * 100).toFixed(1) + "%",
    };
  },
  cli: {
    summary: "[aggregator] top contributors to GWP of a product.",
    renderHuman: (r) =>
      [
        `${r.product.name} → ${r.indicator.name} = ${r.indicator.case_total} ${r.indicator.unit}`,
        `case ${r.case.id} (${r.case.method} / ${r.case.version})  threshold=${r.threshold}`,
        `covered ${r.covered_share_pct}, unaccounted ${r.unaccounted_share_pct}`,
        ...r.rows.map((row) => `  ${row.share_pct.padStart(6)}  ${row.name}`),
      ].join("\n"),
  },
};
