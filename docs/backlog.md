# PMO Portal — live backlog (status + what's next)

**This is the living status doc — read it first.** Shipped-program *history* lives in
[`docs/history.md`](history.md) (don't read it for status). Locked owner-decisions are in
`docs/decisions.md` (OD-* lookup by id). Roadmap framing in `docs/roadmap-spines.md`.

## ▶ Current state (2026-06-13)
- **Deployed LIVE** — Supabase Cloud (prod) + Cloudflare Pages (`https://pmo-bfb.pages.dev`). Full
  infra/secrets/ops runbook + parallel-worktree stack hygiene: **`docs/environments.md`**. Release =
  merge `main → production`. Migrations through **0026** (local); PRs through **#80**.
  (Don't trust hardcoded counts — `supabase migration list` / `ls supabase/migrations` is the real check.)
- **Built & hardened:** Commercial pipeline + win-rate, Budget versioning, Procure-to-Pay (full SoD),
  Timesheets, Companies/Tasks/Incidents/Documents CRUD, Admin users, RBAC (5 roles, RLS-enforced),
  per-role dashboards, mobile, **delivery milestones (spine 3)**, **delivery UI redesign** (even-bar
  stepper + 'Project delivery %' rollup + 'Budget used' committed-spend column), **document file upload
  (storage)**, PostHog analytics, Solar EPC demo seed (4-phase milestones). The CRUD/RBAC foundation
  (ADR-0015–0021) is the pattern all new work follows.
- **Most recently shipped:** PR #80 delivery migration-chain fix (restored 0023, new 0026 committed-spend
  RPC) + committed-spend budget basis — ran the full 4-agent review loop (security/spec/quality/qa) on the
  pi-trial; e2e gate caught a redesign-locator regression + an ambient esbuild CI-audit breakage, both
  fixed. PR #79 delivery-UI redesign; KANNA Issue #1 document file upload (PR #78). Full timeline: history.md.

## ▶ KNOWN ISSUES (action required before next prod push)

### ⚠ Prod migration push pending — 'Budget used' + doc storage not yet live on prod (HIGH)
Local migrations are ahead of prod. The next `scripts/db-push-prod.sh` must land **0024** (Superseded
enum) + **0025** (doc storage bucket + RLS) + **0026** (delivery RPC v2 with `committed_spend`) together
as one unit. Until pushed, the Projects-list 'Budget used' column and document file upload are **not live
on prod**.

> The migration-0023 immutability bug that caused this (0023 was edited in place in PR #79 *after* it had
> already been pushed to prod in PR #74, and id-based `db push` won't re-apply it) was **fixed in PR #80**:
> 0023 restored byte-identical to its #74 content, the committed-spend RPC moved into new 0026. Verified by
> the full review loop + a clean local `db reset` (0001→0026 apply) + pgTAP 0066. Prod push is now unblocked.

## ▶ ACTIVE PROGRAM — KANNA gap-closing series (started 2026-06-12)
Competitor gap analysis vs KANNA/Aldagram: `docs/reviews/2026-06-11-kanna-gap-analysis.md`. Issues run
**in series, one worktree per issue**, under the binding pre-spec gates (grill-with-docs + owner-approved
HTML mockup for UI — playbook §2 1b/1c). Role work dispatched via the **pi CLI** (`docs/pi-delegation.md`).
- **✅ Issue #1 — Storage re-enable + document file upload — DONE & MERGED (PR #78, `main`@5a8314e).**
  Decisions OD-DOC-1..5; migrations 0024 (Superseded enum) + 0025 (bucket + `storage.objects` RLS +
  auto-Superseded RPC). Private org-scoped bucket; Draft-only upload/replace; download (forced attachment,
  all types) + preview; New-revision → auto-Supersede parent (server-side, SoD); 5 MB bumpable knob +
  allowlist + zip/exe denylist. Security audit PASS.

**⚠ BEFORE starting Issue #2:** run the prod migration push (0024 + 0025 + 0026 as a unit) — the 0023 bug
is fixed (PR #80) and the push is unblocked. That prod push is the gate for any further live demo use.

**Recommended next (owner confirmation needed):** The forward roadmap is `docs/roadmap-spines.md`. Spine 4
(Revenue/AR — progress billing, retention, change orders) is sequenced as the logical next spine after
delivery. Within the KANNA series, candidate gap-closers include S-curve, Gantt/task-dependencies (seeded,
unconsumed), and procurement attachments — owner to confirm sequencing at next intake.

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
- **Signed-URL TTL hardening** [Medium, owner-acked on #78] — client can mint long-TTL download URLs; move
  signing to a server/Edge Function with a hard max TTL. Own issue.
- **Prod migration push (unblocked — ready)** — 0024 (Superseded enum) + 0025 (doc storage bucket + RLS) +
  0026 (delivery RPC v2 with committed_spend) push together as a unit via `scripts/db-push-prod.sh`. The
  0023 fix landed (PR #80). See KNOWN ISSUES. Do before any prod file/delivery-% use. **This is the next action.**
- **At-risk classification consolidation** [Important, from PR #80 quality review] — committed-spend is now
  computed three ways (0009 `spent` view / 0026 RPC `committed_spend` / client `getProjectCommittedSpend`
  reduce) and at-risk is classified inconsistently: PMDashboard on `project.spent/budget` (`>0.9`, via
  `dashboardConstants.isAtRisk`) vs Projects-list + OverviewTab on `committedSpend/budget` (`>=0.9`, inlined).
  Same *value* (spent IS the committed basis per OD-BUDGET-2) but a real `>`-vs-`>=` boundary mismatch at
  exactly 90%. Fix: one shared committed-basis helper in `dashboardConstants`; decide if PMDashboard moves to
  the committed basis. Also remove the now-dead `calculatedPct` prop on `MilestonePhaseHeader`.
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
