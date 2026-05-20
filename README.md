# jimu-lca-mcp

Local stdio MCP server + skill that lets a Cortex / Claude Code agent drive
the **积木LCA 3.0** product-carbon-footprint workspace
(https://cloud.ecdigit.com/jimulca) via the 易碳云开放平台 REST API.

Sibling-but-independent to [editor-mcp-server](https://github.com/KirbyInGitHub/editor-mcp-server)
(which writes background LCI datasets on `editor.hiqlcd.com`). The two products
are complementary — `editor-mcp-server` *produces* background data, `jimu-lca-mcp`
*consumes* it to compute product carbon footprints.

## Status

**Phase 0 — investigation and documentation.** No runtime code yet. The repo
currently exists to:

1. Catalog the 易碳开放平台 API surface for 积木LCA 3.0 (37 endpoints — 5
   admin / bootstrap, 32 LCA-runtime)
2. Capture design decisions: which endpoints to wrap, which to aggregate, which
   to leave to web UI
3. Document the auth model, env model, and Cortex Desktop integration shape
4. Document each endpoint's request / response schema, gotchas, and proposed
   MCP tool mapping

Coding begins only after the docs are complete and gaps are closed.

## Architecture (TL;DR)

- **Local stdio MCP**, spawned by Cortex Desktop's claude-agent-sdk (the same
  pattern as Cowork's child-process MCPs). **No** K3s deployment, **no** APISIX
  gateway — 积木LCA's `appId: app:xxx` auth doesn't share a tenant with
  `hiqlcd.com`, so the editor-mcp's gateway pattern doesn't apply here.
- Auth = single env var `JIMU_LCA_MEMBER_KEY` (`app:xxxxxxxxxx`). One memberKey
  per Cortex user; users get theirs from the 易碳 open platform admin.
- Companion skill `jimu-lca-product-carbon` in cortex-skills sits next to
  `hiq-editor` and `upr-integrated-flow` as the third LCA-domain skill.

Full architecture: [docs/architecture/overview.md](docs/architecture/overview.md)

## What this server does NOT cover

- The 5 bootstrap / admin endpoints (`registMember`, `queryMemberKey`,
  `memberToken/*`, `role/listByCompany`). Those operate on a company-level
  appkey, not a user-level memberKey, and run **once per tenant**. They live
  with the admin who provisions Cortex for a 易碳 customer, not with the runtime
  MCP. See [docs/architecture/non-goals.md](docs/architecture/non-goals.md).
- Space membership write operations (`addProjectSpace`,
  `addMemberToSpaceBatch`, `deleteMemberFromSpaceBatch`, role updates). These
  are admin actions a Cortex user does in the 积木LCA web UI; the MCP only
  reads space lists / membership.
- Bearer JWT acquisition (`memberToken/get`, `memberToken/refresh`). The
  memberKey is the long-lived credential; short-lived JWTs are only needed
  for SaaS-UI redirects, which Cortex doesn't do from the agent.

## Layout

```
jimu-lca-mcp/
├── README.md
├── docs/
│   ├── architecture/
│   │   ├── overview.md          # auth model, env, Cortex integration, threat model
│   │   ├── non-goals.md         # what we don't wrap and why
│   │   └── tools.md             # 32 raw endpoints → 22 MCP tools mapping
│   ├── api/                     # one .md per endpoint (32 LCA + 5 admin)
│   │   ├── README.md            # index
│   │   ├── public/getAllUnits.md
│   │   ├── public/getAllocationVersions.md
│   │   └── ...
│   └── api-raw/                 # raw JSON from openResource/getById, source of truth
├── jimu_lca_mcp/                # package (empty until coding starts)
└── tests/                       # (empty until coding starts)
```

## Reading order

1. [docs/architecture/overview.md](docs/architecture/overview.md) — auth, env, integration
2. [docs/architecture/non-goals.md](docs/architecture/non-goals.md) — what we skip
3. [docs/architecture/tools.md](docs/architecture/tools.md) — proposed tool surface
4. [docs/api/README.md](docs/api/README.md) — per-endpoint details

## License

TBD.
