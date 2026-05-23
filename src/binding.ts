/**
 * Shared stage-binding save path.
 *
 * Binding a background dataset to a flow is the same write regardless of how the
 * dataset was chosen: load the item's full data-config (getDataDetail), set the
 * chosen dataset on its background slot, and persist every flow of the stage in
 * one saveConfiguration call. Two tools produce the {@link ResolvedBinding}s that
 * feed it — `bind_backgrounds` (ids from a jimu-side search) and the Cortex
 * `bind_backgrounds_local` (ids resolved from a local catalog uuid via the
 * version bridge) — so the write itself lives here, once.
 */

import type { ToolContext } from "./types.js";
import { callManager } from "./api.js";

/** A dataset already resolved to the ids saveConfiguration needs. */
export interface ResolvedBinding {
  element_id: string;
  /** standardUuid the platform binds by (search: bind_uuid; bridge: bind_uuid). */
  background_uuid: string;
  background_data_id: string;
  background_name: string;
  /** Background-DB version the dataset belongs to. */
  version_id: string;
  location?: string;
  unit?: string;
}

interface DataDetail {
  backgroundList?: Array<Record<string, unknown>>;
  slciList?: unknown[];
  materialList?: unknown[];
  transportList?: unknown[];
}

/**
 * Bind the given datasets to their flows in one stage. Loads each item's
 * data-config, sets the chosen dataset on its first background slot, and saves
 * all in a single saveConfiguration (manager API). If an element has no
 * background slot (not a matchable input) nothing is saved and the error names
 * which bindings were prepared and which remain, so the caller can fix and retry.
 */
export async function saveStageBindings(
  ctx: ToolContext,
  caseId: string,
  stageId: string,
  bindings: ResolvedBinding[],
): Promise<unknown> {
  const backgroundList: Array<Record<string, unknown>> = [];
  const slciList: unknown[] = [];
  const materialList: unknown[] = [];
  const transportList: unknown[] = [];

  const prepared: string[] = [];
  for (const b of bindings) {
    const dd = await callManager<DataDetail>(ctx, "/managerPro/dataConfiguration/getDataDetail", {
      caseId,
      stageId,
      elementId: b.element_id,
    });
    const bg0 = (dd.backgroundList ?? [])[0];
    if (!bg0) {
      throw new Error(
        `no background slot for element ${b.element_id} (not a matchable input?). ` +
          `Nothing was saved. Prepared before failure: [${prepared.join(", ") || "none"}]; ` +
          `not yet processed: [${bindings.slice(bindings.indexOf(b)).map((x) => x.element_id).join(", ")}]. ` +
          `Fix or drop that binding and call again.`,
      );
    }
    prepared.push(b.element_id);
    backgroundList.push({
      ...bg0,
      upElementUuid: b.background_uuid,
      backgroundDataId: b.background_data_id,
      upElementName: b.background_name,
      location: b.location ?? "",
      unitName: b.unit ?? "",
      equivalentCoefficient: "1",
      conversionFactor: "1",
      upVersionId: b.version_id,
      useAiRecommend: false,
      oldName: "-",
    });
    slciList.push(...(dd.slciList ?? []));
    materialList.push(...(dd.materialList ?? []));
    transportList.push(...(dd.transportList ?? []));
  }

  return await callManager(ctx, "/managerPro/dataConfiguration/saveConfiguration", {
    caseId,
    stageId,
    backgroundList,
    slciList,
    materialList,
    transportList,
    lciList: [],
    transportRemoveIds: [],
    materialRemoveIds: [],
  });
}
