# Architecture overview

## Product positioning

| Surface | Repo / skill | Role |
|---|---|---|
| `editor.hiqlcd.com` (jimu_dataset) | `editor-mcp-server` + `cortex-skills/hiq-editor` | **Authors** background LCI datasets (the data library other LCAs consume) |
| `cloud.ecdigit.com/jimulca` (积木LCA 3.0) | **this repo** + `cortex-skills/jimu-lca-product-carbon` | **Consumes** background datasets to compute product carbon footprints |
| (raw report → UPR) | `cortex-skills/upr-integrated-flow` | Extracts production data from EIA reports / PDFs into a UPR Excel |

The three are complementary; an LCA practitioner moves data across all three.

## Why a separate MCP server (not extending editor-mcp-server)

| Dimension | editor-mcp-server (editor.hiqlcd.com) | this repo (open.ecdigit.com / 积木LCA 3.0) |
|---|---|---|
| Auth | SSO session — works for users on the HiQ tenant | `appId: app:<memberKey>` header — different open-platform tenant |
| Backend access | Mix of DB read + HTTP write | HTTP only |
| Deployment shape | Remote HTTP behind a gateway | Local stdio child process |

Two different auth models, two different tenants, two different deployment
shapes. Merging them would force `auth.py` to branch on the upstream URL and
would expose either credential surface to bugs in the other.

## Environment URLs

| Env | open API base | LCA 3.0 web UI |
|---|---|---|
| dev | `https://open.ecdigit.cn/openapi` | `https://saas-dev.ecdigit.cn/jimulca` |
| pre | `https://open-pre.ecdigit.com/openapi` | `https://saas-pre.ecdigit.com/jimulca` |
| **prod** | **`https://open.ecdigit.com/openapi`** | `https://cloud.ecdigit.com/jimulca` |

Notes:

- **dev is `.cn`, prod is `.com`.** Easy to confuse — the docs site's curl
  examples always paste `open.ecdigit.cn` even when documenting prod endpoints.
- `JIMU_LCA_BASE_URL` defaults to prod; override for dev/pre.

## Auth model

Two layers, fully separate:

### 1. Bootstrap (admin, one-time per tenant)

```
公司级 appkey  ← issued in 易碳 open platform admin (https://open.ecdigit.com/oplatform)
   │
   │ POST /role/listByCompany         (no auth header; companyId or companyName)
   │ POST /user/registMember          (creates member + child company, PII write)
   │ POST /open/queryMemberKey        (look up an existing member by orgSign+name+mobile)
   ↓
memberKey: app:xxxxxxxxxx
```

The MCP server does **not** know the company appkey, does **not** call any of
these endpoints. They live with whoever provisions Cortex access for a 易碳
customer (a one-off setup, usually done in the web admin). See
[non-goals.md](non-goals.md).

### 2. Runtime (per LCA call)

```
JIMU_LCA_MEMBER_KEY=app:xxxxxxxxxx  ← env var read at MCP server startup
   │
   │ Each HTTP call to /lca/v3/*
   │   Header: appId: app:xxxxxxxxxx
   ↓
积木LCA 3.0 backend
```

**Critical** — the `app:` prefix is part of the value. Sending the bare digits
returns `"还未配置成员"` (member not configured) even when the digits *are* a
valid member id.

The memberKey is **long-lived** (no expiry observed; Bearer-JWT tokens derived
from it have ~30-day expiry, but those are only needed for SaaS-UI redirects,
which Cortex doesn't do from the agent).

## Deployment shape — local stdio, not remote HTTP

The choice is **local stdio MCP** (child process spawned by the host as a
standard MCP server, per the
[MCP specification](https://modelcontextprotocol.io/)). The alternative — a
remote HTTP MCP behind a gateway (the pattern `editor-mcp-server` uses for
HiQ's internal SSO domain) — was considered and rejected for v0.

### Side-by-side

| Dimension | Local stdio (chosen) | Remote HTTP + gateway (rejected for v0) |
|---|---|---|
| Identity model | memberKey is a per-user secret in the host's config; one user ↔ one 积木LCA member identity | Would need a server-side per-user → memberKey mapping table (new infra) |
| SSO bridge | None needed — host holds the memberKey locally, sends it as `appId` header per call | Gateway `forward-auth` would need a way to translate an upstream agent's auth into 积木LCA's `appId` header — and there's no shared SSO to bridge |
| Failure blast radius | Bad memberKey → only that user's MCP fails | Bad central mapping → every downstream user impacted |
| Release cadence | `uv build && uv publish` (PyPI); user picks up `uvx --from jimu-lca-mcp@latest` on next session | `docker build && kubectl apply` — heavier each ship |
| Audit / observability | Open-platform server-side logs, plus host stdout if user opts into debug | Could pool through one egress IP for centralised logs (theoretical, no current need) |
| Rate limiting | Open API charges the memberKey owner; per-user quotas natural | Pooled through one egress IP — all users share one rate budget |
| Cold start | Local process startup; ~1–2 s | Gateway-routed pod warm ~50 ms, but pays the network hop |
| Geographic latency | Direct user → open.ecdigit.com (CN-side) | If hosted outside CN, would add a trans-Pacific hop per call |
| Operational precedent | Cursor / Claude Code / Cortex Desktop all spawn stdio MCPs already; well-trodden | Each host has a different remote-MCP story; less portable |

### Why local wins for v0

1. **Auth model mismatch.** Open platform uses `appId: app:<memberKey>` header,
   not bearer JWT, not SSO cookie. Gateway forward-auth patterns (which work
   when host SSO and target SSO share a tenant) have nothing to validate
   against here.
2. **Multi-user is out of scope for v0.** Without per-user identity at the
   server, the centralised-deploy benefits collapse — it'd be a single
   passthrough proxy with all the deployment overhead.
3. **Stdio is the universal MCP transport.** Every major MCP-capable agent
   host already spawns stdio child processes — Claude Code, Cursor, Continue,
   OpenAI Codex extensions, and Cortex Desktop all do it. One mechanism,
   maximum host coverage.
4. **Geographic latency.** Hosting outside CN adds a trans-Pacific hop per
   call; local-spawn keeps the user → open.ecdigit.com path direct.

### When to revisit (= when remote HTTP starts to make sense)

- A target host grows a "no local processes" mode (e.g. fully cloud-hosted
  agent runs)
- Multi-tenant audit becomes a hard requirement
- Open platform offers an OAuth flow that exchanges a host's auth token for a
  memberKey at the network edge (would mirror editor-mcp-server's existing
  pattern)

Until one of those, we ship local. The decision is reversible; `auth.py`
reads memberKey from env, so swapping env source (local process →
server-side proxy) is a contained change.

## Host integration

This MCP is built primarily for
[HiQ Cortex Desktop](https://github.com/HiQ-AI/cortex-desktop) — the AI-powered
LCA data workbench this entire repo orbits. It also works unmodified against
any other MCP-capable host because the auth surface is a single env var.

### Generic host config (Claude Code / Cursor / Continue / OpenAI Codex / …)

Add to the host's MCP server registry (the format varies per host, but the
underlying spawn pattern is identical):

```jsonc
{
  "mcpServers": {
    "jimu-lca": {
      "command": "uvx",
      "args": ["--from", "jimu-lca-mcp@latest", "jimu-lca-mcp-server"],
      "env": {
        "JIMU_LCA_MEMBER_KEY": "app:xxxxxxxxxxxxxxxxxxx",
        "JIMU_LCA_BASE_URL": "https://open.ecdigit.com/openapi"
      }
    }
  }
}
```

The `JIMU_LCA_BASE_URL` defaults to prod and can be omitted. Storage of the
key is up to the host — most hosts read this config file directly, so prefer
putting the key in a separate secrets file you reference via an env-var
indirection.

### Cortex Desktop integration (primary target)

Cortex Desktop has a richer integration than the bare-bones JSON config:

1. **Skill-gated registration** — when the
   `jimu-lca-product-carbon` skill is installed (skill marketplace UI),
   Cortex Desktop registers this MCP. Uninstall the skill, the MCP detaches.
2. **Settings UI** — Cortex Desktop's Integrations panel exposes a dedicated
   card for 积木LCA: member-key input (stored in the OS keychain, never on
   disk in plaintext), prod/pre/dev environment switcher, "Test connection"
   button, "Open 积木LCA web" deep-link.
3. **Status indicator** — the card decodes the member's JWT once on open to
   show the logged-in identity.

(The Cortex Desktop source has its own settings-UI implementation; this repo
doesn't ship it. See
[HiQ-AI/cortex-desktop](https://github.com/HiQ-AI/cortex-desktop) for that
side of the integration.)

### Settings-UI pattern (for any agent host considering rich MCP-config)

Most hosts today expose MCP servers via a JSON editor (
*Settings → Developer → Local MCP servers* in Claude Desktop, similar in
Cursor / Continue). That's fine for developer hosts. For end-user
workbenches like Cortex Desktop where the user is a domain expert (LCA
practitioner) rather than an MCP author, a per-integration card with typed
inputs is a better fit. Sketch:

```
┌── 积木 LCA 3.0 ─────────────────────────────────────────┐
│                                                          │
│  Status: ● Connected  (member: 张三 @ Your Tenant)        │
│                                                          │
│  Member key                                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │ app:••••••••••••••••••••                          │  │
│  └────────────────────────────────────────────────────┘  │
│  Obtain from the open-platform admin                     │
│  (https://open.ecdigit.com/oplatform).                   │
│  Stored in your OS keychain — never synced or logged.    │
│                                                          │
│  Environment   [ prod ▾ ]   prod / pre / dev             │
│                                                          │
│  [Test connection]   [Open 积木LCA web ↗]                │
└──────────────────────────────────────────────────────────┘
```

Recommended behaviour:

- **Member key** field is `<input type="password">` so the value isn't
  shoulder-surfed. Stored via the host's OS-keychain integration (e.g.
  `safeStorage.encryptString(...)` in Electron-based hosts), not in
  `localStorage`, not in plaintext JSON anywhere on disk.
- **Status pill** decodes the Bearer JWT obtained from
  `/open/memberToken/get` to surface the member name + company. One-time
  decode, no network call between settings opens.
- **Test connection** button calls `GET /lca/v3/getAllUnits` with the key —
  success / failure / which-error feedback inline.
- **Environment** dropdown swaps `JIMU_LCA_BASE_URL` between prod / pre / dev.
  Defaults to prod.
- **Open 积木LCA web** opens a `memberToken/get`-authenticated URL in the
  default browser, giving a one-click handoff into the web UI when the
  agent's done — solves the "show me what you built" moment.

### Visibility gating

In hosts that support skill / extension gating, the settings card should
appear only when the corresponding skill (or feature flag) is enabled —
keeps the settings surface clean for users who don't use 积木LCA at all.

## Multi-user model

Out of scope for v0. v0 assumes a single user (the one who holds the
memberKey) operates against their own 积木LCA workspace. For team / SaaS
deployments, v1+ will need a server-side per-user → memberKey mapping
(see the "remote HTTP" tradeoffs above), but that's deferred — most users
just want personal LCA workspace access first.

## Blast radius (during development)

During Phase 0 development the maintainer's memberKey is used (a real prod
key against a real prod workspace, since the open platform has no sandbox
environment that's actually wired up for this tenant). All Phase 0 / Phase 1
smoke tests are therefore **read-only**; write-path verification waits until
either (a) a dedicated sandbox space exists inside the prod tenant, or
(b) we have a test member whose workspaces only contain throwaway data.
See `docs/security.md` (TBD) for the credential-handling discipline this
implies.

## Threat model

| Risk | Mitigation |
|---|---|
| memberKey leaked from env / logs | Don't log the key; redact in error messages; advise users to store in OS keychain via desktop config, not in shell rc files |
| Agent triggers destructive endpoint by mistake | `destructiveHint=True` on write tools (create / delete / submit-calc / publish); skill `Never auto-submit` rule mirroring hiq-editor's |
| MCP server pinned to a stale version on user's machine | `uvx --from jimu-lca-mcp@latest` re-resolves the latest version each invoke (works the same in any stdio-MCP host) |
| Open-platform-side rate limiting | Out of scope until we hit it; doc says `频控策略 --次/秒` (unspecified) on every endpoint, no visible budget |
