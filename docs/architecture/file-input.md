# File input across transports

Some operations take a file as input. Today the only one is `import_model`, which
uploads a filled model-template `.xlsx` to 积木LCA's `excel/importModelData` endpoint
to build a whole model in a single call. This document defines how file-bearing
tools accept input so that the **same tool works identically across all three
transports**, rather than each tool re-deciding how to read a file.

## The constraint

The tool surface is served three ways, with different host capabilities:

| Transport | Host | Local filesystem? |
|---|---|---|
| stdio MCP | desktop / editor host child process | yes |
| CLI | a developer shell | yes |
| Cloudflare Worker (HTTP) | isolate, no disk | **no** |

The desktop app connects over the **HTTP Worker**. A tool that accepts only a
server-side `file_path` therefore cannot run from the desktop — the Worker has no
filesystem to read the path from. File input must be expressible as data carried in
the request, not only as a path on the server.

## Principle

A file-bearing tool accepts a **transport-agnostic file input**, and a single shared
resolver turns it into bytes regardless of how the tool was reached. The caller
supplies exactly one form:

| Form | Field(s) | Works on | Used by |
|---|---|---|---|
| Content | `file_base64` (+ `filename`) | every transport | HTTP hosts (desktop), and anyone holding bytes |
| Path | `file_path` | transports with a filesystem | CLI, stdio MCP |

`file_base64` is the universal form; `file_path` is a host-side convenience. A future
`file_url` form can be added the same way without changing any tool signature.

## Contract

```
import_model({ case_id, file_path?, file_base64?, filename? })
```

- Provide `file_path` **or** `file_base64` (exactly one). The tool description states
  which to use per context: a CLI / stdio host passes `file_path`; an HTTP host passes
  `file_base64` (with `filename` for the multipart part name).
- A shared `resolveFileInput(args, ctx)` returns `{ bytes, filename }`:
  - `file_base64` → decode in-process (no filesystem needed; works everywhere).
  - `file_path` → read via `node:fs` when available; on a host without a filesystem
    (the Worker) it fails fast with a `transport` error that names `file_base64` as
    the supported form.
- The tool builds the multipart upload from `bytes` and posts it upstream. The upload
  logic is identical across transports; only acquisition of `bytes` differs.

## Host integration

- **Desktop (HTTP):** the agent generates the model spreadsheet locally (the
  `jimu-lca` skill's `build_import_xlsx` script), reads its content, and passes
  `file_base64`. The host need not expose a filesystem to the Worker.
- **CLI:** keeps `--file <path>` ergonomics; the path is read locally before the
  request is built.
- **stdio MCP:** either form works; a path is natural since the server shares the
  host's disk.

## Why the spreadsheet import stays the primary builder

`excel/importModelData` builds the full stage→process→item structure **and**
auto-matches background datasets by name in one upstream call. The granular JSON
endpoints (`brand/addBatchElement` and friends) add items to an already-created
process but do not reproduce that one-shot structure-plus-auto-match. The spreadsheet
import therefore remains the primary one-call model builder. A JSON-native builder, if
introduced later, is an additional tool with its own trade-offs (more upstream calls,
explicit matching), not a replacement — and it would not change this file-input
contract, which exists for the spreadsheet path.

## Scope

Any future file-bearing tool (report generation, export round-trips, attachment
upload) adopts the same `resolveFileInput` contract instead of re-implementing path
handling. This keeps "how a file gets in" a single, transport-aware decision rather
than a per-tool one.
