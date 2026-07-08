#!/usr/bin/env bash
#
# stamp-edge-fns.sh — deploy Supabase edge functions with the current git SHA
# baked into their bundle, so each deployed fn reports the version it is running
# (catches a stale deploy — see supabase/functions/_shared/version.ts).
#
# Usage (from repo root):
#   scripts/stamp-edge-fns.sh --project-ref <ref> [fn ...]   # deploy named fns (or all)
#   scripts/stamp-edge-fns.sh --project-ref <ref> agent-chat health
#   VER=abc1234 scripts/stamp-edge-fns.sh ...                # override the SHA
#
# The SHA is baked by overwriting _shared/version.ts, then git-reverted on exit
# (even on failure) via the trap — the working tree is never left stamped.
set -euo pipefail

FILE="supabase/functions/_shared/version.ts"
[ -f "$FILE" ] || { echo "error: run from repo root ($FILE not found)" >&2; exit 1; }

VER="${VER:-$(git rev-parse --short HEAD)}"

restore() { git checkout -- "$FILE" 2>/dev/null || true; }
trap restore EXIT

printf "export const DEPLOY_VERSION = '%s';\n" "$VER" > "$FILE"
echo "stamped $FILE = $VER"

# Everything after this script's own flags is passed through to supabase.
# `supabase functions deploy` with no fn name deploys ALL functions.
supabase functions deploy "$@"

echo "deployed at $VER — verify: curl -s <project-url>/functions/v1/health | grep $VER"
