import { z } from "zod";
import type { ToolDef } from "../types.js";
import { get } from "../api.js";

const Args = z.object({
  brand_id: z.string().describe("Product (brand) id, from list_products."),
});

interface LcaCase {
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
  orderNum: number;
  versionId: string;
  versionName: string;
  [k: string]: unknown;
}

interface Product {
  id: string;
  uuid: string;
  name: string;
  industryId: string;
  industryName: string;
  categoryId: string;
  categoryName: string;
  topCompanyId: string;
  companyId: string;
  createId: string;
  createTime: string;
  spaceId: string;
  spaceName: string;
  groupId: string;
  groupName: string;
  lcaBrandCases: LcaCase[];
}

export const getProduct: ToolDef<typeof Args, Product> = {
  name: "get_product",
  description:
    "Fetch full product metadata plus the embedded list of LCA cases under it. " +
    "Each case row carries id, status (待计算/计算中/已计算/已发布), boundary, unit, " +
    "and the background-DB version it uses. The case `id` is what " +
    "get_case_overview consumes to drill into stages/processes/data items.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await get<Product>(ctx, "/lca/v3/getBrandInfo", { brandId: args.brand_id });
  },
  cli: {
    summary: "Get product detail + LCA cases under it.",
    renderHuman: (p) =>
      [
        `${p.name}  [${p.id}]`,
        `  industry: ${p.industryName} / ${p.categoryName}`,
        `  in space: ${p.spaceName} / ${p.groupName}`,
        `  cases (${p.lcaBrandCases.length}):`,
        ...p.lcaBrandCases.map(
          (c) =>
            `    [${c.id}] ${c.statusName} ${c.versionName} ${c.boundaryName} (${c.unitName} ${c.unitComment})`,
        ),
      ].join("\n"),
  },
};
