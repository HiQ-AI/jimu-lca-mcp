#!/bin/sh
set -eu
VERSION='__VERSION__'
DIRECTORY="$HOME/.local/bin"
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = '--directory' ] || { printf '%s\n' 'Usage: install.sh [--directory BIN_DIRECTORY]' >&2; exit 2; }
  DIRECTORY=$2
fi
[ "$(uname -s)-$(uname -m)" = 'Darwin-arm64' ] || { printf '%s\n' 'This release supports macOS Apple Silicon only.' >&2; exit 1; }
[ ! -e "$DIRECTORY/jimu-lca" ] && [ ! -L "$DIRECTORY/jimu-lca" ] || { printf '%s\n' 'jimu-lca already exists; choose a new --directory or explicitly remove the old installation.' >&2; exit 1; }
BASE="https://github.com/HiQ-AI/jimu-lca-mcp/releases/download/cli-v$VERSION"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/jimu-lca-install.XXXXXX")
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
curl -fsSL "$BASE/jimu-lca-darwin-arm64" -o "$WORK/jimu-lca-darwin-arm64"
curl -fsSL "$BASE/checksums.txt" -o "$WORK/checksums.txt"
(cd "$WORK" && shasum -a 256 -c checksums.txt)
chmod 755 "$WORK/jimu-lca-darwin-arm64"
[ "$("$WORK/jimu-lca-darwin-arm64" version)" = "$VERSION" ] || { printf '%s\n' 'Downloaded CLI version mismatch.' >&2; exit 1; }
mkdir -p "$DIRECTORY"
mv "$WORK/jimu-lca-darwin-arm64" "$DIRECTORY/jimu-lca"
"$DIRECTORY/jimu-lca" install-bridge
printf 'Installed %s (add this directory to PATH if needed).\n' "$DIRECTORY/jimu-lca"
