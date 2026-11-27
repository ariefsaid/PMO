#!/usr/bin/env bash
# Content-addressed bundles: include the actual build environment and command (consent differs).
set -euo pipefail
out=$1
shift
if [ "${CI:-}" != "true" ]; then
  exec npx vite build --outDir "$out" "$@"
fi
key=$( { git rev-parse HEAD; if [ -f .env.local ]; then cat .env.local; fi; env | sort | sed -n '/^VITE_/p'; printf '%s\n' "$out" "$*"; } | sha256sum | cut -d' ' -f1)
cache_dir="${RUNNER_TEMP:-/tmp}/pmo-e2e-builds/$key"
if [ -d "$cache_dir" ]; then
  rm -rf "$out"
  cp -a "$cache_dir" "$out"
else
  npx vite build --outDir "$out" "$@"
  mkdir -p "$(dirname "$cache_dir")"
  cp -a "$out" "$cache_dir"
fi
