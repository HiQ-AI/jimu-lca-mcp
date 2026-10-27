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
| **stdio** | `npx @hiq-ai/jimu-lca-mcp` | local agent hosts (Claude Desktop/Code, Cursor, Continue, …) |
| **CLI** | `jimu-lca <cmd>` (standalone binary, installation below) | agents, scripts, operators without Node/npm |

> Published to npm as **`@hiq-ai/jimu-lca-mcp`**; the binaries it installs are
> `jimu-lca-mcp` (the MCP server) and `jimu-lca` (the CLI).

Install it independently for an agent or shell; Cortex Desktop no longer bundles
this package or downloads its bridge resources. It remains a sibling to (and
independent from) [editor-mcp-server](https://github.com/HiQ-AI/editor-mcp-server),
which *authors* the background LCI datasets that this client *consumes*.

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
      "args": ["-y", "@hiq-ai/jimu-lca-mcp"],
      "env": { "JIMU_LCA_MEMBER_KEY": "app:xxxxxxxxxxxxxxxxxxx" }
    }
  }
}
```

### Standalone CLI

The native release supports **macOS Apple Silicon**, matching the verified target
for this delivery. No installed Node, npm, Bun, Desktop, or MCP server is required.
One install command also prepares the CLI's local binding bridge:

```bash
curl -fsSL https://github.com/HiQ-AI/jimu-lca-mcp/releases/download/cli-v0.2.1/install.sh | sh
```

The installer verifies the binary's SHA-256, installs `~/.local/bin/jimu-lca`, and
runs `install-bridge`. Use `sh -s -- --directory /YOUR/BIN` for a different command
directory. It refuses to replace an existing file; user configuration and existing
credentials are not modified. Add the command directory to PATH if needed, or use
the printed absolute executable path in the current agent session.

To give an agent the task, ask: "Read the standalone CLI installation section at
https://github.com/HiQ-AI/jimu-lca-mcp#standalone-cli, install it, and verify help
and version; do not configure a Desktop connector or call business APIs before I
supply my own memberKey."

The macOS binary is ad-hoc signed, not Developer-ID signed or notarized. This is
not a Windows/Intel Mac/Linux release. Native `login` does not bundle the optional
keytar addon; supply `JIMU_LCA_MEMBER_KEY` through your host's controlled credential
mechanism instead. Installing the CLI/bridge needs no memberKey.

```bash
jimu-lca --help
jimu-lca version                         # same value as --version
# Set your own memberKey through your host's controlled credential mechanism.
jimu-lca get-units --query kg
jimu-lca list-background-db-versions
jimu-lca list-products --space-id YOUR_SPACE_ID
jimu-lca get-case-overview --case-id YOUR_CASE_ID
```

Source remains in this repository and the existing `@hiq-ai/jimu-lca-mcp` package.
The historical npm 0.2.0 release remains deprecated; this native release does not
publish an extra npm patch or restore the withdrawn Cortex Desktop connector,
skill marketplace entry, or old catalog binding compatibility. Source builds use
Node.js >= 22.13.0; standalone builds use pinned Bun 1.4.4 (same single-file
compile pattern as cortex-org-wiki-cli), reusing all existing business commands.
`cli-v*` tags publish native assets through this repository's existing GitHub
Release channel; ordinary `v*` tags retain the existing npm workflow.

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

### Background matching, and the optional local bridge

Binding a flow to a background LCI dataset normally means a fuzzy **name search**
(`search_backgrounds`) followed by a save (`bind_backgrounds`). This is the
default path and **works for everyone — no extra data needed.**

Why search by name at all? Because 积木 **re-IDs every dataset when it imports a
background database**: a dataset's 积木-internal uuid is assigned at import and is
*not* the standardized source uuid. Even for Ecoinvent, 积木's uuid is not the
official Ecoinvent uuid — and HiQLCD and other libraries are the same. So a host
that holds the standardized catalogs locally can't name a 积木 dataset by its
catalog uuid directly; the two id spaces are disjoint, which is why the universal
path falls back to matching by name.

The **local bridge** is an optional accelerator for the one case where that gap
can be closed: 积木's per-version mapping export preserves each dataset's original
pre-import uuid, which *does* equal the standardized catalog uuid. Precomputing
that into a lookup table (catalog uuid + version + system model → 积木's binding
ids) supports `bind-backgrounds-local` in the CLI. The input remains a source
activity UUID (or the historical UUID_version form), not a current opaque Relic
`dataset_key`. This patch does not change that binding contract; use
`search-backgrounds` + `bind-backgrounds` when it does not apply. The bridge's
finite version coverage is not a guarantee of current upstream dataset coverage.

`jimu-lca install-bridge` downloads the existing v0.2.0 gzip (~57 MB) from
`download.hiq.earth`, verifies the decompressed SHA-256, and atomically installs
`~/.jimu-lca/v0.2.0/bridge.db` (~170 MB). Re-running verifies/reuses that file.
Neither help/version nor ordinary remote commands download anything. CLI and
stdio MCP resolve the existing `JIMU_LCA_BRIDGE_DB` override first, then this
installation, then the legacy package-local data path. No automatic Desktop
provisioning is involved. The optional bridge is unnecessary for name-search
binding; the Worker still uses its existing D1 path, unchanged by this release.
See [docs/architecture/local-bridge.md](docs/architecture/local-bridge.md).

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

See [CONTRIBUTING.md](CONTRIBUTING.md). In short: Node >= 22.13.0, `npm install`,
`npm run build`, add a tool by dropping a `ToolDef` into `src/tools/` and
registering it in `src/tools/index.ts`.

## License

[Apache License 2.0](LICENSE) © HiQ-AI. See [NOTICE](NOTICE) for attributions.
