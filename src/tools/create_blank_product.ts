import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { createCustomProduct } from "./create_custom_product.js";
import { listProducts } from "./list_products.js";
import { addCase } from "./add_case.js";

// Stable platform enums (verified). The stage-type and unit-type "tokens" have no
// discoverable list endpoint; these defaults work for the common single-stage,
// per-mass declared-unit case. For multi-stage-type models, the platform's
// stage-type ids would be needed (not yet exposed) — fall back to add_case directly.
const DEFAULT_STAGE_KEY = "1621385735695615433";
const DEFAULT_UNIT_TYPE = "1621385735695621127";
const DEFAULT_BOUNDARY = "1519532547259908121"; // cradle-to-gate

const Args = z.object({
  name: z.string().describe("Product name."),
  space_id: z.string().describe("Private space id."),
  group_id: z.string().describe("Group id (space's root group)."),
  version_id: z.string().describe("Background-DB version (prefer Ecoinvent 3.12+HiQ)."),
  industry_id: z.string().describe("Industry tag id (list_industries / nearest list_models row)."),
  category_id: z.string().describe("Category id (nearest list_models row's categoryId)."),
  unit_id: z.string().describe("Declared-unit id (get_units), e.g. kg."),
  unit_comment: z.string().describe("Declared-unit description, e.g. '1 kg' / '1 瓶'."),
  consult_product_name: z.string().describe("Reference product name — MUST equal the 产品 output's name in your import sheet (else the calc won't resolve)."),
  stage_names: z.array(z.string()).min(1).describe("Life-cycle stage display names, e.g. ['生产阶段']."),
  report_date: z.string().optional().describe("Reporting period; defaults to the current year."),
});

export const createBlankProduct: ToolDef<typeof Args, unknown> = {
  name: "create_blank_product",
  description:
    "Create a custom (no-template) product shell + its case + stages in ONE call " +
    "— combines create_custom_product + add_case and bakes the stable stage-type/" +
    "unit-type/boundary enums so you only pass semantic inputs. Returns " +
    "{brand_id, case_id}. Next: generate the import sheet (build_import_xlsx.py) " +
    "and import_model into case_id. Defaults cradle-to-gate + a single stage-type " +
    "(good for the common case); for multi-stage-type models use add_case directly.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    await createCustomProduct.handler(
      { name: args.name, space_id: args.space_id, group_id: args.group_id, industry_id: args.industry_id, category_id: args.category_id },
      ctx,
    );
    // create_custom_product returns no id — resolve the new brand by name (newest).
    const list = (await listProducts.handler({ space_id: args.space_id } as never, ctx)) as { rows?: Array<{ id: string; name?: string; createTime?: string }> };
    const mine = (list.rows ?? [])
      .filter((p) => p.name === args.name)
      .sort((a, b) => String(b.createTime ?? "").localeCompare(String(a.createTime ?? "")));
    const brandId = mine[0]?.id;
    if (!brandId) throw new JimuLcaError("upstream", `created product "${args.name}" but could not resolve its brand id from list_products`);

    const caseId = await addCase.handler(
      {
        brand_id: brandId,
        version_id: args.version_id,
        unit_id: args.unit_id,
        unit_type: DEFAULT_UNIT_TYPE,
        unit_comment: args.unit_comment,
        consult_product_name: args.consult_product_name,
        consult_product_coefficient: "1",
        report_date: args.report_date ?? `${new Date().getFullYear()}`,
        boundary_id: DEFAULT_BOUNDARY,
        stages: args.stage_names.map((n) => ({ key: DEFAULT_STAGE_KEY, name: n })),
      } as never,
      ctx,
    );
    return { brand_id: brandId, case_id: caseId, next: "build_import_xlsx.py → import_model(case_id) → match_backgrounds → validate_case → calculate_case" };
  },
  cli: { summary: "Create custom product + case + stages in one call (baked enums)." },
};
