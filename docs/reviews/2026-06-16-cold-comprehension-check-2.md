# Cold review — PMO Portal docs vs reality (2026-06-16, pass 2)

Reviewer: unbiased, zero prior context. Sources: only `docs/README.md`,
`docs/backlog.md`, `docs/qa-portfolio.md`, `CLAUDE.md`, `docs/adr/0030-*`,
`docs/adr/0031-*`, the four `docs/reviews/2026-06-16-*` reviews + `git` ground truth.

> ⚠ **Repo is LIVE — advanced during analysis.** `main` moved `46b5f4b` → `1db0b36`
> (PR #127) → `1dc5ade` (PR #132) *while I was reading*. I re-read everything after the
> advance. **All findings below cite the final state: `main` = `origin/main` = `1dc5ade`,
> working tree clean.** (This is the same mid-review drift the earlier
> `2026-06-16-cold-comprehension-check.md` warned about.)

---

## 1. CURRENT STATE

### Branch topology (git-verified at `1dc5ade`)
- `main` = `origin/main` = **`1dc5ade`** (PR #132, docs-only). Synced with origin; clean tree.
- `dev` = 1 ahead / **14 behind** `main` — stale; the KANNA work it held merged to `main`
  long ago (#118 + the squash PRs).
- `production` (local) = `a62c7cf` (2026-06-11); `origin/production` = `094406c` (2026-06-13).
  **`main` is 112 commits ahead of `origin/production`.**

### Shipped / merged to `main` this session (PRs, `git log`-verified)
- `#122` **ADR-0030** — QA portfolio (Discover→Graduate→Cover) + vendoring policy
  (`docs/adr/0030-qa-portfolio-and-vendoring-policy.md`).
- `#123` **S-curve** time-axis fix (categorical → time axis; the worked example).
- `#124` process-docs sync to the portfolio loop.
- `#125` **Gantt v2** (ADR-0031, build-and-own, **not** vendored) — on-axis milestone
  diamonds, dependency connectors, MS-Project split, day/week/month/quarter zoom, D1 mobile
  fallback (`useIsNarrow` 640px → List/Board notice).
- `#126` `pi-delegation.md` hardening (subagent foreground-dispatch + GLM-only degraded mode).
- `#127` backlog refresh to 2026-06-16.
- `#128` cold-comprehension check saved + **README ADR range fixed** (0027 → 0031).
- `#129` consolidate superseded backlog history + retire jtbd-walkthrough.
- **`#130` date-fns MERGED** (`d7447dd`, vendor(date-fns)).
- **`#131` TanStack Table DEFERRED** (`9a725ab`, docs-only — assessed, no build).
- `#132` backlog: "Gantt v2 verification = #0 NEXT" + reflects #130/#131.
- `#119` housekeeping · `#120` CLAUDE.md model-tiering · `#121` Incidents hidden behind a UI
  feature flag.
- (Earlier) `#118` JTBD remediation program merged via gated integration PR.

### ✅ Confirmed: date-fns is MERGED (#130); TanStack is DEFERRED (#131, not built)
- **date-fns — MERGED.** `git show main:pmo-portal/package.json` → `"date-fns": "4.4.0"`
  (exact pin, no caret). `git log` shows `d7447dd vendor(date-fns): replace hand-rolled UTC
  date idioms (ADR-0030 Layer-0; OD-DATE-1) (#130)`. `backlog.md` (item #1, OUTSTANDING)
  now reads: *"date-fns ✅ MERGED #130 (OD-DATE-1, TZ bug class killed)."* The trial
  (`reviews/2026-06-16-vendor-date-fns-trial.md`) shows branch `vendor-date-fns` @ `4814fbf`
  → merged; FE-only, no migration.
- **TanStack Table — DEFERRED, NOT BUILT.** `git show main:pmo-portal/package.json` has NO
  `@tanstack/react-table` (only `@tanstack/react-query`). `git log` shows `9a725ab docs:
  TanStack Table assessed → DEFER (no engine to replace) … (#131)` — a **docs-only** commit.
  Trial (`reviews/2026-06-16-vendor-tanstack-table-trial.md`): *"ASSESSED → RECOMMEND DEFER
  … `DataTable` is a controlled presentational component with no internal table-state engine
  to replace … No branch created; no gates to run (nothing built)."* `backlog.md` item #1:
  *"TanStack Table ✅ ASSESSED → DEFER #131 … Vendoring backlog effectively closed for now."*

### Outstanding / next (backlog.md "▶ OUTSTANDING")
0. **⭐ NEXT (owner-directed 2026-06-16): VERIFY THE GANTT v2 IMPLEMENTATION** — render-check
   on a real project incl. the **390px D1 mobile fallback** (the one advisory residual never
   vision-glanced). See §4.
1. **Vendoring** — closed for now (date-fns merged, TanStack deferred, per above).
2. **PROD PROMOTE (owner-gated)** — `main → production` + push migrations **0028–0033**.
   Owner 2026-06-16: *"keeping it dev-only for now — local Docker dev unchanged, prod parked."*
3. **Minor doc residuals** — breakpoint-doc 768-vs-640; `qa-portfolio.md` L3 no-server-sandbox
   recipe + L0 exact date-fns target files.

### Prod-vs-main gap — large, on both schema and features
- **Schema:** Prod Cloud DB at **migration 0027** (backlog "KNOWN ISSUES"; 2026-06-16 block:
  *"Cloud DB migration 0027"*). `main` carries **0028–0033** (6 unshipped migrations):
  `0028_procurement_files` · `0029_calendar_milestone_dates` · `0030_crm_contacts_activity` ·
  `0031_procurements_vendor_idx` · `0032_fix_top_projects_spent` · `0033_at_risk_budget_from_versions`.
  All six confirmed **ABSENT on `origin/production`** (`git ls-tree origin/production
  supabase/migrations/`).
- **Features:** `main` is **112 commits ahead of `origin/production`**. Prod is missing the
  entire KANNA burst (Export/Import, Calendar, Kanban, Gantt v1→v2, CRM contacts+activity,
  procurement attachments, wave-0 mobile), the coherence wave, the JTBD remediation program,
  the QA redesign (ADR-0030 + S-curve time-axis), **date-fns**, and **Incidents feature-flagged** (#121).
- Promotion path documented + owner-gated: *"`git push origin main:production` + push migs
  0028–0033 via `scripts/db-push-prod.sh`"*; backlog also now flags resyncing the stale local
  `production` ref first.

### Open feature tracks / standing debt (unchanged from prior cold-check, still accurate)
Feature entitlements/per-org gating (UI-hide-first, no billing), Commitment-governance,
Admin RBAC config engine, Reports module, Design-system normalization, later spines. Standing
debt: signed-URL TTL (Med), Vite 6→8/esbuild (Med), e2e mutation-spec isolation (recurring),
auth prod cutover, automated a11y gate (axe in CI), etc. — all still listed, none blocking.

---

## 2. INCONSISTENCIES / STALENESS (vs git reality, anchored to `main`=`1dc5ade`)

> Headline: the prior `2026-06-16-cold-comprehension-check.md` review (a snapshot at
> `main`=`1db0b36`) is now **itself substantially stale** — its top findings (README ADR
> range; date-fns/TanStack outstanding; gantt "not merged") were all resolved by #128–#132.
> New seams below.

| # | Location (file + quote) | Reality (git) | Severity |
|---|---|---|---|
| 2.1 | `docs/backlog.md` L9 (resume line): *"> **RESUME ENTRY POINT (model-agnostic).** `main` @ `46b5f4b`."* | `main` is now **`1dc5ade`** — 5 commits (#127–#132) past `46b5f4b`. Defensible as "last *code* anchor" (#128–#132 are docs-only; #125 Gantt v2 = `46b5f4b` is the last non-docs merge), but the literal "`main` @ `46b5f4b`" is false-to-git. | Low |
| 2.2 | `docs/backlog.md` "▶ ACTIVE PROGRAM — KANNA gap-closing (burst on `dev`, awaiting promote)" section header + body | KANNA is **done & merged** (waves 0–3 + coherence via #118 + squash PRs). `dev` is 1 ahead / 14 behind `main`. `kanna-program.md` got an **"archived banner"** (per #131 commit msg) — so `kanna-program.md` says archived while `backlog.md` still calls KANNA the **"ACTIVE PROGRAM … awaiting promote"**. Internal doc contradiction. | Low–Med |
| 2.3 | `docs/reviews/2026-06-16-qa-orchestration-trial-gantt.md` §2/§6: *"Final branch SHA: `965e4db` (pushed to `origin/gantt-v2-phase-a`)"* / *"Branch `gantt-v2-phase-a` @ `965e4db` pushed … Not merged, no PR"* | True at write-time; the Gantt work **IS merged to `main` as PR #125** (`46b5f4b`). The trial doc's headline verdict was never updated; the #132 backlog update cross-references the trial but doesn't patch its "not merged" verdict. | Low (point-in-time artifact, but misleading on a cold read) |
| 2.4 | `docs/reviews/2026-06-16-cold-comprehension-trial-gantt.md` — wait, the **prior cold-check** (`reviews/2026-06-16-cold-comprehension-check.md`) §1: *"Vendoring backlog — decided, not built: `date-fns` … + `TanStack Table`"*; §2.1 *"README ADR range `0001–0027`"*; §2.4 *"gantt … not merged / no PR"* | **All three now resolved.** date-fns merged (#130), TanStack deferred (#131); README range is now `0001–0031` (verified L14); Gantt merged (#125). The cold-check reads as describing a state 5 commits older than current `main`. | Low (dated snapshot) — but a cold reader could cite its outstanding list as current |
| 2.5 | `docs/backlog.md` "KNOWN ISSUES" block: *"Prod migration push **DONE 2026-06-13** — 0024–0027 applied … 'Budget used', document file upload + the prod storage bucket, and the at-risk `>=` boundary are now LIVE."* | Accurate for prod@0027, but sits alongside the 2026-06-16 block which says prod is *"far ahead"*-behind and migs 0028–0033 unshipped. No contradiction (two different facts), but a cold reader must read carefully: prod is LIVE **at 0027**, ~112 commits / 6 migrations behind `main`. | Low (clarity, not error) |
| 2.6 | Local `production` = `a62c7cf` vs `origin/production` = `094406c` (drift) | **Now flagged** in backlog item #2: *"First resync the stale local `production` ref (`git fetch && git branch -f production origin/production`)"* — added by #132. Previously undocumented; now documented. ✓ (no longer an inconsistency, noting it's fixed) | — (resolved) |
| 2.7 | `origin/gantt-v2-phase-a` + ~9 stale feature branches persist on origin (`coherence/*`, `kanna/*`, `wave0/*`, `wave3-fix/*`, `docs-*`, `worktree-agent-*`) | Branch cruft, not doc text — but inflates `git branch -a` for a cold reader. | Low (housekeeping) |

**No contradictions found** between ADR-0030 ↔ `qa-portfolio.md` (`review mode: portfolio`
matches the ADR default; the vendoring table matches — Gantt build-and-own, TanStack DEFER,
date-fns high-ROI). No contradiction between ADR-0031 and the Gantt code on `main` (pure
presentational/model; no migration/RPC/auth — last migration is `0033`, no `0034`). README
ADR range is now correct. CLAUDE.md mirrors the project `AGENTS.md` byte-for-byte (duplication,
not an error).

---

## 3. docs/ CLEANUP still needed

**`ls docs/`** (22 entries): `README.md · adr/ · analytics-events.md · backlog.md ·
decisions.md · design/ · design-mockups/ · design-workflow.md · director-playbook.md ·
environments.md · glossary.md · history.md · jtbd.md · kanna-program.md · pi-delegation.md ·
plans/ · product-expectations.md · qa-portfolio.md · reviews/ · roadmap-spines.md · specs/
spikes/`.

**`ls docs/reviews/`** (13 files): the 6 pre-June-15 audits (`2026-06-07-ui-slop-audit` →
`2026-06-15-jtbd-reaudit-r3`) + **4 new 2026-06-16** (`qa-orchestration-trial-gantt` ·
`cold-comprehension-check` · `vendor-date-fns-trial` · `vendor-tanstack-table-trial`).

### Is the prior consolidation holding? Mostly YES.
- ✅ **README ADR range** — fixed by #128 (`0001–0027` → `0001–0031`; verified L14).
- ✅ **jtbd-walkthrough** — retired by #129: a `⚑ SUPERSEDED by ADR-0030 (2026-06-16) … do
  NOT use it as a review method` banner now heads `reviews/2026-06-14-jtbd-walkthrough.md`.
- ✅ **backlog history** — #129 compacted the superseded blocks (the old "42-ahead-of-main"
  dev figures are gone from the live block; the JTBD-as-current framing is superseded).

### Still worth doing (ranked)
1. **`backlog.md` "ACTIVE PROGRAM — KANNA … awaiting promote" section (§2.2 above).** `kanna-program.md`
   is now banner-archived (#131), but `backlog.md` still headlines KANNA as the active program
   "awaiting promote." **Reconcile**: either retire that backlog section to `history.md` or
   relabel it "MERGED — see `history.md`" so the two docs agree. (Biggest readability seam.)
2. **`reviews/2026-06-16-qa-orchestration-trial-gantt.md` "not merged / no PR" verdict (§2.3).**
   Add a one-line *"✅ MERGED to `main` via #125 (`46b5f4b`); D1-glance still owed — see
   backlog #0"* banner at the top so the trial's headline matches reality. (The #132 backlog
   points at the trial but the trial still self-reports as unmerged.)
3. **`reviews/2026-06-16-cold-comprehension-check.md` (the prior cold-check, §2.4).** It's now
   a stale snapshot (README/gantt/vendoring findings all resolved). Add a one-line *"Status:
   snapshot at `main`=`1db0b36`; superseded by #128–#132"* header, or a cold reader will cite
   its (resolved) outstanding list as current.
4. **`reviews/2026-06-07-ui-slop-audit.md`** (oldest) — UI-slop themes fully absorbed by the
   coherence wave + JTBD program. Candidate for `reviews/archive/` with a pointer. (Carried
   over from prior cold-check; still valid.)
5. **`design-mockups/` + `plans/`** — README documents these as the intentionally-retained
   build/design archive (deleting dangles links). **No action.** Acceptable.
6. **Branch cruft (§2.7)** — not docs/, but `origin/gantt-v2-phase-a` (merged via squash),
   `coherence/*`, `kanna/*`, `wave0/*`, `wave3-fix/*`, `docs-*`, `worktree-agent-*`. Prune the
   merged/superseded ones to reduce `git branch -a` noise for a cold reader.

**Keep as-is (current & load-bearing):** `qa-portfolio.md`, `pi-delegation.md`,
`director-playbook.md`, `design-workflow.md`, `product-expectations.md`, `environments.md`,
`decisions.md`, `glossary.md`, `roadmap-spines.md`, `jtbd.md`, `analytics-events.md`, `spikes/`,
`design/`, `specs/`, `adr/` (29 files, 0001–0031, no 0013/0026 — matches README).

---

## 4. Is the Gantt v2 implementation verification (the 390px D1 mobile vision glance) flagged as outstanding?

**YES — and it is now the #0 headline outstanding item, promoted there by the most recent commit (#132).**
Flagged in two places, with the **390px** figure explicit:

1. **`docs/backlog.md`** — "▶ OUTSTANDING (owner-gated / next)", **item 0**:
   > *"0. **⭐ NEXT (owner-directed 2026-06-16): VERIFY THE GANTT v2 IMPLEMENTATION.** Render-check
   > the shipped Gantt (`pmo-portal/pages/project-detail/ProjectGantt.tsx`, ADR-0031) on a real
   > project with deps/milestones — esp. the **390px D1 mobile fallback** (`useIsNarrow` 640px →
   > List/Board notice) which was the one advisory residual never vision-glanced (sandbox had no
   > live app). Confirm: diamonds on-axis, dependency connectors, MS-Project split + zoom, and the
   > mobile notice all render correctly. DOM is tested (`AC-GANTT-D1-1..5`) but the pixel/taste
   > glance is owed. Use `agent-browser` or the live app (`cd pmo-portal && npm run dev`, login pw
   > `Passw0rd!dev`, open a delivery project → Tasks → Timeline)."*

2. **`docs/reviews/2026-06-16-qa-orchestration-trial-gantt.md`** §6 ("Single open item (non-blocking)"):
   > *"the **L3 rendered Discover glance** — a real-browser look at **390px** on the rich solar seed
   > (does the notice read well? do the buttons actually flip the view in-app? One-Blue holds?). Not
   > runnable in this sandbox (no live app/Supabase/vision). The **DOM-level behavior is proven by
   > `AC-GANTT-D1-1..5`**; the pixel/taste confirmation is deferred to the Director's vision lens per
   > `qa-portfolio.md` L3 (advisory)."*

So the item is clearly and prominently outstanding: it is the **⭐ #0 NEXT** task in `backlog.md`,
cross-referenced from the Gantt trial review, with the 390px figure, the exact file, the
DOM-vs-pixel distinction (`AC-GANTT-D1-1..5` lock the behavior; the vision glance is the owed
residual), and a concrete "how to run it" recipe. It is **not** silently missing.

---

## Summary

- **Shipped to `main` (`1dc5ade`):** ADR-0030 + S-curve + Gantt v2 (ADR-0031) + QA-portfolio
  process sync + date-fns (#130) + Incidents feature-flag + pi-delegation hardening + doc
  consolidations. **date-fns MERGED (#130); TanStack DEFERRED (#131, not built)** — both
  confirmed against `package.json` + `git log`.
- **Outstanding/next:** ⭐ #0 = **verify the Gantt v2 implementation** (incl. the 390px D1
  mobile vision glance — explicitly flagged); PROD PROMOTE (owner-parked, dev-only for now);
  6 unshipped migrations (0028–0033); prod 112 commits / 6 migrations behind `main`.
- **Inconsistencies:** live repo drift — backlog resume SHA (`46b5f4b` vs `1dc5ade`); backlog
  "ACTIVE PROGRAM … KANNA awaiting promote" vs `kanna-program.md` archived banner; the Gantt
  trial's stale "not merged" verdict; the prior cold-check snapshot is itself now stale
  (its findings resolved by #128–#132). No ADR ↔ code contradictions.
- **docs/ cleanup:** prior consolidation (#128/#129) is **holding** (README ADR range fixed,
  jtbd-walkthrough retired, history compacted). Remaining seams: retire/relabel backlog's KANNA
  section, add a "merged via #125" banner to the Gantt trial, mark the prior cold-check as a
  snapshot, optionally archive the oldest ui-slop audit, prune stale origin branches.


