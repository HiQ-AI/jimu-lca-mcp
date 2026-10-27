#!/usr/bin/env bash
# Reuse the GitHub Release -> existing S3/CloudFront channel used by HiQ CLIs.
set -euo pipefail
TAG=${1:?Usage: mirror-to-cdn.sh cli-vVERSION [AWS_PROFILE]}
[[ "$TAG" =~ ^cli-v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { printf '%s\n' 'Invalid CLI tag' >&2; exit 2; }
VERSION=${TAG#cli-v}
AWS=(aws)
[ -z "${2:-}" ] || AWS+=(--profile "$2")
BUCKET=cortex-desktop-downloads
ROOT=cli/jimu-lca
WORK=$(mktemp -d "${TMPDIR:-/tmp}/jimu-lca-cdn.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

gh release download "$TAG" --repo HiQ-AI/jimu-lca-mcp --dir "$WORK" \
  --pattern jimu-lca-darwin-arm64 --pattern checksums.txt --pattern install.sh
(cd "$WORK" && shasum -a 256 -c checksums.txt)
for name in jimu-lca-darwin-arm64 checksums.txt install.sh; do
  "${AWS[@]}" s3api put-object --bucket "$BUCKET" --key "$ROOT/v$VERSION/$name" \
    --body "$WORK/$name" --if-none-match '*' \
    --cache-control 'public,max-age=31536000,immutable' >/dev/null
done
# This first release creates the stable installer without replacing an old one.
"${AWS[@]}" s3api put-object --bucket "$BUCKET" --key "$ROOT/install.sh" \
  --body "$WORK/install.sh" --if-none-match '*' --content-type 'text/plain; charset=utf-8' \
  --cache-control 'public,max-age=300' >/dev/null
DIST=$("${AWS[@]}" cloudfront list-distributions --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, 'download.hiq.earth')].Id" --output text)
[ -n "$DIST" ] && [ "$DIST" != None ] || { printf '%s\n' 'Download distribution not found' >&2; exit 1; }
"${AWS[@]}" cloudfront create-invalidation --distribution-id "$DIST" --paths "/$ROOT/*" --query 'Invalidation.Id' --output text
