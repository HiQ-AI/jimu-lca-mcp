import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Args = z.object({
  name: z.string().describe("Product name."),
  space_id: z.string().describe("Space id (from list_spaces / create_space)."),
  group_id: z.string().describe("Group id inside the space (the space's root group, from list_spaces → groupList where isRoot=1)."),
  industry_id: z.string().describe("Industry classification id. Reuse from the closest list_models row's industryId — pick the nearest GB category to your product."),
  category_id: z.string().describe("Category classification id. Reuse from the same closest list_models row's categoryId."),
  description: z.string().optional().describe("Optional product description."),
});

export const createCustomProduct: ToolDef<typeof Args, unknown> = {
  name: "create_custom_product",
  description:
    "Create a CUSTOM product (no model template) for a product that doesn't " +
    "match any list_models template. Use this only after a list_models search " +
    "genuinely finds nothing close — most products have a usable template, and " +
    "a template (create_product) is preferred because it pre-builds the " +
    "process structure. A custom product starts as an empty shell (0 cases): " +
    "the stage/process/data-item structure must be built afterward (currently " +
    "in the 积木 web UI; programmatic structure editing is on the roadmap). " +
    "industry_id / category_id come from the closest list_models row. Returns " +
    "success only (no id) — find the new product via list_products by name. " +
    "Internally: mints a Bearer token from the memberKey and calls the manager " +
    "API; the caller still only supplies a memberKey.",
  inputSchema: Args,
  annotations: { destructiveHint: false, idempotentHint: false },
  async handler(args, ctx) {
    return await callManager(ctx, "/managerPro/brand/addBrandData", {
      name: args.name,
      spaceId: args.space_id,
      groupId: args.group_id,
      industryId: args.industry_id,
      categoryId: args.category_id,
      ...(args.description !== undefined ? { description: args.description } : {}),
    });
  },
  cli: {
    summary: "Create a custom product (no template; empty shell).",
  },
};
