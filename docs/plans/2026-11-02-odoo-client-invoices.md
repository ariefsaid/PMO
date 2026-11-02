# Plan — Odoo: client invoices, collections and tax documents (O3, #1506)

- **Spec:** `docs/specs/odoo-client-invoices.spec.md` (IDs `FR-OCI`, `AC-OCI`, `DD-OCI`, `OQ-OCI`, `V-OCI`). Owner sign-off of the spec and its §0 defaults is required before C1 (C0 is evidence only and may start earlier). Defaults mirror ERPNext (owner ruling 2026-10-31).
- **Route:** #1481, item O3 of `docs/plans/2026-10-30-epc-odoo-build-route.md`. **Blocked by** O1 (#1504, shipped on `dev`); the time-and-materials slice (C4b) is also blocked by #1514. **Executor:** Director-dispatched per slice (money/SoD); every slice that commits money ships alone (own branch, own PR, never batched).
- **Companion plans (names reused, never rebuilt):** `docs/plans/2026-10-31-odoo-connect-master-data.md` (O1: `odoo/client.ts`, `connectAdapter.ts`, `fakeOdoo.ts`, `sweep.ts`, `odooClientForOrg`, `odooSweep`, master-record mirror, shared resolver), `docs/plans/2026-11-02-odoo-purchase-to-payment.md` (O2: the tier-agnostic dispatch gates, the Odoo outbox resolver registration, the `journal` master kind and payment-journal default, the held-row resolution RPC, the status/derivation pattern), `docs/specs/erp-connect-anytime.spec.md` (ECA: `connect/workflows.ts`, `contractSuite/*`, `ErpHarness`).
- **Migration numbers: 0510–0514 only** (§3). Highest on `dev` at writing: 0496 (O2 holds 0505–0509). Slots a slice does not need are returned to the Director, never reused. Collision: `scripts/renumber-migration.sh <old> <new>`.
- **Files cited as existing were read at `origin/dev` (`142680e7c`) on 2026-11-02.** Names marked *(new)* do not exist yet. Where the spec says "builder confirms against the shipped DDL", the first task of the slice does that and records the answer in the PR body before any migration is written.
- **Order against O2.** C0 and C1 are independent of O2's merge. C2 reuses O2's generalised gates and Odoo outbox registration: **if O2's P2 has not merged when C2 starts, C2 does not redo it; it waits** (a revenue gate wired for ERPNext only fails open for Odoo). Every task that touches a file O2 also creates says "(O2)" and extends it, never duplicates it.

---

## 0. Plan-level decisions (`PD-#`)

- **PD-1 — Gates are shared, revenue adds only its own.** O2's P2 made `authGuard`, link ownership, `projectGateGuard`, the SoD guards and the outbox resolver tier-agnostic. C2 adds only what revenue needs on top: the `submit_sales_invoice` approver≠author rule evaluated for tier `odoo`, the `process_gates` read, and the receipt same-scope check. Deliverable: a test per gate showing a tier `odoo` revenue command is refused exactly as an ERPNext one, with the ERPNext suites as the regression proof.
- **PD-2 — One adapter per domain on the shipped seam.** `odoo/revenueAdapter.ts` *(new)* implements `Adapter` for domain `revenue` (kinds `sales-invoice`, `incoming-payment`); `capabilityMap` gains `revenue` only when the org employs it.
- **PD-3 — The adapter is a state machine over Odoo state.** `nextStep(kind, observed)` is a pure, exhaustively tested function (`odoo/revenue/nextStep.ts` *(new)*); the I/O wrapper is thin (DD-OCI-3).
- **PD-4 — Keys.** `si:<pmo invoice id>`, `ip:<pmo receipt id>`; UUID-validated like the shipped keys. The invoice key is the same whether the invoice is ordinary, a claim, a down payment or a T&M claim (one invoice record → one Odoo invoice, ever).
- **PD-5 — Anchor placement is deferred to C0.** Code reads anchor field names from one table `ODOO_REVENUE_ANCHORS` (`odoo/revenue/anchors.ts` *(new)*), filled from V-OCI2. No anchor name is written anywhere else.
- **PD-6 — The command builder transports, never recomputes.** `odoo/revenue/invoiceBody.ts` *(new)* maps the PMO invoice record (already fixed by the claim/draft) to Odoo lines. BoQ, assessment, recovery and VAT logic stay where they are; the builder is tested to produce the lines it is given, byte for byte, and a recompute is a failing test (AC-OCI-023).
- **PD-7 — Bed tests are gated like O1's** (Deno `*.bed.test.ts`, `ignore` on the *dependency* variables the O1 bed tests use, never on `CI`), run under `scripts/with-odoo-lock.sh` (and `with-db-lock.sh` after it when the local Supabase stack is needed: order **odoo → db**). The curated e2e journey is gated on the same dependencies plus the served-function dependency, tagged per `docs/e2e-parallel-conventions.md`, with an allowlist entry and restore path in `scripts/check-e2e-skips.mjs` ("runs when the Odoo bed is configured in the integration job").
- **PD-8 — Mutation checks are tasks.** Each money rule (invoice approver≠author, held-not-reissued, explicit-key reuse, one-receipt-per-invoice cap, over-receipt refusal, explicit-empty-tax-set, unsigned T&M line, tax-document claim before proof) has a named task that breaks the rule, sees red, and restores. Evidence is pasted in the PR body.
- **PD-9 — Tax documents: capability starts unavailable.** C7 is the only slice that can flip `tax-document.read`, and only with the C0 verdicts in hand. If V-OCI9 finds nothing exposed, C7 ships the absence (AC-OCI-080/082b), returns 0514, and the spec records the finding. No screen text is written for a capability that is still `unavailable` (FR-OCI-090).
- **PD-10 — Public-repo hygiene.** Fixtures use invented clients, amounts and hosts; no prospect name; findings that describe an Odoo behaviour are fine, findings that describe an unpatched weakness of this repo go to `/Users/ariefsaid/Coding/PMO/docs/private/reviews/`.

## 1. Spec deltas to absorb during build

| # | Where | Note |
|---|---|---|
| SD-1 | `connect/workflows.ts` `invoice.push` summary "send a sales invoice to the ERP" | Odoo pushes the receipt as its own command (DD-OCI-2); the shared suite asserts only the preflight; no summary change, no version bump. |
| SD-2 | `odoo/workflowDeclarations.ts` (`ODOO_REVENUE = 1506`) | C9 flips `invoice.push` and `receipt.read` to `supported` at the suites' current version. `invoice.pair-existing` and `cutover.revenue` have **no shared suite on `dev` today** (ERPNext's own `invoice.pair-existing` is `pending` on #1602): they stay `pending` on #1602 unless the suites exist when C9 starts, then Odoo passes them too (the same task list as O2's P9). |
| SD-3 | Research claim: Odoo "generates DJP CSV / Coretax XML from customer invoices" (`docs/research/2026-10-30-odoo20-native-coverage.md`) | Partly wrong on the bed (bed report row 8): only the Coretax module exists in v20, installed as a `l10n_id` dependency. The route says not to claim tax-document capability until tested, so C0's V-OCI9–11 decide and the research note is corrected by C0-T12. |
| SD-4 | O2's journal kind and payment-journal default | Receipts reuse them (OQ-OCI-9). If O2's default is outbound-only, 0512 adds the receipt key; the builder confirms in C5-T1. |
| SD-5 | `ErpHarness.pushRevenue` scenarios | Cover cross-tenant preflight only. The Odoo harness half must also expose the claim/receipt build functions so AC-OCI-011/020/042 run against the fake; added in C1, not in the shared interface (no version bump). |

## 2. Design

### 2.1 Shape

`PMO invoice record` → `adapter-dispatch` (guards → outbox claim → `revenueAdapter`) → Odoo (create → post; payment create → post → reconcile) → read-back → mirror (`sales_invoices`, `incoming_payments`) → derived status. Inbound: the O1 sweep gains revenue passes (invoices, credit notes, incoming payments, census) applied by a service-only function. The shared seam, outbox and sweep are reused; the Odoo vocabulary stays under `adapterSeam/odoo/**` and the Odoo edge helpers.

### 2.2 File map and slice ownership

| Path | New / extends | Slice |
|---|---|---|
| `scripts/odoo-probe.mjs`, `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §10, `pmo-portal/src/lib/adapterSeam/odoo/__fixtures__/revenue.ts` *(new)* | extends / extends / new | C0 |
| `pmo-portal/src/lib/adapterSeam/odoo/revenue/{anchors,nextStep,invoiceBody,receiptBody,moneyHeader,status,taxValidate,errors,constants}.ts` and `.test.ts` *(new)* | new | C1 (builders) |
| `pmo-portal/src/lib/adapterSeam/odoo/fakeOdoo.ts`, `contract.harness.ts` | extends (O2 extended them for purchase) | C1 |
| `pmo-portal/src/lib/adapterSeam/odoo/revenueAdapter.ts` and `.test.ts` *(new)* | new | C3, C4, C5 |
| `supabase/functions/adapter-dispatch/index.ts`, `authGuard.ts`, `projectGateGuard.ts`, `moneyOutboxDeps.ts` | extends | C2 |
| `supabase/functions/adapter-dispatch/odooRevenueGates.test.ts`, `odooInvoiceSodGate.served.test.ts`, `odooRevenue.bed.test.ts` *(new)* | new | C2, C3–C5 |
| `supabase/functions/_shared/odooRevenueFeed.ts` and `.test.ts`, `odooSweep.ts` | new / extends | C6 |
| `supabase/migrations/051{0..4}_*.sql` + `rollback/*_down.sql` | new | C2, C3, C5, C6, C7 |
| `supabase/tests/odoo_revenue_*.test.sql` *(new)* | new | C2, C3, C5, C6 |
| `pmo-portal/pages/SalesInvoices.tsx`, `pages/__tests__/SalesInvoices.*.test.tsx`, `src/components/revenue/OdooOutcome.tsx` *(new)* | extends / new | C8 |
| `pmo-portal/public/locales/{en,id}/*.json` | extends (both) | C8 |
| `pmo-portal/src/lib/adapterSeam/odoo/workflowDeclarations.ts`, `contractSuite/parity.test.ts` | extends | C9 |
| `pmo-portal/e2e/AC-OCI-100-odoo-client-invoice-to-receipt.spec.ts` *(new)*, `scripts/check-e2e-skips.mjs` | new / extends | C9 |

### 2.3 Gate evidence and test conventions

Every slice ends with (CLAUDE.md "Local final gate"), from `/Users/ariefsaid/orca/workspaces/PMO/<worktree>/pmo-portal`: `npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <touched files>`; the directly touched Vitest files (`npx vitest run <files>`; never the full suite, never `--changed`); touched Deno tests (`scripts/deno-test-edge-fns.sh` shows the invocation; edge-fn tests import the SHIPPED handler from `./index.ts` and mock `globalThis.fetch`, `scripts/check-edge-fn-test-binding.mjs`); touched pgTAP only, reset and test in **one** hold:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`, grepping the output for `Parse errors`; `node --test scripts/*.test.mjs` if a script was touched; `scripts/ux-proof.sh <route>` for UI. Paste output bodies, not exit codes.

**Known CI traps checked per migration slice:** pgTAP 0137 (service_role grants on new functions), 0136 (side-mirror inventory), 0178 (anon-executable SECURITY DEFINER allow-list), the isolation-probe denominator, i18n keys in both locales, sibling suites that mock `repositories`/`SalesInvoices` (grep before finishing; the shipped `SalesInvoices.efaktur.test.tsx` and the `0275_native_revenue_*` pgTAP files are the first to check).

**Bed tests (layer B):** Deno `*.bed.test.ts` beside the function they exercise, gated on the bed's dependency variables as in the O1 plan (S0/S8), run with the O1 invocation:
`scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; <bed variables from the O1 plan> deno test --allow-env --allow-net --allow-read <file>'`. Never read the env file; the lock script and the O1 plan name what is exported. The bed needs `account project analytic l10n_id` installed, one customer, one costed product, one down-payment product whose income account is a liability account, one cost account, and the Indonesian sale taxes.

**Fake Odoo (layer U):** `odoo/fakeOdoo.ts` records every call and can inject a fault at a named step (`after-create`, `after-post`, `after-reconcile`, `lost-response`); the C1 additions are the `account.move` (customer), `account.payment` (inbound) and register-wizard behaviours verified in C0.

---

## 3. Slice map

| Slice | Contents | ACs owned | Migration | Blocked by | Executor | Ships alone? |
|---|---|---|---|---|---|---|
| **C0 — Close the bed claims** | V-OCI1–15 on the stock bed, fixtures, probe cases, minimal-group runbook note, correction of the research note | (evidence for all) | none | O1 | Orca worker | n/a (no product code) |
| **C1 — Contract first, pure parts** | anchors table, `nextStep`, tax validation, money-header read-back, status derivation, invoice and receipt body builders (transport, not recompute), fake Odoo revenue models, harness methods; declarations stay `pending` | 013, 014, 015, 016, 023, 041, 045, 046, 051, 063, 071 | none | C0 | Orca worker, opus-grade; Director review | yes (pure, no money path change) |
| **C2 — Enablement + revenue gates + outbox wiring** | employ `revenue` under `odoo` (incl. `cutover.revenue` stranded-drafts refusal); registry entry; approver≠author for Odoo invoices; `process_gates`; receipt same-scope; Odoo probe closures | 001, 002, 003, 004, 005, 050, 051, 052 (P half) | **0510** | C1; **O2 P2 merged** | **Director** (money-path gates) | **yes** |
| **C3 — Invoice push (ordinary)** | create+post, explicit taxes, customer reference, cost account, read-back compare, needs-attention, mirror columns + guard | 010, 011, 012, 030, 031, 032, 061 | **0511** | C2 | **Director** | **yes** |
| **C4 — Billing claims: progress, down payment, recovery** | claim lines transported exactly; DP item/account check; recovery negative line; work-order PO reference | 020, 021, 022, 023 | none | C3 | **Director** | **yes** |
| **C4b — Time-and-materials claims** | T&M claim lines through the same command | 024 | none | C4; **#1514 merged** | **Director** | **yes** |
| **C5 — Customer receipt push** | payment create+post+reconcile, held-on-inconclusive, journal default, tax-prepaid account and withheld shape, recorder from JWT | 040, 042, 043, 044 (or 044b), 046, 052 (D half) | **0512** | C3 | **Director** | **yes** |
| **C6 — Inbound feed, status, credit notes, pair-existing, census** | revenue passes in the sweep, page-apply RPC, tombstones, credit-note link, held-row RPC extended | 060, 062, 070, 072, 073, 074, 075 | **0513** | C2 (needs C3–C5 only for the e2e) | Orca worker; **security-auditor mandatory** (service-role writers, tenancy); DB lock | yes |
| **C7 — Tax documents** | e-Faktur manual record proven on the Odoo tier; read-only Odoo-held facts and optional export **only as C0 proved**; capability flip or documented absence | 080, 081, 082 (or 082b), 083, 084 | **0514** (returned unused if V-OCI9 finds nothing) | C3, C0 verdicts | Orca worker; Director reviews the capability claim | yes |
| **C8 — PMO screens** | outcome class, as-of age, held list, receipt figures, credit notes, journal picker, tax-document block as C7 allows, i18n | 090, 091, 092 | none | C3–C7 | Orca UI worker (impeccable + taste + ui-ux-pro-max, rendered review once) | may batch with C9 docs only |
| **C9 — Declarations, parity, vocabulary guard, acceptance** | flip `invoice.push` and `receipt.read` (and the two others if their suites exist), parity test, vocabulary guard, curated e2e, bed composite, runbook, backlog/roadmap update | 093, 094, 100 | none | C3–C8 | **Director** | yes |

**Slice count: 11** (C0–C9 plus C4b). Migration use: **0510** C2, **0511** C3, **0512** C5, **0513** C6, **0514** C7 (conditional). Numbers are fixed here so parallel builds cannot collide; the order they merge in is C2 → C3 → C5 → C6 → C7, so the Director renumbers nothing unless another lane takes a slot first (check `ls supabase/migrations | tail` at branch time).

Dependency order: C0 → C1 → (O2 P2) → C2 → C3 → (C4, C5 in parallel branches; C6 in parallel) → C4b (after #1514) → C7 → C8 → C9. At most two heavy loads at once (DB, bed, e2e): C6 (pgTAP) may run beside C4 or C5 (Deno + bed), never beside another bed/DB lane.

**Money slices (C2–C5, C4b) are never batched into one PR** (repo rule: money, SoD and auth ship alone). C0, C1, C6, C7, C8 may be batched with each other per the batch rule only if the Director chooses; C6 includes service-role writers and ships alone in practice.

---

## C0 — Close the bed claims (Orca worker; no product code)

Each task adds one case to `scripts/odoo-probe.mjs` (claim id, status, response **shape** only), runs it under `scripts/with-odoo-lock.sh`, appends the verdict to `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §10 "O3 findings", and adds a synthetic shape sample to `pmo-portal/src/lib/adapterSeam/odoo/__fixtures__/revenue.ts` where a slice needs it. Verify: `scripts/with-odoo-lock.sh node scripts/odoo-probe.mjs 2>&1 | grep '<claim id>'`. Never print a key, host or database name in a verdict.

- **C0-T1 (V-OCI1)** customer invoice create with line tuples → `action_post`; read `state`, `name`, `amount_total`; empty vs explicit `tax_ids` against a product with a default tax; a negative-price line; a zero-total post.
- **C0-T2 (V-OCI2)** for invoice and inbound payment: write a probe string into each candidate anchor field, post, read back, `search_read` with `ilike`; edit it as a second user and record whether a UI user can. Verdict: the `ODOO_REVENUE_ANCHORS` table. Also: which of `ref` / `payment_reference` / `invoice_origin` prints as the client's PO.
- **C0-T3 (V-OCI3)** line-level `account_id` override and a product with a distinct income account; read-back of the posted line's account.
- **C0-T4 (V-OCI4)** `analytic_distribution` on positive and negative invoice lines, surviving post.
- **C0-T5 (V-OCI5)** Indonesian sale taxes: PPN output 11%, `price_include`, a reduced-base invoice; `amount_untaxed/tax/total/residual` to the cent.
- **C0-T6 (V-OCI6)** double `action_post`; `payment_state` and `amount_residual` after post.
- **C0-T7 (V-OCI7)** inbound payment create, `action_post`, reconcile via the register wizard or `reconcile`; `payment_state`/`amount_residual` afterwards, partial, overpay, `in_payment`.
- **C0-T8 (V-OCI8)** client-withheld tax: register wizard with `payment_difference_handling = reconcile` and a write-off account; resulting lines; residual zero. **Stop rule:** if the stock calls cannot do it, record "unavailable" and the spec's AC-OCI-044b applies.
- **C0-T9 (V-OCI9)** what a stock read of a posted Indonesian customer invoice exposes of the tax invoice (number fields, status, transaction code), whether a number is assigned before any export, and whether any of it exists on Community. Record the field names in the verdict only (they go under `adapterSeam/odoo/**` later).
- **C0-T10 (V-OCI10, V-OCI11)** whether a stock call produces the Coretax export for one invoice, its return value, the wizard need, the failure body for missing mandatory tax data, content type and size, retrieval via `ir.attachment`, and the minimal user's access.
- **C0-T11 (V-OCI12, V-OCI13)** invoice print via a model call (expected: no); `write_date` shape and ordering on `account.move`/`account.payment`, the sweep filters, a credit note's `reversed_entry_id`; keyset stability at 200/1000.
- **C0-T12 (V-OCI14, V-OCI15)** the minimal service-user group set that passes C0-T1…T11 (extends the runbook note, NFR-ODC-003); error body shapes for a validation failure on each call.
- **C0-T13** update spec §9 with the verdicts and any deviation from a spec FR as a numbered spec delta in §1 above (Director signs); correct the Coretax claim in `docs/research/2026-10-30-odoo20-native-coverage.md` per SD-3. **Stop rule:** if V-OCI1, V-OCI7 or V-OCI3 shows a required call cannot be made with stock models, escalate to the Director before C1; do not design a workaround (NFR-OCI-008).

---

## C1 — Contract first: pure parts, fake Odoo, harness (Orca worker, opus-grade)

ACs: 013, 014, 015, 016, 023, 041, 045, 046, 051, 063, 071 (logic halves). No dispatch or DB change. Declarations stay `pending`.

- **C1-T1 (red→green)** `odoo/revenue/anchors.ts` + test: the table filled from V-OCI2; a test asserts no anchor is a business field (customer reference, number) and every anchor is read through the table.
- **C1-T2 (red→green)** `odoo/revenue/nextStep.ts` + test (AC-OCI-011/042 logic): exhaustive table over `observed ∈ {absent, draft-with-anchor, posted-with-anchor, payment-created, payment-posted, payment-reconciled, state-unreadable}` for both kinds → `create | post | reconcile | adopt | hold | wait`. A payment kind never returns `create` on `absent` after the recovery window (it returns `hold`).
- **C1-T3 (red→green)** `odoo/revenue/taxValidate.ts` + test (AC-OCI-015): from a mirrored tax directory fixture, flag on → default sales tax validated (active, company, sale scope, PPN output); flag off → explicit empty set; refusals name the tax, never the company or an account.
- **C1-T4 (red→green)** `odoo/revenue/invoiceBody.ts` + test (AC-OCI-023, 014): the PMO invoice record in, Odoo create payload out: partner, lines (quantity, price, mapped unit, tax ids), `analytic_distribution` on every line including negative lines, customer reference per FR-OCI-010's resolution order, **no due date, no received date**. A test asserts the lines equal the record's lines exactly (no recomputation) and a refusal for unmapped item/unit/client or an unresolvable income account (AC-OCI-012 logic). Down-payment account check against the mirrored directory (AC-OCI-022 logic).
- **C1-T5 (red→green)** `odoo/revenue/moneyHeader.ts` + test (AC-OCI-013, 016): read-back → `{untaxed, tax, total, outstanding}`; a header missing any part writes none; the mismatch rule (> smallest currency unit → needs-attention reason code); cost-account-missing check (AC-OCI-030 logic).
- **C1-T6 (red→green)** `odoo/revenue/receiptBody.ts` + test (AC-OCI-041, 045, 046): one invoice, `0 < amount ≤ outstanding`, company currency, journal from default or override, memo carries the anchor; withheld shape (cash + withheld = settled, bukti-potong number, same-currency, tax-prepaid account present) with each refusal before any write; recorder never read from the payload.
- **C1-T7 (red→green)** `odoo/revenue/status.ts` + test (AC-OCI-071): invoice, credit-note and payment state tables; cancelled marked not deleted; payment direction classification shares the existing `classifyPayment` expectations (inbound → receipt, outbound → vendor payment, unrecognised/blank/absent → skipped).
- **C1-T8 (red→green)** `odoo/revenue/errors.ts`, `constants.ts` + tests (AC-OCI-061 logic, 063): classification table (timeout/5xx → pending, 429 → retry-then-pending, validation → `commit-rejected` with a user-safe reason, never an Odoo body); one assertion per money-path numeric relationship for the Odoo constants.
- **C1-T9 (red→green)** extend `odoo/fakeOdoo.ts` with `account.move` (customer), `account.payment` (inbound), the register wizard and named fault injection; extend `odoo/contract.harness.ts` so `pushRevenue` and `classifyPayment` run for tier `odoo`; run `contractSuite` `invoicePushSuite` and `receiptReadSuite` against it **red-then-green** (the declarations still say `pending`; the suites run through `odoo/contract.test.ts` with an explicit local list, not through the declaration).
- Final gate (Vitest on the new files and `odoo/contract.test.ts`, typecheck, lint, `check:guards`) + Director review. No review battery (no money path change).

## C2 — Enablement, revenue gates, outbox wiring (Director-dispatched; ships alone)

ACs: 001, 002, 003, 004, 005, 050, 051, 052 (P half). Migration **0510**.

- **C2-T1** read O2's merged gate generalisation and the shipped revenue guards; record in the PR body which of FR-OCI-004's five gates were already tier-agnostic and which this slice changes. **Precondition:** O2 P2 is merged; if not, stop and tell the Director.
- **C2-T2 (red)** `supabase/tests/odoo_revenue_enable.test.sql`: for each role and an Operator, the employ-revenue verb under a user JWT (AC-OCI-004); an org with an active ERPNext binding is refused; an org with PMO draft invoices is refused with a count (`cutover.revenue`, AC-OCI-002 P half); two concurrent claims for one key with `tier = 'odoo'` revenue kinds, one proceeds (AC-OCI-060).
- **C2-T3 (green)** `supabase/migrations/0510_odoo_revenue_enable.sql` + `rollback/0510_odoo_revenue_enable_down.sql`; confirm and widen only the tier/kind CHECKs the DDL requires; definers added to the 0178 allow-list and the 0136/0137 inventories.
- **C2-T4 (red)** `supabase/functions/adapter-dispatch/odooRevenueGates.test.ts` (D): a tier `odoo` revenue command is refused exactly as the ERPNext twin for: not activated, kill-switch off, snapshot missing `account.payment`, cross-org customer/project/work order/invoice, absent customer, `require_project_on_si` on with no project (AC-OCI-001, 003, 005), zero Odoo calls each (the fake records calls).
- **C2-T5 (green)** register the Odoo revenue resolver and outbox resolver in `adapter-dispatch/index.ts` (the registry O2 opened); evaluate the project gate and `process_gates` for tier `odoo`; refusals before the outbox row. ERPNext suites (`dispatchGateWiring.test.ts`, `projectGateGuard.test.ts`, `pmoNativeRevenue.test.ts`) re-run green as the regression proof.
- **C2-T6 (red→green)** `odooInvoiceSodGate.served.test.ts` (D, modelled on the shipped served SoD tests; AC-OCI-050, 051): author and approver under their own JWTs, with a payload claiming a different approver; only the different user succeeds, the approver recorded is the JWT subject, a refused approval leaves no outbox row and no Odoo call; roles equal the ERPNext set. **Mutation check (PD-8):** set the gate to allow → red; restore.
- **C2-T7 (P)** extend the shipped `submit_sales_invoice` pgTAP proof (cited by file in the PR body) with a tier `odoo` invoice: self-approval rejected `sod-self-approval`, cross-user approval permitted.
- **C2-T8 (P)** held-row resolution for the revenue kinds (the O2 RPC extended in C6; here assert only that creator, engineer, Finance and Admin are refused/allowed per FR-OCI-063 if the RPC already covers the kinds; otherwise mark AC-OCI-052's P half to C6).
- **C2-T9 (bed)** AC-OCI-001 secondary: the stock bed with the minimal user is not wrongly refused by the capability check.
- Final gate (touched pgTAP under the lock, Deno on the touched dispatch tests) + review battery (security-auditor mandatory: this slice changes the money path's gates for both tiers).

## C3 — Invoice push, ordinary (Director-dispatched; ships alone)

ACs: 010, 011, 012, 030, 031, 032, 061. Migration **0511**.

- **C3-T1** read the shipped `sales_invoices` / `incoming_payments` DDL and revenue mirror guard; record in the PR body what 0511 must add for an Odoo fact (state, tombstone, mismatch flag, credit-note link, needs-attention reason).
- **C3-T2 (red)** `supabase/tests/odoo_revenue_mirror_guard.test.sql` (P; AC-OCI-070 partial, extended in C6): a user JWT cannot write the new columns; service role can; org scope holds.
- **C3-T3 (green)** `supabase/migrations/0511_odoo_revenue_mirror_columns.sql` + down; guard extended; pgTAP 0136/0137/0178 inventories.
- **C3-T4 (red)** adapter cases on the fake in `odoo/revenueAdapter.test.ts` (AC-OCI-011, 012, 031): fault after create, after post, lost response → one posted invoice, no second create; unmapped thing → refusal with zero writes; unlinked project / needs-attention link / two projects → refusals with zero calls; cost-account-missing read-back → needs-attention, revenue not reported booked.
- **C3-T5 (green)** `odoo/revenueAdapter.ts` kind `sales-invoice`: client-PO resolution before the outbox snapshot, `nextStep` loop, post, read-back through `moneyHeader`, mirror finalize via the shipped finalize path (the 0196/ADR-0082 constraints respected: a read-back that would violate them refuses the mirror write and flags the invoice).
- **C3-T6 (red→green)** AC-OCI-061 through the served handler (D): timeout/5xx/429/validation classify per C1-T8; no Odoo body in any response or log.
- **C3-T7 (P)** AC-OCI-032 database half: un-link/re-link of a project after an Odoo reference exists is refused (`supabase/tests/odoo_revenue_project_link.test.sql`, or cite the shipped O1 check if it already covers `sales_invoices`).
- **C3-T8 (bed)** AC-OCI-010, 030: order-less approved invoice → exactly one posted invoice with client, lines, PO reference, distribution on every line, Odoo number and status in PMO; a free-standing invoice likewise; one posted line stripped of its distribution on the bed → needs-attention.
- Final gate + review battery (security-auditor mandatory).

## C4 — Billing claims: progress, down payment, recovery (Director-dispatched; ships alone)

ACs: 020, 021, 022, 023.

- **C4-T1 (red)** adapter cases on the fake (AC-OCI-023, 022): claim with a work order → lines equal the claim's recorded lines, PO number is the customer reference, `work_order_id` retained; down-payment item whose mirrored income account ≠ the configured advance account → `config-rejected` naming the item with zero calls; read-back line on another account → needs-attention.
- **C4-T2 (green)** extend `invoiceBody.ts`/`revenueAdapter.ts`: claim-kind routing (progress, down payment), recovery negative line on the down-payment item, advance-account check before and after.
- **C4-T3 (bed)** AC-OCI-020: live 200,000 down payment at 20%, claim of 10 km × 50,000 → one invoice with the BoQ line, a −40,000 recovery line on the down-payment item, distribution on both, totals equal Odoo's. AC-OCI-021: DP billed and approved by a second user → the posted line's account is the advance account.
- **C4-T4 (mutation)** make the builder recompute a recovery or drop a negative line's distribution → red; restore.
- Final gate + review battery.

## C4b — Time-and-materials claims (Director-dispatched; ships alone; **after #1514 merged**)

AC: 024.

- **C4b-T1** read the merged #1514 claim record shape; record in the PR body the field names carrying approved quantity and rate. If the shape differs from what `invoiceBody.ts` transports, stop and tell the Director (a spec delta, not a workaround).
- **C4b-T2 (red→green)** adapter case on the fake: a signed T&M claim of 120 h × a contract rate → lines 120 × rate on the project's distribution; an unsigned line is absent. **Mutation check:** send an unsigned line → red; restore.
- **C4b-T3 (bed)** the same on the bed with one T&M claim; totals equal Odoo's.
- Final gate + review battery.

## C5 — Customer receipt push (Director-dispatched; ships alone)

ACs: 040, 042, 043, 044 (or 044b), 046, 052 (D half). Migration **0512**.

- **C5-T1** read the shipped receipt path (`incoming_payments`, `peReceiveToBody` equivalents in `erpnext/bodies/incomingPayment.ts`), the O2 journal default, and the withholding config; record what 0512 must change (tax-prepaid account key; receipt-journal key only if O2's does not serve inbound).
- **C5-T2 (red)** `supabase/tests/odoo_revenue_receipt_defaults.test.sql` (P): the tax-prepaid setter is actor-checked (Admin, Finance), records the actor, refuses others; held-resolution for the receipt kind (creator, engineer refused; Finance, Admin allowed; audit row) if not already covered by C2-T8.
- **C5-T3 (green)** `supabase/migrations/0512_odoo_receipt_defaults.sql` + down; definers added to the 0178 allow-list and inventories.
- **C5-T4 (red)** adapter cases on the fake (AC-OCI-042, 043): fault after create, after post, after reconcile, lost response → one posted, reconciled receipt; probe 0 matches → `hold`, 2 matches → `hold`, unique conjunction → `adopt`, never `create`. **Mutation check (PD-8):** make the decision "reissue" on 0 matches → red; restore.
- **C5-T5 (green)** `revenueAdapter.ts` kind `incoming-payment`: create, post, reconcile as `nextStep` directs; partial receipts; overpay refused before the write; recorder from the JWT subject through the shipped stamp path (AC-OCI-046); the withheld shape per C0-T8 (or the *unavailable* refusal if C0 said so).
- **C5-T6 (D)** served handler: a receipt payload claiming a different `recorded_by` stores the JWT subject; an unsupported withheld shape refuses with a named reason and no outbox row.
- **C5-T7 (bed)** AC-OCI-040: pay 111,000 in one go, residual 0, PMO shows *Paid* only after the next read; 40,000 then 71,000 in two; 112,000 refuses. AC-OCI-044: cash 109,000 + withheld 2,000 with a bukti-potong number → invoice closed, withheld on the tax-prepaid account, three figures in PMO (or AC-OCI-044b per the C0 verdict). Proxy-kill interruption after commit → sweep tick links and confirms with one receipt; anchor edited in Odoo → `held`.
- **C5-T8 (U)** "receipt sent, awaiting Odoo" status derivation (FR-OCI-054) in `odoo/revenue/status.test.ts` plus the repository selector.
- Final gate + review battery (security-auditor mandatory; the held resolve RPC and the withheld shape are the focus).

## C6 — Inbound feed, status reconciliation, credit notes, pair-existing, census (Orca worker; security-auditor mandatory; DB lock)

ACs: 060, 062, 070, 072, 073, 074, 075. Migration **0513**.

- **C6-T1 (red)** `supabase/tests/odoo_revenue_page_apply.test.sql` (P; AC-OCI-070): two orgs; org A's user cannot write any revenue mirror column; a page apply with org B's context cannot touch org A's rows; cursor and rows commit or roll back together; census/tombstone function.
- **C6-T2 (green)** `supabase/migrations/0513_odoo_revenue_feed_apply.sql` + down; service-only page apply (rows **and** the domain's watermark in one transaction, `org_id` from the verified binding) for `sales-invoice`, `credit-note`, `incoming-payment` under tier `odoo`; census/tombstone; definers in the 0178/0136/0137 inventories.
- **C6-T3 (red→green)** `supabase/functions/_shared/odooRevenueFeed.test.ts` (AC-OCI-074): a page that fails halfway leaves the cursor and a replay yields identical rows; a late commit with an earlier `write_date` is picked up; credit notes link via the reversed-entry reference (AC-OCI-075 logic); the invoice's outstanding comes from Odoo's residual.
- **C6-T4 (green)** `supabase/functions/_shared/odooRevenueFeed.ts` and the revenue passes in `odooSweep.ts` (budgeted per tick as O1's; progress shown, not a stale zero).
- **C6-T5 (red→green)** pair-existing: Odoo-native invoice, the same invoice listed twice, an anchored orphan → each mirrored once at newest figures, the orphan proposed for adoption (AC-OCI-072). If the shared `invoice.pair-existing` suite exists, run it for Odoo; if not, the test lives in the Odoo files and the declaration stays `pending` (SD-2).
- **C6-T6 (bed)** AC-OCI-073: a mirrored invoice hard-deleted in Odoo is tombstoned by the census and drops out of billed-to-date and receivables. AC-OCI-075: a credit note posted in Odoo shows linked and negative; the outstanding equals the residual.
- **C6-T7 (bed)** AC-OCI-062 sweep recovery, shared with C5's interruption case: one document after a network cut; held after the anchor is edited.
- Final gate (pgTAP under the lock, Deno) + **security-auditor** (service-role writers, tenancy, the page-apply function's trust of `org_id`).

## C7 — Tax documents (Orca worker; Director reviews the capability claim)

ACs: 080, 081, 082 (or 082b), 083, 084. Migration **0514** (conditional).

- **C7-T1** read the C0 verdicts for V-OCI9–11. Record in the PR body which of (a) hand-recorded e-Faktur, (b) Odoo-held facts, (c) export download is proven. Anything not proven is not built.
- **C7-T2 (red→green)** AC-OCI-081: a numbered, VAT-bearing Odoo-tier invoice accepts an e-Faktur number + date together through the shipped `EfakturModal` path; a non-VAT or unnumbered one offers none. No new code expected; this is the proof that tier `odoo` rides the existing columns. Cite `pages/__tests__/SalesInvoices.efaktur.test.tsx` and extend only if it mocks a tier.
- **C7-T3 (red→green)** AC-OCI-080 and the claim guard: capability `tax-document.read` is declared `unavailable` with a reason; a test greps the rendered invoice (en and id) for any Odoo-generated tax-document label while unavailable and finds none. **Mutation check:** flip the declaration to `supported` without the C7-T4 columns → red.
- **C7-T4 (only if V-OCI9 proved facts)** `supabase/migrations/0514_odoo_tax_document_facts.sql` + down; read-only columns or table, service-only writer, unwritable by a user JWT (P in `supabase/tests/odoo_tax_document_facts.test.sql`); the sweep reads the facts through the C0-verified fields; the screen block "held by Odoo" beside the hand-recorded number; disagreement shows both and flags needs-attention (AC-OCI-082, bed). If V-OCI9 proved nothing: do not create the migration; AC-OCI-082b applies; return 0514.
- **C7-T5 (only if V-OCI10/11 proved an export)** server-side proxied download for Admin and Finance (key never leaves the function); otherwise assert the control is absent (AC-OCI-083).
- **C7-T6 (U)** AC-OCI-084: the fake records every call during every tax-document flow; none is outbound to a tax authority and none writes a tax-document field.
- Final gate + one reviewer pass on the claim (spec-reviewer reads the C0 verdicts against what the UI says).

## C8 — PMO screens (Orca UI worker; impeccable + taste + ui-ux-pro-max; one rendered review)

ACs: 090, 091, 092.

- **C8-T1 (red→green)** `src/components/revenue/OdooOutcome.tsx` + test: plain-words outcome class, age of last read, next step per *pending / held / needs attention / refused*; unhealthy connection shows last data with its age and fails Odoo actions honestly with nothing queued (AC-OCI-090).
- **C8-T2 (red→green)** `pages/SalesInvoices.tsx` + tests: Odoo document number, project attribution, payments and credit notes against the invoice, the e-Faktur record, and the Odoo-held tax-document block **only if C7 proved it**; a plain invoice renders exactly as today (AC-OCI-091, FR-OCI-103).
- **C8-T3 (red→green)** receipt form: settled / cash / withheld figures shown only for a withheld receipt; journal picker from the mirror, disabled with a reason when empty or stale; `ConfirmDialog` for the money action (AC-OCI-091).
- **C8-T4 (red→green)** held-rows list for Admin and Finance with the two resolve actions (the O2 component extended to revenue kinds).
- **C8-T5 (U)** AC-OCI-092: each role and an impersonating Admin; i18n parity (en/id) and axe; 320 px without horizontal scroll.
- **C8-T6** `scripts/ux-proof.sh` on `/sales-invoices` and `/sales-invoices/:invoiceId`; one Director rendered review (every state, all six roles); owner judges screenshots. Cap: one review, one fix. Grep sibling suites that mock `repositories`/`SalesInvoices` and run them.

## C9 — Declarations, parity, vocabulary guard, acceptance (Director-dispatched)

ACs: 093, 094, 100.

- **C9-T1 (red)** `contractSuite/parity.test.ts` with Odoo's `invoice.push` and `receipt.read` declared `supported` at the suites' current version fails until C9-T2.
- **C9-T2 (green)** edit `odoo/workflowDeclarations.ts`: flip those two (and `invoice.pair-existing` / `cutover.revenue` / `cutover.activation` only if their shared suites exist and the Odoo half passes them); everything else stays `pending` with its issue. Add `tax-document.read` per C7's verdict.
- **C9-T3 (U)** AC-OCI-093: extend `odoo/vocabulary.test.ts` so Odoo model and field names fail the guard anywhere in `pmo-portal/src` outside `adapterSeam/odoo/**`, covering the new revenue files and the tax-document fields.
- **C9-T4 (bed)** composite `odooRevenue.bed.test.ts` for AC-OCI-100's server half: claim invoiced by one user, approved by another, paid with and without withheld tax; interruption at each of the two steps; exactly one invoice and one receipt.
- **C9-T5 (E)** `pmo-portal/e2e/AC-OCI-100-odoo-client-invoice-to-receipt.spec.ts`: the curated journey, asserting DB rows and rendered figures; gated on the dependencies (bed + served functions), never on `CI`; `@e2e-isolation` tag per `docs/e2e-parallel-conventions.md`; allowlist entry + restore path in `scripts/check-e2e-skips.mjs`; run via `scripts/e2e-local.sh AC-OCI-100`.
- **C9-T6** runbook note (minimal group set, receipt journal and tax-prepaid account setup, the tax-document finding); backlog and roadmap (#1571) updated in the same session; ticket #1506's acceptance walked against the evidence and quoted in the PR body.
- Final gate + review battery.

---

## 4. Traceability: AC → owning layer → test file

| AC | Layer | Test (path, `AC-OCI-###` leads the test title) |
|---|---|---|
| 001 | U (+B) | `supabase/functions/adapter-dispatch/odooRevenueGates.test.ts` (+ `odooRevenue.bed.test.ts`) |
| 002 | U (+P) | shared `cutover.revenue` suite via `odoo/contract.test.ts` when it exists; `supabase/tests/odoo_revenue_enable.test.sql` |
| 003 | U | shared `invoicePushSuite` via `odoo/contract.test.ts` |
| 004 | P | `supabase/tests/odoo_revenue_enable.test.sql` |
| 005 | U | `odooRevenueGates.test.ts` |
| 010 | B | `supabase/functions/adapter-dispatch/odooRevenue.bed.test.ts` |
| 011, 012 | U | `odoo/revenueAdapter.test.ts`, `odoo/revenue/invoiceBody.test.ts` |
| 013, 016 | U | `odoo/revenue/moneyHeader.test.ts` |
| 014 | U | `odoo/revenue/invoiceBody.test.ts` |
| 015 | U | `odoo/revenue/taxValidate.test.ts` |
| 020, 021 | B | `odooRevenue.bed.test.ts` |
| 022 | U | `odoo/revenue/invoiceBody.test.ts`, `odoo/revenueAdapter.test.ts` |
| 023 | U | `odoo/revenue/invoiceBody.test.ts` |
| 024 | U | `odoo/revenueAdapter.test.ts` (after #1514) |
| 030 | B | `odooRevenue.bed.test.ts` (U secondary: `moneyHeader.test.ts`) |
| 031 | U | `odoo/revenueAdapter.test.ts` |
| 032 | U (+P) | `odoo/revenueAdapter.test.ts` · `supabase/tests/odoo_revenue_project_link.test.sql` |
| 040 | B | `odooRevenue.bed.test.ts` |
| 041, 045, 046 | U | `odoo/revenue/receiptBody.test.ts` |
| 042, 043 | U | `odoo/revenueAdapter.test.ts` |
| 044 (044b) | B (U) | `odooRevenue.bed.test.ts` (`receiptBody.test.ts`) |
| 050 | D+P | `supabase/functions/adapter-dispatch/odooInvoiceSodGate.served.test.ts` + the shipped `submit_sales_invoice` pgTAP extended |
| 051 | U | `odooRevenueGates.test.ts` |
| 052 | D+P | `odooRevenueGates.test.ts` + `supabase/tests/odoo_revenue_receipt_defaults.test.sql` |
| 060 | P | `supabase/tests/odoo_revenue_enable.test.sql` |
| 061 | U | `odoo/revenue/errors.test.ts` + served `odooRevenueGates.test.ts` |
| 062 | B | `odooRevenue.bed.test.ts` |
| 063 | U | `odoo/revenue/constants.test.ts` |
| 070 | P | `supabase/tests/odoo_revenue_mirror_guard.test.sql`, `odoo_revenue_page_apply.test.sql` |
| 071 | U | `odoo/revenue/status.test.ts` (+ shared `receiptReadSuite`) |
| 072 | U | `supabase/functions/_shared/odooRevenueFeed.test.ts` (shared `invoice.pair-existing` suite once it exists) |
| 073, 075 | B | `odooRevenue.bed.test.ts` |
| 074 | U | `supabase/functions/_shared/odooRevenueFeed.test.ts` |
| 080 | U | `odoo/revenue/taxDocument.claim.test.ts` *(new, C7)* |
| 081 | U | `pmo-portal/pages/__tests__/SalesInvoices.efaktur.test.tsx` (extended only if it mocks a tier) |
| 082 (082b) | B (U) | `odooRevenue.bed.test.ts` (`taxDocument.claim.test.ts`) |
| 083 | B (U) | `odooRevenue.bed.test.ts` (`SalesInvoices.taxdoc.test.tsx`) |
| 084 | U | `odoo/revenue/taxDocument.claim.test.ts` |
| 090, 091 | U | `pmo-portal/pages/__tests__/SalesInvoices.odoo.test.tsx`, `src/components/revenue/OdooOutcome.test.tsx` |
| 092 | U | same files + the axe/i18n parity checks |
| 093 | U | `odoo/vocabulary.test.ts` (extended) |
| 094 | U | `pmo-portal/src/lib/adapterSeam/contractSuite/parity.test.ts` |
| 100 | B+E | `odooRevenue.bed.test.ts` composite + `pmo-portal/e2e/AC-OCI-100-odoo-client-invoice-to-receipt.spec.ts` |

Coverage is never lost by moving an AC to a higher layer; a layer is chosen once, here (ADR-0010).

## 5. Risks and ceilings

- **Retention is out (OQ-OCI-5) and the prospect's contracts may hold it.** Mitigation: it is the first question to the owner; ceiling: claims overstate cash due by the retained amount until a ruling; upgrade path: a retention line on a dedicated item and account plus a tax-base rule, its own spec.
- **Tax-document capability may not exist on stock Community 20.** Mitigation: nothing is claimed before C0; the manual record is parity and ships regardless (PD-9); ceiling: Finance types the e-Faktur number as on ERPNext today.
- **Anchors on Odoo are editable.** Mitigation: held-on-inconclusive for invoices and receipts (OQ-OCI-14), composite probe for receipts; ceiling: a person clears a held row; upgrade path: if C0-T2 finds a system-owned field, that kind moves to the reissue-capable class.
- **Wizard-bound steps (register payment, withheld difference) may not be completable by stock calls.** Mitigation: C0 stop rule; the AC has a named alternative (044b); never a module.
- **Gate generalisation touches the ERPNext money path.** Mitigation: it was done once, in O2 P2; C2 only extends it, with the ERPNext suites as the proof and mutation checks recorded.
- **No PMO-initiated cancel or credit note (OQ-OCI-7).** Ceiling: a wrong invoice is corrected by an Odoo accountant and mirrored; the ERPNext cancel-and-reissue journey does not exist for this tier. Upgrade path: a revenue-correction slice once the owner rules.
- **`invoice.pair-existing` and `cutover.revenue` have no shared suites yet.** Ceiling: Odoo cannot claim them; revenue cannot be employed safely on an org with prior PMO invoices until #1602 lands. Mitigation: the stranded-drafts refusal (FR-OCI-003) makes the unsafe case a refusal, not a double count.
- **Clock skew and `write_date` ties** inherit O1's overlap window and keyset; ceiling documented there.
- **Latency.** Sweep-only plus post-write re-read (OQ-OCI-15); webhook nudge is a later optional slice.
- **Odoo posts a number PMO cannot predict.** The PMO draft has no invoice number until the read-back (FR-OCI-016); screens must not print a draft number as the invoice number.

## 6. Rollout

Dev only (owner ceiling 2026-10-17): each slice merges to `dev` on green `verify` + `unit` + (when run) `pgtap`; the browser suite runs on the release PR to `main`. Nothing is pushed or promoted to `main` or production by a worker. Production remains a separate, explicit, owner-gated instruction naming production. A backout of any slice is its `rollback/` down script plus a revert; the Odoo documents already created are Odoo's, and PMO's mirror rows are reconstructible from Odoo by a reset of the revenue watermark. An org does not employ `revenue` under `odoo` until C2–C6 are on `dev` and the owner has answered OQ-OCI-5 (retention) and OQ-OCI-16 (cutover).
