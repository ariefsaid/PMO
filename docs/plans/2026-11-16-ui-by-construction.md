# Screens built right by construction

Date: 2026-11-16. Owner priority (P0). Tickets: #2492 (parent), #2493, #2494, #2495, #2496, #2497, #2498, with #2042.

## The problem, in the owner's words
"We spent 4–5 days last week in UI redesigns but you're still missing a lot." · "You keep setting up fresh-eye reviewers; after 5 times you're still missing a lot of the basic stuff. Is it the harness being a footgun?" · "Why not just ask to do a redesign instead of a fresh-eye review?"

## What produces the defects (measured on `dev`, 2026-11-16)
1. Spacing is set by hand at every call site: 2,912 spacing classes in 243 files under `pmo-portal/pages`, about 1,750 in feature components, 423 in the shared primitives.
2. Builders did not render their work; looks were judged later, once, from whole-page screenshots.
3. `scripts/ux-proof.sh` compares a screen with its own baseline, so what is already wrong passes. One visual snapshot in the e2e suite. No page shows the shared components.
4. A standing minimal-code mode on every worker prefers browser-native controls and the shortest diff.
5. Native controls instead of the vendored library: 42 date inputs, 166 selects (#2042 open since 2026-11-08).

A review lists defects after the fact. The fix is to remove what makes them.

## Method from now on: screen owners
One worker owns a screen: it designs, builds and looks at its own render (1920, 1440, 1024, 390; every reachable state; at least three look-rounds; measured edges in its report). Fixes go into the shared component, not the page. "Same as before" is never an accept. A reviewer is a last look, never the method.

## Train 1: v0.41.1, UI fixes (owner, 2026-11-16 22:50: production after CI)
Only what the owner pointed at. Commits are `fix(ui):`.

| Item | Branch |
|---|---|
| Entry row of the item table aligned | on `dev` (#2486) |
| Overview: task row inset, lone attention item top-aligned, money rows on shared columns | `ariefsaid/ui-1116-a` |
| Project header hierarchy | `ariefsaid/ui-1116-b` |
| Picker tag column; Stock tab bar fixed in place | `ariefsaid/ui-1116-c` |
| One `DateField` replaces every native date input | `ariefsaid/ui-1116-d-datefield` |
| Document preview as a large dialog (#2498) | `ariefsaid/ui-1116-g-docviewer` |
| Test-only: journeys pick seed records by name | `fix/pfe-001-owned-project` |

Steps: each branch judged from its before/after at actual size → one batch PR to `dev` (merge commits) → release PR to `main` → checks green (a red is fixed from its trace, never re-run blind) → merge → version PR v0.41.1 → site deploy (no schema or function change expected; verify before deploying) → the three demo steps re-walked read-only. Fallback: production stays on v0.41.0; a branch not READY by 02:30 ships later.

## Train 2: demo screens redesigned (owner reviews 2026-11-17 08:00; demo 09:30)
Screen owners, in order: purchase request (record, side panel, new form) `ariefsaid/redesign-1116-r2-purchase` → project page → contract, progress claim, invoice → stock. Each lands on `dev` with before/after pictures; nothing reaches `main` without the owner's review. Whole-app findings from the five fixed rules: `ariefsaid/ui-1116-e-rules-sweep`.

## After the demo: the structural fix
| Phase | What | Ticket | Done when |
|---|---|---|---|
| 0 | Screen-owner method in `docs/design-workflow.md`, `docs/orca-dispatch.md` and the UI brief template; minimal-code mode off for UI tasks | #2495 | one UI task run end to end under it |
| 1 | Fixed layout rules on every route, run by the builder and in CI, with a planted-breach self-test | #2493 | every route passes or has a ticketed exception |
| 2 | Layout components own all spacing; ESLint refuses one-off spacing in screens; shrinking allowlist; demo screens first | #2492 | allowlist for `pmo-portal/pages/**` empty |
| 3 | Component gallery, judged once by the owner | #2494 | every shared component in every state |
| 4 | Native controls replaced: dropdowns, time, file, disclosure, tooltips; lint refuses raw ones | #2496, #2042 | zero outside shared components |

Order: 0 and 1 first (they stop new defects), then 2 and 3 together screen by screen, 4 alongside. Each phase is its own PRs to `dev`; UI changes run the journeys that open the changed screens before READY.
