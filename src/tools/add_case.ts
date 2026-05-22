import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Stage = z.object({
  key: z.string().describe("Stage-type id (e.g. 原材料获取与生产制造 / 运输 / 使用 / 废弃处置). From the platform's stage-type enum."),
  name: z.string().describe("Stage display name."),
});

const Args = z.object({
  brand_id: z.string().describe("Custom product id (from create_custom_product → list_products)."),
  version_id: z.string().describe("Background-DB version id (list_background_db_versions)."),
  unit_id: z.string().describe("Declared-unit id (get_units)."),
  unit_type: z.string().describe("Unit-group/type id (get_units)."),
  unit_comment: z.string().describe("Declared-unit description, e.g. '1 m² PV module'."),
  consult_product_name: z.string().describe("Reference product name."),
  consult_product_coefficient: z.string().default("1").describe("Reference-flow coefficient (usually '1')."),
  report_date: z.string().describe("Reporting period, e.g. '2026-01~2027-02'."),
  boundary_id: z.string().describe("System-boundary id (e.g. cradle-to-gate 1519532547259908121)."),
  stages: z.array(Stage).min(1).describe("Life-cycle stages to create on the case."),
  description: z.string().optional().describe("Optional case description."),
});

export const addCase: ToolDef<typeof Args, unknown> = {
  name: "add_case",
  description:
    "Create the LCA case (+ its life-cycle stages) on a CUSTOM product (one " +
    "that has no template, made by create_custom_product). Template products " +
    "already get a case automatically — this is only for custom products. " +
    "Internal manager API (Bearer JWT minted from the memberKey). After this, " +
    "add processes (add_case_process) then data items (add_data_items).",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    return await callManager(ctx, "/managerPro/brand/addCase", {
      modelType: "",
      calculateDimensions: "",
      brandId: args.brand_id,
      unitType: args.unit_type,
      unitComment: args.unit_comment,
      consultProductName: args.consult_product_name,
      unitId: args.unit_id,
      consultProductCoefficient: args.consult_product_coefficient,
      reportDate: args.report_date,
      versionId: args.version_id,
      boundaryId: args.boundary_id,
      stages: args.stages,
      description: args.description ?? "",
      enableBackData: 0,
    });
  },
  cli: { summary: "Create an LCA case + stages on a custom product." },
};
