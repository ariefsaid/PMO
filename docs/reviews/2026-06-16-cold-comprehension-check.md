# Cold review — PMO Portal docs vs reality (2026-06-16)

Reviewer: unbiased, zero prior context. Sources: only the docs named in the task + `git` ground truth.

> ⚠ Note on method: the `main` branch advanced **mid-review** from `46b5f4b` → `1db0b36` (PR #127, "refresh current-state to 2026-06-16"). The `backlog.md` I first read was the pre-`#127` revision (JTBD block as "current"); I re-read it after the advance. All findings below cite the **final** state (`main`=`origin/main`=`1db0b36`, working tree clean).

---

## 1. CURRENT STATE

**Branch topology (git-verified):**
- `main` = `origin/main` = **`1db0b36`** (PR #127, 2026-06-16 10:07). Synced with origin.
- `dev` = `origin/dev` = **`c3722e3`** (2026-06-15 16:30). **Stale**: 1 commit ahead of main, **8 commits behind** (`#119`–`#127`).
- `production` (local) = `a62c7cf` (2026-06-11); `origin/production` = `094406c` (2026-06-13). **`main` is ~146 commits ahead of production** (topo vs local `production`); **107 commits ahead of `origin/production`**.
- `origin/gantt-v2-phase-a` = `e3fb919`; its content is merged to `main` via squash PR #125 (`git merge-base --is-ancestor origin/gantt-v2-phase-a main` = false — merged by squash, not fast-forward). The branch ref itself persists on origin.

**Shipped / merged to `main` this session** (backlog.md `## ▶ Current state (2026-06-16)` L7–L24; corroborated by `git log --topo-order main`):
- `#122` **ADR-0030** — QA portfolio (Discover→Graduate→Cover) + vendoring policy (`docs/adr/0030-…`).
- `#123` **S-curve** time-axis fix (categorical→time axis; the worked example).
- `#124` process-docs sync to the portfolio loop.
- `#125` **Gantt v2** (ADR-0031, build-and-own, not vendored) — on-axis milestone diamonds, dependency connectors, MS-Project split, zoom, D1 mobile fallback.
- `#126` `pi-delegation.md` hardening (subagent foreground-dispatch + GLM-only degraded mode).
- `#127` backlog refresh to 2026-06-16.
- `#119` housekeeping · `#120` CLAUDE.md model-tiering · `#121` Incidents hidden behind a UI feature flag.
- (Earlier) `#118` **JTBD remediation program merged** via gated integration PR — waves 1–3 + coherence.

**Earlier-shipped & on prod (backlog.md L25-onward history block + "Built & hardened (prod)"):** Commercial pipeline + win-rate, budget versioning, procure-to-pay SoD, timesheets, CRUD for Companies/Tasks/Incidents/Documents, Admin users, RBAC (5 roles, RLS), per-role dashboards, mobile, delivery milestones (spine 3), delivery-UI redesign, document file upload, PostHog analytics. Prod Cloud at migration **0027**, promoted 2026-06-13.

**In-flight / outstanding** (backlog.md L20–L24, "▶ OUTSTANDING"):
1. **Vendoring backlog — decided, not built:** `date-fns` (a first orchestrator attempt was **parked**) + `TanStack Table`. Named as the natural next pi/GLM-orchestrator trials (qa-portfolio.md "Vendoring backlog" table; ADR-0030 §F).
2. **PROD PROMOTE (owner-gated):** `main` → `production` + push migrations **0028–0033** to Cloud via `scripts/db-push-prod.sh`. Deferred-debt ledger + the esbuild dependabot-high (dismissed not-affected) to fold first.
3. **Residuals:** 390px Gantt-D1 pixel/taste vision glance (advisory — DOM behavior locked by `AC-GANTT-D1-1..5`); 2 minor un-hardened doc gaps (768-vs-640 breakpoint; qa-portfolio L3 no-server-sandbox recipe).

**Open feature tracks (owner-scope-gated, not started)** — backlog.md "▶ OPEN feature tracks": Feature entitlements / per-org gating (OD 2026-06-15, UI-hide-first, no billing yet); Commitment-governance (PO-commitment gate + cash-position domain); Admin RBAC config engine (OD-PROC-6); Reports module; Design-system normalization (H2/H4 full spacing sweep); later spines (Revenue/AR, Resources/Assets, Service/O&M).

**Standing debt (non-blocking)** — backlog.md "▶ OPEN debt / follow-ups": signed-URL TTL hardening (Med), Vite 6→8 / esbuild GHSA-gv7w-rqvm-qjhr (Med), e2e mutation-spec isolation (Med→recurring), per-role sub-dashboards real data, auth prod cutover (SMTP/site_url/seed-password), transition-map drift guard, automated a11y gate (axe in CI, Gap 4), plus many Minors.

---

## 2. INCONSISTENCIES / STALENESS

| # | Location (file + quote) | Reality (git) | Severity |
|---|---|---|---|
| 2.1 | `docs/README.md` source-of-truth table, `adr/` row: *"Architecture Decision Records `0001–0027` (no 0013; no 0026 …)"* | `ls docs/adr/` shows **0001–0031** (still no 0013, no 0026). **4 ADRs missing from the README's stated range: 0028, 0029, 0030, 0031.** | Med — orientation doc understates the ADR set by 4. |
| 2.2 | `docs/backlog.md` demoted block (`⟨SHIPPED & SUPERSEDED — history⟩`, L25+) final "State:" line: *"all on local `dev` (now 42 ahead of `main`), NOT pushed (`origin/dev`/`origin/main` still `21a0577`)"* | `origin/main`=`1db0b36`, `origin/dev`=`c3722e3`; **`dev` is 1 ahead / 8 behind** main (not 42 ahead); the JTBD program merged long ago via `#118`. The header correctly tags it superseded, but the embedded figures are false-to-reality. | Low (labelled history) — but the numbers would mislead a grep. |
| 2.3 | `docs/backlog.md` 2026-06-16 block resume line (L9): *"`main` @ `46b5f4b`"* | `main` is now `1db0b36` (`#127` is the only commit on top — the backlog refresh itself). | Trivial — one-doc-commit stale. |
| 2.4 | `docs/reviews/2026-06-16-qa-orchestration-trial-gantt.md` §2: *"Final branch SHA: `965e4db` (pushed to `origin/gantt-v2-phase-a`)"*; §6 *"Branch `gantt-v2-phase-a` @ `965e4db` pushed … Not merged, no PR"* | `origin/gantt-v2-phase-a` HEAD is now `e3fb919` (the review doc was committed on top of `965e4db` — `965e4db` is still reachable there), **and the Gantt work IS merged to `main` as PR #125**. The "not merged / no PR" verdict was true at write-time, now stale. | Low — trial report is a point-in-time artifact; still, the headline verdict no longer matches reality. |
| 2.5 | Same review doc §4.6: *"`docs/plans/2026-06-16-gantt-v2-phase-a.md` exists only on the branch, not on `main` — a `Read` from the primary checkout 404s"* | Flagged as a transient trial-time gap; now that Gantt v2 merged via `#125`, this plan file is **likely now on `main`** (not re-verified). If still absent, the §4.6 complaint stands. | Low — verify-then-update. |
| 2.6 | Local `production` branch ref = `a62c7cf` (2026-06-11); `origin/production` = `094406c` (2026-06-13). `git merge-base --is-ancestor 094406c production` = **false**. | The **local** `production` checkout is itself behind `origin/production` by ~40 commits (missing even the 2026-06-13 coverage-gate commit). No doc flags this; a maintainer running `git push origin production` from the stale local ref would be prompted/confused. | Low–Med — local-ref drift; `git fetch && git branch -f production origin/production` to resync. |
| 2.7 | No `jtbd-remediation` branch exists (local or remote), yet backlog.md history block still references *"Branch `jtbd-remediation` (off `main`@`21a0577`) = head `cbdf407`"* and its resume-entry says to verify it with `git log`. | Branch was merged+deleted (via `dev`→`#118`). Reference is to a gone branch. | Low — but the "verify head with git log" instruction will 404 for a resume reader. |

No contradiction found between ADR-0030 and `qa-portfolio.md` (the latter is the operational how-to for the former; `review mode: portfolio` matches the ADR's default). No contradiction between ADR-0031 and the Gantt facts on `main` (pure presentational + model work; "no migration/no RPC/no auth surface" matches `supabase/migrations/` — last migration is `0033`, no 0034). CLAUDE.md ↔ AGENTS.md are byte-identical (same content) — not an inconsistency, just duplication.

---

## 3. docs/ CLEANUP recommendations

`ls docs/` (24 entries): `README.md · adr/ · analytics-events.md · backlog.md · decisions.md · design/ · design-mockups/ · design-workflow.md · director-playbook.md · environments.md · glossary.md · history.md · jtbd.md · kanna-program.md · pi-delegation.md · plans/ · product-expectations.md · qa-portfolio.md · reviews/ · roadmap-spines.md · specs/ · spikes/`.

`ls docs/reviews/` (10 files): `2026-06-07-ui-slop-audit.md · 2026-06-11-kanna-gap-analysis.md · 2026-06-14-intent-lens-gap.md · 2026-06-14-jtbd-census.md · 2026-06-14-jtbd-walkthrough.md · 2026-06-14-r2-audit-verification.md · 2026-06-14-whole-app-coherence-audit.md · 2026-06-15-broad-audit.md · 2026-06-15-jtbd-reaudit-r3.md · 2026-06-16-qa-orchestration-trial-gantt.md`.

**Recommendations (ranked):**
1. **`backlog.md` is 31 KB with three stacked "Current state" blocks** (`2026-06-16` live, `2026-06-15` JTBD, `2026-06-14`). The two older blocks are explicitly tagged superseded/history but still live inline. The README itself says *"shipped-program history lives in `history.md` — don't read it for status."* → **Move the 2026-06-15 + 2026-06-14 blocks into `history.md`** (or a `reviews/` archive); keep only the 2026-06-16 block + standing sections in `backlog.md`. Biggest readability win.
2. **`kanna-program.md`** ("the active program's playbook") describes KANNA waves 0–3 + coherence — all merged/backlogged-complete. Either mark it **COMPLETED/archived** at the top, or move to `history.md`. A reader landing on "active program" today is misled.
3. **`docs/adr/` registry in `README.md`** — update range `0001–0027` → `0001–0031` (fix, not archive). (Finding 2.1.)
4. **`docs/reviews/2026-06-07-ui-slop-audit.md`** (oldest) — UI-slop themes were fully absorbed by the coherence wave + JTBD program. Candidate to archive under `reviews/archive/` with a one-line pointer.
5. **`docs/reviews/2026-06-14-jtbd-walkthrough.md`** — this is the *narrative* JTBD method that ADR-0030 explicitly retired in favour of the enumerated census (`2026-06-14-jtbd-census.md`). Keep the census as the canonical; mark the walkthrough **SUPERSEDED by ADR-0030 / census** at its head so it isn't re-used as a method.
6. **`design-mockups/` and `plans/`** (14 + 56 files) — README already documents these as intentionally-retained build/design archive (deleting would dangle links). **No action** beyond what's documented; acceptable.
7. **Git-branch cruft (not docs/, but related):** ~9 `worktree-agent-*` + `worktree-wf_*` local branches, plus `spike/gantt-dhtmlx` (explicitly superseded by ADR-0030 §F build-and-own decision), `coherence/*`, `kanna/*`, `wave0/*`, `wave3-fix/*`, and the merged `origin/gantt-v2-phase-a`. Prune the merged/superseded ones to reduce confusion for a cold reader running `git branch -a`.

**Keep as-is (current & load-bearing):** `qa-portfolio.md`, `pi-delegation.md`, `director-playbook.md`, `design-workflow.md`, `product-expectations.md`, `environments.md`, `decisions.md`, `glossary.md`, `roadmap-spines.md`, `jtbd.md`, `analytics-events.md`, `spikes/`, `design/`, `specs/`. These all match the live model.

---

## 4. PROD vs MAIN

**Yes — production is far behind `main`, on both schema and features.**

**Schema (migrations):**
- Prod Cloud DB is at **migration 0027** (backlog.md "KNOWN ISSUES": *"Prod migration push DONE 2026-06-13 — 0024–0027 applied"*; 2026-06-16 block: *"Cloud DB migration 0027"*).
- `main` carries migrations through **0033** (`ls supabase/migrations/`; `git show main:supabase/migrations/0033_…sql` = present; `0028` absent on `origin/production`).
- **6 unshipped migrations: 0028–0033** —
  `0028_procurement_files` · `0029_calendar_milestone_dates` · `0030_crm_contacts_activity` · `0031_procurements_vendor_idx` · `0032_fix_top_projects_spent` · `0033_at_risk_budget_from_versions`.
  (backlog.md deferred-debt explicitly notes *"Migration 0028 is unshipped to prod — fold in before promote"*; 0033 is the JTBD fix-wave-2 money-bug derivation.)

**Features (commits):**
- `main` is **146 commits ahead of local `production`** (`git rev-list --count` topo) / **107 commits ahead of `origin/production`**.
- Everything between `094406c` and `1db0b36` is prod-absent: the entire **KANNA burst** (Export/Import, Calendar, Kanban, Gantt v1→v2, CRM contacts+activity, procurement attachments, mobile/wave-0), the **coherence wave** (one noun/registry/RecordHeader/KpiTile/list-shell/unified approvals), the **JTBD remediation program** (waves 1–3: shared links, status-variant authority, budget money-bug fix, dead-display sweep, breadcrumb/rail fix, CRM-rename), the **QA redesign** (ADR-0030 portfolio + S-curve time-axis), and **Incidents hidden behind a feature flag** (`#121`).

**Promotion path (documented, owner-gated):** backlog.md 2026-06-16 "▶ OUTSTANDING" #2 — *"`main` → `production` (Cloudflare `git push origin main:production`) + push migs 0028–0033 to Cloud via `scripts/db-push-prod.sh`"*. Per `environments.md` / CLAUDE.md, release = merge `main → production`, and the prod DB push is gated + typed (`prod` confirm). **Caveat:** the prod FE deploy also needs care because Incidents is now feature-hidden (`#121`) and the seed was rebuilt to a solar-EPC dataset (backlog notes seed is now *prod-reusable but applying to Cloud is a separate owner-gated step* — an intentional override of the standing "seed = local only" rule).

---

