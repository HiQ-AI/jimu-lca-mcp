/**
 * Local-catalog → jimu binding bridge.
 *
 * Cortex ships local TSV catalogs whose `dataset_key` is `{activityUuid}_{version}`.
 * jimu re-IDs every dataset on import, so that activity uuid does NOT equal jimu's
 * internal uuid / standardUuid. jimu's per-version export, however, preserves the
 * original pre-import uuid (配置版本背景数据原UUID), and that value DOES equal the
 * catalog's activity uuid. This module looks a dataset up by
 * (version, system model, activity uuid) and returns the two ids the save path
 * needs: `background_data_id` and `bind_uuid` (the standardUuid jimu binds by).
 *
 * The existing SQLite resource backs {@link BridgeLookup} in the standalone CLI.
 */

/** One resolved dataset — the jimu binding ids plus enough metadata to fill the
 *  saveConfiguration payload and to let the caller confirm the right pick. */
export interface BridgeRow {
  orig_uuid: string;
  system_model: string;
  background_data_id: string;
  bind_uuid: string;
  name_cn: string | null;
  name_en: string | null;
  location: string | null;
  unit: string | null;
}

export interface BridgeLookup {
  /**
   * Resolve activity uuids within one background-DB version + system model to
   * their jimu binding ids. Returns one row per match; uuids with no row are
   * simply absent from the result, and the caller treats them as misses.
   */
  resolve(
    versionKeyValue: string,
    systemModel: string,
    origUuids: string[],
  ): Promise<BridgeRow[]>;
}

/**
 * Normalise a version name so the xlsx export name and the live API's `version`
 * string compare equal despite spacing / case differences — e.g.
 * "Ecoinvent 3.12 + HiQ 1.4.0" and "Ecoinvent3.12+HiQ1.4.0" both reduce to
 * "ecoinvent3.12+hiq1.4.0".
 */
export function versionKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

/**
 * Normalise a system-model label. Local catalog filenames use
 * `cut_off` / `consequential` / `en_15804`; the export uses
 * `Cut-off` / `Consequential` / `EN15804`. Both reduce to a stripped key.
 */
export function systemModelKey(model: string): string {
  return model.toLowerCase().replace(/[\s_-]+/g, "");
}
