# Plan — Odoo master data, remainder (#1504 S8, S9, S10), re-baselined 2026-11-07

- **Supersedes** the S8/S9/S10 sections of `docs/plans/2026-10-31-odoo-connect-master-data.md` (the signed plan, ~1300 commits stale). Its S0–S7 stay as written; this file is the only source for what is left. Slice numbers are the signed plan's.
- **Spec:** `docs/specs/odoo-connect-master-data.spec.md` (ACs `AC-ODC-*`); shared send/scenario ACs `AC-ECA-010..012`, `050`, `051` in `docs/specs/erp-connect-anytime.spec.md`.
- **Baseline checked at `origin/dev` `d1947f807` (2026-11-07).** `(new)` = does not exist yet. Names cited with `file:line` were read at that SHA.
- **Out of scope here:** O2–O8 documents (P2P and revenue are already on dev), employee sends (`employee.send` stays pending #1510).
- **Public repo:** fixtures and runbook use invented names (`PT Sinar Baja`, `odoo.example.test`); no client names, hosts, keys.

---

## 0. Decisions and open questions (default taken; Director overrides)

| # | Question | Default taken |
|---|---|---|
| **Q1** | S9 webhook nudge: keep or drop? | **Drop.** Why: the 5-minute sweep (`cron.schedule('odoo-sweep-tick','*/5 * * * *')`, `0421_odoo_master_records.sql:169`) already bounds master-data staleness at ~5 min plus a Finance "Refresh now" (`odoo/sweepVerbs.ts`); the spec itself says master data is not latency-critical and that the webhook "cannot be required for any AC" (OQ-ODC-3). A webhook adds a public endpoint, a per-org secret in Vault, a dedupe table and a manual Odoo-side Automation Rule per client. Nothing breaks without it. AC-ODC-027 is recorded as *not built (dropped)*; the work is parked in §S9 for revival (migration slot `0740` reserved). |
| **Q2** | Extract ERPNext's send drain into a tier-neutral core, or copy it for Odoo? | **Extract** `_shared/connectSendsCore.ts` (the claim/record/hold/reject loop, `pmoMasterOf`, `actorIsAdmin`, rejection copy) and keep `erpnext-sweep/connectSends.ts` as a thin wrapper. Its existing `connectSends.test.ts` must pass **unchanged** (that is the proof the extraction is behaviour-preserving). Copying would fork money-adjacent logic (the signed plan's "never two copies"). |
| **Q3** | Reissue after an inconclusive probe (Odoo)? | **Never, for every kind** (`reissueOnInconclusiveAbsence: false`). ERPNext reissues items/projects because it refuses duplicate names/codes (`connectSends.ts:117-119`); Odoo has no unique constraint on `default_code` or analytic `code`, so a miss cannot prove the create never landed (ADR-0058 C-1, PD-8). The row ends *held* for a person. |
| **Q4** | Post-employ companies commit (FR-ODC-055) and its UI form verdict. | **Backend + error copy only in S8** (adapter wired in dispatch, employ verb, `pushErrorCopy`). The company form already shows dispatch errors through `pushErrorCopy.ts`; no new form UI. |
| **Q5** | Odoo e2e in CI? | **No.** `.github/workflows/ci.yml` has no Odoo bed (grep `odoo` = 0 hits) and the shipped Odoo specs (`e2e/AC-OCI-100-…`, `e2e/AC-OPP-090-…`) are bed-gated with `scripts/check-e2e-skips.mjs` entries. S10 follows that pattern: run locally on the bed, allowlisted in CI. Putting a bed in CI is a separate issue (file it at S10 close). |
| **Q6** | Where do S10 specs live? | `pmo-portal/e2e/` (like the shipped Odoo specs), not `e2e/serial/`, **except** the S-C spec (needs an empty bed, resets it) which is `e2e/serial/`. Each carries an `@e2e-isolation` header per `docs/e2e-parallel-conventions.md`. |

---

## 1. What already exists on dev (reuse; never re-invent)

| Need | Exists | Where |
|---|---|---|
| Shared send wrapper | `sendMasterOnce`, `masterSendAdapter`, `sendKey` = `seed:<kind>:<id>`, `SEND_DOMAIN` | `pmo-portal/src/lib/adapterSeam/connect/sendViaOutbox.ts:15,33` |
| Shared send contract suite | `partySendSuite` + `sendAllCases` (AC-ECA-010/012), registered under `party.send` | `contractSuite/sendAll.suite.ts:30`, `contractSuite/index.ts:30` |
| Odoo `sendMaster` (lookup-then-create for party/project/item) | done; party anchor `ref = pmo:<id>`, project by `code` + plan domain, item by `default_code`; two hits → `commit-rejected 'ambiguous'`; unmapped unit → `'unit-unmapped'` | `pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts:95-125` |
| Odoo setup adapter for the shared census/run (employee and plan-less project "unserved") | done | `odoo/connectAdapter.ts:131`, built by `_shared/connectAdapterForOrg.ts:23-27` |
| Odoo workflow declarations | `party.send`, `project.send`, `item.send` = supported; `project.match`, `item.match`, `account.match` = pending (S7/ECA suites) | `odoo/workflowDeclarations.ts:28-40` |
| Odoo `Adapter` for `companies` (create/update/list) | done, **unused in `supabase/`** (only its own test imports it) | `odoo/adapter.ts:32` (`createOdooAdapter`) |
| ERPNext drain to copy the shape from | `drainConnectSends` (claim → build master from PMO row → actor still Admin → probe → `sendMasterOnce` → record result/hold/reject) | `supabase/functions/erpnext-sweep/connectSends.ts:71-165`, called at `erpnext-sweep/index.ts:833` |
| Tier-parametric send SQL | `claim_connect_sends(org, tier, limit)`, `connect_send_existing_link`, `record_connect_send_result`, `record_connect_send_held`, `record_connect_send_failure`, `record_connect_record_held`, `enqueue_new_item_sends(org, tier)`; link writer `apply_connect_link` → `connect_link_project` for projects | `0494_erp_connect_sends.sql:10,27,137`, `0499_erp_new_item_sends.sql:8`, `0706_party_link_internal_exclusion.sql:38-40` |
| Shared setup verbs incl. `accept-proposals` / `retry-send` / `census` for every tier | done (run before the Odoo router) | `external-set-company/connect.ts:14`, `index.ts:250` |
| Odoo router verbs | `list-companies, activate, recheck, refresh, reset-kind, list-projects, link-project, unlink-project, set-analytic-plan, employ-domain, propose-config, save-defaults` — **`employ-domain` accepts `procurement` only** | `external-set-company/odoo/router.ts:30-40`, `odoo/purchasing.ts:11` |
| Odoo sweep tick + the seam for post-pass steps | `AFTER_SWEEP` array holds only `advanceSetupRun`; budget object has `spend/left/canSpend/refund` | `_shared/odooSweep.ts:39-46,128-141` |
| Odoo outbox recovery (procurement and revenue only) | reads outbox rows, replays by domain | `_shared/odooOutboxRecovery.ts:16` |
| adapter-dispatch Odoo registry | `{ procurement, revenue }` only — **no `companies`** | `adapter-dispatch/odooAdapters.ts:135` (registry), `dispatchAdapters.ts:152,163` (lookup by tier) |
| adapter-dispatch Odoo outbox deps | `resolveOdooMoneyOutboxDeps` branches `revenue` first, then purchase kinds; a `companies` command would throw "kind not wired" | `adapter-dispatch/odooMoneyOutbox.ts:172-176`, registered `index.ts:96-99` |
| Money tier routing | `MONEY_TIERS` includes `odoo` → every non-read command goes through `dispatchMoneyWrite` | `adapterSeam/dispatch.ts:766` |
| Mirror guard for `companies` under tier `odoo` (AC-ODC-033) and adoption | shipped (S6) | `supabase/tests/odoo_party_adoption.test.sql` |
| pgTAP for sends (ERPNext tier only today) | `erp_connect_sends.test.sql` has **no `odoo` rows** | `supabase/tests/erp_connect_sends.test.sql` (395 lines) |
| Bed tooling | `scripts/odoo-dev-bed.sh up|down|reset|status`, `scripts/with-odoo-lock.sh`, `scripts/odoo-probe.mjs`; synthetic fixtures | `scripts/odoo-dev-bed.sh:73-93` |
| Bed-gated e2e pattern | `ODOO_BED_URL/DB/KEY` + served-functions env; partial config throws, none = `test.skip` | `pmo-portal/e2e/AC-OCI-100-odoo-client-invoice-to-receipt.spec.ts:14-36`, allowlist `scripts/check-e2e-skips.mjs:43,88` |
| ERPNext scenario journeys to mirror | **not yet on dev** (ECA-8 #1607 open): `AC-ECA-050/051` do not exist | `docs/plans/2026-11-01-erp-connect-anytime.md` §13 |
| Runbooks | `docs/runbooks/odoo-client-revenue.md` only; no client setup runbook | `docs/runbooks/` |

**Gaps = the work:** (a) no Odoo send probe; (b) no Odoo drain, so accepted *send* proposals under tier `odoo` sit in `sending` forever; (c) no `companies` adapter or outbox deps in dispatch; (d) `employ-domain` refuses `companies`; (e) no `send-project` verb; (f) Odoo codes missing in `pushErrorCopy`; (g) no Odoo rows in the send pgTAP; (h) S10 specs and runbook.

---

## 2. Order, dependencies, executors

**S7 dependency.** S7 is `origin/feat/odoo-s7-map-once-v2` (migration `0708_odoo_map_once.sql`, new `odoo/config.ts`, `configProposal.ts`, `resolvers.ts`, map-once UI, `ProjectOdooLink.tsx`, edits to `router.ts`, `purchasing.ts`, `projectLinks.ts`, `odooSweep.ts` +10 lines, `useOdoo.ts`, `locales`). I read it (`git diff origin/dev...origin/feat/odoo-s7-map-once-v2`); it is not edited here.

| Slice | Needs S7? | Branch from |
|---|---|---|
| **S8-A** probe, core extract, Odoo drain, AFTER_SWEEP step, pgTAP, pushErrorCopy (T1–T6) | **No.** Touches `odooSweep.ts` (S7 edits the same file: a one-line append to `AFTER_SWEEP` and an import; merge conflict is trivial), `connectAdapter.ts`, `_shared/`, tests. S7's link reconcile is independent. | **`origin/dev` now** |
| **S8-B** companies commit after employ (T7–T9) | No. Edits `purchasing.ts`/`router.ts`, which **S7 also edits** (`router.ts +5`, `purchasing.ts +6`). | `origin/dev` now; rebase onto S7 after it merges, or branch from S7-v2 if it merges first. **Rule: start on dev; the second of the two to merge resolves the router/purchasing conflict.** |
| **S8-C** `send-project` verb + bed test (T10–T11) | **Yes, soft.** Links through `link_odoo_cost_account` and the plan/account mirror; the S7 map-once screen chooses the plan. Works without S7 only if `analytic_plan_id` is set via the shipped `set-analytic-plan`. | **After S7 merges** (branch from `origin/dev` then). Do not branch from the S7-v2 branch: it is an unmerged feature branch and would drag its commits into a money-path PR. |
| **S9** | n/a | dropped (Q1) |
| **S10** | **Yes** — journeys use map-once + the employ step + the project cost-account link. | After S8 + S7 are on dev |

**Executor and shipping.** S8 writes the money outbox (service-role writers, an adapter commit) → **Director-dispatched through an Orca worker (opus-grade), ships alone** (CLAUDE.md batching rule: money/SoD/auth ships alone), with a mandatory **security-auditor** review (service-role path, tenancy on every claim/record RPC, actor re-check, no payload echo). Split S8 into **three branches, each its own PR to dev** (A, B, C above) only if the Director wants smaller reviews; default is **one branch `feat/odoo-s8-sends`** carrying A+B and a second `feat/odoo-s8-send-project` for C after S7. S10 is an Orca worker (qa-acceptance role), batchable with nothing money-related. Full migration/pgTAP/Deno gate per the local final gate in `CLAUDE.md`; CI is the proof.

**Migrations.** Allowed range **0740–0759** (dev head `0720`; S7 holds `0708`; `git ls-remote --heads origin` showed no branch using 0740–0759 on 2026-11-07 — **re-check at build**). **S8 plans no migration:** every send RPC is already tier-parametric (§1). Reserved: `0740_odoo_webhook.sql` + `rollback/0740_odoo_webhook_down.sql` only if Q1 is reversed. If S8-T6's pgTAP exposes a SQL gap (a claim, link or employ rule that does not accept tier `odoo`), the fix is `0741_odoo_sends_gap.sql` with `rollback/0741_odoo_sends_gap_down.sql`, `create or replace` only, and must update the isolation denominator manifest and run `node scripts/check-isolation-denominator.mjs` (live + `--self-test`).

---

## 3. S8 — Send PMO masters to Odoo; companies command after employ (ships alone; security review)

ACs owned: AC-ODC-034 (B), AC-ODC-052 (B; logic U), AC-ECA-010/011/012 for Odoo (S, already in the shared suite — S8 proves the *served* half). Bed claims: V12 (looked-up-before-create shapes), V-CREATE (`res.partner` / `account.analytic.account` / `product.product` create bodies).

Verify commands used below (per the binding gate, never the full suite):
- `V` = `cd pmo-portal && npx vitest run <files>` (under `scripts/with-test-lock.sh`)
- `D` = `cd supabase/functions/<fn> && deno test --allow-env --allow-net --allow-read <files>` (see `scripts/deno-test-edge-fns.sh`)
- `P` = `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'` (reset only if a migration changed; grep output for `Parse errors`)
- Guards: `cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <touched>`

### S8-T1 — `odooSendProbe` (U) — failing test first
File: `pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.test.ts` (append). Red cases, with `fakeOdoo.ts`:
- party: a partner with `ref='pmo:p1'` → probe returns `{ externalRecordId: 'Vendor:<id>' }` (or `Client:`) for the role; none → `null`; two partners with that `ref` → throws `AdapterError('commit-rejected','ambiguous')`.
- project: account of the plan with `code = PRJ-1` in the company → id; none → `null`; two → `ambiguous`.
- item: `default_code` hit → id; none → `null`.
- `sendMaster` after the refactor still produces the same bodies (existing tests stay green).
Green: in `odoo/connectAdapter.ts` extract the `one(...)` lookups inside `sendMaster` (`:95-125`) into `findSent(call, ctx, kind, record)`; `sendMaster` = `findSent ?? create`; export `odooSendProbe(call, ctx, kind, record): Promise<{ externalRecordId: string } | null>` (same return shape as `erpnextSendProbe`, `erpnext/connectAdapter.ts:59`).
Verify: `V connectAdapter.test.ts` red → green; mutation: make `findSent` always return `null` → the "lost response → one partner" test in T3 must go red (run then).

### S8-T2 — Extract the tier-neutral drain core (U/D) — behaviour-preserving
Failing-first here means: add `supabase/functions/_shared/connectSendsCore.test.ts` (Deno; `REQUIRED` entry in `scripts/check-edge-fn-test-binding.mjs` importing the shipped `drainSends` symbol) asserting, with a fake `SupabaseClient` and a fake adapter/probe, the loop's contract: claimed rows processed oldest first; `commit-rejected` → `record_connect_send_result` with rejection text; `command-held` → `record_connect_send_held`; `external-unreachable` stops the tick and records nothing; `command-in-flight-for-record` records nothing; an existing link (`connect_send_existing_link`) is recorded without a second send; a master missing in PMO → `gone` text; a demoted accepting Admin → `actor` text (item sends queued by the sweep itself exempt); unknown error → `record_connect_send_failure`; org B untouched.
Green: move the loop, `pmoMasterOf`, `actorIsAdmin`, `CONNECT_SEND_REJECTION_TEXT`, `DrainResult` out of `erpnext-sweep/connectSends.ts:1-165` into `_shared/connectSendsCore.ts` parameterised by `{ tier, connect: ConnectAdapter, probe(kind, master), reissueOnInconclusiveAbsence(kind), reasonOf(err), nounFor }`. `erpnext-sweep/connectSends.ts` becomes the wrapper (ERPNext parameters: `erpnextSendProbe`, `kind !== 'party'`, `erpReason`).
Verify: `D erpnext-sweep/connectSends.test.ts` **unchanged and green** (before and after the move; do not edit it), `D _shared/connectSendsCore.test.ts`, `D erpnext-sweep` full dir (the sweep tests that mock `drainConnectSends`, `index.ts:647,833`).

### S8-T3 — Odoo drain (D) — failing test first
File `supabase/functions/_shared/odooSends.test.ts` (new; `REQUIRED` entry → the shipped `drainOdooConnectSends`). With `fetch` mocked as a fake JSON-2 server (existing `odooSweep.test.ts` helpers):
1. three accepted vendor proposals → three `res.partner/create` calls, three `record_connect_send_result` with `Vendor:<id>`; outbox key is `seed:party:<pmo id>` on every attempt.
2. create answers, response lost (fetch throws after the server stored it), tick again → **one** partner (probe hit `ref=pmo:<id>`), result recorded once.
3. the stored partner's `ref` edited in Odoo, outbox row forced past its quarantine window, tick → `record_connect_send_held`, **no second create** (Q3).
4. two partners with the anchor → rejected with the ambiguity text; others in the batch complete (AC-ECA-012).
5. Odoo 422/validation → rejected with plain words naming the kind; sentinel upstream body text absent from the stored rejection.
6. `employee` rows → rejected with the "person" text (`pending #1510`).
7. a project row while `analytic_plan_id` is unset → rejected (plain words: choose the plan), no create.
8. unreachable (`odooClientForOrg` refusal) → rows stay `sending`, `pending` counted, **no** result recorded.
9. an Odoo recovery pass (`odooOutboxRecovery.ts`) never replays a `seed:` row (mirror of ERPNext `index.ts:455-459`): add a case to `_shared/odooOutboxRecovery` tests (the file has no `seed:` filter; if the case is red, add `if (candidate.idempotencyKey.startsWith('seed:')) continue;` at its candidate loop).
Green: `supabase/functions/_shared/odooConnectSends.ts` (new) = `drainSends({ tier:'odoo', connect: createOdooConnectAdapter(bindCall(client), ctx), probe: (k,m) => odooSendProbe(call, ctx, k, m), reissueOnInconclusiveAbsence: () => false, … })` with `ctx` built exactly as `_shared/connectAdapterForOrg.ts:23-27` does (`companyId`, `analyticPlanId`, `unitMap`); client from `odooClientForOrg`; deadline from the shared clock (`CONNECT_SENDS_BUDGET_MS`).
Verify: `D _shared/odooSends.test.ts` red → green. **Mutation:** set `reissueOnInconclusiveAbsence: () => true` → case 3 must go red; skip the probe → case 2 must go red; restore.

### S8-T4 — Run the drain from the Odoo sweep (D)
Append to `supabase/functions/odoo-sweep/odooSweep.test.ts`:
- a budget of N calls sends at most the rows that fit (each send reserves 2 calls: probe + create; use `budget.canSpend(2)`/`spend`, `refund` on a probe hit);
- nothing is shown sent before Odoo confirmed (rows move `sending → applied` only through `record_connect_send_result`);
- the drain runs after the directory pass and the setup-run step, also when the directory pass failed, and never fails the tick (`console.error` with no data, like `advanceSetupRun`, `_shared/odooSweep.ts:39-45`);
- `enqueue_new_item_sends(org,'odoo')` is called first (FR-ECA-016: a new item on an open purchase is sent without a person).
Green: add `sendAcceptedOdoo` to `AFTER_SWEEP` (`_shared/odooSweep.ts:46`).
Verify: `D odoo-sweep` (whole dir: `odooSweep.test.ts`, `sweep.test.ts`, bed test skipped without bed).

### S8-T5 — pgTAP: send results under tier `odoo` (P) — failing first
Append `odoo` cases to `supabase/tests/erp_connect_sends.test.sql` (new `AC-ECA-010 (odoo)` / `AC-ECA-012 (odoo)` leading tokens): `claim_connect_sends(org,'odoo',n)` returns only odoo `sending` rows of an activated binding; `record_connect_send_result` for kind `project` creates one `external_project_bindings` row (tier `odoo`, `external_container_id` = the account id) via `connect_link_project`; kind `party` writes `external_refs` with `Vendor:<id>`; a second org's rows untouched; `connect_send_existing_link` returns the link. Any red here is the only trigger for `0741` (§2).
Verify: `P supabase/tests/erp_connect_sends.test.sql supabase/tests/odoo_party_adoption.test.sql supabase/tests/odoo_project_links_config.test.sql` — grep `Parse errors`; plus pgTAP files that reference the touched functions: `grep -l "claim_connect_sends\|record_connect_send\|connect_link_project" supabase/tests/*.sql`.

### S8-T6 — Copy for Odoo's refusal codes (U) — failing first
`pmo-portal/src/lib/adapterSeam/pushErrorCopy.test.ts`: one case each for `validation`, `ambiguous`, `unit-unmapped` (Odoo `commit-rejected` reasons) and `held`, expecting plain words (no model/field names — `odoo/vocabulary.test.ts` guard, AC-ODC-083). Green: `pushErrorCopy.ts:139` table. Verify: `V pushErrorCopy.test.ts pushErrorCopy.budgetV16.test.ts odoo/vocabulary.test.ts`.

### S8-T7 — Companies adapter + outbox deps in dispatch (D) — failing first
File `supabase/functions/adapter-dispatch/odooCompanies.test.ts` (new; `REQUIRED` entry with the handler symbol the existing adapter-dispatch tests import, as `odooGates.test.ts` does). Cases:
1. an org that employs `companies` under tier `odoo` → `selectAdapterFactory('odoo','companies')` (`dispatchAdapters.ts:163`) returns the Odoo companies factory, **not** the ERPNext one; ERPNext and ClickUp orgs unchanged.
2. a company create → one `res.partner/create`; outbox key is `odoo:companies:<company id>` whatever key the client sent (`odoo/adapter.ts:43` already uses it);
3. lost response then second dispatch → no second create (probe hit);
4. two probe hits → `command-held`, no create; anchor edited in Odoo + probe miss → held (Q3).
5. kill-switch off / unusable connection → refused **before** any outbox row (same rule as `resolveOdooProcurementAdapter`).
Green: (a) `odooAdapters.ts:135` registry gains `companies: resolveOdooCompaniesAdapter` (built from `odooClientForOrg` + the same `OdooConnectCtx` as T3; calls counted with `countOdooCalls`); (b) `odooMoneyOutbox.ts:173` gains `if (ctx.command.domain === 'companies') return resolveOdooCompaniesMoneyOutboxDeps(ctx)` next to the `revenue` branch, built with `createDbMoneyOutboxDeps({ externalTier:'odoo', operation, probeByRemarksKey: odooSendProbe-for-party, reissueOnInconclusiveAbsence:false })`.
Verify: `D adapter-dispatch` whole dir (`deno test --allow-env --allow-net --allow-read`; ERPNext/ClickUp/Odoo gate suites are siblings). **Mutation:** return the ERPNext factory for tier `odoo` → case 1 red; restore.

### S8-T8 — `employ-domain` accepts `companies` (D)
`supabase/functions/external-set-company/odoo.test.ts` (append): `employ-domain {domain:'companies'}` by Admin/Operator calls `admin_change_domain_ownership(org,'odoo','companies','employ',actor)` (as `purchasing.ts:12-14` does for procurement); refused with 409 `sends-pending` while any `erp_connect_proposals` row for tier `odoo`, kind `party`, state `sending` exists (count query like `connect.ts:70`); a non-Admin → 403; a second ERP already owning `companies` → the database's plain refusal (422). Green: `odoo/purchasing.ts:10-23` takes `procurement | companies` (a two-element set; do not branch per domain). Verify: `D external-set-company` whole dir + `supabase/tests/odoo_party_adoption.test.sql` under the DB lock (AC-ODC-033: after employ, native-field edit → 42501, `archived_at` ok, release reopens).

### S8-T9 — Bed contract: partner command (B, gated) — AC-ODC-034
`supabase/functions/adapter-dispatch/odooCompanies.bed.test.ts` (new; gated on `ODOO_BED_URL`; **no `process.env.CI` gate**): create a vendor through the dispatch handler → one bed partner `ref='pmo:<id>'` and one `external_refs` row; repeat with the response dropped after the bed answered → still one; bed partner's `ref` edited + outbox row forced past quarantine → retry ends `held`, still one partner; invalid VAT (if `l10n_id` validates it on the bed, else skip with a note) → the verdict code reaches the response. Verify: `scripts/with-odoo-lock.sh scripts/with-db-lock.sh deno test --allow-all odooCompanies.bed.test.ts` against the local bed; add the file to the skip allowlist only if the harness requires it.

### S8-T10 — `send-project {projectId}` verb (D) — after S7
`external-set-company/odoo.projects.test.ts` (append): gate `() => true` (the link actor check decides: Admin, Operator, the project's PM); resolves the client (refusal → 503 `odoo-unavailable`, no outbox row); calls the same `drainSends` core for one row (key `seed:project:<id>`); on success applies the new account to the mirror with `apply_odoo_master_page` (current cursor passed back unchanged) then `link_odoo_cost_account`; `command-held` → 200 `{state:'held'}` with the held copy; double submit → one create; Odoo down → 503. Green: `odoo/projectLinks.ts` + router entry (`router.ts:30-40` tables). Verify: `D external-set-company` whole dir.

### S8-T11 — Bed contract: project send (B, gated) — AC-ODC-052
Append to `external-set-company/costAccount.bed.test.ts`: a fresh project → exactly one bed analytic account `code = project number` in the plan and company, linked; second `send-project` → still one; lost response then retry → one; account `code` edited + outbox row forced quarantined → `held`, bed count one. Verify: `scripts/with-odoo-lock.sh scripts/with-db-lock.sh deno test --allow-all costAccount.bed.test.ts`.

### S8 gate and review
Local final gate (paste output bodies): `npm run check:guards`, `npm run typecheck`, eslint on touched files, touched vitest files, `deno test` for `_shared`, `erpnext-sweep`, `odoo-sweep`, `adapter-dispatch`, `external-set-company`, touched pgTAP under the lock, `node scripts/check-edge-fn-test-binding.mjs` (+ `--self-test`), `node scripts/check-isolation-denominator.mjs --self-test` if SQL changed, i18n parity only if copy files changed. Reviews: spec-reviewer, code-quality-reviewer, **security-auditor** (all three; S8 is money-adjacent). Also re-run `supabase/functions/erpnext-sweep` Deno dir because T2 moves shared code.

---

## 4. S9 — Webhook nudge: **dropped** (Q1)

Decision recorded in `docs/decisions.md` at close (one line: "O1 S9 webhook dropped; sweep + Refresh now cover freshness; revive per §S9 if a client needs sub-minute master data"). AC-ODC-027 and FR-ODC-049 are marked *not built*, not failed; no other AC depends on them.

If revived (parked design, unchanged from the signed plan's S9): migration `0740_odoo_webhook.sql` (+ `rollback/0740_odoo_webhook_down.sql`): service-only `set_odoo_webhook_secret(org, actor)` (Admin/Operator) storing a random Vault secret referenced from `external_org_bindings.webhook_secret_ref`, and `odoo_webhook_seen(org, model, id)` over `external_webhook_dedupe`; `supabase/functions/odoo-webhook/index.ts` (path `/<org>/<token>`, `constantTimeBearerEquals`, a hint-only by-id `search_read` through `odooClientForOrg`, written via `apply_odoo_master_page` with the current cursor passed back so a webhook never moves the watermark); test `webhook.test.ts` first (forged name never applied, duplicate within 60 s → one read, unknown model → 202); runbook paragraph for the Odoo Automation Rule. V15 (payload/signature facts) must be probed on the bed first.

---

## 5. S10 — Bed acceptance: four scenarios, unavailable journey, setup journey, runbook

Executor: Orca worker (qa-acceptance role). Needs S8 and S7 on dev. ACs: 014, 080, 090, 091–094 (+ `AC-ECA-050/051` Odoo parity row of ECA-8, `docs/plans/2026-11-01-erp-connect-anytime.md` §13: "Odoo S9 of #1504 adds the same two journeys against the Odoo bed, reusing these specs' fixtures with `tier: 'odoo'`" — here that is **S10-T1 and S10-T3**; ECA-8's specs (#1607) are not on dev, so S10 builds Odoo-bed versions that use the same oracles and share a fixtures helper `e2e/helpers/connectScenario.ts` (new) which #1607 may adopt — **never two copies:** if #1607 lands first, S10 imports its fixtures instead).

Conventions: gate on the dependency (`ODOO_BED_URL`, `ODOO_BED_DB`, `ODOO_BED_KEY`, served-functions env), partial config throws, none = `test.skip` (pattern `AC-OCI-100…spec.ts:14-36`); never `process.env.CI`; each skip has a `scripts/check-e2e-skips.mjs` entry with a `restore` path ("scripts/with-odoo-lock.sh scripts/with-db-lock.sh scripts/e2e-local.sh <fragment> with the bed up and the functions served") and today's `verified` date; headers per `docs/e2e-parallel-conventions.md`. Order inside the serial group (S-C needs an empty bed): `scripts/odoo-dev-bed.sh reset` → S-C → S-A → S-D. Run: `scripts/with-odoo-lock.sh scripts/with-db-lock.sh scripts/e2e-local.sh AC-ODC-0`.

| Task | File (new) | Journey and oracle |
|---|---|---|
| **S10-T1** (S-C, AC-ODC-093) | `e2e/serial/AC-ODC-093-odoo-empty-erp.spec.ts` | seeded PMO org (3 vendors, 1 client, 2 projects, items on 2 open purchases) connects to the **freshly reset** bed → census "3 vendors in PMO, 0 in Odoo" → Accept all (one confirm with counts) → poll the progress line until sends finish → the bed holds exactly 4 partners with `ref = pmo:<id>`, 2 analytic accounts with the project numbers, the items as products, **and `search_count` of accounts and taxes before = after**; every PMO row has one external ref; accepting again creates nothing. |
| **S10-T2** (S-A, AC-ODC-091) | `e2e/AC-ODC-091-odoo-new-org-existing-erp.spec.ts` | seed 20 partners and 5 products on the bed by JSON-2; fresh PMO org connects → census "0 in PMO, 20 in Odoo" → Accept all → 20 PMO companies (one per role), zero review rows, item picker lists the 5 products. |
| **S10-T3** (S-D, AC-ODC-094) | `e2e/AC-ODC-094-odoo-both-have-data.spec.ts` | PMO: vendors A (tax id T1), B (name only), C (PMO-only), two companies named E; bed: A′ (T1), B′ (same name as B), D (Odoo-only), E′ → proposal link A, link B, send C, bring in D, review E → Accept all → one PMO row per partner, one partner per PMO company (bed count 5), E remains a review row; resolving E links it; a project whose code matches an existing account **links** instead of creating a second one. |
| **S10-T4** (S-B, AC-ODC-092) | no browser | owned below the browser. Shipped: `odoo-sweep/sweep.test.ts:57` (`AC-ODC-092`, zero bindings → no Odoo call). **Missing (grep 2026-11-07):** the P half. Task = append to `supabase/tests/odoo_connect_custody.test.sql`, test first: `AC-ODC-092` with no odoo binding `domain_owned_by_tier(org,'companies','odoo')` is false (company writes stay PMO-local); `P` that file. |
| **S10-T5** (AC-ODC-080) | `e2e/AC-ODC-080-odoo-setup-journey.spec.ts` | fresh org Admin → Integrations → Odoo card → connect → activate the single company → map once (Accept all, S7) → link the pilot project **by sending it** (S8-T10) → review one partner → **Employ companies** (S8-T8) → log out/in → every checklist item complete; goal oracle: the project's cost-account code and the defaults equal the bed's values (read back by JSON-2 in the test). |
| **S10-T6** (AC-ODC-014) | `e2e/AC-ODC-014-odoo-unavailable.spec.ts` | connected org → `scripts/odoo-dev-bed.sh down` → three Re-checks → item directory and project panel show last data with "as of" and the unavailable notice; "Create in Odoo" says "Odoo is unreachable, try again" and **no** `external_command_outbox` row exists (service-role read helper); `up` → Re-check → the notice clears. Bring the bed back up in `afterAll` even on failure. |
| **S10-T7** (AC-ODC-090) | append to `supabase/functions/_shared/odooSweep.bed.test.ts` | per kind, active mirror rows = bed `search_count` with the same company domain; every linked project's account id exists on the bed. AC-ODC-090 = 010 + 014 + 023 + 051 + 080 + this check (no new test beyond those). |
| **S10-T8** | `docs/runbooks/odoo-client-setup.md` | the service user and its group set (no password, key only); mint a key and note its expiry; confirm the Indonesian localisation and PPN/PPh taxes; the connect form; each connection state with its next step; what "Accept all" creates in an empty database (partners, cost accounts, products; never accounts or taxes); how to read a *held* send. Synthetic hostnames only (`odoo.example.test`). Write the doc from the shipped screens (verify each name against `public/locales/en/administration.json`), not memory. |

S10 gate: `npm run check:guards`, `npm run typecheck`, eslint on touched specs, `node scripts/check-e2e-skips.mjs --self-test` and the live check (a stale entry fails), the touched specs on the bed, `docs/` link check if the repo has one. No CI e2e for these (Q5).

---

## 6. Traceability (ACs owned by the remaining slices; one owning test per AC)

| AC | Owning test | Layer | Task |
|---|---|---|---|
| AC-ODC-034 | `supabase/functions/adapter-dispatch/odooCompanies.bed.test.ts` (logic: `odooCompanies.test.ts`) | B | S8-T9 (T7) |
| AC-ODC-052 | `supabase/functions/external-set-company/costAccount.bed.test.ts` (logic: `odoo/connectAdapter.test.ts`, `odoo.projects.test.ts`) | B | S8-T11 (T1, T10) |
| AC-ECA-010 / 011 / 012 (Odoo) | `contractSuite/sendAll.suite.ts` + `send.suite.ts` via `odoo/contract.test.ts` (shared, already green); served half `_shared/odooSends.test.ts`; DB half `erp_connect_sends.test.sql` (odoo rows) | S / D / P | S8-T3, T5 |
| AC-ODC-033 (employ step) | `supabase/tests/odoo_party_adoption.test.sql` | P | S8-T8 |
| AC-ODC-027 | **not built (dropped, Q1)** | — | S9 |
| AC-ODC-014 | `pmo-portal/e2e/AC-ODC-014-odoo-unavailable.spec.ts` | E | S10-T6 |
| AC-ODC-080 | `pmo-portal/e2e/AC-ODC-080-odoo-setup-journey.spec.ts` | E | S10-T5 |
| AC-ODC-090 | composite 010 + 014 + 023 + 051 + 080 + `odooSweep.bed.test.ts` reconciliation | B+E | S10-T7 |
| AC-ODC-091 (S-A) | `pmo-portal/e2e/AC-ODC-091-odoo-new-org-existing-erp.spec.ts` | E | S10-T2 |
| AC-ODC-092 (S-B) | `odoo-sweep/sweep.test.ts` (P half: `odoo_connect_custody.test.sql`) | D | S10-T4 |
| AC-ODC-093 (S-C) | `pmo-portal/e2e/serial/AC-ODC-093-odoo-empty-erp.spec.ts` | E | S10-T1 |
| AC-ODC-094 (S-D) | `pmo-portal/e2e/AC-ODC-094-odoo-both-have-data.spec.ts` | E | S10-T3 |
| AC-ECA-050 / 051 (Odoo parity row) | = AC-ODC-093 / 094 above (same oracles, `tier: 'odoo'`) | E | S10-T1, T3 |

Each owning test names its `AC-###` in the title (CLAUDE.md tagging rule). Layers: U Vitest · D Deno shipped-handler · P pgTAP · S shared contract suite · B bed-gated Deno · E served Playwright.

---

## 7. Risks for the builders

- **Sends create real records in the client's Odoo.** Behind a bulk accept with counts, keyed `seed:<kind>:<id>`, looked up before create, **held — never reissued** — on an inconclusive probe (Q3). The mutation checks in T3/T7 are mandatory evidence.
- **T2 moves ERPNext money-adjacent code.** Its unchanged `connectSends.test.ts` is the proof; any edit to that test file is a stop-and-ask.
- **`odooSweep.ts` and `router.ts`/`purchasing.ts` are shared with S7.** Keep S8's edits to one appended array element and one set membership so the merge is mechanical; the second branch to merge rebases.
- **Call budget.** A 300-vendor setup sends over several ticks; each send reserves probe + create. Do not raise `CONNECT_SENDS_PER_TICK` (10); upgrade path is a per-org budget if a tick is observed to starve the directory passes.
- **Odoo e2e is not in CI** (Q5): a green CI says nothing about S10 specs. The Director runs them locally on the bed before closing #1504 and records the output.
- **Public repo:** no weaknesses, hosts, keys or client names in code, tests, fixtures or the runbook.
