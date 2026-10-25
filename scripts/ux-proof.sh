#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if (($# == 0)); then
  echo "usage: scripts/ux-proof.sh /route [/route ...]" >&2
  exit 2
fi

exec node "$ROOT/scripts/ux-proof.mjs" "$@"
