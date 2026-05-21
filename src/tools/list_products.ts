import { z } from "zod";
import type { ToolDef } from "../types.js";
import { postPaginated, type Paginated } from "../api.js";

const Args = z.object({
  space_id: z
    .string()
    .optional()
    .describe("Scope to one space (from list_spaces). Omit for all spaces visible to the memberKey."),
  group_id: z.string().optional().describe("Optional group/folder id inside a space."),
  name: z.string().optional().describe("Optional fuzzy product-name filter."),
  page: z.number().int().default(1).describe("1-indexed page."),
  size: z.number().int().default(20).describe("Rows per page; the open API caps unknown."),
});

interface ProductRow {
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
  /** Headline GWP — present on the list row, no drill required. */
  co2Content: string;
  co2Unit: string;
  spaceId: string;
  groupId: string;
  spaceName: string;
  num: number;
  consultProductCoefficient: string;
}

export const listProducts: ToolDef<typeof Args, Paginated<ProductRow>> = {
  name: "list_products",
  description:
    "Paginate the tenant's product catalog. Each row carries `co2Content` + " +
    "`co2Unit` headline GWP, so 'highest emitter in this space' tasks can " +
    "answer from this one call without drilling into individual cases.",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return await postPaginated<ProductRow>(ctx, "/lca/v3/getBrandPage", {
      name: args.name,
      page: args.page,
      size: args.size,
      groupId: args.group_id,
      spaceId: args.space_id,
    });
  },
  cli: {
    summary: "Paginate products with headline GWP.",
    renderHuman: (r) =>
      [
        `page ${r.page}/${r.totalPageNum} (total ${r.total})`,
        ...r.rows.map(
          (p) =>
            `  [${p.id}] ${p.name.padEnd(30).slice(0, 30)}  ${Number(p.co2Content || 0)
              .toFixed(1)
              .padStart(15)} ${p.co2Unit}`,
        ),
      ].join("\n"),
  },
};
