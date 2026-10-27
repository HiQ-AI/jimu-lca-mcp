# JiMULCA CLI

Standalone `jimu-lca` for the existing **积木LCA 3.0** product-carbon-footprint
operations on 易碳云开放平台 (<https://cloud.ecdigit.com/jimulca>). It reuses this
repository's business commands, HTTP client and SQLite binding bridge; it does
not implement a new LCA engine.

Independent client, not affiliated with or endorsed by 易碳云 / 积木LCA. See
[NOTICE](NOTICE) and [Apache-2.0 license](LICENSE).

## Install

Current native release: **0.2.1, macOS Apple Silicon only**. No preinstalled Node,
npm, Bun, Desktop or MCP server is required. One command installs the executable
and prepares its local binding resource:

```sh
curl -fsSL https://download.hiq.earth/cli/jimu-lca/install.sh | sh
```

To give an agent the task:

> Install JiMULCA CLI using https://download.hiq.earth/cli/jimu-lca/install.sh ,
> then verify help/version. Do not configure a Desktop connector or call business
> APIs before I supply my own memberKey.

The installer downloads the versioned binary from the same CDN, verifies its
SHA-256 and version, installs `~/.local/bin/jimu-lca`, and runs `install-bridge`.
For another command directory, append `| sh -s -- --directory /YOUR/BIN` instead
of `| sh`. It refuses to replace an existing file or symlink. Add that directory
to PATH if needed; an agent can use the printed absolute executable path in the
current session. Installation needs no account key and changes no credentials.

The binary is **ad-hoc signed, not Developer-ID signed or notarized**. No
Windows/Intel Mac/Linux release is claimed. No cross-platform business or GUI
acceptance is implied by the installation check.

## Use

```sh
jimu-lca --help
jimu-lca version                         # same version as --version
jimu-lca get-units --help
# Supply your own memberKey through your host's controlled credential mechanism.
jimu-lca get-units --query kg
jimu-lca list-background-db-versions
jimu-lca list-products --space-id YOUR_SPACE_ID
jimu-lca get-case-overview --case-id YOUR_CASE_ID
```

`JIMU_LCA_MEMBER_KEY` is the existing per-user credential (`app:xxxxxxxx`), obtained
from the open-platform admin console. It grants API access as that member; never
commit it, put it in an agent prompt, or include it in a report. The existing
optional source-mode `login` command uses keytar, but that native addon is not
bundled in this standalone release: use host-controlled `JIMU_LCA_MEMBER_KEY`.
Short-lived manager tokens remain in memory. See [SECURITY.md](SECURITY.md).

Existing business operations remain subcommands with kebab-case options, JSON
stdout, and optional `--pretty` rendering. `--errors-as-json` gives structured
stderr for business-command failures; nonzero exit means failure. Read, edit,
bind and calculate operations retain their existing business effects. The full
operation reference remains [docs/architecture/tools.md](docs/architecture/tools.md);
its historical MCP/Worker examples are not current installation instructions.

## SQLite Bridge And Binding Boundary

Normal name-search binding uses `search-backgrounds` + `bind-backgrounds` and
needs no local bridge. For UUID-based binding, `install-bridge` downloads the
existing v0.2.0 gzip (~57 MB) from
`https://download.hiq.earth/resources/jimu-lca/v0.2.0/bridge.db.gz`, verifies the
decompressed SHA-256, and atomically installs
`~/.jimu-lca/v0.2.0/bridge.db` (~170 MB). Re-running verifies/reuses that file.
Help/version and ordinary remote commands do not download resources.

The CLI resolves an explicit `JIMU_LCA_BRIDGE_DB` first, then its own installed
resource. `bind-backgrounds-local` now opens the existing SQLite implementation.
Its input remains a source activity UUID (or the historical UUID_version form),
**not a current opaque Relic `dataset_key`**. This release does not change that
contract or extend the bridge's finite dataset/version coverage. Use normal
name-search binding when it does not apply; unresolved entries are not invented.

## Distribution And Removed MCP Surface

Cortex Desktop no longer installs this package, ships/downloads its bridge, or
provisions its runtime. Other LCA catalogs and CLIs are independent and unchanged.
The withdrawn connector and marketplace skill are not restored.

Only the CLI is built and published going forward. MCP stdio/Worker entry points,
connector metadata, SDK/Worker-only dependencies, Wrangler deployment config and
npm publishing workflow are removed. The build package keeps its existing
`@hiq-ai/jimu-lca-mcp` name but is private; it is not a new npm product. Historical
public npm versions (including their deprecated flags), GitHub assets and remote
infrastructure are not deleted or republished by this change.

`cli-vVERSION` tags build standalone assets into this repository's existing
GitHub Release channel. Consumer installation uses the existing HiQ
`download.hiq.earth` S3/CloudFront channel, under `cli/jimu-lca/vVERSION/`; the
stable `cli/jimu-lca/install.sh` pins the published version. No generic installer
service or Desktop release is introduced.

## Development And Release

Source builds require Node >= 22.13.0; native builds use pinned **Bun 1.4.4**
(the same standalone compile pattern as cortex-org-wiki-cli). Bun's native
`node:sqlite` support runs the existing SQLite queries without an adapter.

```sh
npm ci --ignore-scripts
npm run build
npm run build:cli
node scripts/check-cli.mjs build/native/jimu-lca-darwin-arm64
```

The bounded check runs help/version, existing `get-units` against a loopback
fixture, a real SQLite query through `bind-backgrounds-local`, and missing-bridge
rejection. It makes no real business API calls or writes.

After merge, tag the verified commit `cli-v0.2.1`. The release workflow builds and
checks the native binary. `bash scripts/mirror-to-cdn.sh cli-v0.2.1 AWS_PROFILE`
mirrors those verified assets using the existing bucket/distribution, with
conditional creation rather than overwriting historical objects. This first
release also creates the stable installer. Verify the actual CDN installation
in a fresh HOME and a system-only PATH without Node/npm/Bun, then execute help,
version and the bounded existing command. Build/CI success alone is not that
installation evidence.
