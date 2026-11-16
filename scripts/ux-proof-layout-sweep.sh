#!/usr/bin/env bash
# Re-measure the layout checks on every route the word budget covers (both widths, every login the
# budget lists) and write docs/ux/layout-baseline.{json,md} shrink-only (a key not in the baseline yet
# needs --seed-new, passed through: scripts/ux-proof-layout-sweep.sh --seed-new; UX_PROOF_BLOCK_READS=1 for the
# reads-failing state). Needs the app on the rich seed
# at SHOT_BASE (SWEEP_LOGINS=a@acme.test,b@acme.test limits the logins) (default http://localhost:5173) and the role sessions in pmo-portal/e2e/.auth.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
node -e '
const b = JSON.parse(require("fs").readFileSync("docs/ux/word-budget.json", "utf8"));
const by = {};
for (const key of Object.keys(b)) {
  const m = key.match(/^(\/.*)@(\d+)@([^@]+@[^@]+)$/);
  if (m) (by[m[3]] ||= new Set()).add(m[1]);
}
const only = (process.env.SWEEP_LOGINS || "").split(",").filter(Boolean);
for (const [login, routes] of Object.entries(by)) if (!only.length || only.includes(login)) console.log(login + "\t" + [...routes].join("\t"));
' | while IFS=$'\t' read -r login routes_line; do
  IFS=$'\t' read -r -a routes <<<"$routes_line"
  UX_PROOF_AUTH="$login.json" UX_PROOF_WIDTHS=390,1440 node scripts/ux-proof.mjs --layout-only --update-layout-baseline "$@" "${routes[@]}"
done
