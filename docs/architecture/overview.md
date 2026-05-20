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

## Cortex Desktop integration shape

```
Cortex Desktop  (the host's MCP integration layer)
   │
   │ existsSync(the host plugin directory/skills/jimu-lca-product-carbon/SKILL.md)
   │   true → register MCP server:
   │
   ↓
{
  jimu-lca: {
    type: 'stdio',
    command: 'uvx',
    args: ['--from', 'jimu-lca-mcp@latest', 'jimu-lca-mcp-server'],
    env: { JIMU_LCA_MEMBER_KEY: userConfig.jimuLcaMemberKey,
           JIMU_LCA_BASE_URL: userConfig.jimuLcaBaseUrl ?? 'https://open.ecdigit.com/openapi' },
  }
}
```

Mirrors the existing Cowork / Observer / Computer-Use stdio MCP pattern. The
desktop settings UI exposes a `memberKey` field; cortex stores it in
`the host data directory` (per-user, not shared infra).

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
