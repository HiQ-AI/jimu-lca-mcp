#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Same standalone Bun distribution pattern as cortex-org-wiki-cli.
[ "$(bun --version)" = '1.4.4' ] || { printf '%s\n' 'Build requires Bun 1.4.4' >&2; exit 1; }
mkdir -p build/native
bun build src/cli.ts --compile --target=bun-darwin-arm64 --external keytar \
  --no-env-file --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --outfile build/native/jimu-lca-darwin-arm64
codesign --force --sign - build/native/jimu-lca-darwin-arm64
codesign --verify --strict build/native/jimu-lca-darwin-arm64
build/native/jimu-lca-darwin-arm64 --version
VERSION=$(bun --no-env-file -e 'console.log((await Bun.file("package.json").json()).version)')
sed "s/__VERSION__/$VERSION/g" scripts/install.sh > build/native/install.sh
(cd build/native && shasum -a 256 jimu-lca-darwin-arm64 > checksums.txt)
