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

---

## Archived from docs/backlog.md (2026-07-25)

Moved out of the read-first backlog once complete — they were costing every session and every
subagent brief context for work that had already shipped. Verbatim, not summarised.

### ✅ P3a Sales/AR write-through — **MERGED TO `dev`** (verified by content 2026-07-23; header was stale)
> ⚑ **CORRECTION.** This block said "HARDENING ROUND mid-flight; branch, NOT merged" while contradicting
> itself 30 lines down ("✅ P3 COMPLETE … PR #360"). A cold-start agent reading top-down acted on the wrong
> one. **All of P3a is on `dev`**, and under **migs `0123`–`0135`, NOT the `0104`–`0107` this block claims**
> (on `dev` those numbers are M365). Every "REMAINING" hardening block is closed: BLOCK 1
> (`recoveryProbe.ts:125`), BLOCK 6 (`readModelWriters.ts:154`), BLOCK 7 (`salesInvoice.ts:37`,
> `incomingPayment.ts:44`), BLOCK 8 (`reconcileSiCancelAutoUnlink` live, no longer dead).
> `origin/feat/erpnext-adapter-p3` is 0 commits ahead of `dev`. Notes retained below for the record.
**Branch `feat/erpnext-adapter-p3`** (off `dev` @ `b549d06`). **HOLD on the branch — NO PR** (owner: dev
is moving with parallel agents). Spec + plan SIGNED OFF:
[`docs/specs/erpnext-adapter-p3a-sales-ar.spec.md`](specs/erpnext-adapter-p3a-sales-ar.spec.md) ·
[`docs/plans/2026-07-14-erpnext-adapter-p3a-sales-ar.md`](plans/2026-07-14-erpnext-adapter-p3a-sales-ar.md).
R9 bench spike frozen: [`docs/spikes/2026-07-14-erpnext-si-pe-receive-fields.md`](spikes/2026-07-14-erpnext-si-pe-receive-fields.md).
Owner rulings: `decisions.md` **OD-SAR-GATES · OD-SAR-PMO-IS-THE-UI · OD-SAR-DRAFT-SUBMIT**.
- **✅ Built (8 slices) + happy-path proven:** migs `0104–0107`; revenue domain (SI + PE-receive) full
  write-through through `adapter-dispatch` + the ADR-0058 fenced outbox; **two-person SoD** (SI create
  leaves an ERP DRAFT → a DIFFERENT approver submits — OD-SAR-DRAFT-SUBMIT); process-gates seam;
  inbound feed (lifecycle + adopt); AR aging (reuses P2 report path); FE (SalesInvoices/IncomingPayments/
  RevenueByProject). **Served-fn money e2e: 19/19 GREEN at the live bench** (two-person flow). Gates:
  verify (5,428) · pgTAP (1,506) · deno (69) green at the happy-path checkpoint.
- **⚑ HARDENING ROUND IN PROGRESS (re-Luna@max NO SHIP):** the first Luna audit's 8 findings were fixed;
  a **max-thinking re-audit** ([`docs/reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md`](reviews/2026-07-15-luna-p3a-reaudit-maxthinking.md))
  found the **dispatch/repo layer has real authz/targeting/reference holes** the happy-path e2e misses
  (it hand-builds correct commands). **DONE + verified:** BLOCK 2/3/4 (dispatch domain-ownership+role+
  kind↔domain gate before ERP write — hardens ALL erpnext money writes, incl. a gap P2 shared;
  repo submit/cancel send verb+externalRecordId; transition targeting bound to the PMO mapping) + BLOCK 5
  (PE references fail-closed). **REMAINING (resume — task tree + the re-audit doc):** BLOCK 6 (cross-org
  FK check PRE-flight, before ERP write — nemotron's RED test was org-blind, needs a coherent rewrite),
  BLOCK 1 (recoveryProbe anchor-key fallback must also filter payment_type/party_type), PE-sweep
  payment_type disambiguation, BLOCK 7 (siFromDoc/peReceiveFromDoc extract customer/links so inbound
  adopt doesn't NULL them), BLOCK 8 (wire the dead `reconcileSiCancelAutoUnlink`), SF9 (project-gate-
  without-ERP-project), SF10 (partial `process_gates` bypass defaults). Then re-run the 2-person e2e +
  **re-Luna `--thinking max` until SHIP** → hold on branch.
- **✅ P3 COMPLETE (2026-07-23).** P3a shipped in #338; **P3b (timesheets) + P3c (budget) are in
  [PR #360](https://github.com/ariefsaid/PMO/pull/360) → `dev`** (branch `feat/erpnext-adapter-p3`,
  head `fabde7c5`, 35 commits). Gates re-run by the Director on the PR head: verify 746 files / 6277
  tests, pgTAP 211/2103, deno 447, **e2e serial 54/54 vs a live ERPNext bench**, visual gates 78/78.
  **11 adversarial audit rounds — 10 NO SHIP, 1 SHIP; ~54 defects, nine of them in fixes made during
  the review.** Full record + the eleven ways a test failed to fail:
  `docs/reviews/2026-07-23-p3bc-audit-program.md` (read it before the next money slice).
  Owner rulings folded in: OQ-BUD-3 (fail closed on multi-FY), OQ-BUD-3b (FY from ERPNext's own
  `Fiscal Year` doctype), OQ-TSP-5 (per-org timezone first-class + mismatch BLOCKS the flip),
  OQ-TSP-6 (ship with the correction gap).
  **⚑ Next issues this spawned, in priority order:** (1) `Approved → Draft` re-open + ERP cancel
  (OQ-TSP-6 — hit far more often than the budget deferral; mistyped timesheets are routine);
  (2) the budget fiscal-year/phasing dimension (OQ-BUD-3(c) — 8 of 54 seeded projects span years);
  (3) **FR-BUD-152 tension needs an owner ruling** — a gate rejection before FY resolution suppresses
  PMO's OWN budget figure on a year with real GL actuals (PMO-SoT data hidden by external push health).
  **Carried risks, deliberate:** `service_role` retains direct DML on the snapshot tables (the RPC is
  the only *production* writer — convention, not structure); the e2e week separator is a random base,
  safe for `--workers=1` but **not** a parallel CI matrix without deriving it from worker index.
- **Next: P4** Odoo (ADR-0055 §8) — **demand-gated, not scheduled**: it starts when a real Odoo client
  signs. There is no P5; P4 is the last defined phase.
- **Substrate (this program):** build → nemotron-3-ultra (NIM, reliable) or zai/glm-5.2 window; FIXES →
  glm-5.2 (owner directive); **money/security review → Luna `--thinking max`** (owner 2026-07-15,
  `docs/pi-delegation.md`). ⚑ ONE op on the shared worktree at a time (verify-while-agent-edits = a
  contaminated read; concurrent heavy dispatches + sibling agents' MCPs + Docker → OOM risk).


### ✅ H4 GRANTS HARDENING — **LANDED ON `dev`** (verified 2026-07-23; header was stale)
> ⚑ **CORRECTION:** this block said the work sat unmerged on `fix/revoke-client-truncate-grants`. That
> branch **does not exist** (local or remote). The work IS on `dev` as migrations
> `0104_revoke_client_truncate_refs_trigger.sql` + `0105_revoke_anon_write_dml.sql`. Verified by content,
> not by branch name. Nothing is owed here. Original notes retained below for the root-cause record.
Spun out of the M365 Luna audit. Commits `57957091` (Tier 1) + `246be744` (Tier 2). **Root cause was bigger than
the finding:** the grants come from Supabase's bootstrap **DEFAULT PRIVILEGES** (`pg_default_acl`), so EVERY new
table silently inherited `truncate` for `anon`+`authenticated` — `0075` was just where it was visible. Fixed at
BOTH layers (`ALTER DEFAULT PRIVILEGES` + a catalog sweep over all 65 public tables). Tier 1 = revoke
`truncate/references/trigger` from both client roles. Tier 2 = revoke `anon` I/U/D (`0109` was the ONLY test
depending on it — its assertion moved "UPDATE affects 0 rows" → `throws_ok 42501`: same goal-oracle, strictly
stronger mechanism). ACs `AC-GRANT-007/010/011/012/013`. Gates: pgTAP 166/1471 PASS · verify exit 0. **Accepted
residual:** a `supabase_admin` default-priv entry can't be revoked (migration runner `postgres` isn't a
superuser/member) — inert (every public table is created BY `postgres`), and `AC-GRANT-010`'s creator-agnostic
catalog sweep catches real drift. **✅ MERGED to `dev` as PR #336 (`adf79e48`, owner) — it KEPT `0104`/`0105`
+ test `0142`; M365 renumbered above it to `0106–0117`/`0154` instead.** Branch deleted.


### ✅ COMPLETE ON `dev` (2026-07-22) — ClickUp integration + integration enablement
> **COLD-CONTEXT? START HERE →** [`docs/plans/2026-07-20-clickup-integration-completion.md`](plans/2026-07-20-clickup-integration-completion.md)
> Current enablement authority: ADR-0061 + [`docs/specs/integration-enablement-model.spec.md`](specs/integration-enablement-model.spec.md).
> Live-smoke evidence remains in [`docs/spikes/2026-07-17-clickup-live-smoke.md`](spikes/2026-07-17-clickup-live-smoke.md).

The program is merged to `dev` through **PRs #353–#358**. The task feature is complete for every task
column reachable from the UI without requiring ClickUp: description and priority (#350), subtasks,
archive and delivery-rollup exclusion (#352), plus project-aware ownership and routing.

`EXTERNAL_CONNECT_ENABLED` is **default-ON**, not a rollout flag. Unset, empty, and unrecognised values
are enabled; trimmed case-insensitive `false|0|off|no|disabled` disables. It is an operator break-glass
for ClickUp and ERPNext. Per-org active bindings and Vault credentials are the enablement authority, so
production's unset variable does not mean the integration is inert and there is no flag-flip step.
Ownership follows `project_domain_externally_owned` (migration `0146`): mixed ClickUp-owned and PMO-native
projects are supported. An unbound List cannot leak tasks into PMO; zero active bindings is healthy/inert.
**Locked decisions: `docs/decisions.md` OD-INT-1..13** (admin self-serve · personal-token/API-key v1 ·
**Vault-backed `secret_ref`** · one tier-generic layer · sequenced after #315 · **OD-INT-6 ERPNext Company
selected at ORG level** · **OD-INT-7 project↔List link is PROJECT-SCOPED to the owning active PM** ·
**OD-INT-13 status map round 3 — pmo-only outcomes with Blocked defaulting to pmo-only**).

**Still open:**
1. Promote `dev` → `main` (117 commits); only PR→`main` runs integration (pgTAP + full e2e + visual),
   and this work has only used the verify-only fast lane so far.
2. Promote `main` → `production`, owner-gated per instance; this is the deployment, not a flag flip.
3. Correct the owning layer for `AC-IEM-004` and `AC-IEM-007` (specified curated e2e, implemented lower).
4. Add read-only per-status mapping visibility/override to the binding map (OD-INT-13; auto-derivation is
   correct, so this is a transparency gap).
5. Per-org webhook secret remains deliberately deferred for single-org scope (OD-INT-14 / ADR-0047).

Historical design and phase details remain in [`docs/plans/2026-07-13-clickup-admin-integration-flow.md`](plans/2026-07-13-clickup-admin-integration-flow.md); they are not the current completion status.


### ✅ Audit HIGHS — ALL 3 MERGED to dev (owner-directed, 2026-07-07, glm-5.2/4.7)
1. **✅ feature-flag server-enforcement** (#265, mig `0081` + pgTAP `0138`) — `org_feature_enabled()` (non-raising twin of `org_has_feature`) conjoined into the WRITE policies of **24 gated tables** via a DO block mirroring 0063's apply-time append. **Director caught 2 real bugs by serial pgTAP** (both would've shipped silently): glm's `cmd in (lowercase)` filter matched nothing vs UPPERCASE `pg_policies.cmd` → gated NOTHING; + precedence paren-wrap so `(A or B) and F` holds. Full suite 1215 PASS.
2. **✅ orphaned-Auth-user compensation** (#264) — `admin-invite-user` now `deleteUser(invite.user.id)` on profile-insert failure (best-effort, distinct `PROFILE_CREATE_CLEANUP_FAILED` code).
3. **✅ e2e blindspots** (#263) — `requireServiceRoleKey()` throws in CI (wired into AC-AUTHF-005/020) + `quarantine-guard.spec.ts` self-validates the 4 quarantined tests' markers + exact count.

**Residuals from the Highs (tracked):** feature-gating the security-definer procurement/timesheet RPCs (they bypass RLS — the direct-PostgREST threat IS closed) · same un-parenthesised-append latent risk in 0063 (empirically proven-safe by the RLS suite) · the crm→companies mapping gates company writes on the CRM feature (confirm companies isn't a cross-feature dependency before enabling crm-off for a client).
**✅ PROMOTED dev→main→production (2026-07-08, owner-instructed):** the 3 Highs + two other-agent features (#267 agent-read-scope, #268 live-step-trail) shipped to dev, promoted dev→main (#269, `1f68058`, integration lane GREEN), verified main push-CI green, then main→production: prod DB `0080→0081` (feature-flag; via `db-push-prod.sh`), edge fns `admin-invite-user`+`agent-chat` redeployed, FE `main:production` (CF Pages). **`main` == `production` == `1f68058`**; smoke: health 200, DB 0081, pages.dev 200. **Op-lesson: `op-get.sh` (1Password SA token) HUNG mid-deploy (5-min+ timeouts, blocking `db-push-prod.sh`) then RECOVERED on retry — verify prod migration state via `supabase migration list --linked` (auths by access token, not op) when op is flaky; the linked project IS prod (`prwccpsiumjzvnwjlkwq`), a valid `--linked` fallback path once verified.**

**Residuals / deferred (tracked, not blockers):**
- **Credit-race WIRING (deferred with #15)** — thread `run_id` through the 3 agent-chat `check()` sites + `release_credits` after each turn; decide compose-view's missing run_id (release-by-reservation-id or a TTL reaper). Coupled pair (reserve-without-release leaks holds→org-lockout). Ships when credits are enabled (owner-gated, GTM launches un-enforced).
- **#18 residual** — `audit_agent_denial` is `authenticated`-callable → a user can inject *own-org, own-actor* denial-audit noise (append-only, low severity, no cross-org forge).
- **Auditor gaps still open (Meds/Lows):** telegram-notify send-ok+stamp-fail dup alerts (`index.ts:86`) · `notifyOwner` swallows errors untraced · health endpoint checks zero deps · `enforce_automation_owner_cap` racy count-then-insert (SHARE ROW EXCLUSIVE pattern at `0065:69`) · `set_project_contract_value` accepts negative (overlaps money `CHECK(>=0)`; #17 logs but doesn't reject) · `spike-rls.yml` `npm install`+service-role-key (pin+ci or delete) · 3 missing runbooks (prod-deploy/secret-rotation/agent-LLM-outage — doc conversions from `environments.md`).
- **Earlier-audit Meds (not started):** agent-persistence stuck-`running` · interactive-create idempotency · `error_events` completeness + retention · S-curve today-position test · PostHog consent-gate · agent-chat rate-limit.

**Audit fixes OUTSTANDING (after the 3 in-flight Criticals land):**
- **#14 supply-chain/CI — ✅ LANDED ON `dev`** (verified 2026-07-23; entry was stale). Branch
  `harden/supply-chain-ci` **does not exist**; the work is on `dev` by content: **21** `deno.lock` files,
  **10** SHA-pinned Actions and **zero** unpinned `@vN` refs in `ci.yml`. Nothing is owed here.
- **Remaining Meds** — ⚑ **3 of these 7 were WRONG (2026-07-23 audit; see the audit block at the top):**
  ~~agent-chat rate-limit~~ **DONE** (mig `0091`) · ~~S-curve today-position test~~ **DONE**
  (`sCurve.test.ts:126`) · agent-persistence stuck-`running` **PARTIAL** (the `errored` path shipped; a
  reaper is what is missing). **Genuinely owed:** interactive-create idempotency · `error_events`
  completeness (**~15 fns + FE + retention**, not "2 fns") · money `CHECK (>=0)` (= the
  `set_project_contract_value` item — ONE task) · PostHog consent-gate.

**OWNER-ONLY (not autonomously doable):** execute a **DR restore drill** before client #1 · agent-tier **eval GH secrets** + **credits-enforce** decision (both deliberately deferred per GTM plan) · **MSA→counsel** (Terms/Privacy are template stubs) · automation `pg_cron` GUCs · prod Cloud auth-config verification · **prod deploy** (owner-gated, per-instance — push migs to Cloud, redeploy edge fns incl. `admin-invite-user`, FE→CF Pages, set `VITE_FEATURES_CRM=true`).

**Substrate (owner directive):** implementations run on **pi/GLM** to spare Anthropic quota; Director (Claude) orchestrates + security-reviews every diff. **Routing (owner 2026-07-07): glm-5.2 = opus alt, glm-4.7 = sonnet alt; run one dispatch per model in parallel (GLM caps parallel per-model).** **NEVER OpenRouter.** GLM/zai RECOVERED 2026-07-07 (both 5.2 + 5.1 + 4.7 responding) — the 3 Criticals above are being built on it now. Node v22 required for pi (`export PATH="/Users/ariefsaid/.nvm/versions/node/v22.20.0/bin:$PATH"`). Dispatch: `Bash(run_in_background:true)` + `< /dev/null` + `--append-system-prompt .claude/agents/implementer.md`; brief the agent NOT to touch the shared DB (Director verifies pgTAP serially). **Op lessons:** 600s watchdog kills long *quiet* verifies → run heavy `verify`/pgTAP in the main session; a live pi run collides with `db reset` on the shared stack (serialize by `pgrep`); glm-4.7 hallucinates supabase-js APIs + pgTAP fn names (`table_exists`→`has_table`) — Director must diff+fix; glm agents copy the WRONG (stale) migration body for `create or replace` RPCs (grep ALL defs, use the latest).
## ▶ GTM / MVP-viability program (owner grill, 2026-07-04 — supersedes scattered GTM notes)

**Decisions of record from the grill (all owner-confirmed):** ADR-0047 (per-client Supabase Cloud
Pro + CF Pages; VPS = documented exit path; the old cloud project is **reclassified STAGING/DEMO**,
`docs/environments.md` updated) · ADR-0048 (ERPNext = headless accounting engine under PMO;
never build accounting; no Odoo; command/query split, single-writer per DocType; accountant
workspace chunked, AR/AP aging pulled into F1; period-close/e-Faktur stays ERPNext) · glossary:
**Operator** (platform persona ≠ org Admin), **Organization = client group**, **Entity =
subsidiary dimension** (never a separate org; intra-group visibility OK for MVP).

**MVP scope (before/at first paying client) — each row ≈ one issue-loop:**
1. **Ops-Admin surface:** (a) user invite/disable (service-role edge fn + `profiles.status` +
   email rails); (b) credits → **org-pool grants** (schema tweak; flip `credits` INSERT RLS from
   role=Admin → **Operator-only** — as-built it lets client Admins self-grant); (c) usage view
   (`agent_usage` aggregates per org/user + provider-USD vs credits **margin column**; Operator
   sees **aggregates only, never transcripts** — owner-locked privacy line); (d) Operator
   mechanism = platform-level grant table, NOT a 6th enum role; (e) `org_features` entitlements
   build with ownership **flipped from the 2026-06-15 note: Operator-write, org-Admin read-only**.
2. **Auth floor (non-negotiable):** Resend SMTP · password-reset flow · email confirm + invite
   emails · redirect allowlist → prod HTTPS only · rotate/kill seed creds · `auto_expose_new_tables=false`.
   Build together with 1a (same rails). Google OAuth = stretch; SAML = out.
3. **Observability floor:** uptime ping + public status page (= the SLA answer) · PostHog error
   tracking (vendor-consolidated; still no Sentry) · one alert webhook consuming the #224 edge-fn
   errorCodes · 2 PostHog dashboards (org usage; agent cost) · real-browser PostHog spot-check.
   Explicitly NOT: log aggregation, APM, tracing.
4. **Legal floor (Indonesia):** MSA/subscription template (lawyer-day, carries manual billing) ·
   ToS + privacy static pages + footer links incl. wa.me help · pinned data-residency answer.
   Skip: GDPR self-service, cookie banner, DPA machinery.
5. **Backup/DR (cloud):** Pro plan per client project · **one restore drill** into a scratch
   project (documented) · 1-page incident runbook (FE rollback via CF, DB restore, alert path,
   client-comms line).
6. **Client onboarding:** provisioning runbook/script (project → migrations → `functions deploy`
   → secrets → org + first Admin → CF env) — this IS "add org" for the Operator; **white-glove**
   import (runbook + wizard idempotency fix) · **historical import script**: summary-grade,
   ≤1yr, terminal-status records with provenance, NO fabricated transition events.
7. **Entity (subsidiary) dimension** — conditional MVP: build when the first group-of-companies
   client signs (schema dimension + filters + rollup).
8. **Support floor:** WhatsApp group per client (response-time line lives in the MSA) · in-app
   help link · **deputy-as-help-desk** (help corpus = glossary + jtbd.md into assistant context)
   + per-role walkthrough videos recorded during onboarding. No written manual until a question
   repeats 3×.

**Deferred follow-up (Director-adjudicated during the build, 2026-07-04):**
`auto_expose_new_tables=false` (NFR-AUTHF-CONF-006) — cross-family review found flipping it strips
DML grants on all 44 tables (no migration issues explicit GRANTs), so it needs a dedicated
per-table GRANT migration + security review, NOT a jam into the auth PR. **Accepted as a tracked
follow-up issue**, not an auth-floor blocker; the auth email flows are unaffected. `config.toml`
keeps it commented with the reason; `docs/environments.md` §7.6 carries the blocking-finding note
for the eventual owner-gated hardening pass.

**CUT from MVP (owner-confirmed):** custom RBAC engine (escape valve = additive read-only
Viewer role) · Stripe/Midtrans (manual MSA billing) · VPS (exit trigger: >$200/mo Supabase or
onshore-data contract; sized playbook in ADR-0047) · homegrown accounting (never) · separate
operator console (<~5 deployments) · shared-project multi-org + org-seam proof (deferred by
per-client isolation) · SAML · GDPR self-service.

**⚑ BUILD-LOOP AUTHORIZED (owner, 2026-07-04):** autonomous session(s) on `dev`, batteries-A
goal directive (full SDD/TDD + 3-lens + rendered battery per issue, PR per issue, owner gates
`dev`→`main`). Build order: auth floor → ops-admin → observability → DR → legal pages →
onboarding tooling → support floor. **Executor policy: pi+GLM first, parallel where possible;
Claude subagents + dynamic workflows when pi quota exhausts.** Locked inputs: **domain/brand
decision DEFERRED until after issues 1–2** — build against env-var seams (`RESEND_API_KEY`,
sender/site URL as config; wire 1Password + DNS later) · Operator = operator@pmo.test ·
alerts → **Telegram bot** · uptime/status = **BetterStack** (professional client-facing status
page > reliability > ease, per owner priority order) · Supabase stays FREE tier as staging/demo;
Pro billing at first client signing · MSA brief drafted by Director (`docs/legal/`), owner takes
to counsel.

**Fast-follow (post-first-clients):** **external-system adapters per ADR-0055 (2026-07-10 grill —
supersedes ADR-0048's `pmo_connector`/F1–F3 plan):** P0 seam (adapter contract, `external_refs`
+ watermarks, pending-push UI state, capability-map config) → **P1 ClickUp adapter, tasks**
(deliberately BEFORE ERPNext — smallest adapter, proves the SoT/enhancement/read-model machinery,
distributor-partnership demo) → P2 ERPNext money core (parties, procurement chain, AP commands +
actuals/AP-AR aging) → P3 ERPNext width (timesheets, budget projection, sales docs = Revenue/AR
spine 4) → P4 Odoo adapter (when an Odoo client signs). Key rules: external system = SoT for
capability-map domains; Supabase = read-model + additive-only enhancements; synchronous
write-through; adapters = PMO-side TS on stock APIs (RIS-portal-2 `api/*.py` = mapping spec +
future helper-app source, NOT a code port). · credits **pricing decision from 2–4 wks of pilot
margin data** (launch un-enforced, then price, then enforce) · Google OAuth · PostHog
product-analytics widening.

---

## Agent-experience + Tier-2, and the 2026-06/07 state blocks (archived 2026-07-25)

Moved out of the read-first backlog: the agent-experience/Tier-2 program **shipped to production
2026-07-06** and the four dated `Current state`/`Prior state` blocks below it were point-in-time
archaeology (one still asserted `main`=`7a65ac7`, contradicting the top of the same file).

⚑ **The durable gotchas from this program were NOT lost and are NOT here** — they live in their
proper homes: `docs/adr/0050-layered-agent-prompt-charter-and-skills.md` and
`docs/adr/0052-agent-eval-harness.md` (the `deepseek-v4-flash` weak-tool-selector caveat and why
prompt steering is unit-tested but not model-verified). The e2e shared-auth-mutation trap is in
`docs/e2e-parallel-conventions.md`.

### ⚑ AGENT EXPERIENCE LAYER + TIER-2 — HANDOFF STATE (2026-07-05, parallel build stream — READ THIS to continue)

**Goal (owner `/goal` 2026-07-04):** full SDD→plan→TDD→review→QA cycle to surface the *built-but-not-wired*
Tier-1 batteries + build Tier-2. Executor: pi+glm first (glm-5.2≈opus / glm-4.7≈sonnet), Claude
sonnet/opus fallback. **This is a SEPARATE stream from the GTM build above — different files (agent panel /
edge fn vs auth/ops-admin); coordinate the SHARED single local Supabase stack (no concurrent `db reset`/
pgTAP/e2e — `docs/environments.md` local-stack hygiene).**

- **SDD (source of truth):** specs `docs/specs/agent-experience-layer.spec.md` (FR-AXP-*) +
  `docs/specs/agent-tier2-capabilities.spec.md` (FR-AT2-*); plan `docs/plans/2026-07-05-agent-experience-layer.md`
  (has a **✅ Progress section** — read it first); ADRs **0049** (safe markdown, supersedes D-A2-8) + **0050**
  (layered agent prompt). Tier-2 open-Q defaults are recorded in the task board / tier-2 spec.
- **DONE on `dev` (flag-gated, NOT promoted):** I1 safe markdown (`f970a14`), I2 layered prompt/skills
  (`f970a14`), I3 context completeness (`87412ea`), Track D drawer UX (`48b932c` + AppShell reflow follow-up),
  and Track E surfacing specs (`AC-AXP-011/012/013/014/016` Playwright specs added and `--list` verified).
  Latest continuation commit also updates this handoff + the plan progress section. Wave-1 review battery green
  (security: no C/H/M; one code-quality Important fixed).
- **Tier-2 progress (2026-07-05, this stream):**
  - **I5 Cmd+K + conditional approvals — SHIPPED to `dev` via PR #236** (`feat/agent-tier2-cmdk-approvals`):
    openPanel(prefill?) + consumePrefill() one-shot prefill; CommandPalette "Ask AI" row on zero-result
    queries behind the flag; route-aware suggestion chips (`suggestionChips.constants.ts`); ADR-0051
    conditional-approval predicate (`AgentAction.needsApproval`, `resolveNeedsApproval`,
    `AGENT_APPROVAL_MONEY_THRESHOLD`, `isDestructiveDeleteAction`); `update_task_status` auto-approves;
    `create_activity`/`create_automation` keep always-chip. AC-AT2-006..013 unit proofs + AC-AT2-007
    Playwright spec. Full `npm run verify` green (548 files / 4386 tests).
  - **I6 agent eval harness — SHIPPED to `dev` via PR #237** (`feat/agent-eval-harness`): ADR-0052
    (Accepted) — the `*.eval.ts` behavior-regression net against the DEPLOYED agent-chat loop.
    `evals/harness/{scorers,runEval}.ts` (usesTool/contains/llmJudge + runEvalCase via test-user JWT →
    decodeSseStream), `evals/cases/tool-selection.eval.ts` (2 anchor cases), `vitest.eval.config.ts`
    (dedicated project; `npm run test:evals`), `vite.config.ts` excludes eval cases from `verify`,
    `.github/workflows/agent-evals.yml` (nightly + dispatch, never push/PR). AC-AT2-015 scorer half
    deterministic (12 tests, in `verify`); the real-loop half + exit-code gate light up once the owner
    provisions the deployed-target GH secrets (§OQ-1). Full `npm run verify` green (545 files / 4388 tests).
  - **I4 attachments — BUILD COMPLETE + FULL BATTERY GREEN on branch `codex/agent-attachments-track-a` @ `b269f9a`
    (pushed; draft PR #239 body still stale — REFRESH it before marking ready).** ADR-0053 + plan
    `docs/plans/2026-07-05-agent-chat-attachments.md`. ✅ **2026-07-06 (Opus Director, pi-orchestrated):**
    - **Committed & verified (11 commits ahead of `origin/dev`, `8f9ef82`→`b269f9a`):** Tracks A/B/C primitives +
      wiring (`8f9ef82`→`58dcd1d`), WIP wiring snapshot (`930947f`), wiring-greened (`9cd612e`), AC-AT2-001
      cross-stack e2e (`692afcf`), **3-lens review battery applied — all 10 findings fixed & verified (`b269f9a`)**.
    - **Review battery (cross-family gpt-5.4): security SHIP, spec+code-quality BLOCK → 1 Critical + 6 Important +
      3 Minor, ALL fixed** (glm-5.2 via TDD; Director-verified): sticky-thread conversation-mixing (Critical);
      resolver ordering, composer error-classification collapse, a11y duplicate "Attach file", per-conversation
      thread-scope on the resolver, honest "could not read / do not fabricate" degradation (FR-009), drag-drop
      target (FR-001) (Important); ADR-0017 seam for `createAgentThread`, e2e id-shape tightening, pgTAP 0112
      hardening (forged path/owner + bucket MIME/size) (Minor).
    - **GATES GREEN (Director-run on the final tree):** `npm run verify` 555 files / **4430 tests** · `supabase
      test db` 121 files / **973 tests** (hardened `0112` ok) · `playwright AC-AT2-001` **1 passed** (flag on) ·
      typecheck 0. Migration `0060_agent_attachments.sql`, pgTAP `0112`.
    - **DEC-7 (image vision) + DEC-8 (PDF text extraction) ship as HONEST graceful-skip** — an unreadable file now
      injects an explicit refuse-don't-fabricate block. Both are **owner-confirmable follow-ups** (supply-chain
      vetting of a Deno PDF extractor; whether prod `deepseek-v4-flash` supports vision) — NOT blockers; the
      capability is spec-complete for text-readable PDFs + the degradation path.
    - **REMAINING before PR→`dev` (the ONLY open I4 work): (1) rendered Discover pass** on the composer attach +
      drag-drop + error/ready states, dark+light (the design/taste lens — not yet done; z.ai was rate-limited so
      no `agent-browser` render); **(2) refresh PR #239 body → open/ready to `dev`.** Nothing else.
    - **Untracked junk NOT in the commits (leave or clean separately):** `prod-*.png`, `docs/design-mockups/redesign/_refs/agent-native/*.png`, `.claude/launch.json`, the 3 `deno.lock`s.
  - **I7 obs-memory — DEFERRED** behind a token-cost trigger (unchanged).
- **PROGRESS ≈ 97% (2026-07-06, Opus Director):** I1–I3 + Track D + Track E + I5 + I6 DONE & on `origin/dev`;
  **I4 build + full test/review battery COMPLETE & pushed (`b269f9a`)** — only the rendered pass + PR→`dev` remain;
  I7 deferred by design.
- **NEXT (for the resuming agent), in order:** **rendered Discover pass on I4 composer attach/drag-drop/error
  states → refresh + open PR #239 to `dev`** → owner-provision the eval-harness GH secrets (I6 §OQ-1) → **I7**
  obs-memory (deferred).
- **⚠ Load-bearing caveat:** the prompt STEERING is unit-tested (text present) but **unverified against the
  live deepseek-v4-flash** (weak tool-selector). The eval harness (I6, shipped) IS the gate once its GH
  secrets are provisioned. Promotion dev→main→production is **owner-gated**.

## ▶ Current state (2026-07-06) — AGENT-EXPERIENCE + TIER-2 WAVE SHIPPED TO PRODUCTION (owner-instructed)

> **RESUME ENTRY POINT (2026-07-06).** The full agent-experience + Tier-2 program (I1 markdown · I2 layered
> prompts · I3 context+drawer · Track D/E · I4 attachments · I5 Cmd+K/approvals · I6 eval harness; I7 deferred)
> is on **`main` = `dev` = `production` in content**, all at **`94ce615`**. **Shipped to prod 2026-07-06 (owner
> "ship to production"):** (1) prod Cloud DB (`prwccpsiumjzvnwjlkwq`) migrated **0057→0060** (0058 procurement
> write-hardening, 0059 agent-automation-bounds, 0060 agent_attachments table+bucket+RLS) via `db-push-prod.sh`;
> (2) edge fns **agent-chat + agent-dispatch + compose-view redeployed** (I2 prompt, I4 attachments resolver,
> help corpus, mint fix); (3) FE **`git push origin origin/main:production`** → CF Pages `94ce615`
> (https://pmo-bfb.pages.dev). **Verified:** agent-chat + compose-view boot clean (401 invalid-JWT, no
> WORKER_ERROR); CF serves 200. **Promote flow this session:** dev→main #240 (agent-xp wave) then #241 (I4);
> the recurring dev→main integration-red was **AC-AUTHF-005 mutating the shared `pm@acme.test` password** (fixed:
> afterEach service-role restore + serial `workers:1` + signIn retry — see [[e2e-shared-auth-mutation-trap]]).
> **Still owner-gated follow-ups:** DEC-7 image-vision + DEC-8 PDF-text (ship as honest graceful-skip), F4 mobile
> assistant entry, OpenRouter fallback chain, agent automations pg_cron GUCs (`app.settings.dispatch_url`/
> `service_role_key`), credits enforcement (default OFF). **Final logged-in UI render-check on prod needs owner
> creds** (db-push never seeds prod). **⚠ SHAs move fast — trust this line + git, not memory.**

## ▶ Current state (2026-07-04, late) — AGENT TIER LIVE IN PRODUCTION (reskin + assistant panel, rendered-verified) + full security/hardening on `dev`=`main`

> **RESUME ENTRY POINT.** **`dev` = `main` in content** (promoted 2026-07-04 via PR #229, merge commit
> `6f75edb` — a real 3-way merge resolving 44 squash-divergence conflicts to `dev`; `git diff origin/main
> origin/dev` is now EMPTY, and `main` carries `dev`'s ancestry so the NEXT promote is a clean ff).
> `main`/`dev` carry the reskin (#210) + the ENTIRE batteries-included-A program (#211–#218) + cross-family
> remediation (#219/#220) + full-codebase-review remediation & 5-wave hardening (#221–#228) + the mint
> fail-closed fix + the agent-e2e/CI gate fix. **Migrations through 0057, pgTAP through 0109, ADRs 0043–0046.**
>
> **✅ BOTH OWNER GATES CLEARED (owner-instructed 2026-07-04):**
> 1. **`dev`→`main` promote — DONE** (PR #229). Full `verify`+`integration` lane green. The integration gate
>    (which only runs on PR→main, never PR→dev) caught 3 agent-e2e that had never executed in CI — all
>    test/CI-config, no app change: AC-AAN-036/AC-AGP-023 needed `VITE_SUPABASE_ANON_KEY` exported to
>    `$GITHUB_ENV` (they build a 2nd anon client); AC-AW-012 raced the ⌘J listener mount (added the
>    wait-for-Assistant-button guard every other agent e2e already had). Fixed on `dev` (`3324b9d`), re-verified.
> 2. **RED-3 + RED-4 → `production` DB — DONE.** `scripts/db-push-prod.sh` applied migs **0042–0057** to the
>    Supabase Cloud DB (prod was at 0041; all 16 were pending — the pre-agent 0042–0045 had also never shipped
>    to prod). All prod-data-safe (0043's FK is on a fresh NULLABLE column; the rest additive/RLS-policy-only).
>    **prod DB now at 0057; the two live-prod tenant-security holes are CLOSED** (RLS-enforced, independent of FE).
>    Legit old-FE flows unaffected — 0051/0052 only block the abuse paths (file-a-PR-as-another-user, non-admin
>    project delete).
>
> 3. **`main`→`production` FE deploy + agent tier LIVE — DONE (owner-instructed 2026-07-04, rendered-verified).**
>    CF Pages `production` = `8e4998e` → https://pmo-bfb.pages.dev (reskin + agent UI). AssistantPanel **flag ON**
>    via a committed `pmo-portal/.env.production` (`VITE_FEATURES_AGENT_ASSISTANT=true`, `git add -f`) — there is
>    NO CF Pages API token in op (only `CF-Access-Client-*` = Zero-Trust Access, not Pages-mgmt), so the flag is a
>    committed build-time toggle (off = revert+rebuild). `agent-chat`+`compose-view` deployed to the Cloud project;
>    `OPENROUTER_API_KEY` set as a function secret (op `openrouter-api-key`/`credential`). **Live E2E verified in
>    the deployed UI**: login → panel → real answer (deputy-JWT → OpenRouter → deepseek-v4-flash); threads persist
>    (History survives reload). Fixed an edge-fn **boot-crash** in the process (actions↔schema circular-import TDZ
>    → WORKER_ERROR; `049d1e2`, now CI-guarded by `scripts/deno-boot-smoke.ts`).
>    **Live agent-chat polish — ✅ FIXED + rendered-verified in prod (PR #234, deployed `56a77e9`):** the
>    `agent_runs` heartbeat 406 (`.single()`→`.maybeSingle()`) and the duplicate user bubble (server `type:'user'`
>    echo de-duped vs the optimistic add). Verified live: 0 console errors, single bubble.
>
> **STILL OWNER-PENDING (separate):**
> - **Agent AUTOMATIONS in prod** — needs `agent-dispatch` fn deploy + pg_cron GUCs (`app.settings.dispatch_url`/
>   `service_role_key`) + live-mint verify. Until then mig 0048's cron is registered-but-idle (per-minute NULL-url
>   → self-pruning no-op, by design). Interactive assistant (above) does NOT need this.
> - **Credits enforcement** — `AGENT_CREDITS_ENFORCED` default OFF (launch un-enforced per the GTM plan; price after
>   pilot-margin data). **F4 mobile assistant entry, OpenRouter fallback chain** still open.
>
> **Seven-dimension audit + hardening wave (2026-07-04, post-promote):** `docs/spikes/2026-07-04-seven-dimension-audit.md`
> is the ledger. 7 read-only audits over `dev`@`8869145` (RED-1..4 + SEC-HIGH-1/2 re-verified CLOSED). Same-day
> fixes on `dev`: **H-1** procurement record tables RPC-only writes + amount CHECKs + Admin-only file DELETE
> (mig `0058`, pgTAP `0110` — was LIVE in prod DB); **C-1** model-call retry ×3 (429/5xx/network); **H-5**
> usage-metering fail-closed after 3 consecutive insert failures; **M-1** automation bounds (mig `0059`, pgTAP
> `0111`); **M-2** dispatcher schedule claim-then-fire (double-fire immunity); **M-4** `AGENT_ALLOWED_ORIGIN`
> CORS seam; **M-11** AuthProvider getSession `.catch`; **M-17** vitest `clearMocks`; root package.json stray
> removed. H-2 (credits OFF) + H-3 (TOCTOU) + H-4 = documented owner decisions/v1 tradeoffs, untouched.
> **Owner-gated follow-ups: push migs 0058–0059 to prod DB + redeploy agent-chat/compose-view (+ set
> `AGENT_ALLOWED_ORIGIN`).** Deferred (ledgered in the spike): H-6 `strict`, M-16 e2e waits, M-14 god
> components, M-6/M-7/M-8/M-9/M-12/M-15 + lows.
>
> **Full-codebase review + hardening (this session's second half):** `docs/spikes/2026-07-04-full-codebase-review.md`
> is the severity-ledger + shipped-vs-deferred truth. 7 gpt-5.5 sweeps found 11 real issues 4 prior review layers
> passed (incl. 2 live-prod); all exploitable ones FIXED (#221–#223), + hardening waves: observability logging
> +readiness script (#224), reliability atomic RPCs +error-boundary (#225), 12 indexes +pagination (#226),
> test-hardening +deno-check CI gate +dependabot bumps (#227/#228). **Deferred (non-exploitable, ledgered):**
> bulk-import idempotency (own slice), ~~`mint.ts` latent bug~~ (✅ fixed `2de2da8`), timesheet
> entry_date week-range, `.select('*')` trim, MED-1/MED-2 org-seam, deno.lock pin, PostHog dashboards (ops).
>
> **What shipped in batteries-included A (2026-07-03→04, one autonomous session, full SDD/TDD/BDD + 3-lens +
> rendered-Discover battery per issue):**
> 1. **#211+#212** — vendor-neutral `ModelClient` + OpenRouter transport (deepseek-v4-flash, DeepInfra-first,
>    fallbacks on; per-request usage capture). Cross-family pi+gpt-5.5 battery confirmed hardening; live
>
> **What shipped (2026-07-03→04, one autonomous session, full SDD/TDD/BDD + 3-lens + rendered-Discover
> battery per issue):**
> 1. **#211+#212** — vendor-neutral `ModelClient` + OpenRouter transport (deepseek-v4-flash, DeepInfra-first,
>    fallbacks on; per-request usage capture). Cross-family pi+gpt-5.5 battery confirmed hardening; live
>    deepseek gate = **GO-WITH-CAVEATS** (AC-MC-023 evidence in the spec).
> 2. **#213** — ADR-0043 persistence: `agent_threads/runs/events` (owner-only RLS, seq-ordered, tool-call
>    journal → durable resume w/ write de-dupe, server heartbeat + stuck-run UX, feedback thumbs), panel
>    history/resume. Review battery caught + fixed a seq-collision Critical and a heartbeat inversion.
> 3. **#214** — handler-debt refactor: shared `runToolLoop`, `MALFORMED_TOOL_CALL` repair-turn, cast cleanup.
> 4. **#215** — PostHog agent events (9 typed builders, no-content privacy NFR proven, `safeTrack`).
> 5. **#216** — `agent_usage` ledger + credits (mig 0047; unbypassable clamp on untrusted usage; preflight
>    guard behind `AGENT_CREDITS_ENFORCED` default OFF; out-of-credits UX). Quality lens caught a missing
>    hot-path index pre-merge.
> 6. **#217** — ADR-0044 automations + notifications (mig 0048 + **ADR-0046** watermark table; pg_cron→
>    `agent-dispatch` fn; **minted-owner-JWT background deputy** w/ cross-tenant gate; NL conditions;
>    bell/inbox). Security lens caught + fixed a HIGH (un-allowlisted trigger source reaching service_role).
> 7. **#218** — ADR-0045 transcript contracts: typed widgets (twice-validated zod → PMO primitives),
>    ask-user via `control('answer')`, live-context grounding hints + thread-scope population.
>
> **✅ CROSS-FAMILY VERIFICATION PASS (pi+gpt-5.5, 2026-07-04) — #219 + #220.** After the 6 issues merged,
> ran the whole tier through an independent gpt-5.5 battery (security · ADR-conformance · quality/interaction),
> which found **11 issues 4 Claude review layers had passed** — incl. a genuine **Critical cross-org tenancy
> breach** (Org-B `procurement_status_events` event firing an Org-A automation + leaking into its condition
> prompt; service_role read had no org filter). All fixed + independently re-audited **CONFIRM-CLOSED**:
> - **#219** (dispatch/tenancy): cross-org org-gate (+ falsy-org hardening), service_role minimal projection,
>   mint-before-audit on every path, watermark `(created_at,id)` compound cursor, **migration 0049** dropping
>   the owner-DELETE append-only violation on agent transcript/audit rows, JWT-TTL honesty (`wallClockTimeoutS`).
> - **#220** (agent-chat/panel): answer-continuation regains write/compose caps, credit-gate ordering (resolve
>   pending interactions at zero balance), pending-question ≠ stuck-run, server cancel path (ADR-0043 §4).
> - **ADR amendments** (this commit): 0044 §3 (JWT TTL not bounded — deputy ceiling is the mitigation, not TTL);
>   0046 (advance-per-attempted, not advance-after-success). **Lesson: cross-family review catches what
>   same-family passes — make it a launch/version gate, not just issue 1.**
>
> **⚠ OPEN before `v0.2.0`→prod (owner-gated):** the promote path deploys DB+FE only — needs
> `supabase functions deploy agent-chat compose-view agent-dispatch` + prod secrets (`OPENROUTER_API_KEY`,
> pg_cron `app.settings.service_role_key` GUC) + flag decisions (`VITE_FEATURES_AGENT_ASSISTANT`,
> `AGENT_CREDITS_ENFORCED`, `AGENT_AUTOMATIONS`) + the **binding live-mint verification** (ADR-0044 —
> `admin.generateLink` mint for a known user → minted client reads only their rows; edge runtime can't run in CI).
>
> **Deferred/owner-pending ledger:** F4 mobile Assistant entry (owner call) · OpenRouter fallback chain
> (owner will provide) · credit grants admin UI (SQL-only v1) · TOCTOU preflight revisit at ADR-0044-scale
> concurrency · free-text-question vs composer dual-input + feedback-affordance polish (decisions.md notes) ·
> chips pending: dependabot vulns (1 high) + `deno check` CI gate for edge-fn entry files (found: they're
> outside every type gate) · e2e mutation-spec isolation flake (pre-existing, recurring).

## ▶ Prior state (2026-07-01) — agent-native assistant SHIPPED to `main`; versioning adopted

> **RESUME ENTRY POINT.** **`production`(prod) UNCHANGED at `fc312eb` / Cloud DB migration 0041 = the
> `v0.1.0` versioning baseline (ADR-0042). `main`=`1c0f747` (agent-native epic A1–A4 promoted, PR #200,
> gated `verify`+`integration` green). `dev` = same content, + the versioning PR landing now.** No prod
> promote happened this session (main is the autonomous ceiling; prod needs a direct owner go).
>
> **What shipped to `main` this session — the agent-native in-app assistant (ADR-0040/0041), the app's
> first server-side tier:** the ⌘J `AssistantPanel` (A2); a streaming **`agent-chat` Deno edge-function
> deputy** (A1) with read-only `query_entity` + approve-gated write actions `create_activity`/
> `update_task_status` (A3) + compose-a-view (A4); the `AgentRuntime` port + `PmoNativeRuntime` adapter.
> Feature-flagged off by default (`VITE_FEATURES_AGENT_ASSISTANT`). Deputy auth = caller JWT, RLS ceiling,
> `ANTHROPIC_API_KEY` server-only. **The `dev→main` integration gate caught 7 real defects the verify-only
> dev lane structurally can't** (pgTAP fixtures, CI flag, SSE-mock shape, panel-hide UX bug, e2e selectors,
> hotkey-open race, save-mock shape) — each fixed honestly (app-bug→fix app; test-bug→fix test; PRs #201–205).
>
> **Versioning adopted (ADR-0042; PR #206):** SemVer, pre-1.0 while single-tenant MVP. `v0.1.0`=current
> prod; `v0.2.0`=next release = composed views + the agent-native edge-function tier (migs 0042–0045).
> The bump rule + release manifest are in the ADR; `CHANGELOG.md` is the per-release record.
>
> **⚠ OPEN before `v0.2.0` can ship to prod (owner-gated — see OPEN debt):** the promote path deploys only
> DB+FE — there is **no `supabase functions deploy` step and no prod `ANTHROPIC_API_KEY` secret**, so the
> agent panel would call a missing endpoint. Edge functions also don't run in CI/this container
> (`[edge_runtime] enabled=false`) → agent e2e are mocked; **live end-to-end test needs a local session**
> (`docs/environments.md` → Edge Functions).
>
> **▶ DECIDED (owner, 2026-07-03) — agent-native sidecar verdict: CHERRY-PICK; Option A is the ONLY user
> surface. Binding record + forward plan: ADR-0040 addendum 2026-07-03.** The pilot (branch
> `feat/agent-native-adoption`, PR #209) was driven live by the owner and the sidecar UI proved
> **builder/admin-grade, not app-user-grade** (workspace file browsing; "sign up with Builder" upsells on
> the add-provider/add-DB/hosted-UI flows; sidecar settings editable from the end-user panel) — retired as
> a user surface on UX/audience grounds, on top of the known ops grounds. Its batteries are host-coupled
> (Nitro + own `agent_native` Drizzle schema), not liftable. **PR #209 closed unmerged; branch retained as
> a reference archive** (mine: `server/middleware/deputy.ts` AsyncLocalStorage deputy seam,
> `server/lib/read-allowlist.ts`, `test/deputy-invariant.gate.test.ts`, OpenRouter/deepseek wiring
> `f6d6eb1`, scoped-CSS embed plugin).
>
> **▶ NEXT BUILD — "batteries-included A" (each item its own SDD → plan → TDD issue):**
> (1) **OpenRouter provider adapter** in `agent-chat` (cut at the injectable `AnthropicLike` seam,
> `handler.ts`; OpenRouter = OpenAI-shape; its per-request cost accounting feeds metering). **Owner-decided
> 2026-07-03:** PMO-central OpenRouter key (function secret; BYO-key maybe later, enterprise) · default model
> **`deepseek/deepseek-v4-flash` routed DeepInfra-first with fallbacks allowed** (fallback chain TBD, owner
> will provide) — gate: an across-the-board quality test
> (chat + read/write tools + `compose_view` structured output) on that model BEFORE any stronger-model
> fallback is added; per-action model map stays env-configurable · seam renamed **vendor-neutral
> `ModelClient`** (OpenAI-shape). Note: the pilot's "DeepInfra pin infeasible" was an agent-native
> settings-store limit — direct OpenRouter API supports `provider: { order: ["DeepInfra"] }`;
> (2) **`agent_threads` + `agent_events`** persistence (RLS/org_id, owner-private, Companies-slice pattern
> like `user_views`) — transcript resume + doubles as the agent audit trail;
> (3) **`agent_usage` ledger + per-user CREDIT balance**, enforced server-side at the existing `RateGuard`
> injection point — the SaaS metering seam (pricing strategy deliberately deferred);
> (4) **PostHog agent events** (ADR-0022; no Sentry).
> **Scope grown by owner 2026-07-03 (Tier-1 + ask-user promoted; ADRs 0043–0045 Accepted, they govern):**
> item (2) is now **ADR-0043** (binding: thread `scope`, tool-call journal/durable resume, progress
> heartbeat + stuck-run UX, per-event feedback — fold into its spec);
> (5) **automations (cron + event-triggered) + notifications inbox** = **ADR-0044** (pg_cron→dispatcher
> edge fn; minted-owner-JWT background deputy — THE security-sensitive piece, security-auditor owns it;
> credits preflight from item 3);
> (6) **transcript interaction contracts** = **ADR-0045** (typed data widgets via renderer registry,
> ask-user question chips via `control('answer')`, live route/entity context as untrusted hints).
> Suggested build order: 1 → 2(0043) → 3 → 4 → 6(0045) → 5(0044) — automations last (needs credits + notifications).
> **Backlogged nice-to-haves (owner 2026-07-03):** view-proposal workflow (user proposes an agent-composed
> view for promotion into the coded app — ADR-0036 §7) · input-form composition primitives (agent-built
> data-entry forms; new primitive class, write-path security — own ADR when picked up).
> **Battery-mining catalog (2026-07-03): `docs/spikes/2026-07-03-agent-native-battery-mining.md`** — the
> exhaustive pass over agent-native (retired-branch dist + upstream docs) for further end-user batteries.
> Tier 1 candidates: automations (cron+event) · notifications inbox · progress/stuck-run UX · typed
> chat-widget results · context awareness. **⚑ Its "design inputs" section is BINDING on items (2)/(4)
> above** (thread↔entity scope, tool-call journal for durable resume, progress heartbeat, feedback fields);
> upstream has NO budget/rate-limit system — validates item (3) as a build-not-borrow differentiator.

## ▶ Prior state (2026-06-21) — PROD CURRENT: procurement case-folder record model + tabbed case-page UI revamp LIVE

> **RESUME ENTRY POINT (model-agnostic).** **`production`(prod) current at `fc312eb` / Cloud DB migration 0041; `main`=`7a65ac7` (the 2026-06-21 procurement IxD + Reserved-budget program promoted, PR #169); `dev`=`d317260`+ a few ahead (the 2 done follow-ups + docs). See IMMEDIATE NEXT ACTION below.** The prod-level case-folder revamp shipped a prior session (owner-direct "push to prod", PRs #158→dev #160→main): the **procurement revamp** — a case folder over ERP-canonical record tables (PR/RFQ/Quotation/PO/GR/VI/Payment; **dual-ID** = minted system# + external ref; **Model-C** = case-spine + optional PO-anchored settlement chain w/ a same-case FK invariant; PO-less is first-class; SoD-gated `transition_procurement` RPC byte-preserved; append-only `procurement_status_events` log; migs **0035–0041**, the 0038 backfill creates PR/PO records from existing prod pr_number/po_number) **+ the tabbed case page** (Overview bento + Progression timeline · Documents dual-ID ledger w/ file view+upload · Vendor-quotes bid comparison) replacing the old accreted stack. Authority: **ADR-0033**; spec `docs/specs/procurement-records.spec.md`; plans `docs/plans/2026-06-19-procurement-{records,ui-revamp}.md`; design `docs/design/procurement-redesign/`. Security-audited (1 Medium fixed); pgTAP 0076–0083; procurement e2e retargeted to the tabs.
> **⚑ BINDING (owner): work→`dev`→`main`; `main` is the autonomous ceiling. NEVER promote to `production` (FE push or `db-push-prod.sh`) without a DIRECT per-instance owner instruction.** (`fc312eb` was such an instruction.) Promote = `db-push-prod.sh` typed-`prod` (**NO reseed** — seed §R/§S/§T procurement enrichment is local-only) → `git push origin main:production` (clean ff). ⚠ `db-push-prod.sh --check` hangs **silently in `op-get.sh`** if 1Password is locked (zero output; looks like a DB hang but isn't — unlock 1Password first).
>
> **⭐ IMMEDIATE NEXT ACTION — none blocking; `dev` is 9 commits ahead of `main` (the 2 procurement follow-ups + a full backlog debt sweep), optional promote.** **`main`=`7a65ac7` (PROMOTED 2026-06-21, owner "ship to main", PR #169, gated green)** carries the procurement IxD + Reserved-budget program (#162–168). **`dev`=`42c1522` is 9 ahead** — all `verify`-green, promote whenever (gated `verify`+`integration`). **`production` UNTOUCHED — `fc312eb`/mig 0041, now well behind `main`; a prod promote needs a direct per-instance owner go (would push migs 0042–0044 to the cloud DB + FE to `production`).**
>
> **▶ Backlog debt sweep (2026-06-22/23, owner "do it including the minors") — DONE on `dev` (#170–176):**
> - **#170** `0001_rls_enabled` catalog-driven · **#171** `vi-*` testids single-sourced (`vendorInvoiceTestIds.ts`).
> - **#172** doc query-key org-scoping + 3 minors (TZ-flake UTC-fix, kanban Won/Close-Out color split via `--violet`, Projects `<ExportButton>`). **#173** odd-count `StatTiles` last tile spans both mobile columns (fixes the half-empty 5-tile cell; render-verified @390).
> - **#174** **incident→project FK** (gap #8): mig `0043` `incident_reports.project_id` + same-org guard trigger (42501, mirrors 0039) + flag-gated UI; **security-audited clean** + render-verified + pgTAP `0086`. **#175** dashboard status-set literals → shared SQL helpers (mig `0044` + pgTAP `0087`; byte-identical, `0069` drift-guard green). **#176** **axe-core a11y gate** (component-layer, 8 surfaces, runs in `verify`) + e2e retry-isolation (unique-named fixtures on AC-PROC-001/AC-DEL-022).
> - **Already-done/stale (reconciled, NOT debt):** OD-D3 per-role-dashboard real-data (audited — every figure already real-query-backed; the old `*0.4` fabrication long gone) · `<ListState>` adoption (already widely adopted; the 3 hand-rolled spots are legitimately bespoke) · Vite-8 upgrade (done #141) · Projects Export (now #172).
> - **Deferred (assessed, NOT a minor — own issues):** **transition-map drift guard** — a real SQL↔TS guard needs re-emitting the byte-preserved SoD `transition_procurement` RPC to expose its legal-map (material refactor); confirmed in-sync today. **Engineer-dashboard "tasks" tile** — needs a tasks-by-assignee query + RLS that doesn't exist yet (a fresh feature, surfaced by the OD-D3 audit).
> - **OWNER-GATED, NOT auto (need your go — deploy/prod-config):** **Signed-URL TTL hardening** [Medium] — move signed-URL minting to an Edge function with a hard max TTL; feature-sized (new Edge fn + prod deploy), not a minor. **Auth prod cutover** [Medium] — email-confirm/real-SMTP/redirect-allowlist/replace-dev-seed-pw on the LIVE cloud project; matters before real users (repo is public ⇒ project ref discoverable).
>
> **The 2026-06-21 program promoted to main (#162–168):**
> - **#162** tenancy seam — `procurementFiles.prepareUpload` server-fetches `org_id` (was client-threaded; ADR-0017 fix) + `0005_force_rls` catalog-driven. **#164** charter-audit minors — 11 FK/hot-path indexes (mig `0042` + pgTAP `0084`), 6 `hsl()`→DESIGN.md tokens, e2e-count guidance re-baselined.
> - **#163** GR/VI inline capture folded into `RecordCaptureForm` (`onStage` confirm path) + `ProcurementDecisionZone` extracted → `ProcurementDetails.tsx` 1393→988.
> - **#165** decision-strip moved from sticky-footer to a compact non-sticky bar **under the stepper** (Notes progressive-disclosure, SoD hint one line) + `LedgerCaptureRow` data-driven (`ledgerCapture.ts`) so it stops over-prompting "Capture PR" once a PR exists. Render-verified.
> - **#166** **stepper is 6 stages, not 7** — "Approved" removed as a node (owner: approval is a *gate* across steps, not a stage); approving advances PR→done + Vendor Quote→current, status pill still shows "Approved". Applies to detail stepper + by-stage board + list pips; reverses PROC-002 (kept approval visible). Render-verified both surfaces.
> - **#167** **Reserved budget layer** (ADR-0034, owner-signed spec): `Available = Budget − Committed − Reserved`; Reserved = Σ approved-not-ordered `{Approved, Vendor Quoted, Quote Selected}`, a NEW org-scoped read (`getProjectReservedSpend`, pgTAP `0085` proves cross-org denial) — **Committed basis + dashboards UNCHANGED** (OD-BUDGET-2 amended, not redefined). Panel visible **request+approval only** `{Draft, Requested, Approved}` (OWNER-DECISION-2 tight); per-stage double-count fix (at Approved the case is already in Reserved → After == Available). UI term "Reserved" (never "encumbered"). **Full 3-reviewer battery + Director render passed.** **#168** extracted the per-stage math into a pure `computeBudgetSignal()` helper (+11 unit tests).
> - **Retro-review (this session):** security-auditor + code-quality ran over the previously-Director-only-reviewed #162–166 → **CLEAN** (no SoD/RLS/org_id regression; stepper confirmed presentation-only).
>
>
> **Gantt fix (#149→dev→#150→main, prod-live):** the project Timeline was built as TWO nested scroll contexts (outer `overflow-y-auto` + left `sticky` block + right pane's own `overflow-x-auto`) → table & timeline desynced vertically once the task list exceeded 60vh (owner caught "Commissioning misaligned, 2 scrollbars, not 1 unit"). Fixed to ONE `data-gantt-scroll` container (`overflow:auto` both axes) with the task column + header frozen via per-element `sticky` (corner z-40 > column z-30 > axis z-20 > bars). Geometry/zoom/milestones/dependency-lines/activation untouched. Regression test (RED-on-old/GREEN-on-new). **Director render-verified on dev (scrolled to Commissioning: sticky header, frozen column, aligned) THEN on prod.** This is the canonical example: a UI bug the deterministic gates structurally miss → caught by a rendered review (the QA gap the owner flagged; QA-hardening plan parked per owner, but the ratchet test was added).
>
> **⚠ INCIDENT + LESSON (2026-06-17): the /timesheets toolbar shipped visually broken** (owner caught it). Root cause: the shared `<Icon>` (`src/components/ui/icons.tsx`) had **no default size** — sizing depended on the caller passing `className` OR being inside `<Button>` (which sizes child svgs via `[&_svg]`). Hand-rolled controls (timesheet "Review N awaiting" `<Link>` + "Add project" `<label>`, added 2026-06-14) used **classless `<Icon>`** → icons rendered at intrinsic ~77px → blew out the layout. **69 of 123 `<Icon>` usages were classless** (latent footgun). **Why it slipped:** (a) the only deterministic UI gate `AC-MOBILE-OVERFLOW-001` checks *bleed*, and an oversized icon doesn't exceed viewport width; (b) ADR-0030's promised visual-regression gate was never actually built; (c) `npm run verify` renders zero pixels — a build can be green with a broken layout; (d) I shipped two timesheet-touching PRs (#135, #139) + the promote **without rendering that page**. **Fixes:** **#144** gave `<Icon>` a default `width="1em" height="1em"` (SVG attrs — override-safe given the repo's clsx-only `cn`, no tailwind-merge) → fixes all 69 classless usages; **#145** the durable net (below). **Standing rule reinforced: render the affected pages before shipping/promoting UI — verify-green is necessary, not sufficient.**
>
> **Shipped to main this session:**
> - **#135** — mobile horizontal-bleed killed app-wide @390/360 + the measuring gate `e2e/AC-MOBILE-OVERFLOW-001` (every route×{390,360}, no element right-edge > viewport — the deterministic L1 gate the 4-lens reviews structurally couldn't be) + **PostHog fixed** (our `property_denylist` stripped PostHog's own `token` field → tokenless `/e/` → 401; posthog-js#3438) + valid-`phc_`-key guard. **#134** (earlier) = prod-promote ops docs + `scripts/db-seed-prod.sh`.
> - **#136** — S-curve real cumulative ACTUAL line (ADR-0032): `tasks.completed_at` trigger-stamped (migration 0034) + hybrid client-side `buildSCurve(milestones, asOf, tasks?)`. Rendered review caught 2 bugs unit tests missed (seed stamped all completions `today`→ seed backfill block; axis-label overlap → `evenAxisTicks`). The verify-red (full-suite `useTasks` mocks across 3 suites + a tsc error) was fixed before merge.
> - **#139** — whole-row/card clickable: nav-lists (projects/procurement/etc.) → open detail; **/approvals + procurement preview** → expand-in-place (carve-out preserved). **Director rendered Discover pass PASSED** (live Playwright click-through on local Supabase, Admin: projects/procurement row→detail, approvals row→expand budget-impact, nested "Open project" link + preview chevron don't double-fire, no console errors). 12 AC-ROWCLICK-* tests.
> - **#140** — debts: +6 pgTAP 0028 RLS regression assertions, `tsToIso` helper, DRY'd the migration↔seed `completed_at` backfill via `task_completion_proxy()`.
> - **#141** — coordinated **Vite 8** toolchain bump (vite 8 + @vitejs/plugin-react 6 + vitest 4.1.9 + @vitest/coverage-v8 4.1.9 + @tailwindcss/vite 4.3.1); `vite.config.ts` `manualChunks` object→function (Vite 8 = rolldown, function form only). **Supersedes dependabot #138 (closed)** — which bumped vite alone → peer/typecheck break. Gotcha: a local `npm install` lockfile omitted rolldown's `@emnapi/*` optionals → CI `npm ci` EUSAGE; fixed by clean-regen + proving against `npm ci`.
> - **#144** — `<Icon>` default `1em` size → fixes the /timesheets toolbar icon-blowup (see INCIDENT above). Render-verified by the Director on the fix branch (timesheet tidy @desktop+390, dashboard un-regressed) before merge → promoted to prod (`d3d50b0`).
> - **#145** — **tiered CI + the visual-invariant gate.** (1) CI tiering: `dev` push/PR = `verify` only (fast lane); **PRs → `main`** = `verify` + `integration` (pgTAP + e2e incl. the visual gate) — so `main` is always clean + the prod promote stays a no-op (`integration.if` now `pull_request && base_ref=='main'`). (2) **`e2e/AC-VISUAL-ICON-001`** — deterministic gate: every route × {1280, 390}, no `svg[viewBox="0 0 24 24"]` (the shared-Icon family; recharts excluded) may exceed 40px. **Self-proven: passes on fixed main, FAILS with `77×77 timesheets@desktop` when the bug is re-introduced.** This is the net that would have caught the incident; chosen over pixel-screenshot regression (flaky/high-maintenance on a data-driven UI — available as a follow-up if wanted).
>
> **Executor switch (owner directive):** role work runs on **Claude Task subagents, NOT pi** ("use subagents here instead of pi for now"). Background dispatch via Agent `run_in_background:true` (+ `isolation:'worktree'` for parallel-safe edits) + auto-reinvoke = context economy. **Director still verifies every claim + does the rendered visual pass** (caught 2 real bugs in #136 + ran the #139 live click-through). New durable gotcha: a worktree-isolated agent's `npm install` can yield a lockfile that local verify accepts but CI's strict `npm ci` rejects — always prove a lockfile change against `npm ci`, not just `npm install`.
>
> Authoritative self-contained handoff: **this block + `docs/qa-portfolio.md` (QA model) + `docs/adr/0032-scurve-actual-series.md`**. Everything below the "⟨SHIPPED & SUPERSEDED⟩" header is HISTORY.

**Shipped to `main` this session (all gated PRs, `verify`+`integration` green except docs-only=admin):**
- **#122 ADR-0030 — QA portfolio** (`docs/adr/0030-…`, `docs/qa-portfolio.md`): the review model is now **Discover → Graduate → Cover** (open-ended Discover finds unknown-unknowns → every finding *graduates* into a test + a `routes×oracles` matrix cell + a DESIGN/decision note → enumerated sweeps + deterministic L1 gate-tests *cover* it). A **`review mode` switch** (`portfolio` default | `4-lens` | `3-lens`) at the top of `qa-portfolio.md` makes it **reversible** — the legacy 4-lens battery + `design-reviewer` agent + `design-workflow.md` §1a/§2.3 are kept intact. **Vendoring policy "buy-the-engine/build-the-skin"** (headless-first, MIT/permissive, supply-chain hygiene; 3rd outcome = build-and-own referencing MIT source).
- **#123 S-curve** time-axis fix (was categorical → today plotted far-right) — the *worked example*: graduated into a position test + a DESIGN.md "charts use a time axis" rule.
- **#124** process docs synced to the portfolio loop (`director-playbook`/`design-workflow`/`product-expectations`/`CLAUDE.md`).
- **#125 Gantt v2 (ADR-0031, BUILD-AND-OWN not vendored):** on-axis milestone diamonds + dependency connector lines (frappe-MIT blueprint) + MS-Project split table/timeline + day/week/month/quarter zoom + pixel-aware geometry/edge model + D1 mobile fallback (`useIsNarrow` 640px → List/Board notice). Vendor spike killed SVAR (GPLv3+R19-crash) & Frappe (no-a11y).
- **#119** housekeeping · **#120** CLAUDE.md model-tiering rule · **#121** Incidents hidden behind interim feature flag (`src/lib/features.ts`, re-enable=flip flag) · **#126** `pi-delegation.md` hardened (subagent must run pi blocking-foreground; GLM-only degraded mode).

**▶ pi/GLM QA-ORCHESTRATION TRIAL ✅ SUCCEEDED** (`docs/reviews/2026-06-16-qa-orchestration-trial-gantt.md`): a **separate opus orchestrator** ran the full portfolio loop on the Gantt D1 fix **from the docs alone**, dispatching **pi/GLM** for all work (build `glm-5.2` → review `glm-5.1` → fold), self-verified gates (3128/3128); Director only verified + hardened docs. **GLM verdict: keep both** (glm-5.2 first-pass-correct). **gpt-5.4/openai-codex is UNAVAILABLE → GLM-ONLY routing.** Prompting lesson: a Claude subagent gets NO background re-invoke → must run pi blocking-foreground within its turn.

**▶ OUTSTANDING (owner-gated / next):**
1. **PROD PROMOTE ✅ DONE 2026-06-17** — `production`=`d3d50b0` / Cloud DB **migration 0034** (two promotes: 5ce5a39 then d3d50b0 for the timesheet fix). All of mobile + PostHog + S-curve + row-clickable + Vite 8 + timesheet-icon-fix are LIVE. (1 dependabot-high esbuild dismissed not-affected.)
2. **PostHog real-browser spot-check (optional, owner):** the automation browser shows PostHog requests blocked by Chrome **Private Network Access** ("local address space") — an automation artifact, NOT user-facing. Since PostHog matters for the demo, confirm capture in a real browser (the #135 token-denylist 401 fix was verified at the time).
3. **Pixel-screenshot visual regression (optional follow-up):** the standing visual gate is the deterministic `AC-VISUAL-ICON-001` (flake-free). True pixel-diff (`toHaveScreenshot`) can be added if wanted — needs Linux baselines + tolerance tuning + churns on intentional UI changes; deferred deliberately.
4. **Vendoring:** date-fns ✅ #130 · TanStack Table ✅ DEFER #131. Closed.
5. **Minor doc residual** (non-blocking): breakpoint-doc 768-vs-640.

**Open feature tracks** (owner-scope-gated, not started): feature entitlements/per-org gating (backlogged, UI-hide-first); Reports module (`/reports` placeholder); Commitment-governance; Admin RBAC config engine; later spines (Revenue/AR, Resources/Assets, Service/O&M).

## ▶ KNOWN ISSUES

_None blocking._ (Prod migration push **DONE 2026-06-13** — `scripts/db-push-prod.sh` applied 0024+0025+0026+0027
to the Supabase Cloud project; `production` branch promoted to `main`@094406c → Cloudflare prod FE redeployed.
'Budget used', document file upload + the prod storage bucket, and the at-risk `>=` boundary are now LIVE.
The migration-0023 immutability bug behind this was fixed in PR #80; 0023 is byte-identical to its #74 prod content.)

## ⟨COMPLETED — MERGED to `main`⟩ KANNA gap-closing (waves 0–3 + coherence; detail in `history.md`)
> Not active. KANNA shipped long ago (via #118 + the squash PRs); `kanna-program.md` is archived. Kept below for reference only.
**Execution plan + wave sequencing: [`docs/kanna-program.md`](kanna-program.md)** — read it before any fan-out.
Gap analysis (what's missing): `docs/reviews/2026-06-11-kanna-gap-analysis.md`. Model: **parallel waves of ≤3–4
independent issues** (worktree + PR each; CI verifies in parallel on the public repo), with all owner-interactive
gates (grill-with-docs + owner-approved mockup) **front-loaded & serialized through the Director** per wave.
Role work via the **pi CLI** (`docs/pi-delegation.md`) or Task subagents.
- **✅ Issue #1 — document file upload — DONE & MERGED (PR #78).** Decisions OD-DOC-1..5; migrations 0024+0025;
  private org-scoped bucket; Draft-only upload/replace; download + preview; New-revision auto-Supersede (SoD);
  5 MB bumpable + allowlist. Security PASS. **Live on prod** (pushed 2026-06-13).
- **✅ Wave 0 — BUILT & on `dev` (PRs #84–#91):** 8 mobile/UX @390 fixes (exec dashboard glanceable · shell touch-targets · DataTable card-clip · scrollable filters · bottom-sheet confirm · procurement-detail mobile · day-stacked timesheet · project-detail back).
- **✅ Wave 1 — BUILT & on `dev` (PRs #92–#94):** Bulk **Export** (#92) · Project **Calendar** (#93) · **Procurement attachments** (#94, migration 0028). Grill + mockup skipped per owner directive; Director locked `[OWNER-DECISION]`s.
- **✅ Wave 2 — BUILT & on `dev` (PRs #95–#97):** **S-Curve** (#95) · **Kanban** (#96) · drift fix (#97).
- **✅ Wave 3 — BUILT & on `dev` (PRs #98–#101):** **Gantt** (#98) · **Import wizard** (#99) · **CRM** contacts+activity (#100, migration 0030) · CRM companies-drawer (#101).
- **✅ Coherence wave — BUILT & on `dev` (PRs #103–#112 + #111 + #114):** whole-app pattern unification. Design verdict: **SHIP.** Follow-up residuals resolved in #114 (sticky record-action zone + procurement header Edit + "deal" copy leak).
- **▶ Next after promote:** candidates per kanna-program.md §3 — Sub-projects · Append-only audit events · Commitment-governance spec · Spine-4 Revenue/AR. Default SOP = **series + pi** (the parallel burst consumed the Claude weekly-quota window and is now closed).

---

## 2026-08-24 — `dev` → `main` promote (PR #556): 134 commits, 17 migrations

**Merged `8a4f0878` with `--merge` (never `--squash` — a squash breaks ancestry and the next promote
cannot tell what is already on `main`).** Verified after the fact rather than trusting the report:
merge commit reachable from `origin/main`, `main..dev` = 0, `dev` an ancestor of `main`, and
`main` tree == `dev` tree == the tree the local gate certified (`84f0c12d`).

**Migrations `0187`–`0203`:** the currency + tax seam (`money_currency_seam`,
`sales_invoice_tax_treatment`, `vendor_invoice_tax_treatment`, `project_contract_value_tax`,
`sales_pipeline_currency`, `mirror_guards_currency_and_tax`) · `work_orders` · `first_class_tasks`
(+ `task_milestone_same_project`, `assignee_column_allowlist`) · multi-org (`operator_create_org`,
`org_lifecycle_guard`, `profiles_org_id_immutable`) · RLS hardening
(`dead_authenticated_write_grants`, `rls_active_member_write_composition`) ·
`locale_preference_columns` · `budget_import_provenance`.

⛔ **NOT DEPLOYED.** The cloud Supabase project stayed at `0186` and `production` stayed at
`868ab117`. `main` is the autonomous ceiling; production needs an explicit per-instance owner
instruction.

### What this promote actually taught — the part worth keeping

**The local promote gate found 9 failing e2e journeys that every PR to `dev` had passed.** CI's
`integration` lane (pgTAP + e2e + visual) only fires on a PR to `main`, so **133 commits accumulated
behind it**. Running `scripts/verify-main-pr.sh` before opening the PR is what turned a red CI run
into a green first try.

- **7 of 9 were one crash.** `ProjectDetail` resolves an on-hand record from a `select('*')` cache
  and a pre-win record from an **explicit column list**. The currency seam added `projects.currency`;
  the fallback never selected it; `Intl.NumberFormat` threw and the error boundary swallowed the page
  for **every pipeline deal** while the on-hand lens looked perfect. Two `as` casts hid it from the
  compiler. Fixed in #554 — the column list is now data feeding both the type and the query.
- **2 were stale journeys**, not bugs: #513 and #505 made tax treatment/amount **required** on a form
  and on VI import rows, and the journeys predated them. Steps updated, goal oracles untouched.
- ⛔ **The gate certified a commit it never tested.** It runs against the working tree and stamps
  `HEAD`; a dirty run mints a green token for the previous commit. It did exactly that mid-task. A
  dirty-tree refusal shipped in `13673a68`; the deeper defects — nothing reads the stamp, and it keys
  on the SHA rather than the tree it tested — are #555.

**The recurring class, three times in one day:** the artifact asserting a fact and the thing that
determines it were different objects — a policy vs its GRANT, a spec default vs the code, a stamp vs
the tree. Read the deciding one before reporting.
