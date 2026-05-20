# Non-goals — what this MCP intentionally does not cover

Cataloging "no" is as load-bearing as cataloging "yes" — if a future contributor
sees a request like *"can you add registMember support so an agent can onboard
a new customer?"* they should be able to read this page and understand why the
answer is no.

## Group 1 — Bootstrap / admin endpoints (5 endpoints)

| Endpoint | Why excluded |
|---|---|
| `GET /role/listByCompany` | Admin-only; lists roles in the root tenant. Agent never needs this — role choice happens once at tenant onboarding. |
| `POST /user/registMember` | Writes a member + possibly a child company into prod. `username` / `legalPersonMobile` / `companyName` are platform-wide unique — a wrong call leaves real PII in prod. **This endpoint creates real entities; only a human admin should fire it.** |
| `POST /open/queryMemberKey` | Convenient for a sysadmin to fetch an existing member's key. Agent doesn't need to discover member keys; the memberKey is what gets *handed* to the MCP via env. |
| `POST /open/memberToken/get` | Returns a short-lived Bearer JWT useful for "open this case in the web UI"-style SaaS redirects. Cortex doesn't do that handoff from the agent today. (If we add a "deep-link" feature later, revisit.) |
| `POST /open/memberToken/refresh` | Same reason as `get` — JWT lifecycle, not needed for header-auth API calls. |

These 5 are wrapped as **CLI subcommands** if and when an admin needs a
scriptable bootstrap — but **never** as MCP tools. The container env never
holds the company-level appkey.

## Group 2 — Space membership writes (5 endpoints)

| Endpoint | Why excluded |
|---|---|
| `POST /lca/v3/addProjectSpace` | Creating a new workspace is a one-off configuration action; users do it in the web UI. |
| `GET /lca/v3/getAllUser` | Enumerates all users in the tenant (privacy-sensitive). Agent should pick from `getMembersBySpaceId` instead. |
| `POST /lca/v3/addMemberToSpaceBatch` (also used for role updates) | Adding teammates to a space is governance, not an agent task. |
| `POST /lca/v3/deleteMemberFromSpaceBatch` | Removing teammates is governance. |
| (role-modify variant of `addMemberToSpaceBatch`) | Governance. |

Reads (`list_spaces`, `list_space_members`) **are** exposed — the agent often
needs to scope its work to "the workspace I'm in".

## Group 3 — Endpoints with unclear semantics until v1

These will be revisited after we hit a real user task that needs them:

- `POST /lca/v3/publishData` — "上传报告数据". Docs are sparse; unclear whether
  this is for publishing a finished LCA to a report database, or for uploading
  attachments. Wrap once the use case appears.
- `POST /lca/v3/submitUncertaintyAnalysis` — long-running, async. Need to figure
  out how the agent polls / receives result.

## Group 4 — SaaS sibling products

The same open platform also exposes endpoints for **积木LCA云2.0** (older
version, 22 endpoints), **积木碳云3.6** (organization-level carbon
accounting, 15 endpoints), **信息服务** (carbon news / prices, 4 endpoints),
**CBAM Tool**. None of those are this MCP's scope. If Cortex wants to integrate
any of them, they get **their own** repos and MCP servers — same pattern as
this one. Do **not** add them here.

## What changes this list

Two events should cause a re-read:

1. A concrete Cortex user task can't be done with the v0 tool surface (e.g.
   "I need to invite three teammates to this LCA space" — would force
   re-evaluating Group 2).
2. A user actually completes the bootstrap dance and notices Cortex could
   automate it (would force re-evaluating Group 1, probably as the CLI route).

Until those happen, keep the surface tight.
