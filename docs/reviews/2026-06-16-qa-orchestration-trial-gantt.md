# QA-orchestration trial — Gantt D1 mobile fix (cold-subagent, GLM-only)

**Date:** 2026-06-16
**Orchestrator:** an *acting-Director subagent* (not the main session) running the ADR-0030 `portfolio` QA loop
**from the docs alone**, dispatching all build/review work to **pi/GLM**.
**Branch:** `gantt-v2-phase-a` — start `b90095b` → **end `965e4db`** (pushed, NOT merged, no PR).
**Issue:** the owner-decided **D1 mobile fallback** — below `640px`, the Timeline/Gantt view must replace the
cramped MS-Project split with a friendly notice + switch-to-List/Board controls; desktop (`≥640px`) unchanged.

> **Bottom line:** ✅ **Ready for Director vision-verify + ship.** Implemented TDD, all gates green, code review
> clean (no CRITICAL/HIGH), one a11y nit folded. The remaining open item is the **L3 rendered Discover glance**
> (a real-browser look at 390px on the rich seed) — not runnable in this sandbox; deferred to the Director's
> vision lens (the DOM-level behavior is already proven by unit tests).

---

## 1. Loop trace (every pi dispatch + my verification)

| # | Phase | Model | Brief (1-line) | pi result | My verification (§5 — never trusted the report) |
|---|---|---|---|---|---|
| smoke | — | glm-5.2 + glm-5.1 | "Reply OK" | both `OK` | ✅ both substrates live |
| pre | deps | — | `npm ci` in worktree (node_modules missing) | exit 0 | ✅ |
| floor | baseline | — | (me) ran existing Gantt tests pre-change | — | ✅ 28 ProjectGantt + slice green before any edit |
| 1 | **Build** | **glm-5.2** | D1 fallback TDD: new `useIsNarrow` (640px) hook+test; `ProjectGantt` `if(isNarrow)` notice w/ List/Board buttons; `onSwitchView` prop wired from TasksTab; 4 RED→GREEN ACs. Commit, no push. | `D1-BUILD-DONE`, commit `e802c77`, "all gates green, no deviations" | ✅ diff = 6 files, geometry untouched; read full prod diff; confirmed `Icon name="cal"` + `Button variant="outline"` are REAL (not invented); ran **vitest (72) / typecheck 0 / lint 0 / build OK** myself; read all 4 test bodies — assert real behavior (grid+figure absent at narrow, spy gets `'list'`/`'board'`, inverse at desktop, empty-state precedence), no softened assertions |
| 2 | **Review** | **glm-5.1** | review-only D1 diff: correctness/hook-safety/precedence/no-desktop-regression/test-quality/tokens/a11y/prop-typing; findings only, no edits | `D1-REVIEW-DONE`, **verdict ship-able, no CRITICAL/HIGH**, all 8 checklist PASS; LOW/NIT only | ✅ findings triaged (below). Only real defect = a11y heading-role nit → folded |
| 3 | **Fold** | **glm-5.2** | one-finding fix: notice title `<div>`→`<h3>` + 1 heading test (`AC-GANTT-D1-5`); nothing else | `D1-FOLD-DONE`, commit `965e4db` | ✅ diff = 2 files, `h3` present, AC-D1-5 present; re-ran **vitest (73) / typecheck 0 / lint 0 / build OK**; **full suite 3128/3128 green** (no barrel-export regression); pushed |

**Review-finding triage (glm-5.1 → my decision):**
- LOW a11y — notice title styled-but-not-semantic heading → **FOLDED** (real, cheap, graduates to a test).
- LOW coverage — no e2e that `setView` flips the tab → **kept** (unit callback-receipt is the lowest sufficient
  layer per ADR-0010; the wire is trivial & typed).
- NIT tokens — `rounded-[14px]` off the radii scale → **kept** (copied verbatim from the *sanctioned* `ListState`
  empty variant; fixing one copy without the other would fragment — deferred-debt for a shared chip token).
- NIT DRY — 3rd hand-rolled copy of the "icon-chip + heading + sub-line + actions" molecule → **kept** (extraction
  candidate when a 4th consumer appears; Coherence-Wave §7 backlog, not this issue).

## 2. Gate results (all run by me, in the worktree `pmo-portal/`)

| Gate | Result |
|---|---|
| `vitest` (Gantt slice: ProjectGantt useIsNarrow useIsDesktop ganttLayout ganttGeometry) | **73 passed** (incl. AC-GANTT-D1-1..5 + new `useIsNarrow.test.ts`) |
| `vitest` (FULL suite) | **3128 passed / 385 files**, 0 fail — no cross-file regression from the `ui/index.ts` barrel touch |
| `npm run typecheck` (`tsc --noEmit`) | **0 errors** |
| `npm run lint` (`eslint .`) | **0 errors** |
| `npm run build` (`vite build`) | **OK** (pre-existing >500kB chunk-size *warning* only — not new, not an error) |

**Final branch SHA:** `965e4db` (pushed to `origin/gantt-v2-phase-a`). **Not merged. No PR opened** (per constraint).

## 3. What shipped (the change)

6 files, +273/−5 across two commits (`e802c77` build, `965e4db` a11y fold):
- **`src/components/ui/useIsNarrow.ts`** (new) — `useIsNarrow(): boolean`, true `<640px` (`(max-width: 639px)`).
  Faithful mirror of `useIsDesktop` (synchronous initializer = no first-paint flash, `change` listener,
  unmount cleanup, SSR→`false`). `useIsDesktop` left untouched (it has other consumers).
- **`src/components/ui/__tests__/useIsNarrow.test.ts`** (new) — 5 tests (true<640 / false≥640 / change / unmount / SSR).
- **`src/components/ui/index.ts`** — barrel export.
- **`pages/project-detail/ProjectGantt.tsx`** — new optional prop `onSwitchView?: ('list'|'board')=>void`;
  `useIsNarrow()` called unconditionally with the other hooks; `if (isNarrow) return <GanttMobileNotice/>`
  placed **after** the empty-state early-return (so an empty project still shows the honest empty state) and
  **before** the split. `GanttMobileNotice` = token-only card (mirrors `ListState` empty treatment), `cal` icon
  chip, `<h3>` title, muted sub-line, two `variant="outline"` buttons → `onSwitchView`, `data-testid="gantt-mobile-notice"`.
- **`pages/project-detail/tabs/TasksTab.tsx`** — one line: `onSwitchView={setView}`.
- **`pages/project-detail/__tests__/ProjectGantt.test.tsx`** — `mockViewport(w)` helper answering BOTH
  `(max-width:639px)` and `(min-width:768px)` consistently; AC-GANTT-D1-1..5.

**Portfolio-mode graduation (ADR-0030):** the D1 finding is now graduated — *test* (AC-GANTT-D1-1..5 lock the
behavior + heading a11y), *matrix cell* (mobile@390 × `/projects/:id/:tab` Timeline), *decision note* (this doc +
the owner directive). It can no longer silently recur.

## 4. DOC SUFFICIENCY — where the manual failed a cold orchestrator (the real payload)

The docs were **mostly sufficient** to run the loop blind, but several gaps forced guesses:

1. **§3b/§3c background-dispatch model is WRONG for a subagent — the known trap, confirmed + a second failure.**
   `pi-delegation.md` §3b says the canonical pattern is `Bash(run_in_background:true)` + *end your turn*; "the
   harness sends a `<task-notification>` … and **re-invokes you automatically**." **A subagent is NOT re-invoked**
   — ending the turn would have orphaned the build. My task prompt warned me of this, but **the doc itself still
   tells the reader to do the orphaning thing.** A cold orchestrator reading *only* the docs would get it wrong.
   - **Then the documented fallback (§3c detached-tmux) ALSO failed here:** `tmux new-session` →
     `fork failed: Device not configured` in this sandbox. So **both** documented long-dispatch mechanisms were
     unavailable. I had to **guess** the only thing left: a **blocking foreground Bash call** with a 600 000 ms
     timeout, staying alive for the whole run. That worked, but §3b explicitly brands foreground Bash a
     "❌ capacity-hogging anti-pattern" — so the docs actively *discouraged* the one pattern that actually works
     for a sandboxed subagent. **Fix:** `pi-delegation.md` needs a "**dispatched-FROM-a-subagent**" subsection:
     "you will NOT be auto-re-invoked; prefer a blocking foreground Bash (`timeout: 600000`); if tmux is
     available use detached+poll; never `run_in_background`+end-turn."

2. **Breakpoint contradiction: the task said "use `useIsDesktop`", but the owner spec says `<640px`.** `useIsDesktop`
   keys off **768px (md)**, not 640px (sm). Reusing it would have made the notice appear on 640–767px tablets
   where the Gantt is fine. I **guessed** correctly (new 640px `useIsNarrow` hook, leave `useIsDesktop` alone) and
   flagged it in the brief. This was a *task-prompt* vs *spec* contradiction, not a doc gap — but it shows the
   orchestrator must reconcile "reuse hint" vs the actual numeric spec, and the playbook gives no rule for that.
   (Worth a playbook line: *the numeric spec wins over a "reuse X" convenience hint; create a sibling, don't bend
   an existing breakpoint that has other consumers.*)

3. **Model routing: `pi-delegation.md` §2 hard-routes ALL reviews to `openai-codex/gpt-5.4` ("deliberately
   cross-family").** My constraint forced **GLM-only** (glm-5.2 build / glm-5.1 review). The doc has **no GLM-only
   degraded-mode guidance** — what to do when the cross-family reviewer substrate is simply unavailable. I guessed
   "different GLM *model* for partial independence" (per my task), but the doc treats same-family review as a
   quality compromise without saying how much trust to withhold or how much harder the Director must re-verify.
   **Fix:** add a "single-family fallback" row to §2 + a note that the Director's own read must carry more weight
   when builder and reviewer share a family (glm-5.1 reviewing glm-5.2 is *not* the cross-family check §5 relies on).

4. **`qa-portfolio.md` L3 "rendered Discover" has no runnable recipe for a no-server sandbox.** The doc says L3 =
   "browser MCP on rich seed" / Discover = "`taste`/`impeccable`/`design-review`" — all of which need a live app
   (`npm run dev` + Supabase + auth). A cold orchestrator with no running stack has **no documented degraded path**
   ("DOM/unit behavior is the floor; defer the pixel/taste glance to the Director's vision lens, note it as
   `advisory`"). I had to decide this myself. **Fix:** `qa-portfolio.md` should state, for L3/Discover, the
   *minimum* a non-vision/sandboxed agent owns (DOM-level oracle proven by RTL) and that the rendered glance is
   explicitly **advisory** and **routable to the Director** without blocking the loop.

5. **Sentinel-line discipline (§4.6) is the single most valuable doc rule** for a cold orchestrator and it held
   perfectly — `D1-BUILD-DONE` / `D1-REVIEW-DONE` / `D1-FOLD-DONE` + `__PI_EXIT_n__` let me detect clean completion
   cheaply. **No gap here — calling out what WORKED** so it's not "hardened away."

6. **Where the plan doc lives.** `docs/plans/2026-06-16-gantt-v2-phase-a.md` exists **only on the branch**, not on
   `main` — the task pointed me to it but a `Read` from the primary checkout 404s. Minor, but a cold orchestrator
   should be told to read plans from the **worktree**, not the primary checkout. (`.claude/agents/*.md` ARE tracked
   into the worktree per §3 — that part was correct and useful.)

## 5. GLM performance (worth-keeping verdict)

**glm-5.2 (builder) — KEEP, high trust for a well-fenced slice.** First-pass correct, **zero deviations** from a
detailed brief: created the sibling hook exactly mirroring `useIsDesktop`, placed the early-return in the right
order (empty-state precedence preserved — a subtle correctness point it got right unprompted-by-example), used
**real** `Icon`/`Button` names (no invention — a known §6 risk it avoided), tagged ACs as leading tokens, wrote
**genuine** behavior assertions (no `.catch` softening, no "element exists" downgrade — the §6 e2e-softening
tendency did **not** appear here). The `mockViewport` helper handling *both* media queries consistently was a nice
touch beyond the literal ask. The fold round was equally tight (touched exactly 2 files).

**glm-5.1 (reviewer) — KEEP as a within-family second-read, but NOT a substitute for cross-family.** Thorough,
structured, all 8 checklist items answered with file:line evidence; it independently re-ran typecheck+vitest and
**correctly verified** `Icon name="cal"`/`Button variant="outline"` exist and that the desktop path is untouched.
It surfaced one genuine (minor) a11y defect + correctly classified the token/DRY items as pre-existing/deferred. It
also correctly reasoned the **contravariance** of `setView` assignment (sound, no cast) — non-trivial. **Caveat:**
this is **same-family** review (glm reviewing glm); §5 warns cross-family catches what same-family misses. It found
nothing CRITICAL/HIGH — consistent with a clean, small, well-fenced change, but I would **not** rely on glm-5.1
alone for a security/RLS/money slice. For a presentational mobile-fallback, it was sufficient.

**§6 failure tendencies observed:** none of the listed ones fired (no e2e softening, no honest-UX shortcut, no
stopping-partway, no scope drift). The briefs were detailed + fenced, which §4 predicts suppresses these — evidence
the brief-quality lever works.

## 6. Verdict

✅ **READY for Director vision-verify + ship.** Branch `gantt-v2-phase-a` @ `965e4db` pushed; build + review +
fold complete; **vitest 3128/3128, typecheck 0, lint 0, build OK**; review clean (no CRITICAL/HIGH), one a11y nit
folded with a test. **Not merged, no PR** (left for the Director).

**Single open item (non-blocking):** the **L3 rendered Discover glance** — a real-browser look at 390px on the rich
solar seed (does the notice read well? do the buttons actually flip the view in-app? One-Blue holds?). Not runnable
in this sandbox (no live app/Supabase/vision). The **DOM-level behavior is proven by AC-GANTT-D1-1..5**; the
pixel/taste confirmation is deferred to the Director's vision lens per `qa-portfolio.md` L3 (advisory).

— acting-Director subagent, 2026-06-16
