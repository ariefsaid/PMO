# PMO Portal — live backlog (status + what's next)

**This is the living status doc — read it first.** Shipped-program *history* lives in
[`docs/history.md`](history.md) (don't read it for status). Locked owner-decisions are in
`docs/decisions.md` (OD-* lookup by id). Roadmap framing in `docs/roadmap-spines.md`.

## ▶ Current state (2026-06-14)
- **⚑ `dev` branch — unreviewed autonomous burst awaiting owner review (2026-06-14).** A parallel Director-run burst (Claude `Task` subagents + the `Workflow` tool, owner serialized, exploiting the Claude weekly-quota window) shipped to **`dev`** (NOT main/prod): **Wave 0** — 8 mobile/UX streams @390 (exec dashboard glanceable · shell touch-targets+404/h1 · DataTable card-clip · scrollable status filter + Table-toggle hidden on mobile · bottom-sheet confirm · procurement-detail mobile actions/back/SoD · one-handed day-stacked timesheet · project-detail back-affordance). **KANNA Wave 1** — Bulk **Export** (xlsx, #92) · Project **Calendar** read-only (#93) · **Procurement attachments** per-phase child tables+RLS+storage (#94). **KANNA Wave 2** — **S-Curve** planned-vs-actual (#95) · Projects **Kanban** by status (#96) · mobile view-toggle/S-curve drift fix (#97). Each ran TDD + the **3-reviewer battery** (spec+quality+security) + **design-review round 2 @390**; CI green; merged to `dev` (PRs **#84–#97**; new migrations **0028** procurement-files, **0029** calendar-milestone RPC). **Prod is UNCHANGED at 0027/#83.** Owner: review `dev` → promote `dev → main` when satisfied. **Deferred-debt ledger from this burst is in OPEN debt below.** The verification floor caught real defects again (a prod-breaking missing `org_id` stamp-trigger on 0028 that 3 reviewers passed; an export shipped sub-spec with its xlsx serialization fully mocked; full-suite-red-but-subset-green twice).
- **Deployed LIVE** — Supabase Cloud (prod) + Cloudflare Pages (`https://pmo-bfb.pages.dev`). Full
  infra/secrets/ops runbook + parallel-worktree stack hygiene: **`docs/environments.md`**. Release =
  merge `main → production`. **Prod is current** — Cloud at migration **0027**, `production` promoted (2026-06-13). PRs through **#83**.
  (Don't trust hardcoded counts — `supabase migration list` / `ls supabase/migrations` is the real check.)
- **Built & hardened:** Commercial pipeline + win-rate, Budget versioning, Procure-to-Pay (full SoD),
  Timesheets, Companies/Tasks/Incidents/Documents CRUD, Admin users, RBAC (5 roles, RLS-enforced),
  per-role dashboards, mobile, **delivery milestones (spine 3)**, **delivery UI redesign** (even-bar
  stepper + 'Project delivery %' rollup + 'Budget used' committed-spend column), **document file upload
  (storage)**, PostHog analytics, Solar EPC demo seed (4-phase milestones). The CRUD/RBAC foundation
  (ADR-0015–0021) is the pattern all new work follows.
- **Most recently shipped:** PR #82 at-risk consolidation (one shared rule + migration 0027 + drift-guard).
  PR #80 delivery migration-chain fix (restored 0023, new 0026 committed-spend
  RPC) + committed-spend budget basis — ran the full 4-agent review loop (security/spec/quality/qa) on the
  pi-trial; e2e gate caught a redesign-locator regression + an ambient esbuild CI-audit breakage, both
  fixed. PR #79 delivery-UI redesign; KANNA Issue #1 document file upload (PR #78). Full timeline: history.md.

## ▶ KNOWN ISSUES

_None blocking._ (Prod migration push **DONE 2026-06-13** — `scripts/db-push-prod.sh` applied 0024+0025+0026+0027
to the Supabase Cloud project; `production` branch promoted to `main`@094406c → Cloudflare prod FE redeployed.
'Budget used', document file upload + the prod storage bucket, and the at-risk `>=` boundary are now LIVE.
The migration-0023 immutability bug behind this was fixed in PR #80; 0023 is byte-identical to its #74 prod content.)

## ▶ ACTIVE PROGRAM — KANNA gap-closing series (started 2026-06-12)
**Execution plan + wave sequencing: [`docs/kanna-program.md`](kanna-program.md)** — read it before any fan-out.
Gap analysis (what's missing): `docs/reviews/2026-06-11-kanna-gap-analysis.md`. Model: **parallel waves of ≤3–4
independent issues** (worktree + PR each; CI verifies in parallel on the public repo), with all owner-interactive
gates (grill-with-docs + owner-approved mockup) **front-loaded & serialized through the Director** per wave.
Role work via the **pi CLI** (`docs/pi-delegation.md`) or Task subagents.
- **✅ Issue #1 — document file upload — DONE & MERGED (PR #78).** Decisions OD-DOC-1..5; migrations 0024+0025;
  private org-scoped bucket; Draft-only upload/replace; download + preview; New-revision auto-Supersede (SoD);
  5 MB bumpable + allowlist. Security PASS. **Live on prod** (pushed 2026-06-13).
- **✅ Wave 1 — BUILT ON `dev` (review-pending, 2026-06-14):** Bulk **Export** (xlsx, #92) · Project **Calendar**
  read-only (#93) · **Procurement attachments** per-phase child tables/RLS/storage (#94). **Bulk Import** wizard was
  split out → a later wave (owner steer: visual-first for demo). Grill + mockup were skipped (owner directive for the
  burst); Director locked the `[OWNER-DECISION]`s. All 3 reviewed + design-reviewed; on `dev`.
- **✅ Wave 2 — BUILT ON `dev` (review-pending, 2026-06-14):** **S-Curve** planned-vs-actual (#95) · Projects
  **Kanban** by status (#96) · mobile view-toggle drift fix (#97, also makes Calendar reachable on mobile). Demo-visual
  priority per owner.
- **▶ Wave 3 (next, NOT started):** candidates per kanna-program.md §3 — Gantt · CRM contacts+activity · sub-projects ·
  **Bulk Import** wizard. **Default SOP reverts to series + pi** once the Claude weekly-quota window closes (the parallel
  burst was the transient mode, [[kanna-parallel-model]]).

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
  (only a scoped subset done in Wave 6); touches dozens of components → own track with a rendered diff audit.
- **Later spines:** Revenue/AR (progress billing, retention, change orders — spine 4; ties into milestones),
  Resources/Assets (spine 8), Service/O&M (spine 9). See `docs/roadmap-spines.md`.

## ▶ OPEN debt / follow-ups (tracked, none mandate-blocking)

### Deferred-debt ledger from the 2026-06-14 `dev` burst (review-pending; fold in before promote where noted)
- **Procurement attachments — 2 LOW pgTAP regression assertions** [Low, security-acked on #94]: add (a) an explicit
  `org_id=B` override-insert test (caller in org A supplies `org_id=B` → expect `42501` from WITH CHECK) and (b) an
  anon-read=0 assertion on the three `procurement_*_files` metadata tables. Code is provably safe (stamp-trigger guard
  mirrors 0015 + force-RLS); these only pin the regression. **Migration 0028 is unshipped to prod — fold in before promote.**
- **Projects xlsx Export opt-in** [Low]: the Export button was wired to Companies/Incidents/Procurement/SalesPipeline but
  **deliberately skipped on `pages/Projects.tsx`** (collision-avoidance with the Calendar/Kanban view-mode stream). Add the
  one-line `<ExportButton entity=…>` to the Projects toolbar now that those merged.
- **B-MIN-1 noun consistency** [Low, owner copy call]: Projects / "New deal" / "Opportunity name" / "Create deal" mix nouns
  in one create flow. Pulled out of the Wave-0 mobile sweep as a product-copy decision (pipeline *opportunity* vs delivery
  *project* may be intentional) — **owner to decide the canonical copy.**
- **Detail-page metric-tile strip clips a tile @390** [Low, pre-existing]: project/procurement detail metric tiles render
  as a horizontal-scroll strip with the right-edge tile cut (no page overflow, no content loss). Pre-existing; surfaced by
  the Wave-0 audit, outside its scope.
- **S-Curve actual model = single as-of-today point** (OBS-SC-001 / ADR-0025) [Low, by design]: no per-date actual history
  exists; a future `project_milestones.completed_on` (or progress-history) migration upgrades the actual to a stepped curve
  with **no FE rewrite** (`buildSCurve` already consumes a `{date, cumulativePct}` list).
- **Procurement attachments v1 scope** [Low]: quotation/GR/VI phases only; **PR/PO-header attachments + legacy
  `procurement_quotations.file_url` backfill** deferred (ADR-0023).
- **Kanban status-dot color reuse** [Minor]: Won + Close Out share the green status dot (disambiguated by label) — assign
  distinct DESIGN.md status tokens.
- **Calendar/Kanban e2e depth** [Minor]: the toggle→render→click journeys are covered (AC-CAL/AC-PK e2e); confirm the new
  mobile-toggle path (#97) is exercised once when convenient.

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
  manual design-review 3-lens battery (review-time). No `axe-core` in CI/e2e, so a11y regressions between
  reviews can slip. Add axe assertions at the e2e/component layer as a regression net. (Charter Gaps 1–3
  closed: coverage gate now CI-enforced via `scripts/changed-lines-coverage.mjs`; Part B synced to
  3-reviewer + twice-design-review; DB-index review assigned to code-quality.)

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
