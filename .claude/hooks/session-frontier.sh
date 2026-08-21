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

owner, director, build, unlabelled = [], 0, 0, []
for i in issues:
    if i["state"] != "OPEN":
        continue
    names = {l["name"] for l in i["labels"]}
    # ⚑ Key on the RESOLVER label, NOT on `wayfinder:ticket`. Requiring both was the
    # 2026-08-21 bug: #527/#523/#518 were parked with the resolver label alone, fell to
    # the `elif` below, and were counted as ordinary BUILD issues — so this hook opened
    # every session that day with "wayfinder frontier drained" while four owner questions
    # sat waiting. A session then spent ~150K tokens on director work without asking one.
    # The resolver is what the session-kind branch actually turns on; making a second
    # label agree adds a way to be silently wrong and buys nothing.
    resolver = names & {"wayfinder:owner", "wayfinder:director", "wayfinder:factory"}
    if resolver:
        if "wayfinder:ticket" not in names:
            unlabelled.append(i["number"])
        if not unblocked(i.get("body", "")):
            continue
        if "wayfinder:owner" in names:
            owner.append((i["number"], i["title"]))
        elif "wayfinder:director" in names:
            director += 1
    elif not names & {"wayfinder:map", "wayfinder:ticket"}:
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

# Free to check — the labels are already in hand — and it names the exact repair. A parked
# ticket still wants `wayfinder:ticket`, `Map: #<n>` as its first body line, and the native
# sub-issue link; only the first is checkable here without a per-issue API call, and a slow
# SessionStart hook gets disabled.
if unlabelled:
    ids = " ".join(f"#{n}" for n in unlabelled[:8])
    lines.append(f"⚠ {len(unlabelled)} resolver-labelled ticket(s) missing `wayfinder:ticket`: {ids}"
                 " — add it, plus `Map: #<n>` as the first body line and the sub-issue link.")

if lines:
    print("\n".join(lines))
' 2>/dev/null
exit 0
