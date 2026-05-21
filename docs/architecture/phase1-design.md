# Phase 1 — runtime design

This page is the design that the upcoming runtime code lands against. It
covers three deliverables in **one shared codebase**:

1. **`jimu-lca-mcp` — stdio MCP server.** What `npx -y jimu-lca-mcp` runs.
   Used by Claude Code / Cursor / Continue / Cortex Desktop's local-MCP
   slot.
2. **`jimu-lca` — subprocess-friendly CLI.** Same operations as MCP tools
   exposed as subcommands with JSON-by-default output, so a host agent
   (or a shell script) can call `jimu-lca list-products --space=xxx
   --json` and parse the result. v0 is **not** an agent-in-a-CLI; the
   agent-native chat variant is Phase 2 (see "CLI evolution" below).
3. **`jimulca-mcp` Cloudflare Worker — HTTP MCP server.** Hosted at
   `https://jimulca-mcp.hiq.earth/mcp` (planned hostname). What Cortex
   Desktop's future **Connector** directory points at; same wire
   protocol as the stdio server, different transport.

All three share **one core**: the same tool implementations, the same API
client, the same auth strategy (with one config-source switch). The three
entry points are thin adapters around the shared core.

## Cortex Connector — what it is, and why our design accommodates it

Claude Desktop's `Settings → Customize → Connectors` directory ships
HTTP-based MCP integrations (Gmail / Google Drive / Calendar / Canva /
Notion / …). Each Connector lists:

- A `Connector URL` (e.g. `https://gmailmcp.googleapis.com/mcp/v1`)
- An author + privacy / docs links
- A Tools list (the MCP tool names the connector exposes)
- A Connect button that triggers an OAuth-like flow or credential prompt

Cortex Desktop's planned Connectors feature mirrors this model. For
`jimu-lca-mcp` to appear as a Connector in Cortex's directory (and
secondarily in Claude Desktop's), the **HTTP transport** is required —
stdio child processes aren't how the Connector pattern works.

Cortex-side Connector implementation is **suspended** per the user, but
this design ensures jimu-lca-mcp is **ready** the day Cortex's
Connectors infrastructure ships:

- HTTP MCP is built from day one (Cloudflare Worker)
- A `connector/manifest.json` lives in the repo with the metadata Cortex
  (or any directory) needs
- Auth model supports both env-var (stdio/CLI) and header-injection
  (Connector OAuth-equivalent)

## Repository layout

```
jimu-lca-mcp/
├── package.json                  # multi-bin: { "jimu-lca-mcp", "jimu-lca" }; "exports" for Worker
├── tsconfig.json
├── wrangler.toml                 # Cloudflare Workers config (worker entry)
├── src/
│   ├── server.ts                 # entry — stdio MCP server (`jimu-lca-mcp` bin)
│   ├── cli.ts                    # entry — subprocess-friendly CLI (`jimu-lca` bin)
│   ├── worker.ts                 # entry — Cloudflare Worker (HTTP MCP)
│   ├── auth.ts                   # memberKey extraction (env / header) + validation
│   ├── api.ts                    # shared HTTP client to open.ecdigit.com
│   ├── env.ts                    # base-URL switcher (prod/pre/dev), defaults
│   ├── types.ts                  # shared TS types: ToolDef, ToolContext, ApiResult, ...
│   ├── tools/                    # ONE FILE PER TOOL — pure handlers + schema
│   │   ├── index.ts              #   exports allTools[]
│   │   ├── get_units.ts
│   │   ├── list_background_db_versions.ts
│   │   ├── list_calculation_methods.ts
│   │   ├── list_spaces.ts
│   │   ├── list_space_members.ts
│   │   ├── list_models.ts
│   │   ├── list_products.ts
│   │   ├── get_product.ts
│   │   ├── get_case_overview.ts     # 🧩 aggregator
│   │   ├── get_data_config.ts
│   │   ├── copy_case.ts
│   │   ├── delete_case.ts
│   │   ├── list_data_items.ts
│   │   ├── edit_data_items.ts
│   │   ├── export_elements_excel.ts
│   │   ├── import_elements_excel.ts
│   │   ├── calculate_case.ts        # 🧩 aggregator
│   │   ├── list_case_calculation_methods.ts
│   │   ├── get_lcia_detail.ts
│   │   ├── get_sensitivity.ts
│   │   └── create_product.ts
│   ├── cli/
│   │   ├── format.ts             # JSON ↔ human-readable rendering
│   │   └── commands.ts           # wires allTools[] into yargs/commander subcommands
│   └── connector/
│       └── manifest.json         # Connector directory metadata (Anthropic-style)
└── tests/                        # gitignored — local-only
```

## Shared core — the tool contract

Every tool exports a uniform interface:

```ts
// src/types.ts
export interface ToolDef<TArgs = unknown, TResult = unknown> {
  name: string;                       // "list_products"
  description: string;                // shown to the LLM
  inputSchema: ZodObject<any>;        // validated by all three entries
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  handler: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
  /** CLI helpers, only relevant to the CLI adapter — optional. */
  cli?: {
    summary: string;                  // shown in --help
    renderHuman?: (result: TResult) => string;  // pretty-print mode
  };
}

export interface ToolContext {
  memberKey: string;                  // already validated as 'app:...'
  baseUrl: string;                    // https://open.ecdigit.com/openapi by default
  fetch: typeof globalThis.fetch;     // workers-compatible
  logger: Logger;
}
```

Each tool file looks like:

```ts
// src/tools/list_products.ts
import { z } from 'zod';
import type { ToolDef } from '../types.js';
import { apiPost } from '../api.js';

const Args = z.object({
  space_id: z.string().optional().describe('Optional space id to scope to'),
  group_id: z.string().optional().describe('Optional group/folder id'),
  name: z.string().optional().describe('Optional fuzzy name filter'),
  page: z.number().int().default(1),
  size: z.number().int().default(10),
});

export const listProducts: ToolDef<z.infer<typeof Args>> = {
  name: 'list_products',
  description: 'Paginate the tenant\'s product catalog ...',
  inputSchema: Args,
  annotations: { readOnlyHint: true },
  async handler(args, ctx) {
    return apiPost(ctx, '/lca/v3/getBrandPage', args);
  },
  cli: {
    summary: 'List products, paginated',
    renderHuman: (r) => /* nice table */ '',
  },
};
```

`src/tools/index.ts` collects them:

```ts
import { getUnits } from './get_units.js';
import { listProducts } from './list_products.js';
// ...
export const allTools = [getUnits, listProducts /* ... */];
```

The three entry points (`server.ts` / `cli.ts` / `worker.ts`) each
iterate `allTools` and register them in their respective shape.

## Entry points

### `src/server.ts` — stdio MCP (npx target)

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { allTools } from './tools/index.js';
import { contextFromEnv } from './auth.js';

const server = new McpServer({ name: 'jimu-lca', version: VERSION });
const ctx = await contextFromEnv();  // reads JIMU_LCA_MEMBER_KEY

for (const t of allTools) {
  server.registerTool(
    t.name,
    { description: t.description, inputSchema: t.inputSchema.shape, annotations: t.annotations },
    async (args) => {
      const result = await t.handler(args, ctx);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );
}

await server.connect(new StdioServerTransport());
```

### `src/cli.ts` — subprocess-friendly CLI

```bash
# All subcommands accept --json (default), --pretty (human-readable table)
jimu-lca units
jimu-lca versions
jimu-lca methods --version-id=<id>
jimu-lca spaces
jimu-lca space members --space=<id> [--role=owner|admin|member]
jimu-lca models [--name=<kw>] [--flag=own|EC]
jimu-lca products --space=<id> [--page=1] [--size=10]
jimu-lca product --brand=<id>
jimu-lca case --case=<id>                              # full overview, the aggregator
jimu-lca case data --case=<id> --process=<id>
jimu-lca case edit --case=<id> --edits='[{...}]'       # batch edit
jimu-lca calc --case=<id> --method=<id> [--target=<id>]
jimu-lca lcia --case=<id> --record=<id> --target=<id>
jimu-lca sensitivity --record=<id> --factor=<id> --target=<id>
jimu-lca version
jimu-lca login                                          # writes JIMU_LCA_MEMBER_KEY to OS keychain
```

Properties:

- **JSON by default** — every command outputs the same JSON shape an MCP
  tool call would return. Pipe-friendly: `jimu-lca products --space=x |
  jq '.[].name'`.
- **`--pretty`** flag triggers a table/tree renderer per command. Useful
  for humans; LLMs use JSON.
- **No interactive REPL in v0.** That's the agent-native CLI in Phase 2.
- **`jimu-lca login`** stores the memberKey via `keytar` (OS keychain) so
  subsequent calls don't need the env var; CLI reads from keychain
  first, env second.
- **Exit codes are meaningful**: 0 success, 1 API error (rate limit /
  server error), 2 auth missing, 3 invalid args, 4 validation failure
  from the open platform.

Library choice: `yargs` (mature, has structured commands + builtin
`--help` per subcommand). Avoid commander.js — it doesn't handle
sub-sub-commands as cleanly.

### `src/worker.ts` — Cloudflare Worker (HTTP MCP)

Cloudflare Workers run TS natively and have first-class fetch — no
adapter shim needed. The Worker mounts the MCP HTTP transport at `/mcp`:

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
// or StreamableHTTPServerTransport per the latest SDK
import { allTools } from './tools/index.js';
import { contextFromRequest } from './auth.js';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
    }

    if (url.pathname.startsWith('/mcp')) {
      const ctx = await contextFromRequest(request, env);  // pulls memberKey from header
      const server = new McpServer({ name: 'jimu-lca', version: VERSION });
      // register tools using same shared core
      registerAll(server, ctx);
      const transport = new SSEServerTransport('/mcp', request);
      await server.connect(transport);
      return transport.response;
    }

    if (url.pathname === '/manifest.json') {
      return new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } });
    }

    return new Response('Not found', { status: 404 });
  },
};
```

Deploy: `wrangler deploy`. Custom domain `jimulca-mcp.hiq.earth`
configured via the Cloudflare dashboard (CNAME or Worker route).

Worker characteristics:

- **No cold-start tax** to worry about — Workers are ~10ms warm
- **Pricing**: free tier covers 100k requests/day, well above expected
  usage for v0
- **No persistent storage needed** — every request is self-contained
  (memberKey in header, no session)
- **HTTPS by default**, CN users hit the HKG edge

## Auth strategy

One internal function, two sources:

```ts
// src/auth.ts
const MEMBER_KEY_RE = /^app:[a-zA-Z0-9]+$/;

export function validateMemberKey(key: string | undefined | null): string {
  if (!key) throw new ConfigError('memberKey missing — set JIMU_LCA_MEMBER_KEY or pass X-Member-Key header');
  if (!MEMBER_KEY_RE.test(key)) throw new ConfigError(`invalid memberKey format: expected 'app:...', got ${key.slice(0, 8)}...`);
  return key;
}

export async function contextFromEnv(): Promise<ToolContext> {
  const memberKey = validateMemberKey(process.env.JIMU_LCA_MEMBER_KEY ?? await readKeychain());
  return { memberKey, baseUrl: resolveBaseUrl(process.env.JIMU_LCA_BASE_URL), fetch, logger };
}

export async function contextFromRequest(req: Request, env: Env): Promise<ToolContext> {
  // Connector-style: Cortex / Claude Desktop injects the memberKey in a header
  // when the user connects via the Connector UI.
  const memberKey = validateMemberKey(req.headers.get('x-member-key') ?? req.headers.get('authorization')?.replace(/^Bearer /i, ''));
  return { memberKey, baseUrl: env.JIMU_LCA_BASE_URL ?? PROD_BASE_URL, fetch, logger };
}
```

Header convention (`X-Member-Key` or `Authorization: Bearer app:...`):
both supported because different Connector UIs send credentials in
different shapes. The Cortex Connector directory entry's "Connect" flow
will collect the memberKey (paste-or-OAuth) and inject it on every
forwarded request.

## Connector manifest

`src/connector/manifest.json` describes the integration in the shape
Cortex (or Claude Desktop / any directory) expects:

```jsonc
{
  "name": "积木 LCA 3.0",
  "id": "jimu-lca",
  "description": "Drive product-carbon-footprint workflows on 积木LCA 3.0 — create products, edit data items, calculate LCIA, drill into sensitivity. Built for HiQ Cortex Desktop.",
  "author": {
    "name": "HiQ",
    "url": "https://hiq.earth"
  },
  "version": "0.1.0",
  "connector_url": "https://jimulca-mcp.hiq.earth/mcp",
  "transport": "http+sse",
  "auth": {
    "type": "credential",
    "credential_name": "memberKey",
    "credential_format": "app:[0-9a-zA-Z]+",
    "instructions": "Get your member key from the 易碳云开放平台 admin (open.ecdigit.com/oplatform).",
    "header": "X-Member-Key"
  },
  "tools": [
    "get_units", "list_background_db_versions", "list_calculation_methods",
    "list_spaces", "list_space_members",
    "list_models",
    "create_product", "list_products", "get_product",
    "get_case_overview", "get_data_config", "copy_case", "delete_case",
    "list_data_items", "edit_data_items", "export_elements_excel", "import_elements_excel",
    "calculate_case", "list_case_calculation_methods",
    "get_lcia_detail", "get_sensitivity"
  ],
  "links": {
    "documentation": "https://github.com/HiQ-AI/jimu-lca-mcp",
    "support": "https://github.com/HiQ-AI/jimu-lca-mcp/issues",
    "privacy_policy": "https://hiq.earth/privacy"
  },
  "categories": ["lca", "carbon-footprint", "manufacturing"]
}
```

Cortex's Connector directory consumes this manifest verbatim. The exact
field names will evolve with Cortex's spec (Cortex side is suspended);
this shape mirrors what Claude Desktop's Connectors display.

## CLI evolution — Phase 2 agent-native variant

v0 ships **only** the subprocess-friendly CLI. A future Phase 2 adds
a separate binary (`jimu-lca-chat` or `jimu-lca interactive`) that:

- Opens a Claude-Code-style REPL
- Builds on `@anthropic-ai/claude-agent-sdk` (or equivalent)
- Auto-registers the local `jimu-lca-mcp` as an MCP server
- Adds slash commands: `/login`, `/space`, `/clear`, `/help`,
  `/scope <space>`
- Supports one-shot mode: `jimu-lca-chat "build me an LCA for product X"`
- Uses the user's Anthropic API key (BYOK) — no infrastructure cost
  on our side

Deferred because:

- The subprocess-friendly CLI satisfies the immediate "I want to script
  against 积木LCA" need without an LLM in the loop
- Agent-native CLI is a bigger UX investment (system prompt, slash
  commands, conversation memory, permission gating)
- Users who want agent-in-CLI today already have Claude Code / Cursor
  with our stdio MCP server attached

## Phase order

| Phase | Deliverable | Status |
|---|---|---|
| 1A | Tool handlers + stdio MCP server (`src/server.ts`) | next |
| 1B | Subprocess-friendly CLI (`src/cli.ts`) | next |
| 1C | Cloudflare Worker (`src/worker.ts`) + manifest + custom domain | next |
| 2 | Cortex Connector directory entry | **suspended** (Cortex-side work) |
| 2 | Agent-native CLI (`jimu-lca-chat`) | deferred |
| 2 | Multi-user memberKey mapping (for hosted SaaS Cortex) | deferred |

Phase 1A/B/C ship together as v0.1.0 to npm + Cloudflare. After they
prove out, Phase 2 lands incrementally.

## Open questions for first implementation pass

- **Cloudflare Worker bundling** — `@modelcontextprotocol/sdk` may pull
  Node-only deps. Validate the worker bundle size + edge compatibility
  before committing to CF; fallback is a tiny Node server on existing
  K3s with a direct LoadBalancer (skipping APISIX, as decided).
- **Excel binary handling in Worker** — `exportElementData` returns
  ~50KB Excel. Workers can stream binary fine, but the SDK's content
  shape for binary tool results needs verification.
- **CLI error UX vs JSON output** — when a call errors, do we emit JSON
  `{ "error": {...} }` to stdout (good for piping) or stderr (good for
  human shells)? Plan: stderr by default, `--errors-as-json` flag for
  pipe-friendly mode.
- **Custom domain on Cloudflare** — `jimulca-mcp.hiq.earth` requires
  the `hiq.earth` zone to be on Cloudflare. Already there per
  [[reference_cloudflare_proxy_decision]], just need the CNAME +
  Worker route.
