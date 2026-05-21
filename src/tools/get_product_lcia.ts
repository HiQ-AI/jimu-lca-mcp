/**
 * 🎯 Convenience aggregator. Collapses the 5-call (sometimes 10-call,
 * with version discovery) chain "find product by name → product info →
 * case detail → list calc methods (per version until found) → LCIA
 * detail" into one tool call.
 *
 * Verified via Story 2 of tests/user_story_trace.py.
 */
import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { get, post, postPaginated } from "../api.js";

const Args = z.object({
  product: z
    .string()
    .describe(
      "Product name (fuzzy match) OR brandId (exact UUID-like id). Auto-detected: " +
      "if the value matches /^\\d+$/ it's treated as a brandId; otherwise as a name search.",
    ),
  indicator: z
    .string()
    .optional()
    .describe(
      "Optional impact-factor name fragment to filter rows (e.g. 'GWP', '气候变化'). " +
      "Omit to return all impact factors.",
    ),
  case_index: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe(
      "Which case under the product to use, when there are multiple. Default 0 (first).",
    ),
  target_product: z
    .string()
    .optional()
    .describe("Which target product/disposal to fetch LCIA for. Default: first."),
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
  influenceFactorName: string;
  influenceFactorUnit: string;
  productName: string;
  stageName: string;
  summary: string;
  [k: string]: unknown;
}

interface ProductLciaResult {
  product: { id: string; name: string };
  case: { id: string; status: string; method_used: string; version_used: string; case_cal_method_id: string };
  target_product: string;
  rows: LciaRow[];
  meta: {
    total_indicators: number;
    filtered_by: string | null;
  };
}

export const getProductLcia: ToolDef<typeof Args, ProductLciaResult> = {
  name: "get_product_lcia",
  description:
    "Convenience aggregator: 'show me the LCIA for product X'. Goes from " +
    "product name or brandId all the way to LCIA result rows in one call. " +
    "Internally handles the version-discovery loop (the case's stored " +
    "versionId is sometimes wrong; we probe all calculated versions until " +
    "we find one with results). Pass `indicator` to filter to one impact " +
    "factor like GWP.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    // 1. Resolve brand
    const looksLikeId = /^\d+$/.test(args.product);
    let brandId: string;
    let brandName: string;
    if (looksLikeId) {
      brandId = args.product;
      brandName = "";
    } else {
      const products = await postPaginated<BrandRow>(ctx, "/lca/v3/getBrandPage", {
        name: args.product,
        page: 1,
        size: 1,
      });
      if (products.rows.length === 0) {
        throw new JimuLcaError(
          "validation",
          `no product matching name '${args.product}'.`,
        );
      }
      brandId = products.rows[0]!.id;
      brandName = products.rows[0]!.name;
    }
    // 2. Get product → cases
    const info = await get<ProductInfo>(ctx, "/lca/v3/getBrandInfo", { brandId });
    if (info.lcaBrandCases.length === 0) {
      throw new JimuLcaError(
        "validation",
        `product '${info.name}' has no LCA cases yet.`,
      );
    }
    if (args.case_index >= info.lcaBrandCases.length) {
      throw new JimuLcaError(
        "validation",
        `case_index ${args.case_index} out of range; product has ${info.lcaBrandCases.length} cases.`,
      );
    }
    const lcaCase = info.lcaBrandCases[args.case_index]!;

    // 3. Discover the actually-calculated version. The case's stored versionId
    // is sometimes wrong, so we loop all versions until one returns calc records.
    let calcRecord: InnerCalcRecord | null = null;
    let methodName: string | null = null;
    let versionUsed: string | null = null;
    // Try the case's stored versionId first (common case)
    let buckets = await get<MethodBucket[]>(ctx, "/lca/v3/getCaseCalculationMethods", {
      caseId: lcaCase.id,
      versionId: lcaCase.versionId,
    });
    if (buckets.length > 0) {
      calcRecord = buckets[0]!.calculationMethods[0] ?? null;
      methodName = buckets[0]!.name;
      versionUsed = lcaCase.versionName;
    } else {
      // Fallback: scan all bg versions
      const versions = await get<BgVersion[]>(ctx, "/lca/v3/getAllocationVersions");
      for (const v of versions) {
        if (v.id === lcaCase.versionId) continue;
        const probe = await get<MethodBucket[]>(ctx, "/lca/v3/getCaseCalculationMethods", {
          caseId: lcaCase.id,
          versionId: v.id,
        });
        if (probe.length > 0) {
          calcRecord = probe[0]!.calculationMethods[0] ?? null;
          methodName = probe[0]!.name;
          versionUsed = v.version;
          break;
        }
      }
    }
    if (!calcRecord) {
      throw new JimuLcaError(
        "validation",
        `case ${lcaCase.id} (${lcaCase.statusName}) has no calculation results in any background-DB version yet. Run calculate_case first.`,
      );
    }
    const targetProduct = args.target_product ?? calcRecord.targetProduct;

    // 4. Fetch LCIA detail
    const lciaRows = await post<LciaRow[]>(ctx, "/lca/v3/getCaseLciaDetails", {
      caseId: lcaCase.id,
      id: calcRecord.id,
      targetProduct,
    });
    // 5. Optional filter
    const filtered = args.indicator
      ? lciaRows.filter(
          (r) =>
            r.influenceFactorName.includes(args.indicator!) ||
            (r as { influenceFactorNameEn?: string }).influenceFactorNameEn?.toLowerCase().includes(args.indicator!.toLowerCase()),
        )
      : lciaRows;

    return {
      product: { id: brandId, name: brandName || info.name },
      case: {
        id: lcaCase.id,
        status: lcaCase.statusName,
        method_used: methodName ?? "",
        version_used: versionUsed ?? "",
        case_cal_method_id: calcRecord.id,
      },
      target_product: targetProduct,
      rows: filtered,
      meta: {
        total_indicators: lciaRows.length,
        filtered_by: args.indicator ?? null,
      },
    };
  },
  cli: {
    summary: "[aggregator] LCIA for a product, one call.",
    renderHuman: (r) =>
      [
        `${r.product.name} → case ${r.case.id} (${r.case.method_used}, ${r.case.version_used})`,
        `target product: ${r.target_product}`,
        `rows: ${r.rows.length}${r.meta.filtered_by ? ` (filtered by '${r.meta.filtered_by}')` : ""}`,
        ...r.rows.map(
          (row) =>
            `  [${row.stageName.slice(0, 14).padEnd(14)}] ${row.influenceFactorName.padEnd(40).slice(0, 40)}  ${Number(row.summary).toExponential(3)} ${row.influenceFactorUnit}`,
        ),
      ].join("\n"),
  },
};
