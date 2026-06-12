# PMO Portal — live backlog (status + what's next)

**This is the living status doc — read it first.** Shipped-program *history* lives in
[`docs/history.md`](history.md) (don't read it for status). Locked owner-decisions are in
`docs/decisions.md` (OD-* lookup by id). Roadmap framing in `docs/roadmap-spines.md`.

## ▶ Current state (2026-06-12)
- **Deployed LIVE** — Supabase Cloud (prod) + Cloudflare Pages (`https://pmo-bfb.pages.dev`). Full
  infra/secrets/ops runbook + parallel-worktree stack hygiene: **`docs/environments.md`**. Release =
  merge `main → production`. Migrations through **0025**; pgTAP through **0068**; PRs through **#78**.
  (Don't trust hardcoded counts — `supabase migration list` / `ls supabase/migrations` is the real check.)
- **Built & hardened:** Commercial pipeline + win-rate, Budget versioning, Procure-to-Pay (full SoD),
  Timesheets, Companies/Tasks/Incidents/Documents CRUD, Admin users, RBAC (5 roles, RLS-enforced),
  per-role dashboards, mobile, **delivery milestones (spine 3)**, **document file upload (storage)**,
  PostHog analytics. The CRUD/RBAC foundation (ADR-0015–0021) is the pattern all new work follows.
- **Most recently shipped:** Issue #1 of the KANNA series — document file upload (PR #78). See history.md
  for the full program timeline.

## ▶ ACTIVE PROGRAM — KANNA gap-closing series (started 2026-06-12)
Competitor gap analysis vs KANNA/Aldagram: `docs/reviews/2026-06-11-kanna-gap-analysis.md`. Issues run
**in series, one worktree per issue**, under the binding pre-spec gates (grill-with-docs + owner-approved
HTML mockup for UI — playbook §2 1b/1c). Role work dispatched via the **pi CLI** (`docs/pi-delegation.md`).
- **✅ Issue #1 — Storage re-enable + document file upload — DONE & MERGED (PR #78, `main`@5a8314e).**
  Decisions OD-DOC-1..5; migrations 0024 (Superseded enum) + 0025 (bucket + `storage.objects` RLS +
  auto-Superseded RPC). Private org-scoped bucket; Draft-only upload/replace; download (forced attachment,
  all types) + preview; New-revision → auto-Supersede parent (server-side, SoD); 5 MB bumpable knob +
  allowlist + zip/exe denylist. Security audit PASS.
- **▶ Issue #2 (NEXT) — Procurement attachments** (quotation files + GR/VI) reusing the shipped upload
  component (FileCell/useFileUpload/getSignedUrl + bucket). Owner-sequenced BEFORE S-curve/Gantt (daily
  approver pain).
- **Then (gap-doc tiering):** S-curve (delivery-% snapshots; rides milestones) · Gantt (`task_dependencies`
  seeded, unconsumed) · project calendar · import/export · project templates.

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
- **Prod storage bucket** — migration 0025's `storage.buckets` insert + policies land in cloud only on the
  next prod migration push (`db-push-prod.sh`); do before any prod file use.
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
