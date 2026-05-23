# Security Policy

## Reporting a vulnerability

Please report security issues **privately**, not in a public issue:

- Open a [GitHub Security Advisory](https://github.com/HiQ-AI/jimu-lca-mcp/security/advisories/new)
  on this repository (preferred), or
- email **security@hiq.earth** with the details and, if possible, a reproduction.

We aim to acknowledge a report within a few business days. Please give us a
reasonable window to ship a fix before any public disclosure.

## What's in scope

This is a client for a third-party API (易碳云开放平台 积木LCA 3.0). In-scope issues
are those in **this code** — for example:

- leakage of the memberKey or a derived token (logs, error messages, telemetry);
- a tool that performs a destructive write without the documented confirmation
  contract;
- path traversal or arbitrary file read/write via a file-bearing tool;
- the Cloudflare Worker exposing data or operations across tenants.

Vulnerabilities in the upstream 易碳云 platform itself are out of scope here —
report those to the platform operator.

## How credentials are handled

- **memberKey** (`app:xxxxxxxx`) is the only credential. It is a per-user secret
  that grants full API access as that member. The server reads it from the
  `JIMU_LCA_MEMBER_KEY` environment variable (or, for the CLI, the OS keychain via
  the optional `keytar` dependency) — never from a file in the repo, and it is
  never written to logs.
- Short-lived Bearer JWTs minted from the memberKey live in memory only.
- The local **bridge** database contains only public dataset id mappings (no
  credentials, no customer data).

## Supported versions

Only the latest published version receives security fixes. Pin a version you
trust and upgrade promptly when a fix is released.
