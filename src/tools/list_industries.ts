import { z } from "zod";
import type { ToolDef } from "../types.js";
import { callManager } from "../api.js";

const Args = z.object({
  keyword: z.string().optional().describe("Optional name filter (client-side), e.g. '塑料' / '化工'."),
});

interface Tag { tagId: string; nameCn: string; nameEn: string }

export const listIndustries: ToolDef<typeof Args, unknown> = {
  name: "list_industries",
  description:
    "List the platform's industry tags (115+). The `tag_id` is what " +
    "create_custom_product / create_blank_product take as `industry_id`. Use " +
    "this (or the nearest list_models row's industryId) to classify a custom " +
    "product. Manager API (Bearer token from the memberKey).",
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    const tags = await callManager<Tag[]>(ctx, "/managerPro/operateFeign/getIndustryTagList", {});
    const kw = args.keyword?.trim();
    const rows = (tags ?? [])
      .filter((t) => !kw || t.nameCn.includes(kw) || (t.nameEn ?? "").toLowerCase().includes(kw.toLowerCase()))
      .map((t) => ({ tag_id: t.tagId, name_cn: t.nameCn, name_en: t.nameEn }));
    return rows;
  },
  cli: { summary: "List industry tags (industry_id source)." },
};
