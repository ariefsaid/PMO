# SSSF trial — process record (run `270858e4`, 2026-08-06)

The first real issue through an SSSF ADW: the AdminUsers own-row self-edit gate (PR #436, merged to
`dev` as `c7adfaee`). Plan artifact: `docs/plans/2026-08-06-admin-self-edit-gate.md`. Stamp: PR #435.

> ⚑ **Why this file exists:** the run's SQLite trace (`adws/adw_data/sssf.db`) and per-agent session
> artifacts lived inside the trial worktree and were deleted with it during post-merge cleanup —
> unrecoverable. This file preserves what survived: the phase transcript and the cross-family review,
> verbatim. **Cleanup rule since:** archive `adws/adw_data/` out of a worktree BEFORE
> `git worktree remove`.

## Phase transcript (ADW console, verbatim)

```
adw_id: 270858e4   engineer Arief Said
▶ 01 request  engineer · Arief Said  Capture the incoming ask
  · input: UX-gate the self-edit affordances on pmo-portal/pages/AdminUsers.tsx. …
  ✓ request 0.0s
▶ 02 plan  agent · planner  Turn the request into an implementable plan
  ▸ planner zai/glm-5.2  session sssf-270858e4-planner-631b
  ✓ gate artifacts_exist 2 checked
    · adws/adw_data/sessions/270858e4/context_handoff/plan.md — exists, 9.3KB
    · specs/270858e4_admin-self-edit-gate.md — exists, 9.3KB
  ✓ gate files_non_empty 2 checked
  ✓ PlanOutput Plan to omit (hide) the 'Edit role' and 'Change manager' row-menu items on the
    signed-in caller's own row in AdminUsers.tsx via an isSelf guard, TDD'd with a n…
  └ planner used 333,229 tokens · $0.0000
  ✓ plan 191.2s
▶ 03 build  agent · builder  Implement the plan exactly
  ▸ builder zai/glm-5.2  session sssf-270858e4-builder-eab6
  ✓ BuildOutput Gated the per-row 'Edit role' and 'Change manager' affordances off on the
    signed-in caller's own row in AdminUsers.tsx (matching the page's omit-unavailable-ac…
  └ builder used 668,943 tokens · $0.0000
  ✓ build 1038.3s
▶ 04 test_1  code · quality  Run the suite — a known command, so code runs it
  · quality test: scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm test'
  · quality test: passed (exit 0, 240.7s)
  ✓ test_1 240.8s
▶ 05 commit  code · git  Land the code only after the suite came back green
  · sha: f18d0b12, message: Gate Admin self-edit role/manager affordances on the own-row (0179 RLS)
  ✓ commit 0.2s
status ✓ success · phases 5/5 · tokens 1,002,172 · cost $0.0000
```

## Director verification (outside the ADW)

- **Mutation check:** `isSelf` guard broken by hand → `AdminUsers.selfedit.test.tsx` went RED; restored.
- **Rendered check:** localhost as the seed Admin — own row offers only Disable; another user's row
  offers Edit role · Change manager · Disable.
- **Cross-family review:** `pi-dispatch review` (gpt-5.6-luna), 3 lenses in one pass — below.
- **`npm run verify:locked`:** all 8 gates green before push; CI (verify + pgtap) green on PR #436.

## Cross-family review (verbatim, `review-findings.md` from the dispatch)

**Verdict: APPROVE.** Zero Critical / zero Important findings across all three lenses.

- **Lens 1 — spec fidelity:** implementation matches intent exactly; the only non-null
  `setEditTarget` callers are the two gated items, so gating the menu fully gates the modals — no
  bypass path. Two Minor notes: (1) the stale-ledger sweep folded unrelated (but independently
  verified) backlog strikes into a single-issue branch, and the original branch name blurred the
  scope (branch renamed in response); (2) "rendered-verified" in the backlog could over-read as a
  full Discover pass — it was a Director rendered check, defensible for a two-item menu omission.
- **Lens 2 — code quality:** naming/null-safety/comment accuracy all verified against source
  (`RowMenuItem` really has no disabled field; 0179 really denies self-row UPDATE; the
  `admin_set_user_status` RPC really carries its own lockout guard). Test mock hygiene byte-for-byte
  consistent with the `AdminUsers.disable.test.tsx` sibling; positive menu-open control before the
  negative assertions; mutation-bound to the shipped `rowMenu`. ADW `quality.py` lock wiring correct
  per the CLAUDE.md lock rules (only the heavy vitest suite takes the test lock). One stylistic Minor.
- **Lens 3 — security:** purely subtractive change; no RLS/policy/migration touched; no enforcement
  moved to the FE; 0179's Admin-carve-out means peer-Admin edits are NOT over-restricted; worst-case
  FE bypass still dies at the DB with 42501, independently re-proven by pgTAP
  (`0172_profiles_hierarchy_write.test.sql`). No findings.

## Trial findings → iterate list

1. Planner `writes:` boundary points at repo-root `specs/` (upstream default) — re-aim at
   `docs/plans/` in `sssf.config.yaml` + the planner prompt.
2. `adw_plan_build_test` has no reviewer phase — the 3-lens battery stayed Director-dispatched.
   Next: a PMO ADW chain plan → build → test → cross-family review.
3. Builder: 17 min for a 9-line change (plan-fidelity overhead; acceptable).
4. **Preserve `adws/adw_data/` before worktree cleanup** — the lesson this file embodies.
5. Ship (branch/PR/merge/gates) stays Director work — by design, no change.

Verdict recommended to owner: **iterate** — adopt for bounded build slices, land fixes 1+2 before
making it the default dispatch path.
