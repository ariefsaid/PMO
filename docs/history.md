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
