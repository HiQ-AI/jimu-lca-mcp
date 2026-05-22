/**
 * Collected MCP tools. The three entry points (stdio MCP server, CLI,
 * Cloudflare Worker) all iterate {@link allTools} and register them in
 * their respective shape.
 *
 * Adding a new tool: create src/tools/<name>.ts exporting a `ToolDef`,
 * import + push it here. No other registration needed.
 */
import type { ToolDef } from "../types.js";

// Public data
import { getUnits } from "./get_units.js";
import { listBackgroundDbVersions } from "./list_background_db_versions.js";
import { listCalculationMethods } from "./list_calculation_methods.js";
import { listIndustries } from "./list_industries.js";
import { checkConnectivity } from "./check_connectivity.js";
import { getCalcStatus } from "./get_calc_status.js";

// Space management
import { listSpaces } from "./list_spaces.js";
import { listSpaceMembers } from "./list_space_members.js";
import { createSpace } from "./create_space.js";

// Models
import { listModels } from "./list_models.js";

// Products + cases
import { createProduct } from "./create_product.js";
import { createCustomProduct } from "./create_custom_product.js";
import { createBlankProduct } from "./create_blank_product.js";
import { addCase } from "./add_case.js";
import { addCaseProcess } from "./add_case_process.js";
import { addDataItems } from "./add_data_items.js";
import { validateCase } from "./validate_case.js";
import { searchBackgroundData } from "./search_background_data.js";
import { searchBackgrounds } from "./search_backgrounds.js";
import { matchBackgrounds } from "./match_background.js";
import { getModelItems } from "./get_model_items.js";
import { getResult } from "./get_result.js";
import { importModel } from "./import_model.js";
import { listProducts } from "./list_products.js";
import { getProduct } from "./get_product.js";
import { getCaseOverview } from "./get_case_overview.js";
import { copyCase } from "./copy_case.js";
import { deleteCase } from "./delete_case.js";

// Data input
import { listDataItems } from "./list_data_items.js";
import { editDataItems } from "./edit_data_items.js";
import { exportElementsExcel } from "./export_elements_excel.js";
import { importElementsExcel } from "./import_elements_excel.js";

// Calculation + results
import { calculateCase } from "./calculate_case.js";
import { listCaseCalculationMethods } from "./list_case_calculation_methods.js";
import { getLciaDetail } from "./get_lcia_detail.js";
import { getSensitivity } from "./get_sensitivity.js";

// Convenience aggregators
import { getProductLcia } from "./get_product_lcia.js";
import { getTopContributors } from "./get_top_contributors.js";

export const allTools: ToolDef[] = [
  // Foundation reads
  getUnits,
  checkConnectivity,
  listBackgroundDbVersions,
  listCalculationMethods,
  listIndustries,
  listSpaces,
  listSpaceMembers,
  createSpace,
  listModels,

  // Product + case
  listProducts,
  getProduct,
  getCaseOverview,

  // Data input
  listDataItems,
  getModelItems,
  editDataItems,
  exportElementsExcel,
  importElementsExcel,

  // Writes
  createProduct,
  createCustomProduct,
  createBlankProduct,
  addCase,
  addCaseProcess,
  addDataItems,
  searchBackgroundData,
  searchBackgrounds,
  matchBackgrounds,
  importModel,
  validateCase,
  copyCase,
  deleteCase,
  calculateCase,

  // Result reads
  getCalcStatus,
  listCaseCalculationMethods,
  getLciaDetail,
  getSensitivity,

  // Convenience aggregators
  getProductLcia,
  getResult,
  getTopContributors,
] as unknown as ToolDef[];

export type { ToolDef };
