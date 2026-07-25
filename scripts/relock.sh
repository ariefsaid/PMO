#!/usr/bin/env bash
# Regenerate pmo-portal/package-lock.json the way CI can consume it.
#
# ⚑ WHY THIS EXISTS: running `npm install` (or even `npm install --package-lock-only`) on
# macOS/arm64 PRUNES the wasm32-wasi optional deps — `@emnapi/core`, `@emnapi/runtime`, reached
# via `@tailwindcss/oxide-wasm32-wasi` — from the lockfile. Linux CI then fails `npm ci` with
# "Missing: @emnapi/core@… from lock file". This happens even with an UNCHANGED package.json,
# so the lock is simply not reproducible from a Mac. Generating it in a linux node:22 container
# (what CI actually runs) keeps every platform's optional deps in the tree.
#
# Usage:
#   scripts/relock.sh                      # re-resolve from package.json
#   scripts/relock.sh update dompurify     # any npm subcommand, run in the container
#
# After this, run `npm ci` locally to sync node_modules to the new lock.
set -euo pipefail

APP="$(cd "$(dirname "$0")/../pmo-portal" && pwd)"

if ! docker info >/dev/null 2>&1; then
  echo "relock: docker is not running — start it (the lock MUST NOT be regenerated on macOS)." >&2
  exit 1
fi

cd "$APP"
if [ "$#" -eq 0 ]; then
  set -- install
fi
docker run --rm -v "$APP":/w -w /w node:22 npm "$@" --package-lock-only

# The pruning bug is silent, so assert the canary entries survived.
for pkg in "@emnapi/core" "@emnapi/runtime"; do
  if ! grep -q "\"node_modules/$pkg\"" package-lock.json; then
    echo "relock: FAILED — $pkg missing from the lock; CI's npm ci would fail." >&2
    exit 1
  fi
done
echo "relock: OK — lock regenerated with platform-optional deps intact. Run 'npm ci' to sync."
