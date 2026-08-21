#!/usr/bin/env bash
# The owner frontier — and a check that nothing is hiding from it.
#
# WHY THIS EXISTS. The frontier query used to AND `wayfinder:ticket` with the resolver label. On
# 2026-08-21 that returned EMPTY while three owner questions sat open: they had been parked with the
# resolver label alone and never wired to a map. The session read empty as "no owner questions",
# declared a DRIVE session, and spent ~150K tokens without asking anything. It was executing a wrong
# answer correctly.
#
# An empty frontier is a CLAIM. This script is what checks it: it prints the frontier AND exits
# non-zero on an orphan, so a bad answer cannot look like a calm one.
set -euo pipefail

REPO="${WAYFINDER_REPO:-ariefsaid/PMO}"
RESOLVERS=(owner director factory)

# ── the frontier, keyed on the RESOLVER label alone ─────────────────────────────────────────────
# Keyed on the resolver because that is what the drive loop branches on. Requiring a second label to
# agree adds a way to be silently wrong and buys nothing.
echo "── owner frontier ──"
frontier=$(gh issue list --repo "$REPO" --state open --label wayfinder:owner --limit 100 \
  --json number,title,body \
  --jq '.[] | select((.body|test("Blocked-by")|not)) | "  #\(.number)  \(.title)"')
if [ -n "$frontier" ]; then
  echo "$frontier"
  echo
  echo "→ GRILL session: drain ALL of the above in one sitting, batched into /grilling rounds."
else
  echo "  (empty)"
  echo
  echo "→ DRIVE session — but only if the orphan check below is clean."
fi
echo

# ── orphans: a ticket parked into a place nobody looks ──────────────────────────────────────────
# Parking is three fields (docs/factory-workflow.md § The drive loop). Any one missing hides it.
echo "── orphan check ──"
orphans=0
for r in "${RESOLVERS[@]}"; do
  while IFS=$'\t' read -r num title labels body_head; do
    [ -z "${num:-}" ] && continue
    problems=""
    case "$labels" in *wayfinder:ticket*) ;; *) problems="${problems}no wayfinder:ticket label; ";; esac
    case "$body_head" in "Map: #"*) ;; *) problems="${problems}body's first line is not \`Map: #<n>\`; ";; esac
    # A sub-issue knows its own parent, so this needs no map-by-map scan.
    # ⚑ The field is `parent_issue_url`. There is NO `.parent` on the REST issue object — reading one
    #   yields empty for EVERY issue, so the check reports every ticket as an orphan and looks like it
    #   is working. Caught by running it against four tickets that had just been linked by hand.
    if ! gh api "repos/$REPO/issues/$num" --jq '.parent_issue_url // empty' 2>/dev/null | grep -q .; then
      problems="${problems}not a sub-issue of any map; "
    fi
    if [ -n "$problems" ]; then
      orphans=$((orphans + 1))
      printf '  ⚠ #%s [%s] %s\n      %s\n' "$num" "$r" "$title" "${problems%; }"
    fi
  done < <(gh issue list --repo "$REPO" --state open --label "wayfinder:$r" --limit 100 \
             --json number,title,labels,body \
             --jq '.[] | [.number, .title, ([.labels[].name]|join(",")), (.body|split("\n")[0])] | @tsv')
done

if [ "$orphans" -eq 0 ]; then
  echo "  clean — every resolver-labelled ticket is wired to a map."
  exit 0
fi
echo
echo "  $orphans ticket(s) are parked where no frontier query will find them."
echo "  Fix each before trusting the frontier above (docs/factory-workflow.md § The drive loop):"
echo "    gh issue edit <n> --add-label wayfinder:ticket"
echo "    # prepend 'Map: #<map>' as the body's FIRST line"
echo "    gh api repos/$REPO/issues/<map>/sub_issues -F sub_issue_id=\$(gh api repos/$REPO/issues/<n> --jq .id)"
echo "    # ⚑ -F not -f: -f sends the id as a string and the API rejects it"
exit 1
