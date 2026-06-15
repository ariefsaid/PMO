# PMO Portal — live backlog (status + what's next)

**This is the living status doc — read it first.** Shipped-program *history* lives in
[`docs/history.md`](history.md) (don't read it for status). Locked owner-decisions are in
`docs/decisions.md` (OD-* lookup by id). Roadmap framing in `docs/roadmap-spines.md`.

## ▶ Current state (2026-06-15) — JTBD REMEDIATION PROGRAM (branch `jtbd-remediation`, NOT yet merged)
Owner ran `/goal`: *"find as many [JTBD/usability issues] as possible, run workflow to fix them, then re-audit fresh — loop."* Triggered by owner: "the jtbd review isn't earning its keep" (Gantt unusable / procurement unnatural / approval chevron inconsistent / where is the CRM / drawer-vs-detail). **Method fix: replaced the narrative design-walk with an enumerated CENSUS** (16-route denominator × action-completeness oracle + cross-screen invariants + job-fit), plus a complementary BROAD audit (state/a11y/data/mobile/resilience).
- **Branch `jtbd-remediation`** (off `main`@`21a0577`) = head **`cbdf407`**. Gates green: typecheck 0 · lint 0 · build ok · **2957 unit** · **496 pgTAP**. **NOT merged to `main`/`dev`/prod.**
- **fix-wave-1 (DONE, gated):** 27 action-completeness findings → P0 shared seams (`ProjectNameLink`, `ApprovalRow` disclosure slot, single status-variant authority, Gantt `onActivate`) + 10 file-disjoint consumer pkgs. Closes the owner's dead-display/inert-project-name class + in-context add + CRM-hub buildout (activity timeline, Add-contact, contacts error-state) + Gantt-clickable + chevron order. Plan `docs/plans/2026-06-15-jtbd-remediation.md`; census `docs/reviews/2026-06-14-jtbd-census.md`.
- **fix-wave-2 (DONE, gated):** 25 broad-audit findings → **G1 the CRITICAL budget money-bug** (`projects.budget` stored-but-never-populated, twin of the 0032 spent bug → **migration 0033** derives at-risk/util from active budget-version line-items; **pgTAP 0075**), G2 false-empty-on-error cluster + MyTasks silent-no-op, G3 date-only UTC off-by-one (4 sites→canonical formatters) + variance-sign + compact-currency, G4 a11y labels/focus + touch-targets + resilience + ViewToggle semantics. Plan `docs/plans/2026-06-15-fix-wave-2.md`; audit `docs/reviews/2026-06-15-broad-audit.md`.
- **3-reviewer battery (on the program diff):** security **CLEAN** · code-quality **SHIP** · spec **COMPLIANT** (mig 0033 preserves `security invoker`+RLS org-scoping).
- **Fresh re-audit (loop-closer, both oracles re-run on the fixed tree):** census **0 Crit / 7 Imp / 17 Min**; broad **2 Crit / 7 Imp / 9 Min**. Structural wins HELD (drawer/detail clean, one noun, one registry). **It caught 2 residuals from my own waves** (header Spend% still on dead budget; AwaitingApprovalTile false-zero) + a pre-existing Critical (delivery-hook cache-key collision). Full triage + fix-wave-3 plan-of-record: **`docs/reviews/2026-06-15-jtbd-reaudit-r3.md`** (read this to resume).
- **▶ NEXT — fix-wave-3 (NOT yet built; plan-of-record in the r3 doc):** G3a criticals+my-wave-residuals (cache-key, header budget, OverviewTab/Finance/AwaitingApproval false-empty, ProjectBudget line-item resilience, Gantt undated chips, procurement board link-in-button + empty-state, 2 reviewer test-minors); G3b shared `CompanyNameLink`+`ContactNameLink` + `ApprovalRowShell` unification (the owner's chevron + dead-display class); G3c CRM editable/deletable activity + type-independent procurement + cold-start; G3d mobile overflow (PageHeader/BvACard @390) + ROLE_PILL/VERSION_PILL→registry + noun + dead-code delete + guard tests. Then **central gate → final fresh re-audit → PR** (converged when re-audit returns 0 Crit / 0 Imp).
- **Executor model this program:** Claude `Task` subagents + the **`Workflow` tool** for audit fan-out; **build done SEQUENTIALLY on the integration branch** (the Workflow `isolation:'worktree'` forked from inconsistent bases — see LESSONS in the r3 doc). **`/goal` Stop-hook still active** until the loop closes.
- **DEFERRED tail (NOT in fix-wave-3 — owner triage):** Incident items IN-1 reporter field + IN-2 admin delete (**owner-descoped this program**, "remove incident for now"); **AD-2 admin deactivate/offboard user** (needs security-definer RPC + `profiles.status` migration → own signed issue; interim in-context note); SP-1 Sales "Won" kanban column never populates (build `useWonDeals()` or drop); `useCompanyActivities` N+1 (add batch DAL `.in('contact_id', ids)`); cosmetic data minors (`formatCompactCurrency` `$1000.0K`, `formatDocNumber` local-TZ, Gantt reversed-range); Funnel `aria-pressed` a11y; security Lows (server-stamp `logged_by_id=auth.uid()`, `mailto` recipient sanitize).

## ▶ Current state (2026-06-14)
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

## ▶ KNOWN ISSUES

_None blocking._ (Prod migration push **DONE 2026-06-13** — `scripts/db-push-prod.sh` applied 0024+0025+0026+0027
to the Supabase Cloud project; `production` branch promoted to `main`@094406c → Cloudflare prod FE redeployed.
'Budget used', document file upload + the prod storage bucket, and the at-risk `>=` boundary are now LIVE.
The migration-0023 immutability bug behind this was fixed in PR #80; 0023 is byte-identical to its #74 prod content.)

## ▶ ACTIVE PROGRAM — KANNA gap-closing (burst on `dev`, awaiting promote)
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

## ▶ OPEN feature tracks (owner-scope-gated — not started)
- **Commitment-governance (OD-W5-5)** — (a) a server-enforced **PO-commitment approval gate** (distinct
  authority signs off the order commitment vs budget+cashflow before PO): new state-machine state + RPC +
  ADR; (b) a **cash-position/cashflow data domain** (opening balance, in/out-flows, runway — none exists
  today). Spec together.
- **Admin RBAC config engine (OD-PROC-6)** — configurable roles + access; re-enables Engineer-as-manager
  approvals (OD-W2-2, currently FE-off / RPC-dormant). Also the home for per-category document access
  (OD-DOC-4). The B2B-multitenancy bridge.
- **Reports module** — `/reports` is a placeholder; needs owner definition (read-only dashboards/exports).
  Export affordances (Sales, board pack) route here.
- **Design-system normalization (H2/H4)** — full arbitrary-px-spacing sweep + off-scale-font normalization
  (only a scoped subset done in the coherence wave); touches dozens of components → own track with a rendered diff audit.
- **Later spines:** Revenue/AR (progress billing, retention, change orders — spine 4; ties into milestones),
  Resources/Assets (spine 8), Service/O&M (spine 9). See `docs/roadmap-spines.md`.

## ▶ OPEN debt / follow-ups (tracked, none mandate-blocking)

### Deferred-debt ledger from the 2026-06-14 `dev` burst (fold in before promote where noted)
- **Procurement attachments — 2 LOW pgTAP regression assertions** [Low, security-acked on #94]: add (a) an explicit
  `org_id=B` override-insert test (caller in org A supplies `org_id=B` → expect `42501` from WITH CHECK) and (b) an
  anon-read=0 assertion on the three `procurement_*_files` metadata tables. Code is provably safe (stamp-trigger guard
  mirrors 0015 + force-RLS); these only pin the regression. **Migration 0028 is unshipped to prod — fold in before promote.**
- **Projects xlsx Export opt-in** [Low]: the Export button was wired to Companies/Incidents/Procurement/SalesPipeline but
  **deliberately skipped on `pages/Projects.tsx`** (collision-avoidance with the Calendar/Kanban view-mode stream). Add the
  one-line `<ExportButton entity=…>` to the Projects toolbar now that those merged.
- ~~**B-MIN-1 noun consistency**~~ — **RESOLVED by CW-1** (one noun "Project" + one create-verb, coherence wave).
- **Detail-page metric-tile strip clips a tile @390** [Low, pre-existing]: project/procurement detail metric tiles render
  as a horizontal-scroll strip with the right-edge tile cut (no page overflow, no content loss). Pre-existing; surfaced by
  Wave-0 audit, outside its scope.
- **S-Curve actual model = single as-of-today point** (OBS-SC-001 / ADR-0025) [Low, by design]: no per-date actual history
  exists; a future `project_milestones.completed_on` (or progress-history) migration upgrades the actual to a stepped curve
  with **no FE rewrite** (`buildSCurve` already consumes a `{date, cumulativePct}` list).
- **Procurement attachments v1 scope** [Low]: quotation/GR/VI phases only; **PR/PO-header attachments + legacy
  `procurement_quotations.file_url` backfill** deferred (ADR-0023).
- **Kanban status-dot color reuse** [Minor]: Won + Close Out share the green status dot (disambiguated by label) — assign
  distinct DESIGN.md status tokens.
- **Coherence wave minor follow-up** [Low]: two residuals to land in a follow-up PR — sticky action zone + procurement
  header Edit button; "No deals in <stage>" → "No projects" copy leak.
- **Pre-existing TZ flake** [Low, known]: `src/lib/db/procurementLifecycle.test.ts` AC-803 fails under a behind-UTC TZ
  (e.g. UTC-8 local); passes in CI/UTC. Fix: use UTC-fixed date construction in the test.

### Standing debt
- **Signed-URL TTL hardening** [Medium, owner-acked on #78] — client can mint long-TTL download URLs; move
  signing to a server/Edge Function with a hard max TTL. Own issue.
- ~~**Prod migration push**~~ — **DONE 2026-06-13** (0024–0027 applied to prod; `production` promoted; FE redeployed).
- ~~**At-risk classification consolidation**~~ — **DONE (PR #82).** One shared rule in `dashboardConstants`
  (private predicate; `isAtRisk`/`isAtRiskByCommitted` delegate), all surfaces (PMDashboard/Projects/OverviewTab)
  call it; server `projects_at_risk` reconciled `>`→`>=` via new migration 0027 (0009 untouched); dead
  `calculatedPct` prop removed; pgTAP 0069 drift-guard pins the three committed-spend definitions in agreement;
  fixed a latent bug (PMDashboard counted inactive projects as at-risk). `budgetUtilPct` dead export left
  (unrelated pre-existing). Reviewed SHIP; 2214 unit + 459 pgTAP green.
- **Vite 8 upgrade (real esbuild remediation)** [Medium, from PR #80] — esbuild GHSA-gv7w-rqvm-qjhr (build-time
  devDep, not shipped) has no in-range fix; the blocking CI audit was scoped to prod deps (`--omit=dev`, clean)
  with a non-blocking full audit (`.github/workflows/ci.yml`). The actual patch is the Vite 6→8 major (moves to
  patched esbuild); requires the legacy-browser-target check (esbuild 0.28 dropped destructuring downlevel for
  chrome87/safari14). Own track.
- **e2e mutation-spec isolation** [Minor→Medium, recurring] — mutation specs (AC-PROC-001 just flaked in CI with
  a strict-mode duplicate; AC-DEL-022 hit it too; prior AC-1011/AC-816/AC-911) create rows that persist across
  Playwright *retries* on the shared DB → duplicate-element / dirty-precondition failures on retry. Harden with
  dedicated per-spec seed rows / unique-named fixtures (the P011/P013 pattern) so a flaked attempt-1 doesn't
  poison the retry.
- **Document query-key consistency** [Minor] — document React-Query keys are project-only (pre-existing
  across all document hooks); align to the org-scoped key convention in a consistency pass.
- **Per-role sub-dashboards real data (OD-D3)** — Engineer/PM/Finance views still carry some hard-coded
  figures; wire to real per-role queries.
- **Auth prod cutover** — email confirmations + real SMTP; `site_url`/redirect allowlist to HTTPS prod only;
  replace dev seed password; `auto_expose_new_tables=false`. (Cloud is demo/staging-grade today.)
- **JWT role fast-path** — `auth_role()` reads `profiles.role` (authoritative); re-introducing an
  `app_metadata.role` JWT claim needs GoTrue signing + an audited sync trigger.
- **Transition-map drift guard** — `transition_procurement`'s SQL legal-map/role-matrix and
  `procurementLifecycle.ts` (TS, cosmetic) are hand-maintained duplicates; add a sync test before the
  matrix grows.
- **SQL helper extraction** — dashboard on-hand/pipeline status-set literals duplicated across the 3 RPCs in
  `0009_dashboard_margin.sql`; extract a shared helper before the taxonomy changes.
- **e2e seed-coupling** — a few mutation specs (AC-1011/AC-816/AC-911) share seeded entities → can fail in
  some *local* full-suite orderings (CI passes); harden with dedicated per-spec seed rows (the P011 pattern).
- **Shared `<ListState>`** — loading/empty/error markup duplicated across list pages; extract + memoize
  list filters consistently. Minor.
- **Admin user disable/invite** — needs a `profiles` status column + server-side Supabase auth-admin API.
- **Monitoring** (Sentry/uptime) — deferred. Optional CF API token in op vault `AS` for non-interactive CI.
- **Automated a11y gate (charter Gap 4)** [Medium] — WCAG-AA is a charter DoD but enforced only by the
  manual design-review 4-lens battery (review-time). No `axe-core` in CI/e2e, so a11y regressions between
  reviews can slip. Add axe assertions at the e2e/component layer as a regression net. (Charter Gaps 1–3
  closed: coverage gate now CI-enforced via `scripts/changed-lines-coverage.mjs`; Part B synced to
  3-reviewer + twice-design-review; DB-index review assigned to code-quality.)
- **Lens D — Product / Intent (JTBD) codified + first pass run, 2026-06-14** — `docs/jtbd.md` is the
  role × job-story oracle (Lens D grades every FE screen against it); wired into
  `docs/design-workflow.md` §2.3(d), `design-reviewer` agent, `docs/director-playbook.md` intake hook,
  `DESIGN.md` §7, and Part C of `docs/product-expectations.md`. **(b) DONE:** the dual-substrate
  (Opus + gpt-5.4) JTBD walkthrough on `dev` → [`docs/reviews/2026-06-14-jtbd-walkthrough.md`](reviews/2026-06-14-jtbd-walkthrough.md):
  3 anchors re-confirmed (a HOLDS·Critical, b HOLDS, c PARTIALLY-RESOLVED+re-appears-pre-win), **9
  confirmed intent gaps** (1 Crit / 6 Imp / 2 Min) clustering in 2 classes (dead-display, preview-asymmetry).
- **✅ intent-fix wave — DELIVERED** (branch `intent-fix-wave` → PR to `main`, 2026-06-14; plan
  `docs/plans/2026-06-14-intent-fix-wave.md`). Closed **all 9 JTBD gaps + all 3 anchors** (render-verified):
  (1) procurement **preview-in-place** in `/approvals` (the Critical — inline budget preview + Approve/Reject,
  no drill-in); (2) **dead-display sweep** (exec BvA rows + at-risk link, calendar milestone chips,
  S-curve→tabs + overdue lever); (3) **pre-win record layout** (sales levers first, S-curve hidden pre-win);
  (4) company-detail related objects + My-Tasks urgency/log-time; (5) **seed** contacts+activity.
  Gap #8 (incident→project link) deferred — needs a `project_id` FK (schema), tracked below.
  Full battery: spec ✅ · security ✅ (RPC+RLS authority intact) · code-quality ✅ (incl. new
  `procurements_vendor_idx`, **migration 0031**) · rendered Lens-D ✅. **All review Minors fixed (none backlogged)**
  per owner directive. 10 commits, gates green (2721 tests).
- **✅ Wave-0 mobile audit (`review/mobile-audit/`) — RECONCILED + CLOSED, 2026-06-14.** 13/18 findings FIXED
  (render-verified @390), 2 SUPERSEDED by the coherence wave (noun-soup, approvals-duplication), 2 adjudicated
  non-defects (A-MIN-3, B-MIN-2). The 3 that were "outstanding": **A-MIN-1** (Projects no-op view-toggle
  visible @390 — a cw5 regression masked by a class-string-only test) **FIXED** in the intent-fix wave
  (wrapperClassName + test hardened to computed-visibility); **A-MIN-2** (kanban first-scroll affordance)
  **ADDED** (owner ruling); **B-IMP-3** (timesheet approve confirm on mobile) **kept by design** (owner
  ruling — consistent with procurement approvals + SoD gravity; thumb-zone already fixed by S5). Ledger now zero-open.
- **▶ Deferred (small, tracked):** gap #8 — link an incident's `location`/project to `/projects/:id` needs an
  `incident_reports.project_id` FK + migration; do as a tiny schema issue when convenient.

## Run locally
- One-time: `claude plugin install superpowers@claude-plugins-official --scope project`;
  `scripts/vendor-skills.sh` (vendored skills, gitignored); `cd pmo-portal && npm install`;
  `npx playwright install chromium`.
- Backend: `supabase start && supabase db reset` (seeds professional-services data + credentialed users,
  password `Passw0rd!dev`). Put the printed URL/anon key in `pmo-portal/.env.local`.
- App: `cd pmo-portal && npm run dev`. Gates: `npm run typecheck` · `npm run lint:ci` · `npm test` ·
  `npm run build` · `npx playwright test` (stack up, from `pmo-portal/`) · `supabase test db` (pgTAP).
- **Parallel-worktree caution:** one shared local Supabase stack — serialize DB-driving work; `db reset`
  between an e2e run and pgTAP. See `docs/environments.md` "Local stack hygiene".
- **Worktree e2e caution:** worktrees lack `.env.local` (gitignored) — copy it from the main checkout and
  use a fresh port to avoid auth failures.
