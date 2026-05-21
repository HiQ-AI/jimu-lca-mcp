import { z } from "zod";
import type { ToolDef } from "../types.js";
import { JimuLcaError } from "../types.js";
import { get, post } from "../api.js";

const Args = z.object({
  name: z.string().describe("Product display name."),
  model_id: z.string().describe("Model template id, from list_models."),
  space_id: z.string().describe("Space id, from list_spaces."),
  version_id: z
    .string()
    .describe("Background-DB version id, from list_background_db_versions."),
  group_id: z
    .string()
    .optional()
    .describe("Group/folder id inside the space. Defaults to the space's root group if omitted."),
  description: z.string().optional().describe("Optional product description."),
  /* The upstream needs modelFlag (own/EC), modelType (流程/离散), calculateDimensions
     (only LCA vs LCA+LCC). The wrapper picks sensible defaults: own / 流程 / only-LCA. */
});

interface Space {
  id: string;
  groupList: Array<{ id: string; isRoot: number }>;
}

interface Model {
  id: string;
  industryId: string;
  categoryId: string;
  modelFlag: string;
}

export const createProduct: ToolDef<typeof Args, unknown> = {
  name: "create_product",
  description:
    "Create a new product (brand) by instantiating a model template. The " +
    "wrapper looks up industryId / categoryId from the chosen model (they " +
    "must match), defaults groupId to the space's root group when omitted, " +
    "and picks safe defaults for the advanced model-type fields. " +
    "Skill rule: agent must show the user the resolved (model name, target " +
    "space + group display path, product name) and wait for confirmation.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    // Resolve industryId + categoryId from the model
    const models = await get<Model[]>(ctx, "/lca/v3/getModelList");
    const model = models.find((m) => m.id === args.model_id);
    if (!model) {
      throw new JimuLcaError(
        "validation",
        `model_id ${args.model_id} not in list_models; call list_models to discover valid ids.`,
      );
    }
    // Resolve groupId default
    let groupId = args.group_id;
    if (!groupId) {
      const spaces = await get<Space[]>(ctx, "/lca/v3/getProjectSpaces");
      const space = spaces.find((s) => s.id === args.space_id);
      if (!space) {
        throw new JimuLcaError(
          "validation",
          `space_id ${args.space_id} not in list_spaces.`,
        );
      }
      const root = space.groupList.find((g) => g.isRoot === 1) ?? space.groupList[0];
      if (!root) {
        throw new JimuLcaError(
          "validation",
          `space ${args.space_id} has no groups.`,
        );
      }
      groupId = root.id;
    }

    return await post(ctx, "/lca/v3/addBrand", {
      name: args.name,
      description: args.description,
      industryId: model.industryId,
      categoryId: model.categoryId,
      modelId: model.id,
      spaceId: args.space_id,
      groupId,
      modelFlag: model.modelFlag ?? "own",
      versionId: args.version_id,
      // Sensible defaults per upstream docs:
      modelType: "41524144274399259", // 流程 (process-based) — most common
      calculateDimensions: "41524144274399269", // 仅计算LCA (LCA only, no LCC)
    });
  },
  cli: {
    summary: "Create a new product (brand) from a model template.",
  },
};
