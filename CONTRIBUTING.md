# Contributing to jimu-lca-mcp

Thanks for your interest in improving jimu-lca-mcp. This project is an
independent MCP server + CLI for the 易碳云开放平台 积木LCA 3.0 API; contributions
of bug fixes, new tool wrappers, and documentation are welcome.

## Prerequisites

- **Node.js ≥ 20** (the built-in `node:sqlite` used by the local bridge needs a
  recent Node; CI builds on Node 22).
- **npm** (the repo uses `package-lock.json`).
- A **memberKey** (`app:xxxxxxxx`) from the open-platform admin console is needed
  only to exercise the live API (tests, manual CLI runs) — not to build or typecheck.

## Setup

```bash
git clone https://github.com/HiQ-AI/jimu-lca-mcp.git
cd jimu-lca-mcp
npm install
npm run build        # tsc → dist/  (this is the check a PR must pass)
```

## The three entry points

One shared core (`src/api.ts`, `src/auth.ts`, `src/tools/`) is served three ways.
Run any of them locally:

```bash
export JIMU_LCA_MEMBER_KEY=app:xxxxxxxxxxxxxxxxxxx

npm run dev                       # stdio MCP server (tsx src/server.ts)
npx tsx src/cli.ts units          # CLI — same operations as subcommands
npm run worker:dev                # Cloudflare Worker (HTTP) via wrangler
```

| Entry | File | Transport |
|---|---|---|
| MCP server | `src/server.ts` | stdio |
| CLI | `src/cli.ts` | subprocess / shell |
| Worker | `src/worker.ts` | HTTP (Cloudflare Workers) |

## Adding a tool

1. Create `src/tools/<name>.ts` exporting a `ToolDef` (see any existing tool for
   the shape: `name`, `description`, `inputSchema` (zod), `annotations`,
   `handler`, and a `cli` summary).
2. Import and push it into `allTools` in `src/tools/index.ts`. No other
   registration is needed — all three entry points iterate `allTools`.
3. Keep the tool transport-agnostic: read files via the `src/files.ts` helpers
   (which accept `file_path` on stdio/CLI and base64 over the Worker), and never
   read process state directly — everything comes through `ToolContext`.
4. `npm run build` must pass (no `tsc` errors).

Design boundaries worth respecting: see [docs/architecture/overview.md](docs/architecture/overview.md)
for what this server wraps and [docs/architecture/non-goals.md](docs/architecture/non-goals.md)
for what it deliberately does **not** (admin/governance endpoints).

## Tests

The `tests/` directory is **git-ignored** — its fixtures can carry real customer
case data, and the suite runs against the **live prod API** with your memberKey.
So tests are local-only; a PR is not expected to include or pass them. The
contribution gate is `npm run build` (a clean `tsc`). If your change has a
reproducible behaviour you want to lock in, describe the manual steps in the PR.

## Pull requests

- Branch from `main`, keep the change focused, and explain the "why" in the
  description.
- Run `npm run build` before pushing.
- Note any change to a tool's input/output shape — downstream skills and hosts
  depend on these contracts.
- Be precise in tool `description` strings: they are the agent's only guide to a
  tool, so a wrong or vague description is a runtime bug, not a doc nit.

## Secrets

Never commit a memberKey, JWT, or `.env`. The memberKey is a per-user credential
that grants full API access as that member; it lives only in an environment
variable (or the host's OS keychain), never on disk in the repo. See
[SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the
project's [Apache License 2.0](LICENSE).
