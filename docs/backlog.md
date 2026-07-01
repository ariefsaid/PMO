# PMO Portal — live backlog (status + what's next)

**This is the living status doc — read it first.** Shipped-program *history* lives in
[`docs/history.md`](history.md) (don't read it for status). Locked owner-decisions are in
`docs/decisions.md` (OD-* lookup by id). Roadmap framing in `docs/roadmap-spines.md`.

## ▶ Current state (2026-06-21) — PROD CURRENT: procurement case-folder record model + tabbed case-page UI revamp LIVE

> **🎨 PARALLEL TRACK — DESIGN-SYSTEM RESKIN (2026-07-01, language LOCKED, not yet ported).** A full app
> reskin is in flight as **docs/mockups only** on branch **`redesign/design-system`** (pushed; nothing wired
> into the app — no app-code/`dev`/`main`/prod impact). The **monochrome-calm** design language is **LOCKED**
> (owner "lock the language"): **ADR-0037** is authoritative; look source = `docs/design-mockups/redesign/reskin/`
> (+ `reskin/ext/`, folder map in its `README.md`); no-drop gate =
> `docs/plans/2026-06-30-reskin-port-parity-inventory.md`; runbook = `docs/plans/2026-07-01-reskin-port-plan.md`.
> **Next = the reskin-IN-PLACE port via pi+glm-5.2** (Director orchestrates + render-verifies), **branched off
> CURRENT `dev`**, Foundation phase rewrites `DESIGN.md`. Do NOT port "from the mockups" (drops widgets) —
> re-tone existing components; the parity inventory is the gate.

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

## ▶ OPEN feature tracks (owner-scope-gated — not started)
- **Feature entitlements / per-org gating (owner-decided 2026-06-15, BACKLOGGED)** — deactivate features per
  org ("not every company needs Incidents") on the *same axis* that later becomes paid tiers. **Decision of
  record (owner):** build the **entitlement seam + per-org toggles**; **UI-hide now, server-enforce later**
  (defer RLS per feature until it becomes a paywall); **NO billing/Stripe** yet. **First build:** `org_features`
  table (`org_id`,`feature_key`,`enabled`) + a feature registry (`incidents`,`crm`,`procurement`,`timesheets`,
  `import_export`,…; core never-gated = Projects/Dashboard/Approvals/Admin) + `org_has_feature(key)` SQL fn
  (ships now, *unused by gated tables* — the later-enforcement hook); FE `useFeature()`/`<FeatureGate>` mirroring
  `usePermission`/`<CanWrite>` gating **rail item + route (redirect, not just hidden nav) + affordances**; an
  Admin `/administration` "Features" toggle section. **Hold-the-line even in UI-first:** `org_features` itself
  gets real RLS (read-own-org, **admin-only write**); disable = **hide, never destroy** (re-enable restores).
  **Deferred:** `plans`/`plan_features`, billing, and the `AND org_has_feature(...)` RLS on each gated module.
  Orthogonal to RBAC (entitlement = per-*org* feature; RBAC = per-*role* action) — both UX-gate + (eventually)
  RLS-enforce. **Own issue via full loop** (grill → spec → **ADR-00NN** [pre-assign] + plan → TDD → 3 reviewers →
  mockup+design-review for the Admin toggle/gated nav → ship). The ADR must record the UI-first bypass risk
  explicitly. May expand the registry once the owner's broader app feedback lands.
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
