# Plan — Connect an ERP at any time, with no step inside the ERP (#1599, ECX)

- **Issue:** #1599 (`OD-ERP-ANYTIME-1`), map #791 / #1442. Builds on the owner-signed spec
  `docs/specs/erp-connect-anytime.spec.md` (ECA) and its as-built plan `erp-connect-anytime plan (2026-11-01, in git history)`.
- **Owner rule (binding for this plan):** clients never work in the ERP. PMO is the only interface; the ERP is the source of
  truth, PMO writes to it and reads it back. A no-ERP organisation keeps its own records in PMO as the truth. Any step a person
  would have to do inside the ERP is a **GAP** (§6), never a plan step.
- **Evidence baseline:** `origin/dev` at `1ac0fe85` (2026-11-15). Every "today" claim cites the file that decides it.
- **IDs:** `FR-ECX-###`, `AC-ECX-###` (prefix checked unused: `grep -rhoE 'AC-[A-Z]+-' docs pmo-portal supabase | sort -u`
  lists `AC-EC-` and `AC-ECA-`, not `AC-ECX-`), plan decisions `PD-ECX-#`, owner questions `OQ-ECX-#`, tasks `ECX<n>-T<m>`.
- **Migrations:** ECX-3 = 0910, ECX-4 = 0911, ECX-5 = 0912 (only if needed); the other slices keep the numbers they name, all after the head `0894_cli_operator_onboard_guard.sql`. Each has
  `supabase/migrations/rollback/<number>_<slug>_down.sql`. A collision at build is fixed with `scripts/renumber-migration.sh`,
  never by hand.

## 1. Goal

An organisation that started without an ERP, or with one, can connect an ERP at any later time, and its existing PMO records
are matched to the ERP's or created in it, each counted once. Every step of that connection, including the setup the ERP
itself needs, is done from PMO, so nobody in the client organisation ever has to open the ERP.

## 2. What exists today (all eight ECA slices shipped)

#1600–#1607 are closed. The four scenarios of the spec (S-A new PMO + ERP with data, S-B no ERP, S-C live PMO + empty ERP,
S-D both hold data) work on ERPNext through the shared seam:

| Capability | Where it is decided | Proof |
|---|---|---|
| Census per kind, one matcher, accept-all, review rows, audit, reversible links | `pmo-portal/src/lib/adapterSeam/connect/{census,match,run}.ts`; `supabase/migrations/0480_erp_connect_setup.sql:11-60` (runs, staged, census, proposals), `:430` `accept_connect_proposals`, `:518` `decide_connect_review`, `:548` `unlink_connect_match`; UI `pmo-portal/src/components/integrations/ConnectProposalReview.tsx` | AC-ECA-001..007 (`connect/census.test.ts`, `connect/match.test.ts`, `ConnectProposalReview.test.tsx`, `supabase/tests/erp_connect_setup.test.sql`, `supabase/functions/_shared/erpnextFeedDeps.partyMatch.test.ts`, `supabase/functions/erpnext-onboard/index.test.ts`) |
| Send PMO clients/vendors, projects, items to the ERP, lookup-before-create, outbox keys | `adapterSeam/erpnext/connectAdapter.ts:59` `erpnextSendProbe`, `:92` `createErpnextConnectAdapter`; `adapterSeam/connect/sendViaOutbox.ts`; `0494_erp_connect_sends.sql:10-137`; `0499_erp_new_item_sends.sql` | AC-ECA-010..012 (`contractSuite/sendAll.suite.ts`, `send.suite.ts`, `supabase/tests/erp_connect_sends.test.sql`, `supabase/functions/erpnext-sweep/connectSends.test.ts`) |
| Records in flight at cut-over finish in PMO | `0481_process_domain_cutover.sql:14` `pre_cutover_procurement`, `:36/:75/:132` receipt/invoice/payment guards; `adapterSeam/cutoverGate.ts` | AC-ECA-020/021 (`cutoverGate.test.ts`, `supabase/tests/process_domain_cutover.test.sql`, `adapter-dispatch/cutoverGuard.served.test.ts`) |
| PMO and ERP invoices for one sale count once | `0498_invoice_pairs.sql:484` `invoice_pair_candidates`, `:519` `propose_invoice_pairs`, `:582` `accept_invoice_pairs(p_pairs jsonb)`, `:663` `unpair_invoice`; UI `components/integrations/InvoicePairReview.tsx` | AC-ECA-030 (`supabase/tests/invoice_pairs.test.sql`, `InvoicePairReview.test.tsx`) |
| Existing ERP budget: use as draft / replace | `0495_budget_occupant_resolution`; `pages/project-detail/budget/BudgetErpNotice.tsx` | AC-ECA-031 |
| Parity registry and shared suites | `adapterSeam/connect/workflows.ts:15-47`, `erpnext/workflowDeclarations.ts:19-54`, `contractSuite/parity.test.ts`, `tierBranch.test.ts` | AC-ECA-040..043 |
| Bed journeys | `pmo-portal/e2e/serial/AC-ECA-050-connect-empty-erp.spec.ts`, `AC-ECA-051-connect-erp-with-data.spec.ts` | AC-ECA-050/051 |
| No-ERP organisation keeps PMO as truth | `0275_native_revenue.sql` (native revenue), `0890_import_purchase_history.sql:1-4` (PMO-native purchase history, "nothing is sent to an ERP") | `0275_native_revenue_*.test.sql` |
| ERP purchase history brought into PMO | `supabase/functions/purchase-capture/index.ts` (`proposeCapture`/`reconcileCapture` from `adapterSeam/captureHistory.ts`); `0866_erp_purchase_capture.sql`; captured bills payable from PMO (`erpnext/workflowDeclarations.ts:57` `payCapturedInvoice: true`, `adapterSeam/dispatch.ts:357`) | `captureHistory.test.ts`, `captureHistory.contract.test.ts` |

### What is missing: the shipped flow still sends people into the ERP

Each row is shipped behaviour that tells a client user to act inside the ERP (owner rule violation), or leaves a balance the
ERP never learns about.

| # | Shipped behaviour | Cite | Who is hurt |
|---|---|---|---|
| M-1 | Employees are never sent; the setup screen says "Add these people in the ERP." | `erpnext/workflowDeclarations.ts:13,30` (`employee.send` unavailable); `pmo-portal/public/locales/en/administration.json:299` (`addPeople`) | An Admin on an empty ERP cannot push the first timesheet until someone keys every employee in the ERP. |
| M-2 | Missing direct-cost accounts: "Ask your accountant to add a direct-cost account for: …" | `components/integrations/ErpSetupChecklist.tsx:227`; `erpSetupIncompleteness.ts:25` `missingAccountCategories`; `administration.json:300` | Budget push and expense posting for that category are refused until someone edits the ERP chart. |
| M-3 | ERP company defaults (payable, expense, cash, bank account, cost centre) can only be re-read; the fix is "Review company settings" in the ERP | `erpSetupIncompleteness.ts:4-11` `COMPANY_DEFAULTS`; `ErpSetupChecklist.tsx:233` (`onRefreshCompany` re-reads); `locales/en/common.json:134` | Bills and payments are refused by the ERP while a default is empty. |
| M-4 | Ambiguous invoice pairs: "Open them in the ERP to tell them apart; PMO will not choose for you." | `administration.json:394` (`needsDecisionHelp`); `InvoicePairReview.tsx` | Finance must open the ERP to resolve a double-count risk. |
| M-5 | Unpaid PMO invoices at revenue employ are stamped with "its share of the one opening entry the accountant posts in the ERP" | `0275_native_revenue.sql:41-66` (`erp_opening_amount`, comment `:64`) | The ERP's receivables are wrong until a person posts the opening entry by hand. |
| M-6 | Pre-cut-over purchases finish in PMO (OQ-ECA-1); their unpaid bills are never known to the ERP; no opening payable is posted | `0481_process_domain_cutover.sql:14`; spec FR-ECA-030 | The ERP's payables omit what the company still owes vendors. |
| M-7 | A claim approved before `expenses` is enabled posts its payment without an approval entry; "the operator carries the approval in the opening balance" | spec FR-ECA-030, FR-EXP-110 (`docs/specs/expense-claims.spec.md`) | The ERP posts a payment against a liability it never recorded. |
| M-8 | Nothing creates the next fiscal year; ERPNext refuses postings dated outside one | `0295_statement_ledger_source.sql` mirrors fiscal years read-only; no writer exists (`grep -rln 'Fiscal Year' pmo-portal/src/lib/adapterSeam/erpnext` returns readers only) | Every push dated in a new year fails until someone opens the ERP. |
| M-9 | No guard stops new copy from telling a user to act in the ERP | — | The rule regresses silently. |

Out of scope (already owned elsewhere): Odoo parity rows (#1504–#1511), `cutover.timesheet`/`cutover.revenue` suite moves
(#1676), stock crossing (#1508), bulk matching for non-ERP tools (#1043).

## 3. Design decisions

- **PD-ECX-1 — Every ERP-side setup task becomes a PMO action through the same outbox.** Writes go through
  `adapterSeam/connect/sendViaOutbox.ts` with derived keys (ADR-0059 §4) and a lookup before create, exactly like
  `party.send`. No new transport.
- **PD-ECX-2 — Opening balances are one PMO document per domain, prepared and approved by two different people.** It is a
  ledger posting: preparer ≠ approver, enforced in SQL (ADR-0019), Admin/Finance only.
- **PD-ECX-3 — Opening entries never touch project figures.** They post party balance against an opening-equity account the
  approver picks from the mirrored chart, with no project tag, and are flagged `is_opening = 'Yes'` (the mirror already stores
  it, `0295_statement_ledger_source.sql:6`). PMO's pre-cut-over records keep counting in project figures (FR-ECA-032); the
  ERP's opening lines count only in balance-sheet figures. This is the double-count rule (§5).
- **PD-ECX-4 — New workflows join the registry.** `account.send`, `company-defaults.set`, `fiscal-year.ensure`,
  `opening.post`, `opening.settle` are added to `connect/workflows.ts`; typecheck forces ERPNext and Odoo to declare them
  (FR-ECA-050), so Odoo inherits the rule.
- **PD-ECX-6 — Every ERP write sends `company`; journal and payment writes are one POST with submit.** The bed silently
  defaults an omitted `company` to the API user's default company (an Employee and an Account landed in the wrong company), so
  every write names it. A Journal Entry or Payment Entry is created and submitted in one POST (`docstatus: 1`): the ERP checks
  at submit, and a rejected single POST leaves no draft behind, where create-then-submit leaves one. (Bed findings, section 10.)
- **PD-ECX-5 — The copy guard is the enforcement.** A locale scan with an allowlist (each entry names the slice that removes it;
  a stale entry fails), same shape as `scripts/check-e2e-skips.mjs`.

## 4. Slices (each independently shippable, in order)

Verify commands used below (all from repo root unless stated):

- **V-unit:** `cd pmo-portal && npx vitest run <file>`
- **V-type:** `cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 <touched files>`
- **V-pg:** `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`
- **V-deno:** `(cd supabase/functions/<fn> && deno test --allow-all)`
- **V-e2e:** `scripts/with-db-lock.sh scripts/e2e-local.sh <fragment>`
- **V-guards:** `cd pmo-portal && npm run check:guards`

| Slice | Removes | ACs | Tier | Executor | Bed discovery first |
|---|---|---|---|---|---|
| ECX-1 Copy guard | M-9 | 001 | — | Orca worker | no |
| ECX-2 Resolve ambiguous invoice pairs in PMO | M-4 | 010, 011 | **money** (changes what counts) | Director-dispatched, Orca UI worker | no |
| ECX-3 ERP company defaults set from PMO | M-3 | 020, 021 | config (accounting) | Director-dispatched | **yes** |
| ECX-4 Direct-cost accounts created from PMO | M-2 | 030, 031 | config (accounting); OQ-ECX-1 answered yes | Director-dispatched | **yes** |
| ECX-5 Fiscal year kept ahead from PMO | M-8 | 040 | config (accounting) | Director-dispatched | **yes** |
| ECX-6 Employees sent from PMO | M-1 | 050, 051 | personal data; waits on OQ-ECX-2 | Director-dispatched + security-auditor | **yes** |
| ECX-7 Opening balances posted from PMO | M-5, M-6, M-7 | 060–064 | **money, ships alone** | Director-dispatched | **yes** |
| ECX-8 Settle pre-cut-over balances against the opening entry | M-6, M-7 (after posting) | 070, 071 | **money, ships alone**; waits on OQ-ECX-4 | Director-dispatched | **yes** |
| ECX-9 Bed journey: connect with zero ERP steps | all | 080 | — | Orca worker (qa-acceptance) | runs on the bed |

Order: ECX-1 first (it lists the GAPs it will drop); ECX-2..6 independent; ECX-7 after ECX-3 and ECX-5 (it needs defaults and a
fiscal year); ECX-8 after ECX-7; ECX-9 last. Each slice removes its allowlist entries from ECX-1's guard in the same PR.

---

### ECX-1 — Copy guard: no instruction to act in the ERP (M-9)

**ECX1-T1 — failing guard self-test (AC-ECX-001).** Create `scripts/check-no-erp-steps.mjs` with only a `--self-test` that
feeds a fixture `{ "x": "Add these people in the ERP." }` and expects exit 1, and `{ "x": "Synced from the ERP." }` expecting
exit 0. Run: `node scripts/check-no-erp-steps.mjs --self-test` → fails (no scanner yet).

**ECX1-T2 — scanner (green).** Scan `pmo-portal/public/locales/{en,id}/*.json` values for imperative ERP instructions:
`/\b(add|open|create|set|enter|post|review|ask)\b[^.]{0,60}\b(in|inside) (the|your) ERP\b/i` and the `id` forms
`/\b(tambahkan|buka|buat|atur|masukkan)\b[^.]{0,60}\bdi ERP\b/i`, plus `/\bask your accountant\b/i` and its `id` form
`/\bminta akuntan\b/i` (the accountant works in the ERP). Allowlist `scripts/no-erp-steps-allowlist.json` entries
`{ file, key, slice }` for today's matches: `administration.integrations.send.addPeople` (ECX-6),
`administration.odoo.send.addPeople` (Odoo O7, #1510 — outside this plan, entry names it),
`administration.integrations.send.accountantTask` (ECX-4), `administration.invoicePairs.needsDecisionHelp` (ECX-2), each in
`en` and `id` (the worker confirms the `id` strings match; an `id` string that does not match is a copy defect to fix in the
same task). `common.uxs08.companyAction` ("Review company settings") names no ERP and is not matched; ECX3-T6 replaces the
action itself. A listed key that no longer matches fails as stale. Run: `node scripts/check-no-erp-steps.mjs --self-test && node
scripts/check-no-erp-steps.mjs` → both exit 0.

**ECX1-T3 — wire into guards.** Add `"check:no-erp-steps": "node ../scripts/check-no-erp-steps.mjs && node
../scripts/check-no-erp-steps.mjs --self-test"` to `pmo-portal/package.json` (beside `check:plain-words`, line 34) and append
`&& npm run check:no-erp-steps` to `check:guards` (line 40). Run V-guards.

### ECX-2 — Resolve ambiguous invoice pairs in PMO (M-4, money)

`invoice_pair_candidates(p_pmo_id)` (`0498_invoice_pairs.sql:484`) already returns every candidate and
`accept_invoice_pairs(p_pairs jsonb)` (`:582`) already takes explicit pairs. No SQL change: the review row only needs to show
the candidates' facts from the mirror and let Finance pick one.

**ECX2-T1 — failing RTL test (AC-ECX-010).** In `pmo-portal/src/components/integrations/InvoicePairReview.test.tsx` add
`it('AC-ECX-010 a needs-a-decision row shows each candidate ERP invoice with number, date, amount and reference and lets Finance pick one')`:
mock the repository with one PMO invoice and two candidates; click "Choose this one" on the second; expect the accept call with
exactly `[{ pmo_id, erp_id: second }]`. Run V-unit on that file → red.

**ECX2-T2 — repository read.** `InvoicePairReview.tsx:41` reads `repositories.revenue.proposeInvoicePairs()`
(`src/lib/repositories/revenue.ts:69` → `src/lib/db/revenue.ts:757`). Add `invoicePairCandidates(pmoId)` in
`src/lib/db/revenue.ts` calling `invoice_pair_candidates` with `p_pmo_id`, and expose it in `repositories/revenue.ts`. Test first
in `src/lib/db/revenue.test.ts` (`it('AC-ECX-010 candidates are read for one PMO invoice')`). V-unit.

**ECX2-T3 — UI (green).** Expand the review row into a candidate list (number, posting date, amount, reference) with a
per-candidate "Choose this one" behind `ConfirmDialog`; replace `needsDecisionHelp` en/id with "These match more than one ERP
invoice. Compare them here and choose the same sale." Remove the allowlist entry. Run V-unit, V-type, V-guards.

**ECX2-T4 — failing pgTAP for the SoD of a single accept (AC-ECX-011).** In `supabase/tests/invoice_pairs.test.sql` add
`AC-ECX-011 a Project Manager cannot accept a chosen pair; Finance can, and the PMO invoice stops counting`. Expected green
on first run (shipped RPC); if red, stop and report — it is a defect in `0498`, not this slice. Run V-pg on that file.

### ECX-3 — ERP company defaults set from PMO (M-3)

**ECX3-T0 — bed discovery (done 2026-11-16, §10).** **v16 (§11): identical; nothing changes.** A partial-body REST `PUT /api/resource/Company/<name>` works for an integration user
without System Manager and returns the whole Company. The ERP enforces **no** account type on these fields and no group or
company check on `cost_center` (it refuses only a group account, an account of another company, and an unknown account or cost
centre). So PMO owns the type rule (payable → Payable, cash → Cash, bank → Bank, expense → Expense Account/COGS; expense is
the `default_expense_account` field). A fresh Standard-chart company has no bank default: a Bank-type leaf must first be
created by ECX-4. Record the request/response shapes as fixtures in
`pmo-portal/src/lib/adapterSeam/erpnext/__fixtures__/companyDefaults.json` (synthetic names only).

**ECX3-T1 — registry (failing typecheck, AC-ECX-020).** Add `'company-defaults.set': { version: 1, summary: 'set the ERP
company default accounts and cost centre chosen in PMO' }` to `connect/workflows.ts`. Run V-type → fails in both
`erpnext/workflowDeclarations.ts` and `odoo/workflowDeclarations.ts` (proves FR-ECA-050 coverage). Declare ERPNext
`supported`, Odoo `pending` with #1504.

**ECX3-T2 — failing shared suite.** Create `contractSuite/companyDefaults.suite.ts`:
`AC-ECX-020 given an ERP company with an empty payable default and a mirrored Payable account, setting it from PMO writes the
company once, a retry writes nothing, and an account of the wrong type or a non-leaf cost centre is refused by the adapter before any write`. Register it in
`contractSuite/index.ts`. Run `npx vitest run src/lib/adapterSeam/erpnext/contract.test.ts` → red.

**ECX3-T3 — adapter (green).** `pmo-portal/src/lib/adapterSeam/erpnext/companyDefaults.ts`: read the company, diff against the
chosen values, refuse in plain words any account whose type is wrong or any cost centre that is a group or of another company
(the ERP will not), send `company`, `PUT` only changed fields, re-read to confirm (NFR-ECA-004). A stale `modified` answers 417
`TimestampMismatchError`: re-read and retry once. Route through `sendViaOutbox` with key
`setup:company-defaults:<binding_id>:<sha of chosen values>`.

**ECX3-T4 — failing pgTAP (AC-ECX-021).** `supabase/tests/erp_company_defaults.test.sql`:
`AC-ECX-021 only Admin or Finance of the binding's org can request a defaults change; the account must be a mirrored account of
that company and org; another org's request is refused`. Run V-pg → red.

**ECX3-T5 — migration (green).** `supabase/migrations/0910_erp_company_defaults.sql`: security-definer
`request_company_defaults(p_tier text, p_values jsonb)` that resolves org from `auth_org_id()`, checks role, validates each
account's type and each cost centre (leaf, same company) against the mirror for the bound company, enqueues the outbox row; rollback file. Run V-pg.

**ECX3-T6 — UI.** In `ErpSetupChecklist.tsx` replace "Review company settings" for a missing default with a `SelectField` of
mirrored accounts of the right type (and leaf cost centres of the company only) and a Save; RTL test first in a new
`pmo-portal/src/components/integrations/ErpSetupChecklist.test.tsx` (none exists today). Drop the allowlist entry. Run V-unit, V-type, V-guards.

### ECX-4 — Direct-cost accounts created from PMO (M-2; OQ-ECX-1 answered yes: leaf direct-cost accounts only, under a group the Finance user picks, Admin/Finance only)

**ECX4-T0 — bed discovery (done 2026-11-16, §10).** **v16 (§11): identical (28 cases); nothing changes.** Required fields are `account_name`, `parent_account`, `company` only;
`root_type` is inherited and `account_type` is optional (checked against its option list, never against `root_type`). The parent
must be a group of the same company (leaf, missing, unknown or other-company parent → 417). A duplicate is 409
`DuplicateEntryError` on the full name `<account_name> - <abbr>` across any parent, case-insensitive. A missing `account_name`
is a 500 (PMO guards an empty name). Do not send `account_currency`. Fixture
`erpnext/__fixtures__/accountCreate.json`.

**ECX4-T1 — registry.** Add `'account.send'` (version 1) to `connect/workflows.ts`; ERPNext `supported`, Odoo `pending` #1504.
Run V-type (red until declared, then green).

**ECX4-T2 — failing shared suite (AC-ECX-030).** `contractSuite/accountSend.suite.ts`:
`AC-ECX-030 given a budget category with no direct-cost account and a chosen expense group, sending creates one leaf account
under that group, the category map points at it, a lost response then retry finds and links the same account, a 409 duplicate that is not a leaf of the same company under an expense root is refused in plain words (`commit-rejected`, never held), and no tax,
fiscal year or group account is ever created`. Run the ERPNext `contract.test.ts` → red.

**ECX4-T3 — adapter (green).** Extend `erpnext/connectAdapter.ts` `sendMaster` for `kind: 'account'`: send
`account_name`, `parent_account`, `company` only; look up by `company` + `account_name` before create; a 409 duplicate is linked
only when the existing account is a leaf of the same company under an expense root, otherwise refuse in plain words (`commit-rejected`); only a duplicate whose account cannot be read back (outcome not established) is held as `command-held` for reconciliation; guard an
empty name in PMO; create leaf only, return the ERP name; derived key `seed:account:<category>` via
`sendViaOutbox`.

**ECX4-T4 — failing pgTAP (AC-ECX-031).** `supabase/tests/erp_account_send.test.sql`:
`AC-ECX-031 only Admin or Finance can request an account send; the parent must be a mirrored group account of the bound
company; the resulting map row is org-scoped`. → red.

**ECX4-T5 — migration (green).** `0911_erp_account_send.sql`: `request_account_send(p_tier text, p_category text,
p_parent_account text)`; on success the sweep writes `budget_category_account_map` through the shipped map path
(`budget/categoryAccountMap.ts:86`). Rollback file. V-pg.

**ECX4-T6 — UI.** Replace `accountantTask` copy with "No direct-cost account for: {{categories}}. Create them under:
[group picker] [Create]"; RTL test first in `ErpSetupChecklist.test.tsx` (created in ECX3-T6). Drop allowlist entry. V-unit, V-type, V-guards.

An account request whose reconciliation is unresolved keeps its category reserved until the account is linked or an Admin records a reasoned, audited absence disposition. Disposition requires the original outbox to be terminal and unclaimable and any claim window to have elapsed; a recorded ERP identity requires authoritative linking.

### ECX-5 — Fiscal year kept ahead from PMO (M-8)

**ECX5-T0 — bed discovery (done 2026-11-16, §10).** Create is `POST /api/resource/Fiscal Year {year, year_start_date,
year_end_date, companies:[{company}]}` and **needs System Manager** (403 without; reads work). Refused: end before start (417),
not one year unless `is_short_year` (417), duplicate name (409), unknown company row (417). Overlap: 409 `NameError` (no company
rows, or a shared company) and 417 (identical start and end); a partial overlap between two different companies' years is
accepted. Lookup trap: a global year (no company rows) is not found by a company child filter. Fixture `erpnext/__fixtures__/fiscalYear.json`.
**v16 (§11):** a company year beside a global year with the same dates is accepted (v15 refused it), so "already covered" is decided ONLY from the date-range lookup and the year's company rows, never from a 409.

**ECX5-T1 — registry.** Add `'fiscal-year.ensure'` (v1); ERPNext supported, Odoo pending #1504. V-type.

**ECX5-T2 — failing shared suite (AC-ECX-040).** `contractSuite/fiscalYear.suite.ts`:
`AC-ECX-040 given the current fiscal year ends within 45 days and no next year exists, the sweep creates exactly one next year
with the same start month, a second tick creates nothing, an existing overlapping year is linked, not duplicated, and a 403 on
create shows on the setup checklist as an Operator task, never a client step and never a silent skip`. → red.

**ECX5-T3 — adapter + sweep (green).** `erpnext/fiscalYear.ts` (lookup by date range and read each year's company rows, none = covers every company; "already covered" comes only from that lookup, never from a 409, because v16 accepts a company year beside a global one; then create with a
`companies` row for the bound company; a 403 is surfaced on the checklist as an Operator task; a migration `0912` only if the
checklist needs a stored state); call it from
`supabase/functions/erpnext-sweep/index.ts` once per binding per day. Deno test first:
`supabase/functions/erpnext-sweep/fiscalYear.test.ts` importing the shipped handler with `globalThis.fetch` mocked. V-deno, V-unit.

### ECX-6 — Employees sent from PMO (M-1; waits on OQ-ECX-2)

**ECX6-T0 — bed discovery (done 2026-11-16, §10).** Mandatory: `first_name`, `gender`, `date_of_birth`, `date_of_joining`
(417 otherwise); `company` is mandatory but silently defaulted, so always send it. No holiday list, department, user or contact
needed. Gender is a link doctype (bed: Male, Female, Other, Transgender, Genderqueer, Non-Conforming, Prefer not to say; unknown
417). Future birth date or joining before birth 417. There is **no unique anchor** on Employee: the lookup-before-create keys on
a PMO-owned `employee_number` prefix (or a custom field) plus `[company, employee_number]`, accepting the race. Fixture
`erpnext/__fixtures__/employeeCreate.json`.

**ECX6-T1 — failing pgTAP (AC-ECX-051).** `supabase/tests/people_hr_details.test.sql`:
`AC-ECX-051 the HR details of a person (date of birth, gender, date of joining) are readable and writable only by Admin of the
same org and by the person themself, never by other roles, never across orgs, and are absent from every list view`. → red.

**ECX6-T2 — migration (green).** `0897_people_hr_details.sql`: a separate table `public.person_hr_details(org_id, profile_id,
date_of_birth, gender, date_of_joining)` with RLS forced, org-scoped, Admin + self; no grant on any list view; rollback file.
V-pg.

**ECX6-T3 — failing shared suite (AC-ECX-050).** Extend `contractSuite/send.suite.ts`:
`AC-ECX-050 given an active person with HR details filled in PMO, sending creates one ERP employee linked to the PMO person; a
person without them is held with "add birth date and gender in PMO", never sent with invented values`. → red.

**ECX6-T4 — adapter (green).** `erpnext/connectAdapter.ts` `sendMaster('employee', …)` reads HR details through the
service-role writer scoped by the binding's org (NFR-ECA-003); flip `employee.send` to supported in
`erpnext/workflowDeclarations.ts:30` and remove `EMPLOYEE_SEND_UNAVAILABLE_REASON` once nothing imports it.

**ECX6-T5 — UI.** HR details fields on the person's profile (Admin); replace `addPeople` with "Add birth date and gender for
these people in PMO to create them in the ERP" linking to each profile. RTL test first. Drop allowlist entry. V-unit, V-type,
V-guards.

### ECX-7 — Opening balances posted from PMO (M-5, M-6, M-7; money, ships alone)

**ECX7-T0 — bed discovery (done 2026-11-16, §10).** One Journal Entry `{voucher_type:'Opening Entry', is_opening:'Yes', company,
posting_date, user_remark:<key>, accounts:[…], docstatus:1}` holds many party lines plus the counter-line. Party lines on
receivable/payable accounts need `party_type` + `party` (a mismatch is 417); Payable accepts Supplier and Employee, and the ERP
also accepts Employee on a Receivable account, which PMO must not allow. The counter-line is an Equity or Temporary balance-sheet
leaf (P&L and group accounts are refused at submit). Submit refuses an unbalanced entry and a posting date with no covering fiscal
year (ECX-5 first). Negative amounts submit, so PMO guards them. `user_remark` is not unique: lookup by `[company, user_remark]`
across docstatus 0 and 1 is the only guard. Ledger rows carry `is_opening` 'Yes' but `voucher_type` 'Journal Entry' (key on
`is_opening`), project null. A cancelled opening cannot be deleted. Read-back: `erpnext.accounts.utils.get_balance_on` on v15 only; on v16 it is not whitelisted (403), so read a party balance as a GL Entry aggregate (§11). The opening entry's key is read from the Journal Entry's `user_remark`, not from the ledger row (v16 leaves GL remarks empty). Creating
a Supplier needs the Purchase Master Manager role. Fixture
`erpnext/__fixtures__/openingEntry.json`.

**ECX7-T1 — registry.** Add `'opening.post'` (v1); ERPNext supported, Odoo pending #1506. V-type.

**ECX7-T2 — failing pgTAP for the proposal (AC-ECX-060).** `supabase/tests/erp_opening_balances.test.sql`:
`AC-ECX-060 given unpaid PMO invoices stamped with erp_opening_amount, pre-cut-over PMO purchases with billed-unpaid amounts, and
claims approved before expenses was enabled and unpaid, propose_opening_balances returns one line per party per domain whose
totals equal the PMO outstanding, and nothing from another org`. → red.

**ECX7-T3 — failing pgTAP for SoD (AC-ECX-061).** Same file:
`AC-ECX-061 the preparer cannot approve their own opening balance; a Project Manager can neither prepare nor approve; an
approved opening is immutable`. → red.

**ECX7-T4 — migration (green).** `0898_erp_opening_balances.sql`: `erp_opening_balances(org_id, binding_id, domain, status
draft|approved|posted|rejected, prepared_by, approved_by check (approved_by <> prepared_by), equity_account (Equity or Temporary balance-sheet leaf only; Employee lines only on Payable, never Receivable; no negative amounts), posting_date,
lines jsonb, posted_ref)`, RLS forced; `propose_opening_balances(p_domain)`, `approve_opening_balance(p_id)` (security
definer, Admin/Finance, preparer ≠ approver), enqueues the outbox row with key `opening:<domain>:<binding_id>` (one per
binding per domain, unique index). Rollback file. V-pg on the file.

**ECX7-T5 — failing shared suite (AC-ECX-062).** `contractSuite/openingPost.suite.ts`:
`AC-ECX-062 an approved receivable opening posts one Opening Entry with one line per customer and the equity counter-line,
balanced, in one POST with submit; a retry after a lost response finds it by key and posts nothing; a rejected post returns the ERP reason in plain
words and leaves the row approved-not-posted`. → red.

**ECX7-T6 — adapter (green).** `erpnext/openingEntryCommand.ts` (shape after `erpnext/imprestPostingCommand.ts`: build body,
lookup by `[company, user_remark]` key on the Journal Entry (never the ledger row) across docstatus 0 and 1, then one POST with `docstatus: 1`; send `company`); dispatch through `adapterSeam/dispatch.ts`.

**ECX7-T7 — failing pgTAP for count-once (AC-ECX-063).** `supabase/tests/erp_opening_count_once.test.sql`:
`AC-ECX-063 after an opening posts, project revenue and project cost are unchanged (opening lines carry no project); the
receivable shown for the customer equals the ERP ledger balance and the PMO invoice's outstanding no longer adds to it`. → red.

**ECX7-T8 — readers (green).** In the receivables reader (`pmo-portal/src/lib/db/revenue.ts:82-83` reads `erp_opening_*`)
and its SQL source, exclude a native invoice's outstanding once its opening line is `posted`; project actuals filter
`is_opening = 'Yes'` explicitly (defensive, PD-ECX-3). V-pg, V-unit on `src/lib/db/revenue.test.ts`.

**ECX7-T9 — UI (AC-ECX-064).** `pmo-portal/src/components/integrations/OpeningBalanceReview.tsx` with RTL test
`OpeningBalanceReview.test.tsx`: `AC-ECX-064 Finance sees per-domain totals and lines, picks the equity account and posting
date, prepares; a second Admin/Finance approves; the preparer sees no approve button`. `<CanWrite>`/`can()` for UX; RLS is the
authority. Expense copy "carried in the opening balance" in `pages/expenses/ExpensePostingsCard.tsx` changes to the posted
state. V-unit, V-type, V-guards.

### ECX-8 — Settle pre-cut-over balances against the opening entry (money, ships alone; waits on OQ-ECX-4)

**Bed findings (§10):** the Payment Entry is one POST with `docstatus: 1`, with `paid_to`, equal paid and received amounts and the
right party type sent by PMO. Prefer allocating against the opening Journal Entry (`references`) up to its outstanding and
leaving any excess unallocated. On v16 the balance read-back is a GL Entry sum (debit minus credit), not `get_balance_on` (refused there). The ERP does **not** refuse overpayment: PMO caps at the party's opening outstanding.
`reference_no` is not unique (lookup `[company, reference_no]` before create); a bank `paid_from` needs `reference_no` and
`reference_date`.

**ECX8-T1 — registry.** Add `'opening.settle'` (v1); ERPNext supported, Odoo pending #1505. V-type.

**ECX8-T2 — failing pgTAP (AC-ECX-070).** `supabase/tests/process_domain_cutover.test.sql`: `AC-ECX-070 a payment recorded
after cut-over on a pre-cut-over purchase whose opening payable is posted is queued once as an opening settlement; before the
opening posts it stays PMO-only as today (AC-ECA-020 unchanged)`. → red.

**ECX8-T3 — migration (green).** `0899_opening_settlement.sql`: amend `create_payment` (`0481_process_domain_cutover.sql:132`)
so the pre-cut-over branch enqueues `opening.settle` keyed `settle:<payment_id>` when the purchase's vendor line is in a posted
opening; same for expense claim payments. Rollback restores the 0481 body. V-pg.

**ECX8-T4 — failing shared suite (AC-ECX-071).** `contractSuite/openingSettle.suite.ts`: `AC-ECX-071 the settlement posts a
Payment Entry against the vendor (or employee), allocated to the opening entry up to its outstanding and unallocated for any
excess, never above the party's opening outstanding, reduces the opening party balance by exactly the
payment, and a retry posts nothing`. → red; then `erpnext/openingSettleCommand.ts` (green).

### ECX-9 — Bed journey: connect with zero ERP steps (AC-ECX-080)

**ECX9-T1.** Extend `pmo-portal/e2e/serial/AC-ECA-050-connect-empty-erp.spec.ts` via a new
`pmo-portal/e2e/serial/AC-ECX-080-connect-no-erp-steps.spec.ts` reusing `e2e/_connectScenario.ts`: an operational org with
history connects an empty ERPNext company; the Admin sets defaults, creates missing accounts, fills HR details, accepts all,
prepares and a second user approves the opening balances; the goal oracle: the setup checklist shows no outstanding item and
the next purchase and timesheet reach the ERP. Tag `@e2e-isolation` per `docs/e2e-parallel-conventions.md`. V-e2e
`AC-ECX-080` on the bed; CI's release run is the proof.

## 5. Acceptance criteria

| AC | Given / When / Then | Layer |
|---|---|---|
| AC-ECX-001 | Given a locale value instructing a user to act in the ERP that is not allowlisted, when guards run, then they fail; given an allowlist entry whose text no longer matches, then they fail as stale. | unit (guard self-test) |
| AC-ECX-010 | Given a PMO invoice with two candidate ERP invoices, when Finance chooses one in PMO, then exactly that pair is accepted and no ERP screen is referenced. | unit (RTL) |
| AC-ECX-011 | Given a chosen pair, when a Project Manager accepts it, then it is refused; when Finance accepts, then the PMO invoice stops counting. | pgTAP |
| AC-ECX-020 | Given an empty ERP company default and a mirrored account of the right type, when Admin sets it in PMO, then the ERP company holds it once and a retry writes nothing; given the wrong type, then nothing is written. | unit (shared suite) |
| AC-ECX-021 | Given a defaults request, when a non-Admin/Finance or another org sends it, then it is refused. | pgTAP |
| AC-ECX-030 | Given a category with no direct-cost account, when Finance creates it in PMO, then one leaf account exists under the chosen group, the map points at it, a retry links, and no tax, fiscal year or group is created. | unit (shared suite) |
| AC-ECX-030 (reconciliation) | Given a 409 duplicate, when its account is known unusable, then the request is refused in plain words; when it cannot be read back, then the request is held (not refused) and its category stays reserved until the account is linked or an Admin records an audited absence disposition. | unit (ERPNext `accountSend.test.ts`; shared suite for the refusal) |
| AC-ECX-031 | Given an account send request, when the caller is not Admin/Finance or the parent is not a mirrored group of the bound company, then it is refused. | pgTAP |
| AC-ECX-040 | Given the year ends within 45 days and no next year exists, when the sweep runs twice, then one next fiscal year exists. | Deno (shipped sweep) |
| AC-ECX-050 | Given an active person with HR details in PMO, when sends run, then one ERP employee exists linked to them; given a person without them, then it is held with a PMO instruction and nothing is invented. | unit (shared suite) |
| AC-ECX-051 | Given HR details, when another role or org reads them, then nothing is returned. | pgTAP |
| AC-ECX-060 | Given unpaid pre-cut-over invoices, bills and claims, when an opening is proposed, then its totals per party equal the PMO outstanding for that org only. | pgTAP |
| AC-ECX-061 | Given a prepared opening, when its preparer approves, then it is refused; a second Admin/Finance can approve; approved rows are immutable. | pgTAP |
| AC-ECX-062 | Given an approved opening, when it posts, then the ERP holds one balanced Opening Entry; a retry posts nothing; a rejection is shown in plain words. | unit (shared suite) |
| AC-ECX-063 | Given a posted opening, when figures are read, then project revenue/cost are unchanged and each party's receivable/payable equals the ERP balance with no PMO outstanding added. | pgTAP |
| AC-ECX-064 | Given the opening review, when the preparer views it, then no approve action is shown; a second user approves. | unit (RTL) |
| AC-ECX-070 | Given a pre-cut-over purchase with a posted opening payable, when a payment is recorded in PMO, then one settlement is queued; without a posted opening, then nothing is queued. | pgTAP |
| AC-ECX-071 | Given a queued settlement, when it posts, then the vendor's ERP balance drops by the payment and a retry posts nothing. | unit (shared suite) |
| AC-ECX-080 | Given an operational org and an empty ERP, when the Admin completes setup in PMO only, then the checklist is clear and the next purchase and timesheet reach the ERP. | e2e (bed) |

## 6. Money and tenancy risks

- **Double counting.** (a) Opening receivables + PMO invoice outstanding: ECX7-T8 stops counting the PMO outstanding once its
  opening line posts (AC-ECX-063). (b) Opening lines in project figures: they carry no project and readers filter
  `is_opening = 'Yes'` (PD-ECX-3). (c) A pre-cut-over payment posted both as an opening reduction and as an invoice payment:
  ECX-8 posts only party-level settlements allocated to the opening entry (never to an invoice), capped at the party's opening outstanding, keyed per payment (AC-ECX-071). (d) Pairs resolved in
  ECX-2 reuse the shipped count-once rule (`0498`). (e) The opening is unique per binding per domain (unique key + outbox key),
  so a second connect run cannot post it twice.
- **Tenancy (`org_id`).** Every new RPC resolves org from `auth_org_id()`; service-role writers (sweep, sends) scope by the
  binding's org (NFR-ECA-003). Each pgTAP file includes a two-org case (AC-ECX-021, 031, 051, 060).
- **Separation of duties.** Opening balances: preparer ≠ approver in SQL (AC-ECX-061). Pair acceptance stays Admin/Finance
  (AC-ECX-011). Accounting configuration (ECX-3/4/5) is Admin/Finance only; it posts no money.
- **Personal data.** ECX-6 stores birth date and gender; separate table, Admin + self only, never in list views or logs, sent
  only to the bound ERP (AC-ECX-051). security-auditor reviews.
- **Money-tier slices:** ECX-2 (counting), ECX-7, ECX-8. ECX-7 and ECX-8 ship alone (CLAUDE.md batching rule).

## 7. GAPS — steps that still need a person in the ERP

| GAP | Today | How PMO removes it | Slice |
|---|---|---|---|
| G-1 Add employees in the ERP | `administration.json:299` | HR details held in PMO, employee sent | ECX-6 (OQ-ECX-2) |
| G-2 Accountant adds direct-cost accounts | `ErpSetupChecklist.tsx:227` | PMO creates leaf accounts under a chosen group | ECX-4 (OQ-ECX-1) |
| G-3 Set company default accounts / cost centre in the ERP | `erpSetupIncompleteness.ts:4-11` | PMO writes the company defaults | ECX-3 |
| G-4 Open the ERP to tell ambiguous invoices apart | `administration.json:394` | Candidates shown and chosen in PMO | ECX-2 |
| G-5 Accountant posts the receivables opening entry | `0275_native_revenue.sql:64` | PMO prepares, a second person approves, PMO posts | ECX-7 |
| G-6 Payables for pre-cut-over bills never reach the ERP | `0481_process_domain_cutover.sql:14` | Same opening, then settlements | ECX-7, ECX-8 |
| G-7 Operator carries pre-enable claim approvals in the opening | spec FR-ECA-030 | Same opening, then settlements | ECX-7, ECX-8 |
| G-8 Create next fiscal year | no writer | Sweep keeps one year ahead; **Gap:** Fiscal Year create needs System Manager on the ERP, so an integration user without it gets 403 and the checklist shows an Operator task (never a client step) | ECX-5 |
| G-9 Taxes / tax templates for an empty ERP | never created by PMO (spec FR-ECA-020) | **Not a client step; Operator onboarding** — OQ-ECX-3 (section 8) | — |
| G-10 Chart of accounts and company creation on a brand-new ERP | ERP setup wizard | **Not a client step; Operator onboarding** — OQ-ECX-3 (section 8) | — |

## 8. OPEN OWNER QUESTIONS (default taken if unanswered; not decided here)

| # | Question | Default and why |
|---|---|---|
| **OQ-ECX-1** | DD-SETUP-1 says the chart belongs to the accountant. Under "clients never work in the ERP", may PMO create direct-cost accounts? | **Answered yes (orchestrator, 2026-11-16).** **Yes, leaf accounts only, under a group the Finance user picks, Admin/Finance only.** It removes G-2 while never shaping the chart's structure; groups, taxes and fiscal setup stay untouched. Answered, so ECX-4 may start. |
| **OQ-ECX-2** | May PMO hold a person's birth date and gender so it can create the ERP employee? | **Yes, optional, in a separate Admin + self table, sent only to the bound ERP.** Without it G-1 cannot close for ERPNext; PMO never invents values. ECX-6 does not start until answered. |
| **OQ-ECX-3** | Who sets up taxes, the chart and the company on a brand-new ERP (G-9, G-10)? | **Resolved:** the Operator, at onboarding; see the paragraph below the table. |
| **OQ-ECX-4** | OQ-ECA-1 said pre-cut-over purchases finish in PMO only. Once their opening is posted, should later payments settle the ERP balance? | **Yes, as party-level settlements (ECX-8).** Otherwise the ERP shows vendors still owed after PMO paid them. Before the opening posts, OQ-ECA-1 stays as shipped. |
| **OQ-ECX-5** | Opening posting date: the cut-over date, or a date Finance picks? | **Finance picks, defaulting to the day before cut-over**, inside an open fiscal year (ECX-5 makes one exist). |

**OQ-ECX-3 resolved (G-9, G-10).** Setting up taxes, the chart of accounts and the company on a brand-new ERP is not a client step and is not in this plan. It is the Operator's one-time provisioning at onboarding, done by platform staff and never asked of a client user. A later Operator runbook ticket covers it.

## 9. Live-ERP bed discovery (done locally 2026-11-16; results in section 10)

ECX-3 (Company default fields and account types), ECX-4 (Account create rules), ECX-5 (Fiscal Year create/overlap), ECX-6
(Employee mandatory fields and gender values), ECX-7 (Opening Entry voucher, party lines, mirror `is_opening`), ECX-8 (Payment
Entry against a party with no invoice). Each T0 task records synthetic fixtures; the shared suites assert against them.
ECX-1, ECX-2 need no bed; ECX-9 runs on the bed by definition.

## 10. Bed findings (2026-11-16)

Local ERPNext dev bed, v15.94.3, Standard chart, IDR; synthetic fixtures under `pmo-portal/src/lib/adapterSeam/erpnext/__fixtures__/`
(`companyDefaults`, `accountCreate`, `fiscalYear`, `employeeCreate`, `openingEntry`, `openingSettle`). Probed with a throwaway
company and two throwaway API users, one with System Manager and one without. All refusals are an HTTP status plus a JSON body
whose plain-words text sits inside `_server_messages`. A draft save is permissive; submit is where the ERP checks.

The seven plan corrections:

1. **ECX-3.** The ERP enforces no account type on the Company defaults and no group or company check on `cost_center`. PMO
   filters the picker by type and validates both before the PUT; the adapter refuses before any write.
2. **ECX-4.** `root_type` and `account_type` are optional and `account_type` is not checked against the root. A duplicate
   collides on the full name across any parent, case-insensitive (409). PMO sends `account_name`, `parent_account`, `company` only.
3. **ECX-5.** Fiscal Year create needs System Manager (403 without), a Gap stated in G-8. Overlap answers 409 or 417 by shape.
   Lookup must be by date range and read the company rows, because a global year is invisible to a company child filter.
4. **ECX-6.** Employee has no unique anchor and `company` is silently defaulted; PMO owns an `employee_number` prefix and always
   sends `company`.
5. **ECX-7.** The counter-line is Equity or Temporary only; Employee on a Receivable account is accepted (PMO forbids it);
   create and submit are one POST; `user_remark` is not unique; ledger `voucher_type` reads "Journal Entry"; a cancelled opening
   cannot be deleted.
6. **ECX-8.** Overpayment is not refused (PMO caps it); `reference_no` is not unique; allocating to the opening entry is preferred.
7. **Cross-cutting.** Always send `company`; creating a Supplier needs the Purchase Master Manager role.

Version 16 differences are in §11. Not tested (do not assume): the exact roles of the real client integration user; frozen
accounts and closed fiscal-year periods; multi-currency; Odoo.

## 11. Version 16 differences (2026-11-16)

Bed: local ERPNext v16 bed, erpnext 16.53.0 / frappe 16.54.0 (the runbook said 16.33; the bed is newer). Same six probe sets, same
two API-user role sets (with and without System Manager), same clean-up, under the bed lock. A throwaway company ("ECX Probe Co")
on a bed that already had one other company (shown as "Other Co" in fixtures). Only differences are recorded: in each fixture file
a top-level `v16` block (`bed`, `notes`, `cases[]` = the cases that differ) and `_meta.v16`.
Bed left clean: yes. Both API users, the probe company, every voucher, ledger row, party, employee, fiscal year and helper file
deleted (counts re-read: 0). Correction to the v15 clean-up report above: one stray DRAFT Payment Entry (the "missing company"
probe, created in the bed's default company) was missed on the v15 bed; found and deleted in this pass (probe re-read: 0).

Everything not listed below behaved the same as v15 (same status, exception type and message text; v16 only adds an
`"as_table": false` key per server message and HTML `/desk/...` links instead of `/app/...`).

- **ECX-3 company defaults: identical** in behaviour (no account-type check, no cost-centre group/company check, no System
  Manager needed, null/"" clears). Only text: a stale `modified` message names the document.
- **ECX-4 account create: identical** (28 cases).
- **ECX-5 fiscal year: DIFFERS (looser).** Identical dates for a year of another company: v15 417 "already set in Fiscal Year",
  v16 200. A company-scoped year beside a global year with identical dates: v15 417, v16 200; with partial overlap: 200.
  Unchanged: overlap with a year sharing the same company, or any overlap by a new global year -> 409 NameError (message now
  contains an HTML link); create without System Manager 403; other refusals the same. The v16 bed has global years 2026-2028.
  The lookup rule stands (date range, then inspect the `companies` child rows; the company child filter misses global years).
  Consequence for ECX-5: on v16 a company-scoped year can coexist with a global one, so "an existing overlapping year is
  linked, not duplicated" is decided from the date-range lookup and the year's company rows, never from a 409.
- **ECX-6 employee: identical** (same mandatory set: first_name, gender, date_of_birth, date_of_joining, company; same genders;
  no unique anchor; omitted company still defaults).
- **ECX-7 opening entry: DIFFERS in three ways.**
  1. `erpnext.accounts.utils.get_balance_on` is NOT whitelisted on v16 (403 PermissionError, both users). Read a party balance
     with GET /api/resource/GL Entry, filters [company, account, party_type, party, is_cancelled=0], fields as DICT syntax
     `[{"SUM":"debit","as":"debit"},{"SUM":"credit","as":"credit"}]`; balance = debit - credit (a payable credit is negative:
     same sign and numbers as v15). A SQL function string ("sum(debit) as debit") is refused 417. Works for the user without
     System Manager. Not run on v15.
  2. A group account as counter-line is refused at SAVE (417 "You selected the account group X as Journal Entry Account in row
     2. Please select a single account."); v15 refused it only at submit. Net effect for PMO: none (still refused).
  3. **GL Entry.remarks is EMPTY on v16** for journals (opening and plain), although `user_remark` is stored on the Journal
     Entry. v15 wrote "Note: <user_remark>" into GL remarks. `ledgerFetch.ts` reads GL `remarks` (#1919: vendor/invoice
     reference of a journal): on v16 that read returns "". The opening-entry key and any journal reference must be read from
     the Journal Entry's `user_remark`, not from the GL row. This affects code already shipped, not only ECX: filed as ticket
     #2356 (journal ledger rows without remarks on newer 16; an upgrade risk, production rows carry remarks today). GL rows also
     show a new `voucher_subtype` ("Opening Entry"); `voucher_type` stays "Journal Entry", `is_opening` Yes.
  Same as v15: submit-time checks (balance, P&L ban, fiscal year), Equity and Temporary counter-lines accepted, Employee on
  Receivable accepted, negative amounts and duplicate user_remark accepted, one-shot POST with docstatus 1 leaves no draft on
  rejection, cancelled entries not deletable, Supplier create needs Purchase Master Manager.
- **ECX-8 settlement: identical in behaviour** (unallocated and JE-allocated settlement, caps, overpay not refused, Employee
  party, reference_no rules, save-lax/submit-strict split; -5,000,000 -> -3,000,000, supplier B +400,000, employee -200,000).
  Read-back must use the GL aggregate (see ECX-7 point 1). Only text: auto remarks read "Amount IDR 2000000.0 paid to <party>"
  and an allocated payment adds "adjusted against Journal Entry <name>".

Still not tested: the real client integration user's exact roles; frozen accounts / closed periods; multi-currency; Odoo; the v15
read-back by GL aggregate.
