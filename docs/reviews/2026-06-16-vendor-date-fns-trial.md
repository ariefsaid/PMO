# QA-portfolio trial — vendor `date-fns` (ADR-0030 Layer-0)

- **Date:** 2026-06-16
- **Orchestrator:** acting Director / QA-orchestrator subagent (opus), **GLM-only** dispatch (gpt-5.4/openai-codex unavailable).
- **Issue:** adopt `date-fns` to kill the hand-rolled TZ/off-by-one date-parsing class (ADR-0030 §F vendoring; `docs/qa-portfolio.md` L0 backlog "Date math → date-fns").
- **Branch:** `vendor-date-fns` @ **`4814fbf743322cf648b984fa1ac3861cfb7a6b7e`** (pushed, NOT merged, no PR — Director ships).
- **Mode:** `review mode: portfolio`. Correctness swap → **no rendered Discover pass** (not UI).
- **Verdict:** ✅ **READY FOR DIRECTOR VERIFY + SHIP.**

## Outcome in one line
date-fns `4.4.0` (exact pin, MIT, zero transitive deps) now backs date parsing/arithmetic; **behaviour-identical** (3133/3133 tests green, identical to baseline); 4 gates green; the graduation note (OD-DATE-1) locks the pattern so the class can't recur.

## Loop trace (each pi dispatch + Director verification)

### 0. Smoke-test + scope
- `pi --provider zai --model glm-5.2 … "Reply with exactly: OK"` → `OK`. GLM-5.2 live.
- Baseline (worktree off `main`, `npm ci`): **3133 passed (385 files)** — the oracle.
- Scope (Director read all 6 targets first): **2 date conventions identified, must not be conflated** —
  - **Convention A (UTC-midnight):** `sCurve.ts` `isoToTs`/`daysBetween`, `ganttLayout.ts` private `daysBetween` (parse explicit `…T00:00:00Z`).
  - **Convention B (LOCAL-tz):** `monthMatrix.ts` `parseLocalDate`/`toIso`/`addMonths` → used by the calendar 6×7 grid + `toWorkbookBuffer` xlsx cells + `ganttLayout` tick-walk.
  - Display: `format.ts` `formatDate`. Deliberate-native: `procurementLifecycle.formatDocNumber` (`getUTC*` C4 fix) + `sCurve.formatSCurveAxisDate` (Intl UTC) — both correctly require `date-fns-tz` to swap, which is out of scope.

### 1. Build — `pi glm-5.2` (implementer), blocking-foreground
Commit `300758e` (7 files, +70/−18). Swapped the parse/arithmetic helpers to `parseISO`, **left native** the two sites that would need `date-fns-tz` (added clarifying comments). Did NOT add `date-fns-tz`. No test files edited.

**Director verification (never trusted the report):**
- Pin: `package.json` → `"date-fns": "4.4.0"` (no caret); lockfile has resolved URL + `sha512` integrity + `license: MIT`. ✓
- Read the full source diff — every swap preserves its convention; no signature change.
- **Empirical equivalence harness** (`parseISO` vs old native) across date-only / `…Z` / `…+offset` / no-offset / invalid / empty → **0 mismatches** (TZ=Asia/Jakarta).
- Gates run by Director: typecheck 0 · lint 0 · **test 3133/3133** · build ✓.

### 2. Review — `pi glm-5.1` (code-quality-reviewer)
Cross-*model* (same-family) review per GLM-only degraded mode. Ran its own empirical OLD-vs-NEW harness + the 4 oracle suites. **Verdict: SHIP.** All 6 review questions CLEAN except two findings, both on `formatDate`, both unreachable by real Postgres data:
- **#1 (LOW):** JSDoc said "no throw" but `parseISO` throws `TypeError` on a *non-string* arg (typed out, but defensive). Fix: add `typeof` guard + tighten JSDoc.
- **#2 (NIT):** `formatDate` is now stricter on malformed non-ISO strings (`2026/06/14`, `2026-2-30` → em-dash instead of lenient/rollover parse). Postgres never emits these; new behaviour is arguably *more* correct.
- Reviewer's one open uncertainty (same-family caveat): convention-A `daysBetween` across a DST spring-forward.

**Director verification:** closed the DST uncertainty myself — `TZ=America/New_York` `daysBetween` across the Mar-8-2026 spring-forward + month/year spans → **0 mismatches** (the explicit `Z` makes it TZ-immune, as the reviewer reasoned).

### 3. Fold — `pi glm-5.2` (implementer)
Commit `4814fbf` (3 files, +23/−4). Applied finding #1 (the `typeof iso !== 'string'` guard + accurate JSDoc) — zero behaviour change for valid ISO. **Graduated** the pattern:
- `docs/decisions.md` → **OD-DATE-1**: "Date math uses date-fns (UTC-stable); never hand-roll `T00:00:00Z` parsing" — documents both conventions + the two native exceptions.
- `DESIGN.md` §"How to use these tokens" pt 7 → one-sentence cross-ref to OD-DATE-1.

**Director verification:** read the fold diff (exactly as specified) → re-ran ALL gates on final state: typecheck 0 · lint 0 · **test 3133/3133** · build ✓.

## Gate results (final, Director-run @ `4814fbf`)
| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0, zero errors |
| `npm run lint` | exit 0, zero errors/warnings |
| `npm test -- --run` | **3133 passed / 385 files** (== baseline) |
| `npm run build` | ✓ built (pre-existing exceljs chunk-size warning only) |
| Supply-chain | date-fns `4.4.0` exact-pinned, sha512 lockfile integrity, MIT, zero deps |

## What changed (final, 7 source/doc files)
- `sCurve.ts` — `isoToTs` → `parseISO('…Z').getTime()`; `daysBetween` rides it (ms-divide kept). `formatSCurveAxisDate` left on Intl (UTC) intentionally.
- `ganttLayout.ts` — private UTC `daysBetween` → `parseISO('…Z')`; local tick-walk untouched.
- `monthMatrix.ts` — `parseLocalDate`→`parseISO`; `toIso`→`format(d,'yyyy-MM-dd')`; `addMonths`→date-fns wrapper. 6×7 grid loop left native (byte-identical, zero gain in swapping).
- `format.ts` — `formatDate` parse → single `parseISO` + non-string guard + tightened JSDoc.
- `procurementLifecycle.ts` — comment-only (stays `getUTC*`).
- `toWorkbookBuffer.ts` — unchanged (rides `parseLocalDate`).
- `docs/decisions.md` (OD-DATE-1) + `DESIGN.md` (cross-ref) — the graduation artifact.

## Doc-sufficiency gaps (for a cold orchestrator)
The docs were largely sufficient. Two friction points worth recording:

1. **The brief's "~7 files" target list was partly wrong / over-broad.** It named `procurementLifecycle.ts` and `format.ts` as date-arithmetic targets, but `procurementLifecycle.formatDocNumber` is deliberately `getUTC*` and *correctly stays native* (swapping it needs `date-fns-tz`), and `format.ts` only needed a parse swap. The initial grep `T00:00:00Z|parseLocalDate|daysBetween|isoToTs` **also matched ~60 test files** — a cold orchestrator must filter to non-test sources (`grep -v '\.test\.|__tests__'`) to find the real 4–6 targets. The docs don't warn that the scope grep is noisy; I had to read each candidate to classify it. *Suggest: the qa-portfolio L0 row could name the exact target files + flag the two intentional-native exceptions, so the next vendoring orchestrator doesn't re-derive the convention map.*

2. **`docs/pi-delegation.md` §3c-bis is correct but the harness behaviour is subtler than written.** It says a subagent must run pi as "blocking foreground `Bash(timeout: 600000)`". In practice the Claude-Code harness **auto-backgrounded** the foreground Bash anyway (the foreground-`sleep` guard), returning a task id immediately — and a subagent is NOT auto-re-invoked on completion. The working pattern was to **poll the task output file for the sentinel with a bounded in-turn `for`-loop of short sleeps** (never ending the turn). §3c-bis hints at this for tmux but not for the plain-foreground-gets-backgrounded case. *Suggest: §3c-bis add "if the harness backgrounds your foreground dispatch, poll the output file for the sentinel within the same turn; do NOT end the turn expecting re-invocation."*

(Neither gap blocked the loop; both are documentation polish.)

## GLM-5.2 / GLM-5.1 performance (worth-keeping verdict)
- **GLM-5.2 (builder), first-pass correct.** Made exactly the right convention-preserving calls **unprompted-correctly**: swapped the parse/arithmetic helpers, *recognised on its own* that `formatDocNumber` and `formatSCurveAxisDate` would need `date-fns-tz` and **correctly left them native with clarifying comments** rather than over-swapping. No §6 failure tendencies observed (no test-softening — it edited zero test files; no scope drift; no stopping partway; ran its own empirical equivalence probe before editing). Pin was exact on the first try. The fold round was equally clean.
- **GLM-5.1 (reviewer), genuinely independent + rigorous.** Ran its OWN OLD-vs-NEW empirical harness (didn't just eyeball), produced file:line evidence per question, found the two real (if low-severity) `formatDate` edge findings the builder's JSDoc had slightly overstated, and — notably — **flagged its own same-family-review limitation** and named the precise residual uncertainty (DST-boundary `daysBetween`) for the Director to close. That is exactly the honest-uncertainty behaviour you want from a degraded-mode reviewer.
- **Verdict: keep both for this class of work.** GLM-5.2 is a trustworthy builder for bounded correctness/vendoring slices; GLM-5.1 is a real reviewer. **Caveat (per degraded-mode rule):** this was a *presentational/low-risk* change with strong existing oracles — same-family GLM review was appropriate. For **auth/RLS/RPC/money-path** changes, still escalate to cross-family or Director review; same-family independence is weaker (both reviewer and builder share GLM blind spots). Here the 3133-test oracle + the Director's empirical harnesses backstopped that risk.

## Ready state
**READY FOR DIRECTOR VERIFY + SHIP.** Branch `vendor-date-fns` @ `4814fbf` pushed, gated green, graduated. Director: re-run gates if desired, then open the PR and merge. No prod migration involved (FE-only). No blockers.
