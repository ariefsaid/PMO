#!/usr/bin/env bash
# SessionStart: surface the real wayfinder frontier so a session does not open by
# hand-querying it — and getting it wrong. (#501)
#
# Two failures on 2026-08-19 motivated this, both from hand-running the query:
#   * a ticket parked on an EXTERNAL event was reported as a pending owner question
#     twice, because it was still open and still labelled wayfinder:owner;
#   * three tickets were called "blocked" after their blockers had closed.
#
# ⚑ The naive filter — drop anything whose body mentions `Blocked-by` — is WRONG,
# and is the bug that produced the second failure. A ticket is unblocked when every
# id it names is CLOSED. This resolves that from a single listing rather than one
# API call per ticket, because a slow SessionStart hook gets disabled.
set -uo pipefail
command -v gh >/dev/null 2>&1 || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

ALL=$(gh issue list --state all --limit 400 \
        --json number,title,state,labels,body 2>/dev/null) || exit 0
[ -z "$ALL" ] && exit 0

printf '%s' "$ALL" | python3 -c '
import json, re, sys
try:
    issues = json.load(sys.stdin)
except Exception:
    sys.exit(0)

state = {i["number"]: i["state"] for i in issues}

def unblocked(body):
    m = re.search(r"Blocked-by:([^\n]*)", body or "")
    if not m:
        return True
    # Unblocked only when EVERY named blocker is closed. An id we have never seen
    # is treated as open — fail closed, so a stale reference cannot look ready.
    ids = [int(n) for n in re.findall(r"#(\d+)", m.group(1))]
    return all(state.get(i, "OPEN") == "CLOSED" for i in ids)

owner, director, build = [], 0, 0
for i in issues:
    if i["state"] != "OPEN":
        continue
    names = {l["name"] for l in i["labels"]}
    if "wayfinder:ticket" in names:
        if not unblocked(i.get("body", "")):
            continue
        if "wayfinder:owner" in names:
            owner.append((i["number"], i["title"]))
        elif "wayfinder:director" in names:
            director += 1
    elif not names & {"wayfinder:map"}:
        build += 1

lines = []
if owner:
    lines.append(f"⚑ GRILL session — {len(owner)} owner ticket(s) unblocked. Drain them ALL:")
    lines += [f"    #{n}  {t}" for n, t in owner[:8]]
    if len(owner) > 8:
        lines.append(f"    … and {len(owner)-8} more")
elif director:
    lines.append(f"DRIVE session — owner frontier empty · {director} director ticket(s) ready · {build} build issue(s) open.")
else:
    # Quiet when there is nothing to say: a hook that prints a wall every session
    # gets ignored, which is worse than not having it.
    if build:
        lines.append(f"DRIVE session — wayfinder frontier drained · {build} build issue(s) open.")

if lines:
    print("\n".join(lines))
' 2>/dev/null
exit 0
