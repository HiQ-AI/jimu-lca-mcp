# jimu-lca-mcp

MCP server and companion CLI for the **积木LCA 3.0** product-carbon-footprint
workspace on 易碳云开放平台 (<https://cloud.ecdigit.com/jimulca>).

**Built primarily for [HiQ Cortex Desktop](https://github.com/HiQ-AI/cortex-desktop)** —
an AI-powered LCA data workbench that orchestrates product carbon footprinting
across an LCA practitioner's working day. Because it speaks the standard MCP
stdio protocol, it also runs unmodified against any other MCP-capable agent
host (Claude Code, OpenAI Codex, Cursor, Continue, …). The same Python package
ships a `jimu-lca` CLI for scripted use, smoke tests, and operators who don't
want to wire up an agent.

Sibling-but-independent to [editor-mcp-server](https://github.com/HiQ-AI/editor-mcp-server),
which authors background LCI datasets on `editor.hiqlcd.com`. The two
products are complementary — `editor-mcp-server` *produces* background
data; this repo *consumes* that data to compute product carbon footprints.

## Status

**Phase 0 — investigation and documentation.** No runtime code yet. The repo
currently exists to:

1. Catalog the 易碳云开放平台 API surface for 积木LCA 3.0 (37 endpoints — 5
   admin / bootstrap, 32 LCA-runtime)
2. Capture design decisions: which endpoints to wrap, which to aggregate, which
   to leave to the web UI
3. Document the auth model, env model, and host-integration shape (including
   a Settings-UI pattern for desktop hosts)
4. Document each endpoint's request / response schema, gotchas, and proposed
   MCP tool mapping

Coding begins after the docs settle and the open questions in
`docs/architecture/non-goals.md` are closed.

## Architecture (TL;DR)

- **Local stdio MCP**, spawned by the agent host as a child process. **No** K3s
  deployment, **no** API gateway — 积木LCA's `appId: app:xxx` auth doesn't
  share a tenant with any SSO an agent host might natively integrate with, so
  a remote-HTTP gateway pattern wouldn't add value here.
- **Companion `jimu-lca` CLI** in the same package — same operations as the
  MCP tools, exposed as subcommands for scripts, smoke tests, and operator
  workflows. Useful when there's no agent in the loop.
- **Auth** = single env var `JIMU_LCA_MEMBER_KEY` (value `app:xxxxxxxxxx`).
  One memberKey per end user; obtained from the open-platform admin console.
- **Companion skill** `jimu-lca-product-carbon` (under construction) for hosts
  that support the [Anthropic skill format](https://github.com/anthropics/claude-cookbooks),
  documenting the product-LCA workflow on top of these tools.

Full architecture: [docs/architecture/overview.md](docs/architecture/overview.md)

## What this MCP / CLI does NOT cover

- **The 5 bootstrap / admin endpoints** (`registMember`, `queryMemberKey`,
  `memberToken/*`, `role/listByCompany`). Those operate on a company-level
  appkey, not a user-level memberKey, and run **once per tenant**. They live
  with the integrator who provisions access for an end user, not with the
  runtime MCP/CLI. See
  [docs/architecture/non-goals.md](docs/architecture/non-goals.md).
- **Space membership write operations** (`addProjectSpace`,
  `addMemberToSpaceBatch`, `deleteMemberFromSpaceBatch`, role updates). These
  are governance actions an end user performs in the web UI; the MCP only
  reads space lists / membership.
- **Bearer JWT lifecycle endpoints** (`memberToken/get`, `memberToken/refresh`).
  The memberKey is the long-lived credential; short-lived JWTs are only
  needed for SaaS-UI redirects, which an agent doesn't drive directly.

## Quickstart (planned, not yet shipped)

```jsonc
// MCP host config — e.g. claude_desktop_config.json
{
  "mcpServers": {
    "jimu-lca": {
      "command": "npx",
      "args": ["-y", "jimu-lca-mcp@latest"],
      "env": {
        "JIMU_LCA_MEMBER_KEY": "app:xxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

```bash
# CLI usage — same operations, scripted
export JIMU_LCA_MEMBER_KEY=app:xxxxxxxxxxxxxxxxxxx
npx -y jimu-lca-mcp units
npx -y jimu-lca-mcp versions
npx -y jimu-lca-mcp products list --space <space-id>
npx -y jimu-lca-mcp case overview <case-id>
```

CLI surface mirrors the MCP tool surface 1:1; same parameter names, same
response semantics. See [docs/architecture/tools.md](docs/architecture/tools.md).

## Layout

```
jimu-lca-mcp/
├── README.md
├── docs/
│   ├── architecture/
│   │   ├── overview.md          # auth / env / host integration / Settings-UI pattern
│   │   ├── non-goals.md         # what we don't wrap and why
│   │   └── tools.md             # 32 endpoints → 22 MCP tool / CLI subcommand mapping
│   ├── api/                     # one .md per endpoint (32 LCA + 5 admin)
│   │   ├── README.md            # index
│   │   ├── public/getAllUnits.md
│   │   └── ...
│   └── api-raw/                 # raw openResource/getById JSONs, source of truth
├── src/                         # TypeScript runtime (empty until Phase 1)
│   ├── server.ts                #   MCP stdio server entry
│   ├── cli.ts                   #   CLI entry (same operations as MCP tools)
│   ├── auth.ts                  #   memberKey → `appId` header
│   ├── api.ts                   #   shared HTTP client
│   ├── tools/                   #   one file per MCP tool
│   └── ...
├── package.json                 # npm metadata; `bin` exposes jimu-lca-mcp
├── tsconfig.json
└── tests/                       # (gitignored — local-only test scaffolding)
```

## Reading order

1. [docs/architecture/overview.md](docs/architecture/overview.md) — auth, env,
   host integration patterns, Settings-UI design
2. [docs/architecture/non-goals.md](docs/architecture/non-goals.md) — what we
   skip and why
3. [docs/architecture/tools.md](docs/architecture/tools.md) — 22-entry tool /
   CLI subcommand surface
4. [docs/api/README.md](docs/api/README.md) — per-endpoint deep dives

## License

TBD.
