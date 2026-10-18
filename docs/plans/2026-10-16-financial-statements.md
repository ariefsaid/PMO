# Financial statements — v0.23 native display implementation plan (#897)

**Amendment:** owner 2026-10-18, OD-FS-023; amended financial-statements.spec.md. The prior2026-10-16
mirrored-GL report port is parked, not the current release plan. DEV ONLY; no production action.

**Goal:** PMO displays saved actual ERPNext standard current/prior statements and native-project
P&L, with complete atomic publication and approved role-scoped UI.
**Architecture:** Existing transport/metadata → native report adapter → bounded resumable collection
on existing org sweep/lease → one complete snapshot publisher → invoker reads/DAL/repository/UI.
ERPNext owns every financial calculation; PMO normalizes structure/lexical numeric representation.
**Tech:** existing TypeScript/Deno/React/Supabase/pgTAP/Vitest/Playwright; no new numeric/ERP framework.

## Fixed decisions and preserved work

- Standard query_report.run outputs, ERPNext 16.33 / Frappe 16.31 captured profile, no custom template/native
  helper/controller or independent GL source arithmetic. Exact Company/calendar/map from metadata.
- Company TB/PL/BS plus explicitly mapped-project PL. No unassigned/remainder scope in v0.23.
  Preserve company-native totals and project-native report_summary values; don't calculate a tie.
- Detail payload is separate native current/prior sides, preserving sparse/translated/special rows
  and financial tokens. No cross-side translated-label identity guesses or invented absent zeros.
  raw_reports stores exactly two original UTF8 strings on detail rows, NULL on project totals.
- Use current org TTL-row holder, not old advisory/session-driver instructions. SourceGeneration is
  native acquisition batch UUID; statement success no longer requires GL replay/chart generation.
  Existing mirror/replay/Actuals/aging safety and independent tests remain their own contract.
- Native collection is ONE pass over all supported captured pairs/scopes, resumable across ticks.
  N native responses=`2*(3+M)*K`; snapshot rows=`(3+2M)*K` (project PL supplies detail+totals).
  K=48/M=25 means2,688 native calls, so do not pretend this is one tick. No second pass/5,376 calls.
  Segment size follows actual deadline and measured native request cost; never raise timeouts or
  silently narrow the owner's period catalogue. Previous complete generation remains served.
- Final binding/Company/version/calendar/map recheck; changed context discards only pending owned
  batch and retries under the new context. Ordinary financial changes across calls are captured
  window, not an error requiring global-ERP snapshot/reconciliation/GL scan. Per-response acquiredAt
  plus generation startedAt/completedAt are retained. No fabricated ERP revision token.
- Reuse accepted schema/publisher/read/parser/metadata and approved renderer/picker/permissions
  after their final checkpoints. Any computed-payload/source assumptions change deliberately,
  with old/new contract evidence; never silently loosen an old assertion to get green.
- Preserve all parked calculator branches/tests/briefs/fixtures; do not merge them as v0.23 runtime
  dependencies or delete their work. No .github/workflows/ci.yml edits; CI work is another lane.

## Code slices and useful parallel work

Root uses linked code issues for each bounded dispatch, uses clean managed worktrees off actual
fresh dev/integration checkpoints, and records exact immutable heads. No branch is created by this
planning turn. One PR per coherent issue; each targets dev. Docs apply directly to dev separately.

### Slice 1 — Native fetch/normalization contract (can launch immediately)

**Own:** `pmo-portal/src/lib/adapterSeam/erpnext/client.ts`, `client.test.ts`,
`statementReports.ts`, `statementReports.test.ts`; the adapter owns the NativeReportColumn/fetch/parser/pair contracts. No calculator/scheduler/storage edits.

- [ ] RED real transport tests for GET query_report.run, ignore_prepared_report=1 as a METHOD argument
  (not a filter), exact current/prior filters, Company/project
  mapping, raw numeric token survival, complete bounded response and native nested versions.
- [ ] Implement actual per-side native columns/ordered rows/lexical cells and raw UTF8 pair. Accept
  irrelevant extras; fail missing/wrong consumed financial fields, malformed/error/prepared/truncated
  response, wrong currency/range/role/source profile. Special/footer/separator shapes remain native.
- [ ] Extract project Income/Expense/Net directly from source-bound native report_summary slots;
  no labels-as-identity, chart/account totals, net subtraction or missing financial default0.
- [ ] Owning AC001 unit tests use hash-bound sanitized actual outputs; mutate a required native
  value/row/column/summary or reuse current for prior and require failure. No calculator goldens,
  seven-case / ACB / full-source bracket gate or native operation by the builder.
- [ ] Green targeted adapter/client tests, typecheck/lint/Deno check and changed-import tests.

### Slice 2 — Resume native sweep and publish/read complete native generations

**Own:** existing `supabase/functions/erpnext-sweep/index.ts` plus its real-handler
`statementPublication.test.ts`/source lifecycle tests; new `pmo-portal/src/lib/adapterSeam/erpnext/statementReportRefresh.ts`/`.test.ts`; checkpointed snapshot publisher,
read SQL/DAL/repository/domain files from B3; one newly allocated reversible display migration and
its targeted pgTAP. Root first resolves active publisher/read ownership and actual migration slots.

- [ ] RED AC005 handler test: collect a bounded prefix, release lease, next tick reacquires and
  resumes the same frozen request plan; pending data never leaks; final response permits publish.
- [ ] Persist minimum machine-only pending native response rows and one small org binding batch
  descriptor (id,context,cursor/window). No general job/queue/epoch/witness system or raw binding
  blob. Existing lease protects each segment; per-write and final publish recheck holder/batch/binding.
- [ ] Collect deterministic complete Company/project/report/period/current-prior request keys.
  Stage actual response, raw UTF8/acquiredAt and lossless normalized native pair; no financial
  reprocessing. A report read repeated after a crash is safe; no ERP writes are introduced.
- [ ] At segment boundary/final publish recheck actual binding/Company/version/calendar/map;
  drift invalidates pending batch only. Missing/error/deadline keeps old complete rows/time and
  delayed. Remove only obsolete calculator-specific chart/replay completion preconditions from
  NEW statement publication; retain legacy feed/replay finish/stale_binding rules unchanged.
- [ ] Adapt0317 publisher's complete expected key set to `(3+2M)*K`, native pair payload/raw linkage
  and acquisition batch identity/window; keep atomic delete/insert/status, older/stale/expired-holder
  rejection, project/tenant validation and transactional failure rollback. No unassigned placeholder.
- [ ] Add restricted detail-only raw_reports and native-pair payload validation; totals whitelist
  unchanged. SQL/view/read projection exposes safe capture window, not raw bodies to project staff.
  Preserve old/calculator payload artifacts; do not publish them as native output. No destructive
  migration/reset of completed local Finance fixture. Reversible downgrade guards raw-data loss.
- [ ] Adapt exact native read envelopes/DAL parser and one-race retry; keep authorization-before-
  absence, actual projects RLS, real roles, both columns, currency/period/run identity and neutral
  errors. No full stored-row response or raw detail in totals. Generated types and denominator match.
- [ ] Canonical AC003/004/006 pgTAP plus two-session atomicity; AC005 real index.ts test with mocked
  global fetch; mutations break holder/scope/complete-set/raw restriction and must RED. Scope-only
  reset-free migration-up+test+down/reapply under ONE DB lock; run appropriate legacy regressions.

### Slice 3 — Approved display UI + real Finance journey / acceptance

**Own:** existing financial-statement domain/read consumer adaptation, hooks, approved shared
components/picker/StatementTable/FinancialStatementsSection, company page/project Overview,
policy/nav/locales, existing presentation/scope/permission tests; private rehearsal runner/journey.
Reuse completed component checkpoints; no redesign or B2 import. Component adaptation can run
parallel with Slice 2 against Slice 1's fixed native DTO; final integration depends on Slice 2.

- [ ] RED AC007/008/009: independent native current/prior side rows, sparse footers/profit rows,
  native summary totals, absent rows kept absent, both locales/roles/cache scopes and honest states.
- [ ] Preserve native value through grouping/presentation; no financial calculation in React or
  re-rounding stored money. Native formatting/presentation metadata is separate from value source;
  no unproved Python/browser mode equivalence is claimed. Never display raw JSON/ERP ids/HTML.
- [ ] Finance defaults Company, can choose explicit mapped project P&L. Project Overview shows
  its project's three native totals only. Remove unassigned selection rather than invent remainder.
- [ ] Render Discover on rich sanitized native-shaped data, graduate actual findings, keep existing
  approved layout/tokens/accessibility. Touched curated presentation journey remains supporting UI
  proof, not live acceptance or a reason to run the full local suite.
- [ ] AC002 real ordinary Finance path: standard read-only ERP API outputs → normal sweep stored
  generation → authorized repository → UI. Compare actual saved/current-prior values and capture
  window, not local GL sums. Operator may prepare data separately; runner never posts/closes.
  Synthetic local proof is useful now but does not close RIS-specific acceptance.

## AC ownership / tests / gates

AC001 adapter unit; AC005 real sweep handler/unit; AC003/004/006 pgTAP+existing race;
AC007 scope RTL; AC008 section/table RTL; AC009 real-role/cache RTL; AC002 one curated serial
Finance rehearsal. Exact actual filenames/checkpoints come from Root's accepted owning briefs,
not a second copy of tests. Keep AC-id titles and one lowest sufficient owning layer per criterion.

Every code slice: targeted RED→GREEN, ≥80% meaningful changed-module coverage, zero type/lint,
locked changed-import Vitest and touched tests; CI verify+pgtap decides dev merge. Edge tests import
real index.ts/global fetch; no copied handler validators. No weakening/skips/timeout inflation.
New SQL under one DB hold with normal migration up, targeted pgTAP/catalogue/grants/rollback;
NO reset/reseed of completed local fixture. Use test/ERP/DB locks in existing order, max2heavy lanes
per Director using the shared test-lock wrappers with at most two heavy local jobs. No new runtime dependency.

Measure actual native report latency/response sizes and bounded-segment completion in current
served Deno path; use those observations to set per-tick work against existing deadline. Report
estimated ticks from N and measured segment throughput, not an invented shipping/runtime ETA.
No old130k calculator benchmark, full seven context matrix or GL/ACB equivalence prerequisite.

## Concrete exit and parked constraints

Root can launch Slice 1 after applying amended docs; Slice 2 begins after checkpointing active publisher/
read work and schema allocation; UI adaptation can overlap. Completion is all amended ACs with
actual evidence, not “we copy so parity is automatic”. Transport/normalization/storage/projection/
formatting can still alter values, roles can leak scope and a batch can drift/expire/partially fail.

RIS-equivalent rehearsal nomination/provisioning remains a real fact; don't promote sample success
into AC002. Existing secure source/served-route/Finance setup planning remains available. No new
production permission is inferred. Preserve public evidence as code/version/AC/counts only.
