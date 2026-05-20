# Architecture overview

## Product positioning

| Surface | Repo / skill | Role |
|---|---|---|
| `editor.hiqlcd.com` (jimu_dataset) | `editor-mcp-server` + `cortex-skills/hiq-editor` | **Authors** background LCI datasets (the data library other LCAs consume) |
| `cloud.ecdigit.com/jimulca` (积木LCA 3.0) | **this repo** + `cortex-skills/jimu-lca-product-carbon` | **Consumes** background datasets to compute product carbon footprints |
| (raw report → UPR) | `cortex-skills/upr-integrated-flow` | Extracts production data from EIA reports / PDFs into a UPR Excel |

The three are complementary; an LCA practitioner moves data across all three.

## Why a separate MCP server (not extending editor-mcp-server)

| Dimension | editor.hiqlcd.com | open.ecdigit.com (积木LCA 3.0) |
|---|---|---|
| Auth | hiqlcd SSO cookie/JWT, APISIX forward-auth | `appId: app:<memberKey>` header (open platform) |
| Tenant | HiQ tenant | 易碳数科 root tenant (comId=<your-tenant>) |
| Backend access | PG direct read + HTTP write | HTTP only |
| Deployment expectation | K3s container behind APISIX route | Local stdio child process |

Two different auth models, two different tenants, two different deployment
shapes. Merging them would force `auth.py` to switch on `request_url.startswith(...)`
and would expose either credential surface to bugs in the other.

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

## Deployment shape — local stdio, not K3s

This is the most-debated decision in the design. The choice is **local stdio
MCP** (child process spawned by Cortex Desktop's claude-agent-sdk, same pattern
as Cowork / Observer / Computer-Use sub-agents). The alternative — K3s deploy
behind APISIX like `editor-mcp-server` — was considered and rejected.

### The two options side-by-side

| Dimension | Local stdio (chosen) | K3s + APISIX (rejected for v0) |
|---|---|---|
| Identity model | memberKey is a per-user secret typed into Cortex settings; one user ↔ one 积木LCA member identity | Would need server-side per-Cortex-user → memberKey mapping table (new infra) |
| SSO bridge | None needed — Cortex Desktop holds the memberKey locally, sends it as `appId` header per call | APISIX `forward-auth` validates Cortex JWT but **can't translate** to 积木LCA's `appId` header — different SSO domain, no shared session |
| Failure blast radius | Bad memberKey → only that user's MCP fails | Bad central memberKey mapping → all Cortex users impacted |
| Release cadence | `uv build && uv publish` (PyPI); user picks up via `uvx --from jimu-lca-mcp@latest` on next session | `docker build && kubectl apply` (K3s) — heavier each ship |
| Audit / observability | Only what the open API logs server-side, plus Cortex Desktop stdout if user enables debug | Could pool through one egress IP for centralised logs (theoretical benefit, no current need) |
| Rate limiting | Open API charges the memberKey owner; per-user quotas natural | Pooled through one egress IP → all users share one rate budget (worse) |
| Cold start | Local process startup; ~1–2 s | K3s pod warm; ~50 ms but pays APISIX latency |
| Geographic latency | Direct user → open.ecdigit.com (CN-side) | User → CF → AWS us-east-1 → ctyun → open.ecdigit.com (adds the trans-Pacific hop) — see [[reference_deck_latency_physics]] |
| Existing precedent | Cowork / Observer / Computer-Use all stdio | editor-mcp-server is K3s, but it shares the hiqlcd SSO with Cortex — apples to oranges |

### Why local wins for v0

1. **Auth model mismatch.** Open platform uses `appId: app:<memberKey>` header,
   not bearer JWT, not SSO cookie. APISIX forward-auth pattern (which works
   beautifully for editor-mcp-server because they share hiqlcd SSO) has nothing
   to validate against here.
2. **Multi-user is out of scope for v0.** Without per-user identity at the
   server, all the K3s benefits collapse — we'd just be running a single
   passthrough proxy with all the deployment overhead.
3. **The local-stdio precedent is already in Cortex Desktop.** No new mechanism;
   `the host's MCP integration layer` already spawns child-process MCPs for cowork, observer,
   computer-use, wiki. One more entry.
4. **Trans-Pacific latency.** Cortex Desktop → cloudflare HKG → AWS us-east-1
   → ctyun → 积木LCA round-trip would be ~700 ms; direct from desktop is
   ~150 ms. Multiply by tens of calls per LCA flow.

### When to revisit (= when K3s starts to make sense)

- Cortex grows a SaaS / hosted-cowork mode where there's no desktop to hold
  the memberKey
- Multi-tenant audit becomes a hard requirement
- Open platform offers an OAuth flow that maps Cortex JWT → memberKey at
  exchange time (would mirror editor-mcp's existing pattern)

Until one of those, we ship local. The decision is reversible; the codebase
already factors `auth.py` to read from env, so swapping env source (local
process → server-side proxy) is a contained change.

## Cortex Desktop integration shape

`the host's MCP integration layer` registers the stdio MCP when the skill is installed:

```ts
const jimuLcaSkillInstalled = existsSync(
  join(the host plugin directory, 'skills', 'jimu-lca-product-carbon', 'SKILL.md'),
)
const memberKey = userConfig.jimuLcaMemberKey  // from desktop settings, see below

if (jimuLcaSkillInstalled && memberKey) {
  mcpServers['jimu-lca'] = {
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'jimu-lca-mcp@latest', 'jimu-lca-mcp-server'],
    env: {
      JIMU_LCA_MEMBER_KEY: memberKey,
      JIMU_LCA_BASE_URL: userConfig.jimuLcaBaseUrl ?? 'https://open.ecdigit.com/openapi',
    },
  }
}
```

Two gating signals:

1. **Skill installed** — the `jimu-lca-product-carbon` skill being present in
   `the host plugin directory/skills/` says "user has opted into 积木LCA workflows".
   Same pattern as `hiq-editor` (skill presence gates editor-mcp's HTTP
   attachment).
2. **memberKey set** — without a key the MCP can't talk to the API; better to
   not spawn it than to spawn-and-fail. Settings UI shows a "missing key"
   warning when the skill is installed but the key is empty.

## Cortex Settings UI design

The Claude Desktop screenshots you sent show two affordances:

- **Settings → Developer → Local MCP servers** — power-user JSON editor; lists
  every locally-spawned MCP server in a flat array
- **Settings → Connectors** (now under "Customize") — first-class entries
  per integration

**Cortex follows the "Connectors" pattern, not the JSON-editor pattern.** Most
Cortex users are LCA practitioners, not MCP developers — they should not have
to hand-edit `claude_desktop_config.json`-style JSON. The mental model is
"integration", not "MCP server".

Proposed layout under Cortex Desktop **Settings → Integrations**:

```
┌── 积木 LCA 3.0 ─────────────────────────────────────────┐
│                                                          │
│  Status: ● Connected  (member: 张三 @ Your Tenant)   │
│                                                          │
│  Member key                                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │ app:••••••••••••••••••••                          │  │
│  └────────────────────────────────────────────────────┘  │
│  Obtain from the open-platform admin (https://open.ecdigit.com/oplatform). │
│  Stored in your OS keychain — never synced or logged.    │
│                                                          │
│  Environment   [ prod ▾ ]   prod / pre / dev             │
│                                                          │
│  [Test connection]   [Open 积木LCA web ↗]                │
└──────────────────────────────────────────────────────────┘
```

Behaviour:

- **Member key** field is `<input type="password">` so the value isn't shoulder-
  surfed. Stored via `safeStorage.encryptString(...)` (Electron API → OS
  keychain on macOS/Windows/Linux), not in `localStorage`, not in
  `the host data directory/*.json` plaintext.
- **Status pill** decodes the Bearer JWT obtained from
  `/open/memberToken/get` to surface the member name + company. (One-time
  decode, no network call between settings opens.)
- **Test connection** button calls `GET /lca/v3/getAllUnits` with the key —
  success / failure / which-error feedback inline.
- **Environment** dropdown swaps `JIMU_LCA_BASE_URL` between prod / pre / dev.
  Defaults to prod.
- **Open 积木LCA web** opens a `memberToken/get`-authenticated URL in the
  default browser, giving a one-click handoff into the web UI when the
  agent's done — solves the "show me what you built" moment.

### Why NOT a JSON config view like Claude Desktop's Developer screen

- Most Cortex users will never need to edit raw MCP config — the skill +
  field-per-integration UX covers 99% of cases
- A JSON view encourages users to bypass the skill-gating mechanism, which is
  load-bearing for permission checks ("does this user have any 积木LCA tools
  loaded?" boils down to "is the skill installed?")
- If a power user *does* need to override (e.g. point at dev env), the
  Environment dropdown covers that

Developer JSON view *can* be added later as a hidden "Settings → Developer
→ Local MCP servers" tab mirroring Claude Desktop's screenshot, but it's not
the primary path.

### Visibility gating

The 积木LCA settings tab only appears in the sidebar when the skill is
installed. Removes from sidebar if the user uninstalls the skill (same
mechanism as e.g. computer-use being hidden when its scenario isn't selected).
This keeps the settings surface clean for users who don't use 积木LCA at all.

## Multi-user model

Out of scope for v0. v0 assumes a single Cortex user (the one who has a memberKey)
operates against their own 积木LCA workspace. For team / SaaS Cortex deployments,
v1+ will need a server-side per-Cortex-user → memberKey mapping (analogous to
deck's per-user `LITELLM_*` credentials), but that's deferred — most users
just want personal LCA workspace access first.

## Blast radius (during development)

The test memberKey (张三@易碳, `app:xxxxxxxxxxxxxxxxxxx`) has access to 7 real
workspaces in prod LCA. Any **write** call during development pollutes 张三's
actual workspace. Phase-0 / Phase-1 testing is **read-only**; writes wait until
we have a sandbox space inside the prod tenant or a real test member.

## Threat model

| Risk | Mitigation |
|---|---|
| memberKey leaked from env / logs | Don't log the key; redact in error messages; advise users to store in OS keychain via desktop config, not in shell rc files |
| Agent triggers destructive endpoint by mistake | `destructiveHint=True` on write tools (create / delete / submit-calc / publish); skill `Never auto-submit` rule mirroring hiq-editor's |
| MCP server pinned to a stale version on user's machine | `uvx --from jimu-lca-mcp@latest` re-resolves to latest each invoke, like other Cortex stdio MCPs |
| Open-platform-side rate limiting | Out of scope until we hit it; doc says `频控策略 --次/秒` (unspecified) on every endpoint, no visible budget |
