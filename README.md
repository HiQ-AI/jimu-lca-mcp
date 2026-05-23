# jimu-lca-mcp

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server and companion CLI for the
**积木LCA 3.0** product-carbon-footprint workspace on 易碳云开放平台
(<https://cloud.ecdigit.com/jimulca>). It lets an AI agent — or a script — drive
the full LCA loop: create a product and case, build the model, bind background
LCI datasets, run the calculation, and read back results and contributions.

The same tool surface is served three ways from one shared core:

| Transport | Entry | For |
|---|---|---|
| **HTTP** (Streamable) | Cloudflare Worker at `https://jimu-lca-mcp.hiq.earth/mcp` | any remote-MCP-capable host, zero install |
| **stdio** | `npx jimu-lca-mcp` | local agent hosts (Claude Desktop/Code, Cursor, Continue, …) |
| **CLI** | `npx jimu-lca-mcp <cmd>` (`bin: jimu-lca`) | scripts, smoke tests, operators with no agent |

It is built primarily for [HiQ Cortex Desktop](https://github.com/HiQ-AI/cortex-desktop)
but speaks standard MCP, so it runs unmodified against any MCP host. It is a
sibling to (and independent from) [editor-mcp-server](https://github.com/HiQ-AI/editor-mcp-server),
which *authors* the background LCI datasets that this server *consumes*.

> **Disclaimer.** Independent client — not affiliated with or endorsed by 易碳云 /
> 积木LCA. See [NOTICE](NOTICE).

## Quickstart

### Remote HTTP (no install)

Point any host that supports remote MCP at the hosted Worker. For example, with
Claude Code:

```bash
claude mcp add --transport http jimu-lca https://jimu-lca-mcp.hiq.earth/mcp \
  --header "Authorization: Bearer app:xxxxxxxxxxxxxxxxxxx"
```

The Worker reads the member key per request from `Authorization: Bearer app:…`
(or an `X-Member-Key` header) — it stores no session state.

### Local stdio (npm)

```jsonc
// MCP host config — e.g. claude_desktop_config.json
{
  "mcpServers": {
    "jimu-lca": {
      "command": "npx",
      "args": ["-y", "jimu-lca-mcp"],
      "env": { "JIMU_LCA_MEMBER_KEY": "app:xxxxxxxxxxxxxxxxxxx" }
    }
  }
}
```

### CLI

```bash
export JIMU_LCA_MEMBER_KEY=app:xxxxxxxxxxxxxxxxxxx
npx -y jimu-lca-mcp units                       # list unit groups
npx -y jimu-lca-mcp versions                    # background-DB versions
npx -y jimu-lca-mcp products list --space <id>  # products in a space
npx -y jimu-lca-mcp case overview <case-id>     # a case's stages + status
```

The CLI mirrors the MCP tool surface 1:1 — same parameter names, same response
semantics — and prints JSON by default. See [docs/architecture/tools.md](docs/architecture/tools.md).

## Authentication

A single environment variable, `JIMU_LCA_MEMBER_KEY`, holds the member key
(`app:xxxxxxxxxx`) — one per end user, obtained from the open-platform admin
console. It is the long-lived credential; the server mints short-lived Bearer
JWTs from it as needed, in memory. Never commit it. See [SECURITY.md](SECURITY.md).

## Tool surface

37 tools cover the runtime LCA loop — spaces, products, cases, model items,
background binding, calculation, and results — plus a few aggregators that
collapse common multi-call intents (e.g. `get_top_contributors`,
`create_custom_product`). Read operations are safe to call freely; write
operations are marked `destructiveHint` so a host can gate them. The full
endpoint → tool mapping, with status flags, is in
[docs/architecture/tools.md](docs/architecture/tools.md).

### Background matching and the local bridge

Binding a flow to a background LCI dataset normally means a fuzzy name search
(`search_backgrounds`) followed by a save (`bind_backgrounds`). Hosts that ship a
local copy of the LCI catalogs can skip the search: pass the dataset's
`dataset_key` to `bind_backgrounds_local`, which resolves it to 积木's binding ids
through a **version bridge** and saves in one call — faster and exact. Datasets
the bridge doesn't cover come back as `unresolved`, and the caller falls back to
the search path.

The bridge is a ~170 MB SQLite table, too big to bundle and refreshed on the
dataset's own cadence. The Worker backs it with Cloudflare D1; local hosts
provision a `.db` file (Cortex Desktop downloads it once from this repo's GitHub
Release). See [docs/architecture/local-bridge.md](docs/architecture/local-bridge.md).

### File input across transports

Some tools take a file (e.g. `import_model` uploads a filled `.xlsx`). The stdio
server and CLI accept a local `file_path`; the Worker, which has no filesystem,
accepts the file content as base64 over the wire. Tools report which form a
transport supports. See [docs/architecture/file-input.md](docs/architecture/file-input.md).

## What this does NOT cover

By design, the server does **not** wrap tenant-bootstrap/admin endpoints
(`registMember`, `queryMemberKey`, `memberToken/*`, `role/listByCompany`) or
governance writes over *other people's* access (batch membership / role updates).
Those are one-time, human-admin, or web-UI operations — not agent actions. The
reasoning, endpoint by endpoint, is in
[docs/architecture/non-goals.md](docs/architecture/non-goals.md).

## Repository layout

```
jimu-lca-mcp/
├── src/
│   ├── server.ts          # stdio MCP server entry
│   ├── cli.ts             # CLI entry (same operations as MCP tools)
│   ├── worker.ts          # Cloudflare Worker (HTTP) entry
│   ├── api.ts             # shared HTTP client       auth.ts  # memberKey → headers
│   ├── tools/             # one ToolDef per tool (+ index.ts registry)
│   ├── bridge.ts          # BridgeLookup contract + D1 backing
│   ├── sqliteBridge.ts    # local-file backing (node:sqlite)
│   ├── binding.ts files.ts search.ts env.ts logger.ts types.ts
│   └── connector/         # host connector manifest
├── docs/
│   ├── architecture/      # design + behaviour (start at overview.md)
│   ├── api/               # one .md per upstream endpoint (curated reference)
│   └── api-raw/           # the platform's raw API-portal JSON, kept as provenance
├── scripts/build-bridge.py
├── .github/workflows/release.yml
└── package.json  tsconfig.json  wrangler.toml
```

## Documentation

1. [docs/architecture/overview.md](docs/architecture/overview.md) — positioning,
   auth/env model, host-integration shape.
2. [docs/architecture/tools.md](docs/architecture/tools.md) — the endpoint → tool
   surface.
3. [docs/architecture/workflow-walkthrough.md](docs/architecture/workflow-walkthrough.md) —
   a real end-to-end traced run and its gotchas.
4. [docs/architecture/local-bridge.md](docs/architecture/local-bridge.md) ·
   [file-input.md](docs/architecture/file-input.md) ·
   [non-goals.md](docs/architecture/non-goals.md) — focused topics.
5. [docs/api/README.md](docs/api/README.md) — per-endpoint reference.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: Node ≥ 20, `npm install`,
`npm run build`, add a tool by dropping a `ToolDef` into `src/tools/` and
registering it in `src/tools/index.ts`.

## License

[Apache License 2.0](LICENSE) © HiQ-AI. See [NOTICE](NOTICE) for attributions.
