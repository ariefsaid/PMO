#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if (($# == 0)); then
  echo "usage: scripts/ux-proof.sh /route [/route ...]" >&2
  exit 2
fi

# #1862: ux-proof starts no server; it drives the app at SHOT_BASE (default http://localhost:5173).
# UX_PROOF_PORT points it at a dev server on another port (a parallel worktree's), and a base that
# nothing listens on fails fast here instead of timing out inside the browser.
if [ -n "${UX_PROOF_PORT:-}" ] && [ -z "${SHOT_BASE:-}" ]; then
  export SHOT_BASE="http://localhost:${UX_PROOF_PORT}"
fi
_base="${SHOT_BASE:-http://localhost:5173}"
_host="$(printf '%s' "$_base" | sed -n 's#^https\?://\([^:/]*\).*#\1#p')"
_port="$(printf '%s' "$_base" | sed -n 's#^https\?://[^:/]*:\([0-9][0-9]*\).*#\1#p')"
# only a local base is probed: a remote host is not ours to health-check from here.
case "$_host" in localhost|127.0.0.1|::1) _local=1 ;; *) _local=0 ;; esac
if [ "$_local" = 1 ] && [ -n "$_port" ] && ! node -e 'const s=require("net").connect(+process.argv[1],"localhost");s.on("connect",()=>process.exit(0));s.on("error",()=>process.exit(1))' "$_port" 2>/dev/null; then
  echo "[ux-proof] nothing is listening on $_base - start the dev server (npm run dev -- --port $_port) or set UX_PROOF_PORT/SHOT_BASE" >&2
  exit 1
fi

exec node "$ROOT/scripts/ux-proof.mjs" "$@"
