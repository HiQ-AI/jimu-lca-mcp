#!/usr/bin/env bash
# Build the local bridge DB from bridge.sql, gzip it, and attach it to a
# GitHub Release as `bridge.db.gz` — the asset Cortex Desktop downloads on
# first run (see docs/architecture/local-bridge.md).
#
# CI can't do this (the bridge is built from operator-only 背景数据映射管理
# exports), so it's a one-command operator step per dataset refresh.
#
# Usage:
#   scripts/release-bridge.sh <release-tag>      # e.g. v0.2.0
#
# Prereqs: bridge.sql present (built via build-bridge.py), sqlite3, gh (authed).
set -euo pipefail

TAG="${1:?usage: release-bridge.sh <release-tag>   (e.g. v0.2.0)}"
cd "$(dirname "$0")/.."

[ -f bridge.sql ] || {
  echo "error: bridge.sql not found in $(pwd)" >&2
  echo "build it first: python3 scripts/build-bridge.py <exports>.xlsx -o bridge.sql" >&2
  exit 1
}

echo "→ building bridge.db from bridge.sql ..."
rm -f bridge.db bridge.db.gz
sqlite3 bridge.db < bridge.sql

echo "→ gzipping ..."
gzip -kf bridge.db

# sha256 of the DECOMPRESSED db — this is the value the desktop provisioner's
# EXPECTED_SHA256 should be pinned to for integrity verification.
if command -v sha256sum >/dev/null 2>&1; then
  SHA=$(sha256sum bridge.db | cut -d' ' -f1)
else
  SHA=$(shasum -a 256 bridge.db | cut -d' ' -f1)
fi

DB_SIZE=$(du -h bridge.db | cut -f1)
GZ_SIZE=$(du -h bridge.db.gz | cut -f1)

echo "→ uploading bridge.db.gz to release ${TAG} ..."
gh release upload "${TAG}" bridge.db.gz --clobber

echo
echo "✓ done."
echo "  bridge.db      ${DB_SIZE}"
echo "  bridge.db.gz   ${GZ_SIZE}  → uploaded to release ${TAG}"
echo "  decompressed sha256: ${SHA}"
echo
echo "Pin this in the desktop provisioner (jimuBridgeProvisioner.ts):"
echo "  const BRIDGE_RELEASE = '${TAG}'"
echo "  const EXPECTED_SHA256 = '${SHA}'"
