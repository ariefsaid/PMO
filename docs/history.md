# PMO Portal — shipped program history

Archive of completed build programs (was the bulk of `docs/backlog.md`). **Not needed for current
status** — see `docs/backlog.md`. Full per-PR detail is in `git log` + the PRs; locked decisions in
`docs/decisions.md` (OD-*); durable engineering lessons in the auto-memory `pmo-operational-notes`.

Timeline (each program is merged to `main`; cited PRs + key migrations/decisions):

1. **Backend foundation** (PR #2) — schema, RLS (`enable` + `force` on all base tables, 0002/0004),
   `org_id` tenancy seam, pgTAP harness. ADR-0001 (tenancy), 0010 (test pyramid).
2. **Write-capable MVP / "write wave"** (issues #1–#5, PRs #13–#17, 2026-06-04) — Budget versioning,
   Procure-to-Pay, Timesheets, Sales pipeline + win-rate/margin dashboards. Established the
   **security-definer transition-RPC pattern** (ADR-0011/0012/0014) and the security-auditor-with-live-
   exploits gate (found a HIGH on 3 of 4 definer RPCs that unit+pgTAP+spec-review all passed — the
   4 recurring vuln classes are in `pmo-operational-notes`). "THE WALL" of owner decisions resolved →
   `docs/decisions.md`.
3. **CI hardening** (PR #19) — added the `integration` job (supabase + pgTAP + Playwright on the runner);
   fixed a silently-red `verify` job (hermetic unit env in `vite.config.ts`). Lesson: watch the actual CI
   run, don't merge on local-green.
4. **UI polish** (PR #29) + **App-wide FE-CRUD + RBAC program** (PRs #32/#34/#35, 2026-06-08) — the
   CRUD/RBAC foundation: repository seam (ADR-0017), `can()`/RLS authority split (ADR-0016), soft-archive
   (ADR-0018), server-enforced SoD + destructive deletes (ADR-0019). Companies/Tasks/Incidents/Documents/
   Admin shipped. Reference slice = Companies.
5. **UI realignment program** (2026-06-07, `main`@25d6963) — whole app re-skinned to the owner-approved
   RIS/IA-3 identity; `DESIGN.md` reverse-engineered from the app. ⚠ Surfaced the Tailwind-v4 `<alpha-value>`
   + cascade-order traps (whole color system can render dead while class-name tests pass) — see
   `pmo-operational-notes`.
6. **ADR-0020 → ADR-0021 unified detail** (PRs #37/#38) — one canonical `/projects/:id` stage-adaptive
   detail page (full delivery layout at every lifecycle stage; pre-win gets the PipelineLens banner).
7. **UX-naturalness program, Waves 1–6** (PRs #36–#65, 2026-06-08/10) — added two standing review lenses
   (IxD task-flow + IA structure) to the 3-lens battery (`docs/design-workflow.md` §2.3). Wave 1 (Model B
   + write policy + honest dashboard), Wave 2 (RBAC view-gating), Wave 3 (correctness/integrity/authz;
   migration 0018, OD-PROC-8), Wave 5 (detail/dashboard IxD; migrations 0019/0020), Wave 4 (mobile —
   DataTable table↔cards single-render), Wave 6 (a11y + DS-hygiene subset; H2/H4 normalization deferred),
   detail-drawers (PR #66), finance backend-debt (PR #67, migration 0022, `get_finance_budget_review`).
   Recurring lesson: the **rendered 3-lens review catches real bugs that all unit+pgTAP pass**.
8. **Deployment — LIVE** (PRs #68–#72 + infra, 2026-06-11; ADR-0006 ACCEPTED) — Supabase Cloud (prod) +
   Cloudflare Pages. Secrets via 1Password + `op-get.sh`. IPv6/session-pooler trap + the full runbook in
   `docs/environments.md` and the `deployment` auto-memory.
9. **PostHog analytics foundation** (PR #77, ADR-0022).
10. **Solar EPC demo seed + milestone enrichment** (PRs #73/#75/#76).
11. **Delivery backbone — spine 3** (PR #74, migration 0023, OD-DEL-1..8) — `project_milestones` (free-form
    per project), `tasks.milestone_id`, two-column % progress (calculated + input), weight-weighted
    delivery-% rollup. No stage-gates (OD-DEL-6); PM+Admin writes. Plain role-gated RLS (no SoD axis → no
    definer RPC).
12. **KANNA series Issue #1 — document file upload** (PR #78, migrations 0024/0025, OD-DOC-1..5) — see
    `docs/backlog.md` for the live entry. First feature run end-to-end on the pi-delegation trial.
13. **Procurement case-folder record model + tabbed case-page** (PRs #158→#169, migrations 0035–0041,
    ADR-0033, 2026-06-21) — ERP-canonical record tables (PR/RFQ/Quotation/PO/GR/VI/Payment), dual-ID,
    Model-C case-spine, SoD-gated `transition_procurement`. **Promoted to prod** (`fc312eb`/mig 0041) —
    the `v0.1.0` versioning baseline.
14. **Agent-native in-app assistant — epic A1–A4** (PR #200, ADR-0040/0041, 2026-07-01) — the app's first
    **server-side tier**: the ⌘J `AssistantPanel` + a streaming `agent-chat` Deno edge-function deputy
    (read-only `query_entity`, approve-gated write actions, compose-a-view) + `AgentRuntime` port /
    `PmoNativeRuntime`. Deputy auth (caller JWT, RLS ceiling), flag-gated off. The `dev→main` integration
    gate caught 7 real defects verify-only can't (PRs #201–205; see `docs/backlog.md` current state).
    **Versioning adopted** (ADR-0042, PR #206): SemVer pre-1.0; `main` in dev toward `v0.2.0`. Not yet in
    prod (needs the edge-function deploy step — `docs/environments.md`).

---

## ⟨archived from backlog 2026-06-16⟩ JTBD remediation + coherence current-state blocks (2026-06-14/15) — long since merged

> These were live `backlog.md` current-state blocks; superseded by the 2026-06-16 QA-portfolio/Gantt-v2 state. Embedded branch/commit figures are point-in-time and NOT current (e.g. 'dev 42 ahead' is false — see git).

### ⟨SHIPPED & SUPERSEDED⟩ Current state (2026-06-15) — JTBD REMEDIATION PROGRAM (long since merged via the session above)
> **RESUME ENTRY POINT (model-agnostic).** If you are resuming this work — **especially a non-Claude tool (pi/codex/etc.) that does NOT have the Claude auto-memory** — these REPO docs are the authoritative, self-contained handoff: **this `docs/backlog.md` current-state block + [`docs/reviews/2026-06-15-jtbd-reaudit-r3.md`](reviews/2026-06-15-jtbd-reaudit-r3.md) (full fix-wave-3 plan-of-record + lessons)**. Everything needed to continue is in-repo; you do not need any external memory. Plans: `docs/plans/2026-06-15-jtbd-remediation.md` + `docs/plans/2026-06-15-fix-wave-2.md`. Audits: `docs/reviews/2026-06-14-jtbd-census.md` + `docs/reviews/2026-06-15-broad-audit.md`. **Branch `jtbd-remediation`; verify exact head with `git -C . log --oneline -5`.**
> **⚠ If `git status` shows a DIRTY working tree:** a fix-wave-3 group (G3a→G3b→G3c→G3d, see the r3 plan-of-record) was mid-build when the prior session ended — the uncommitted edits are that group's partial work. Do NOT assume they're complete/correct: inspect each changed file against its group's spec in the r3 doc, finish the group, run the FULL gate (`npm run typecheck && npm run lint && npm test && npm run build` from `pmo-portal/`; `supabase test db` from repo root if SQL changed), then commit that group before starting the next. Commits land at clean per-group checkpoints; the last commit's subject names the last completed group.

Owner ran `/goal`: *"find as many [JTBD/usability issues] as possible, run workflow to fix them, then re-audit fresh — loop."* Triggered by owner: "the jtbd review isn't earning its keep" (Gantt unusable / procurement unnatural / approval chevron inconsistent / where is the CRM / drawer-vs-detail). **Method fix: replaced the narrative design-walk with an enumerated CENSUS** (16-route denominator × action-completeness oracle + cross-screen invariants + job-fit), plus a complementary BROAD audit (state/a11y/data/mobile/resilience).
- **Branch `jtbd-remediation`** (off `main`@`21a0577`) = head **`cbdf407`**. Gates green: typecheck 0 · lint 0 · build ok · **2957 unit** · **496 pgTAP**. **NOT merged to `main`/`dev`/prod.**
- **fix-wave-1 (DONE, gated):** 27 action-completeness findings → P0 shared seams (`ProjectNameLink`, `ApprovalRow` disclosure slot, single status-variant authority, Gantt `onActivate`) + 10 file-disjoint consumer pkgs. Closes the owner's dead-display/inert-project-name class + in-context add + CRM-hub buildout (activity timeline, Add-contact, contacts error-state) + Gantt-clickable + chevron order. Plan `docs/plans/2026-06-15-jtbd-remediation.md`; census `docs/reviews/2026-06-14-jtbd-census.md`.
- **fix-wave-2 (DONE, gated):** 25 broad-audit findings → **G1 the CRITICAL budget money-bug** (`projects.budget` stored-but-never-populated, twin of the 0032 spent bug → **migration 0033** derives at-risk/util from active budget-version line-items; **pgTAP 0075**), G2 false-empty-on-error cluster + MyTasks silent-no-op, G3 date-only UTC off-by-one (4 sites→canonical formatters) + variance-sign + compact-currency, G4 a11y labels/focus + touch-targets + resilience + ViewToggle semantics. Plan `docs/plans/2026-06-15-fix-wave-2.md`; audit `docs/reviews/2026-06-15-broad-audit.md`.
- **3-reviewer battery (on the program diff):** security **CLEAN** · code-quality **SHIP** · spec **COMPLIANT** (mig 0033 preserves `security invoker`+RLS org-scoping).
- **Fresh re-audit (loop-closer, both oracles re-run on the fixed tree):** census **0 Crit / 7 Imp / 17 Min**; broad **2 Crit / 7 Imp / 9 Min**. Structural wins HELD (drawer/detail clean, one noun, one registry). **It caught 2 residuals from my own waves** (header Spend% still on dead budget; AwaitingApprovalTile false-zero) + a pre-existing Critical (delivery-hook cache-key collision). Full triage + fix-wave-3 plan-of-record: **`docs/reviews/2026-06-15-jtbd-reaudit-r3.md`** (read this to resume).
- **▶ fix-wave-3 IN PROGRESS (plan-of-record in the r3 doc):**
  - **G3a ✅ DONE** (`e1e2b0d`, 2986 unit / typecheck 0 / lint 0): both criticals (delivery cache-key, header budget) + W1/W2 residuals (OverviewTab/Finance/AwaitingApproval false-empty, ProjectBudget line-item resilience, Gantt undated chips, procurement board link-in-button + empty-state) + 2 reviewer test-minors.
  - **G3b ✅ DONE** (`9774e5c`, 3004 unit / typecheck 0 / lint 0): shared `CompanyNameLink`+`ContactNameLink` + dead-display sweep (E-1: D-1/PL-1/PL-2/PRD-1/CD-2/AD-1/D-2) + `ApprovalRowShell` unification (B — owner's chevron complaint root-caused & fixed).
  - **G3c ✅ DONE** (`10c120e`, 3023 unit / typecheck 0 / lint 0): CRM editable/deletable activity (CD-1/CT-1; RLS already permitted — no migration; **new delete surface → security re-check before PR**) + type-independent related procurement (CD-3) + cold-start empty (CD-4).
  - **G3d ✅ DONE** (`e2dbe38`, 3046 unit / typecheck 0 / lint 0 / build ok): @390 overflow (PageHeader/BvACard, ProgressBar `widthless`) + status-pill registry consolidation (roleVariant/budgetVersionVariant) + noun + dead-code delete (3 components) + guard tests + xlsx-export catch.
  - **fix-wave-3 BUILD COMPLETE** (G3a `e1e2b0d`·G3b `9774e5c`·G3c `10c120e`·G3d `e2dbe38`; gate typecheck0/lint0/build/3046 unit/496 pgTAP).
  - **Convergence battery — PARTIAL:** the **action-completeness CENSUS re-audit COMPLETED** (run `w0qfgp5ns`, on `dev` post-`e2dbe38`) = **0 Critical / 0 Important / 11 Minor → CONVERGED on the action-completeness oracle.** All 5 owner complaints confirmed addressed; 11 residual minors only (see below). The **broad re-audit NEVER completed** — every attempt failed on the Claude API (first the usage-quota session limit, then a transient server rate-limit), so state/a11y/data/mobile/resilience is NOT re-verified post-wave-3. The **security re-check on G3c's activity update/delete surface also did not run.** **▶ NEXT SESSION (route via pi/GLM to dodge the Claude limit): re-run the broad re-audit + the G3c security re-check; then PR/promote when both confirm 0 Crit / 0 Imp.** Owner committed fix-wave-3 to `dev` for review.
  - **Census 11 residual minors (all in `w0qfgp5ns` synth):** (B-residual) procurement approval row still has a horizontal-inset mismatch vs the timesheet row (`ProcurementApprovalRow.tsx:144` `px-3.5` + different card shell) so the chevron column doesn't line up across the scope tab — the precise live remnant of the owner's chevron complaint; (A-residual) stale `pages/Approvals.tsx:22-24` header comment describes the RETIRED route-away procurement flow (doc-only); `useCompanyActivities` N+1 (code-quality); company hub still thin on a first-class **primary-contact** surface + a **related-opportunities / pipeline-value** roll-up; + ~6 smaller. None reopen an owner complaint to Important.
  - **▶ 2 NEW owner-found bugs (post-merge review of `dev`, 2026-06-15) — fix next session (neither caught by the oracles):**
    1. **Progress curve renders on ALL project tabs.** `ProjectSCurve` is at `pages/project-detail/ProjectDetail.tsx:216` OUTSIDE the tab switch (shared shell, below every tab), gated only by `!isPipeline`. IF-B's "demote" moved it below the tab bar but not INTO a tab. **Fix:** move `<ProjectSCurve>` into the `tab==='overview'` panel (OverviewTab) so it shows only on Overview; update `ProjectDetail.scurve-demote` test.
    2. **Breadcrumb ↔ rail mismatch on a pipeline project.** Opening a pre-win project from Sales Pipeline → URL `/projects/:id` → rail highlights **Projects** (URL-based) but the breadcrumb (`breadcrumbForPath`, `App.tsx:19`) roots under **Sales Pipeline** (record-kind-based). **Fix:** root the breadcrumb at **Projects** for the canonical `/projects/:id` route regardless of pipeline status (Sales Pipeline is a lens, not the home — matches CW-1 + URL-based rail); the pipeline cue stays on the status pill/stepper.
- **Executor model this program:** Claude `Task` subagents + the **`Workflow` tool** for audit fan-out; **build done SEQUENTIALLY on the integration branch** (the Workflow `isolation:'worktree'` forked from inconsistent bases — see LESSONS in the r3 doc). **`/goal` Stop-hook still active** until the loop closes.
- **DEFERRED tail (NOT in fix-wave-3 — owner triage):** Incident items IN-1 reporter field + IN-2 admin delete (**owner-descoped this program**, "remove incident for now"); **AD-2 admin deactivate/offboard user** (needs security-definer RPC + `profiles.status` migration → own signed issue; interim in-context note); SP-1 Sales "Won" kanban column never populates (build `useWonDeals()` or drop); `useCompanyActivities` N+1 (add batch DAL `.in('contact_id', ids)`); cosmetic data minors (`formatCompactCurrency` `$1000.0K`, `formatDocNumber` local-TZ, Gantt reversed-range); Funnel `aria-pressed` a11y; security Lows (server-stamp `logged_by_id=auth.uid()`, `mailto` recipient sanitize).

- **Post-fix-wave-3 polish (2026-06-15, on local `dev`, after owner review):**
  - **Seed consolidated to ONE canonical demo** (`7008a5b`/`f5d24b8`): `supabase/seed.sql` rebuilt as a recent (anchored ~2026-06-15) believable **solar-EPC** dataset that exercises every feature (11 companies/15 contacts/24 CRM activities; 17 projects across pipeline+delivery incl. Won+Lost+1 at-risk; 16 milestones for S-curve; 51 tasks [47 dated+4 undated] +15 deps for Gantt; 20 procurements across the full P2P lifecycle +3 awaiting approval; 19 Active budgets/41 line items; 7 timesheets; 4 incidents; 9 demo logins preserved). **`seed-demo-solar.sql` DELETED** — `seed.sql` is the only seed (`config.toml` `db.seed.sql_paths=["./seed.sql"]` auto-loads it on `db reset`). e2e fixtures kept (Playwright depends on them); their test-y display names relabeled to solar where not e2e-asserted (the 7 e2e-name-asserted projects P001–P004/P011–P013 keep plausible non-solar names — renaming would break ≥6 specs each; solar-ify later only with lockstep e2e-assertion updates). ⚠ Seed is now **prod-reusable but applying it to Cloud is a separate owner-gated step** (overrides the standing "seed = local only, never prod" rule — intentional for the pre-customer demo MVP).
  - **3 coherence fixes (`37ed025`):** the **2 owner-found bugs FIXED** — (1) S-curve moved into the Overview tabpanel (was shell-level → showed under every tab); (2) breadcrumb now roots at **Projects** for `/projects/:id` (was "Sales Pipeline" while the rail highlighted Projects — now they agree). Plus the recurring "where is the CRM" answered: **rail "Sales" section renamed → "CRM"** (holds Sales Pipeline + Companies + Contacts). typecheck 0 / 49 unit green.
  - **State:** all on **local `dev`** (now 42 ahead of `main`), **NOT pushed** (`origin/dev`/`origin/main` still `21a0577`), prod untouched (`origin/production` `094406c`, Cloud DB 0027). Still-pending from the JTBD loop: broad re-audit + G3c security re-check (Claude-API-blocked → route via pi) + the 11 census minors.

### ⟨SHIPPED & SUPERSEDED⟩ Current state (2026-06-14)
- **⚑ `dev` branch — large autonomous burst awaiting owner review (2026-06-14).** `dev` is ~33 commits ahead of `main`; **prod is UNCHANGED at migration 0027 / PR #83**. Owner: review `dev` → promote `dev → main → production` when satisfied.
- **KANNA Waves 0–3 (PRs #84–#101, on `dev`):** each ran TDD + 3-reviewer battery (spec+quality+security) + design-review round 2; grill+mockup skipped per owner directive (Director locked `[OWNER-DECISION]`s); CI green throughout.
  - **Wave 0** — 8 mobile/UX @390 fixes: exec dashboard glanceable · shell touch-targets+404/h1 · DataTable card-clip · scrollable status filter + Table-toggle hidden on mobile · bottom-sheet confirm · procurement-detail mobile actions/back/SoD · day-stacked timesheet · project-detail back-affordance.
  - **Wave 1** — Bulk **Export** xlsx (#92) · Project **Calendar** read-only (#93) · **Procurement attachments** per-phase child tables+RLS+storage (#94, migration **0028**).
  - **Wave 2** — **S-Curve** planned-vs-actual (#95) · Projects **Kanban** by status (#96) · mobile view-toggle/S-curve drift fix (#97).
  - **Wave 3** — **Gantt** (#98) · **Import wizard** xlsx (#99) · **CRM** contacts+activity (#100, migration **0030**) · CRM companies-drawer (#101). New migrations: **0029** calendar-milestone RPC, **0030** CRM contacts/activities.
- **Whole-app coherence audit (2026-06-14):** dual-substrate (Opus ×3 + gpt-5.4 ×3, 3-lens) → `docs/reviews/2026-06-14-whole-app-coherence-audit.md`. Diagnosis: "doesn't feel like the same app" = **PATTERN drift** (5 record verbs built per-feature), not token drift.
- **Coherence wave (PRs #103–#112 + #111, on `dev`):** plan `docs/plans/2026-06-14-coherence-wave.md`, DESIGN.md §7 added. CW-1: one noun "Project" + one create-verb. CW-2: status/colour registry (action-blue freed, active→grey). CW-7: bug sweep (NaN/dates, ⌘K-index Companies/Contacts, role-invariant URL, dashboard copy, validation, honest Add-user). CW-3a: one RecordHeader + bar stepper (retired procurement circle stepper). CW-3b: one KpiTile + one ProjectCard. CW-4a/b: routable `/incidents/:id` + `/companies/:id` + `/contacts/:id` pages (drawers-as-record retired, Incidents dead-end fixed). CW-5: one ListPage shell. CW-6: unified `/approvals` inbox. #111: re-landed orphaned #102 drift fixes (gantt today-line, s-curve "100%", import autoMap; #102 closed). Design-review closing verdict: **SHIP — "feels like one app."** Two minor residuals in follow-up PR (sticky action zone + procurement header Edit; "No deals in <stage>" → "No projects" copy leak). **B-MIN-1 noun-soup RESOLVED by CW-1.**
- **Deployed LIVE** — Supabase Cloud (prod) + Cloudflare Pages (`https://pmo-bfb.pages.dev`). Full
  infra/secrets/ops runbook + parallel-worktree stack hygiene: **`docs/environments.md`**. Release =
  merge `main → production`. **Prod is current** — Cloud at migration **0027**, `production` promoted (2026-06-13). PRs through **#83**.
  (Don't trust hardcoded counts — `supabase migration list` / `ls supabase/migrations` is the real check.)
- **Built & hardened (prod):** Commercial pipeline + win-rate, Budget versioning, Procure-to-Pay (full SoD),
  Timesheets, Companies/Tasks/Incidents/Documents CRUD, Admin users, RBAC (5 roles, RLS-enforced),
  per-role dashboards, mobile, **delivery milestones (spine 3)**, **delivery UI redesign** (even-bar
  stepper + 'Project delivery %' rollup + 'Budget used' committed-spend column), **document file upload
  (storage)**, PostHog analytics, Solar EPC demo seed (4-phase milestones). The CRUD/RBAC foundation
  (ADR-0015–0021) is the pattern all new work follows.
- **`dev` additionally contains (not yet on prod):** Export/Import wizard, Calendar, Procurement attachments, S-Curve, Kanban, Gantt, CRM contacts+activity, whole-app coherence pass — awaiting owner review + promote.
- **Most recently shipped to prod:** PR #83 CI changed-lines coverage gate. PR #82 at-risk consolidation. PR #80 delivery migration-chain fix. PR #79 delivery-UI redesign. PR #78 document file upload. Full timeline: history.md.
