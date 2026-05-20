# Endpoint catalog

Source of truth = raw JSON from `https://open.ecdigit.com/openapi/openResource/getById?id=<apiId>` cached in [../api-raw/](../api-raw/).
Per-endpoint markdown (this directory) is **derived** from those JSONs plus our integration notes (smoke tests, aggregation decisions, gotchas).

## How to refresh from upstream

```
python3 scripts/fetch_docs.py            # re-download all 37 raw JSONs
python3 scripts/render_endpoint_docs.py  # regenerate per-endpoint .md scaffolds
```

(Scripts not yet written — coming in the docs-tooling commit.)

## Index

### Admin / bootstrap (5 — not wrapped, see [../architecture/non-goals.md](../architecture/non-goals.md))

| Endpoint | Method | URL | Notes |
|---|---|---|---|
| [查询角色列表](admin/role-listByCompany.md) | GET | `/role/listByCompany` | tenant role discovery |
| [注册成员及子公司](admin/user-registMember.md) | POST | `/user/registMember` | creates member + child company, PII write |
| [获取成员key](admin/open-queryMemberKey.md) | POST | `/open/queryMemberKey` | look up existing memberKey by orgSign+name+mobile |
| [获取token](admin/open-memberToken-get.md) | POST | `/open/memberToken/get` | short-lived Bearer JWT for SaaS redirects |
| [更新token](admin/open-memberToken-refresh.md) | POST | `/open/memberToken/refresh` | rotate Bearer JWT |

### Public data (3)

| Endpoint | Method | URL | MCP tool |
|---|---|---|---|
| [查询所有单位](public/getAllUnits.md) | GET | `/lca/v3/getAllUnits` | `get_units` |
| [查询背景数据库版本列表](public/getAllocationVersions.md) | GET | `/lca/v3/getAllocationVersions` | `list_background_db_versions` |
| [查询当前租户已分配的计算方法](public/getAssignedCalculationMethods.md) | GET | `/lca/v3/getAssignedCalculationMethods` | `list_calculation_methods(version_id)` |

### Space management (7 — 2 wrapped, 5 deferred to web UI)

| Endpoint | Method | URL | MCP tool |
|---|---|---|---|
| [查询空间列表](spaces/getProjectSpaces.md) | GET | `/lca/v3/getProjectSpaces` | `list_spaces` |
| [创建空间](spaces/addProjectSpace.md) | POST | `/lca/v3/addProjectSpace` | (not wrapped) |
| [查询用户列表](spaces/getAllUser.md) | GET | `/lca/v3/getAllUser` | (not wrapped) |
| [添加成员](spaces/addMemberToSpaceBatch.md) | POST | `/lca/v3/addMemberToSpaceBatch` | (not wrapped) |
| [查询空间成员](spaces/getMembersBySpaceId.md) | GET | `/lca/v3/getMembersBySpaceId` | `list_space_members` |
| [批量删除空间成员](spaces/deleteMemberFromSpaceBatch.md) | POST | `/lca/v3/deleteMemberFromSpaceBatch` | (not wrapped) |
| [空间成员角色修改](spaces/updateMemberRole.md) | POST | `/lca/v3/addMemberToSpaceBatch` | (not wrapped) — same endpoint as 添加成员, different use case |

### Model library (1)

| Endpoint | Method | URL | MCP tool |
|---|---|---|---|
| [查询模型列表](models/getModelList.md) | GET | `/lca/v3/getModelList` | `list_models` |

### Product management (10 — 5 wrapped + 1 deferred, case-reads aggregated into `get_case_overview`)

| Endpoint | Method | URL | MCP tool |
|---|---|---|---|
| [创建产品](products/addBrand.md) | POST | `/lca/v3/addBrand` | `create_product` |
| [查询产品列表](products/getBrandPage.md) | POST | `/lca/v3/getBrandPage` | `list_products` |
| [查询产品信息](products/getBrandInfo.md) | GET | `/lca/v3/getBrandInfo` | `get_product` |
| [查询lca详情](products/getCaseDetail.md) | GET | `/lca/v3/getCaseDetail` | (folded into `get_case_overview`) |
| [复制lca](products/copyCase.md) | POST | `/lca/v3/copyCase` | `copy_case` |
| [查询lca阶段信息](products/getCaseStage.md) | GET | `/lca/v3/getCaseStage` | (folded into `get_case_overview`) |
| [删除lca](products/deleteCase.md) | POST | `/lca/v3/deleteCase` | `delete_case` |
| [查询工序列表](products/getProcessList.md) | GET | `/lca/v3/getProcessList` | (folded into `get_case_overview`) |
| [查询lca下的数据配置列表](products/getDataConfigurationList.md) | POST | `/lca/v3/getDataConfigurationList` | (folded into `get_case_overview`) |
| [查询lca下的数据配置详情](products/getDataConfigurationDetail.md) | POST | `/lca/v3/getDataConfigurationDetail` | `get_data_config` (deferred) |

### Data input (4)

| Endpoint | Method | URL | MCP tool |
|---|---|---|---|
| [查询数据项列表](data/getElementList.md) | GET | `/lca/v3/getElementList` | `list_data_items` |
| [修改数据项](data/editElements.md) | POST | `/lca/v3/editElements` | `edit_data_items` |
| [导出模型数据](data/exportElementData.md) | GET | `/lca/v3/exportElementData` | `export_elements_excel` |
| [导入模型数据](data/importModelData.md) | POST | `/lca/v3/importModelData` | `import_elements_excel` |

### Submit calculation (6 — `getCaseDisposals` folded into `calculate_case`)

| Endpoint | Method | URL | MCP tool |
|---|---|---|---|
| [查询lca所有产品处置物](calc/getCaseDisposals.md) | GET | `/lca/v3/getCaseDisposals` | (folded into `calculate_case`) |
| [提交计算并且模型校验](calc/addCaseCalculationTask.md) | POST | `/lca/v3/addCaseCalculationTask` | `calculate_case` |
| [查询当前版本lca历史计算方法列表](calc/getCaseCalculationMethods.md) | GET | `/lca/v3/getCaseCalculationMethods` | `list_case_calculation_methods` |
| [查询当前lca产品和处置物的lcia详情](calc/getCaseLciaDetails.md) | POST | `/lca/v3/getCaseLciaDetails` | `get_lcia_detail` |
| [上传报告数据](calc/publishData.md) | POST | `/lca/v3/publishData` | `publish_data` (deferred) |
| [查询敏感性分析结果](calc/getCaseSensitive.md) | POST | `/lca/v3/getCaseSensitive` | `get_sensitivity` |

### Uncertainty analysis (1)

| Endpoint | Method | URL | MCP tool |
|---|---|---|---|
| [提交不确定分析计算](uncertainty/submitUncertaintyAnalysis.md) | POST | `/lca/v3/submitUncertaintyAnalysis` | `submit_uncertainty_analysis` (deferred) |
