# Plan — Odoo: purchase through payment (O2, #1505)

- **Spec:** `docs/specs/odoo-purchase-to-payment.spec.md` (IDs `FR-OPP`, `AC-OPP`, `DD-OPP`, `OQ-OPP`, `V-OPP`). Owner sign-off of the spec and its §0 defaults is required before P1. Defaults mirror ERPNext (owner ruling 2026-10-31).
- **Route:** #1481, item O2 of `docs/plans/2026-10-30-epc-odoo-build-route.md`. **Blocked by** O1 (#1504, shipped on `dev`). **Executor:** Director-dispatched per slice (money/SoD); every slice that commits money ships alone (own branch, own PR, never batched).
- **Companion plans (names reused, never rebuilt):** `docs/plans/2026-10-31-odoo-connect-master-data.md` (O1: `odoo/client.ts`, `connectAdapter.ts`, `fakeOdoo.ts`, `sweep.ts`, `odooClientForOrg`, `odooSweep`, master-record mirror, shared resolver), `docs/specs/erp-connect-anytime.spec.md` (ECA: `connect/workflows.ts`, `contractSuite/*`, `ErpHarness`).
- **Migration numbers: 0505–0509 only** (§3). Highest on `dev` at writing: 0496. Slots a slice does not need are returned to the Director, never reused. Collision: `scripts/renumber-migration.sh <old> <new>`.
- **Every file cited as existing was read at `origin/dev` (`855433274`) on 2026-11-02.** Names marked *(new)* do not exist yet. Where the spec says "builder confirms against the shipped DDL", the first task of the slice does that and records the answer in the PR body, before any migration is written.

---

## 0. Plan-level decisions (`PD-#`)

- **PD-1 — Gates first, then the Odoo push (P2 before P3–P6).** The shipped dispatch gates (`authGuard`, `procurementGateGuard`, `projectGateGuard`, `paymentGate`, `sodGuard`, `poReviseGuard`, link-ownership preflight) are ERPNext-named in places. P2 makes them tier-agnostic with the ERPNext suites as the regression proof, **before** any Odoo money command exists. A gate that is only wired for ERPNext fails open for Odoo; P2's deliverable is a test per gate showing a tier `odoo` command is refused exactly as an ERPNext one.
- **PD-2 — One adapter per domain, built on the shipped seam.** `odoo/procurementAdapter.ts` (new) implements `Adapter` for domain `procurement`; `createOdooAdapter` (companies) stays as is. `capabilityMap` gains `procurement` only when the org employs it.
- **PD-3 — The adapter is a state machine over Odoo state, not a script.** Each command reads the document's state (by anchor, then by external ref) and performs only the missing call (DD-OPP-3). The pure decision function `nextStep(kind, observed)` is unit-tested exhaustively; the I/O wrapper is thin.
- **PD-4 — Keys.** `po:<pmo po id>`, `gr:<pmo receipt id>`, `bill:<pmo invoice id>`, `pay:<pmo payment id>`, `porev:<po id>:<revision>` (shipped `purchaseOrderReviseKey`), all UUID-validated like `PO_REVISE_KEY_RE`. A receipt key also carries the cumulative received quantity digest so FR-OPP-033's "same cumulative quantities" check is a string compare.
- **PD-5 — Anchor placement (Director provisional, 2026-11-02).** Order, transfer and bill use a stock external identifier (`ir.model.data`, module `pmo`, name derived from the PD-4 key with safe characters), written immediately after creation. Payment retains its memo anchor. The create-to-anchor gap uses a composite probe of vendor, lines, amount and date window; any doubt holds and never reissues. The held state remains visible. The service user’s Access Rights group is an elevated grant and an OWNER go-live check. Code centralizes these choices in `ODOO_ANCHORS`.
- **PD-6 — Bed tests are gated like O1's** (Deno `*.bed.test.ts`, `ignore: !BED` on the *dependency* variables, never on `CI`), run under `scripts/with-odoo-lock.sh` (and `with-db-lock.sh` after it when the local Supabase stack is needed: order **odoo → db**). The curated e2e journey is gated the same way and tagged per `docs/e2e-parallel-conventions.md`.
- **PD-7 — Mutation checks are tasks.** Each money rule (SoD gate, held-not-reissued, explicit-key reuse, one-payment-per-bill, over-receipt refusal) has a named task that breaks the rule, sees red, and restores. Evidence is pasted in the PR body.
- **PD-8 — Public-repo hygiene.** Fixtures use invented vendors, amounts and hosts; no prospect name; V-OPP findings that describe an Odoo behaviour are fine, findings that describe an unpatched weakness of this repo go to `/Users/ariefsaid/Coding/PMO/docs/private/reviews/`.

## 1. Spec deltas to absorb during build

| # | Where | Note |
|---|---|---|
| SD-1 | `connect/workflows.ts` `purchase.push` summary says "an order and its receipt" | Odoo pushes the receipt as its own command (DD-OPP-2). The shared suite asserts only the preflight; no summary change, no version bump. |
| SD-2 | `odoo/workflowDeclarations.ts` | P9 flips seven workflows to `supported` at the suites' current version; `cutover.timesheet`, `invoice.*`, `receipt.read`, `actuals.read`, `budget.*`, `timesheet.push`, `imprest.transfer` stay `pending` with their issues. |
| SD-3 | `adapter-dispatch/index.ts:1192` comment | "the Odoo edit-style tier relaxes it when #1505 adds that tier" is implemented by P3-T8 as a per-tier `reviseCancels` flag. |
| SD-4 | O1 account defaults | Journals are not in O1's kinds. P2 adds kind `journal` (migration 0509 is the allow-list change, P2-T6 the parser). |
| SD-5 | Research claim "confirm with `action_confirm`" | Wrong on the bed (bed report row 2): `button_confirm`. V-OPP1 re-verifies; tests use the bed's answer. |
| SD-6 | P5/P9 localized tax bed setup | The stock Indonesian chart did not supply named PPh 23 or PPh 4(2) taxes. Seed explicit synthetic purchase withholding taxes with liability repartition accounts before the withholding bed cases; the configured tax remains explicit in PMO. |
| SD-7 | V-OPP7 / payment-state fixtures | The stock Community bed reports a fully reconciled bill as `paid` even before the payment is bank-matched. Keep `in_payment` as an accepted inbound state where supplied, but do not require that state in the stock-bed test. |
| SD-8 | PD-5 / order anchor | Order `origin` is the visible Source and `note` is HTML terms text. Preserve existing business content; use the stock external identifier as the anchor under amended PD-5. |
| SD-9 | PD-5 / transfer anchor | Transfer `origin` carries the order reference and `note` is HTML. Preserve both business fields; use the stock external identifier as the anchor under amended PD-5. |
| SD-10 | PD-5 / bill anchor | Purchase auto-completion rewrites `invoice_origin`; `narration` is HTML terms text. Preserve those fields; use the stock external identifier as the anchor under amended PD-5. |
| SD-11 | PD-5 / payment anchor | `memo` is plain text and editable, as the signed payment flow already anticipates. Retain it as the payment anchor under amended PD-5. |
| SD-12 | PD-5 / stock external identifier | The identifier survived the tested transitions and ordinary UI/API access was denied; Access Rights administrator permission allowed creation. Its separate write leaves a create-to-anchor interruption gap, so it is not sufficient as the sole recovery anchor. The amended PD-5 adds a composite probe for that gap. |
| SD-13 | V-OPP2 order candidate spelling | The stock order field is `note`, singular, not `notes`; its value is HTML terms text. |
| SD-14 | P1-T11 / P2 | P2 wires the client and dispatch to the P1 purchase constants. |
| SD-15 | P2-T2 / 0505 | `admin_change_domain_ownership` is callable by an Admin's own JWT (0210 revoked only `anon`), so AC-OPP-004's role matrix runs under each user's JWT. 0505 adds two preconditions for procurement only: no other ERP already employs it (one ERP per domain), and for Odoo no active ERPNext connection, an activated connection and a snapshot showing the seven models. |
| SD-16 | P2-T1 / discovery | `capabilities.later` now means present **and readable** by the key and gains `purchase.order.line` and `account.payment`; `account.journal` is an O1 directory model (kind `journal`). A connection activated before P2 has an older snapshot, so its first employ asks to check the connection again. |
| SD-17 | P2-T4 / P2-T5 | `paymentGate`, `procurementGateGuard` and `poReviseGuard` already carry no tier name. The tier-literal was `authGuard`'s ownership lookup, now one `OWNING_TIERS` table whose answer (`tier`) also picks the adapter registry and the outbox resolver. The unlinked-project gate for Odoo procurement is P3-T6. The shipped payment gate has approver arms only (case approver, approver of a raised amount); a bill-author arm does not exist for either tier and is a P6-T8 decision. |
| SD-18 | P2-T6 | Until each kind's create-to-anchor composite exists, every Odoo purchase kind holds on a missed probe (`GAP_COVERED` in `odooMoneyOutbox.ts`; P3, P4, P5 flip theirs). The payment composite is vendor, amount and window, and excludes a payment carrying another PMO anchor; the reconciled-bill conjunct waits for P6-T6 (the field is computed and unverified on the bed). |
| SD-19 | P2-T8 | `propose-config` and `save-defaults` exist for tier `odoo` for the payment journal only; the O1-S7 account and unit defaults are not on `dev` and extend the same verbs. |

## 2. Design

### 2.1 Shape

```
PMO UI ──▶ repository ──▶ adapter-dispatch (edge) ──gates──▶ dispatchMoneyWrite ──▶ odooProcurementAdapter ──▶ Odoo JSON-2
                                                       │                              ▲ probe/recover by anchor
                                                       └─ external_command_outbox ◀───┘
Odoo ──▶ odoo-sweep tick ──▶ _shared/odooPurchaseFeed ──▶ apply_odoo_purchase_page (service-only RPC) ──▶ mirror tables
```

The browser never talks to Odoo. All calls come from `_shared/odooClientForOrg.ts` (O1). The outbox, claim, finalize, confirm, quarantine and held mechanics are the shipped ones (`dispatch.ts`, `moneyOutboxDeps.ts`, migration 0096 and successors), unchanged.

### 2.2 File map and slice ownership

| File | Owner slice | Notes |
|---|---|---|
| `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §9 "O2 findings" | P0 | verdict per V-OPP |
| `scripts/odoo-probe.mjs`, `scripts/odoo-bed/*` (seed purchase data) | P0 | extend only |
| `pmo-portal/src/lib/adapterSeam/odoo/__fixtures__/purchase.ts` *(new)* | P0 | synthetic shapes |
| `adapterSeam/odoo/purchase/anchors.ts` *(new)* | P1 | `ODOO_ANCHORS`, key regexes |
| `adapterSeam/odoo/purchase/nextStep.ts` *(new)* | P1 | pure decision per kind |
| `adapterSeam/odoo/purchase/{orderBody,receiptBody,billBody,paymentBody}.ts` *(new)* | P3–P6 (shape in P1) | request builders, pure |
| `adapterSeam/odoo/purchase/taxValidate.ts` *(new)* | P1 (used P5) | FR-OPP-042 |
| `adapterSeam/odoo/purchase/status.ts` *(new)* | P1 (used P7) | FR-OPP-081 |
| `adapterSeam/odoo/purchase/moneyHeader.ts` *(new)* | P1 (used P5, P7) | FR-OPP-043 read-back |
| `adapterSeam/odoo/fakeOdoo.ts` | P1 | extend with purchase models, state transitions, fault seams |
| `adapterSeam/odoo/contract.harness.ts` | P1 | implement `pushProcurement`, `pushPurchase`, `pushPurchaseStep`, `mirrorPurchases`, `revise` |
| `adapterSeam/odoo/procurementAdapter.ts` *(new)* | P3 (order), extended P4–P6 | `Adapter` for domain `procurement` |
| `adapterSeam/odoo/workflowDeclarations.ts` | P9 | flip to `supported` |
| `supabase/functions/adapter-dispatch/index.ts` (+ guards) | P2, P3 | registry entry, tier-agnostic gates |
| `supabase/functions/adapter-dispatch/odooMoneyOutbox.ts` *(new)* | P2 | anchor probe closures per kind |
| `supabase/functions/_shared/odooPurchaseFeed.ts` *(new)* | P7 | sweep pass, mapping to mirror RPC |
| `supabase/functions/odoo-sweep/index.ts`, `_shared/odooSweep.ts` | P7 | add purchase passes to the tick |
| `supabase/migrations/0505…0509` + `rollback/*_down.sql` | see §3 | |
| `pmo-portal/pages/ProcurementDetails.tsx`, `src/components/procurement/*`, repositories | P8 | UI |
| `pmo-portal/public/locales/{en,id}/*.json` | P8 | both languages |
| `pmo-portal/e2e/AC-OPP-090-odoo-purchase-to-payment.spec.ts` *(new)* | P9 | |

### 2.3 Gate evidence and test conventions

Every slice ends with (CLAUDE.md "Local final gate"), from `/Users/ariefsaid/orca/workspaces/PMO/<worktree>/pmo-portal`: `npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 <touched files>`; the directly touched Vitest files (`npx vitest run <files>`; never the full suite, never `--changed`); touched Deno tests (`scripts/deno-test-edge-fns.sh` shows the invocation; edge-fn tests import the SHIPPED handler from `./index.ts` and mock `globalThis.fetch`, `scripts/check-edge-fn-test-binding.mjs`); touched pgTAP only, reset and test in **one** hold:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <files>'`, grepping the output for `Parse errors`; `node --test scripts/*.test.mjs` if a script was touched; `scripts/ux-proof.sh <route>` for UI. Paste output bodies, not exit codes.

**Known CI traps checked per migration slice:** pgTAP 0137 (service_role grants on new functions), 0136 (side-mirror inventory), 0178 (anon-executable SECURITY DEFINER allow-list), the isolation-probe denominator (`scripts/isolation-probe-denominator.json`), i18n keys in both locales, sibling suites that mock `repositories`/`ProcurementDetails` (grep before finishing).

**Bed tests (layer B):** Deno `*.bed.test.ts` beside the function they exercise, e.g. `supabase/functions/adapter-dispatch/odooPurchase.bed.test.ts`:

```ts
const BED = Deno.env.get('ODOO_BED_URL');
const ORG = Deno.env.get('ODOO_BED_ORG');
Deno.test({ name: 'AC-OPP-010 on the bed: …', ignore: !(BED && ORG), sanitizeResources: false, fn: async () => { /* … */ } });
```

Run: `scripts/with-odoo-lock.sh scripts/with-db-lock.sh bash -c 'set -a; . ./.env.odoo.local; set +a; ODOO_BED_URL=http://127.0.0.1:$ODOO_PORT ODOO_BED_DB=$ODOO_DB ODOO_BED_KEY=$ODOO_API_KEY ODOO_BED_ORG=<seeded org> deno test --allow-env --allow-net --allow-read <file>'` (sourced, never printed; never read the env file). Bed up first: `scripts/with-odoo-lock.sh scripts/odoo-dev-bed.sh up`.

**Layers:** U Vitest/Deno mocked · P pgTAP · B bed · E Playwright. Fault injection on the fake uses the shipped fault-seam idiom (`adapter-dispatch/faultSeams.ts`); the bed interruption test cuts the connection with a local proxy that the test starts and kills (not a production seam).

---

## 3. Slice map

| Slice | Contents | ACs owned | Migration | Blocked by | Executor | Ships alone? |
|---|---|---|---|---|---|---|
| **P0 — Close the bed claims** | V-OPP1–11 on the stock bed, fixtures, probe cases, runbook minimal-group note | (evidence for all) | none | O1 | Orca worker | n/a (no product code) |
| **P1 — Contract first, pure parts** | anchors table, `nextStep`, tax validation, money-header read-back, status derivation, fake Odoo purchase models, harness methods (suites run red-then-green against the fake), declarations stay `pending` | 002, 003, 042, 043, 044, 071, 072 (logic), 063 | none | P0 | Orca worker, opus-grade; Director review | yes (pure, no money path change) |
| **P2 — Enablement + tier-agnostic gates + outbox wiring** | employ `procurement` under `odoo`; registry entry; generalise the dispatch gates; Odoo probe closures; journal kind | 001, 004, 060, 061, 064 (P half) | **0505** (employ/enablement), **0509** (journal kind + default setter) | P1 | **Director** (money-path gates) | **yes** |
| **P3 — Purchase order push + revise** | order create+confirm, "to approve" handling, project gate, revise with per-tier flag | 010–017, 021, 014 | none (0505 covers) | P2 | **Director** | **yes** |
| **P4 — Goods receipt push** | validate transfer, partial/backorder, over-receipt guard, idempotency | 030–032 | none | P3 | **Director** | **yes** |
| **P5 — Vendor bill + withholding push** | bill create+post, order-line link, explicit taxes, read-back compare, cost-account check | 020, 040–046 | none | P3 | **Director** | **yes** |
| **P6 — Vendor payment push** | payment create+post+reconcile, held-on-inconclusive, SoD, journal | 050–055, 053, 054 | **0508** (payment gate reads, held-resolution RPC) | P5 | **Director** | **yes** |
| **P7 — Inbound feed, status reconciliation, link-existing, census** | purchase passes in the sweep, page-apply RPC, mirror columns, mirror guard, tombstones | 062, 070, 073, 074, 081-derived statuses | **0506** (mirror columns + guard), **0507** (page apply + census) | P2 (needs P3–P6 only for the e2e) | Orca worker; **security-auditor mandatory** (service-role writers, tenancy); DB lock | yes |
| **P8 — PMO screens** | outcome class, as-of age, held list, withholding figures, tax/journal pickers, i18n | 080–083 | none | P3–P7 | Orca UI worker (impeccable + taste + ui-ux-pro-max, rendered review once) | may batch with P9 docs only |
| **P9 — Declarations, parity, vocabulary guard, cutover, acceptance** | flip seven workflows, parity test, cutover suites, curated e2e, bed composite, runbook, backlog/roadmap update | 084, 090 | none | P3–P8 | **Director** | yes |

Migration use: **0505** P2, **0506** and **0507** P7, **0508** P6, **0509** P2. Numbers are fixed here so parallel builds cannot collide; the order they merge in is P2 → P6 → P7, so the Director renumbers nothing unless another lane takes a slot first (check `ls supabase/migrations | tail` at branch time).

Dependency order: P0 → P1 → P2 → P3 → (P4, P5 in parallel branches, P7 in parallel) → P6 → P8 → P9. At most two heavy loads at once (DB, bed, e2e): P7 (pgTAP) may run beside P4 or P5 (Deno + bed), never beside another bed/DB lane.

**Money slices (P2–P6) are never batched into one PR** (repo rule: money, SoD and auth ship alone). P0, P1, P7, P8 may be batched with each other per the batch rule only if the Director chooses; P7 includes service-role writers and should ship alone in practice.

---

## P0 — Close the bed claims (Orca worker; no product code)

Each task adds one case to `scripts/odoo-probe.mjs` (claim id, status, response **shape** only), runs it under `scripts/with-odoo-lock.sh`, appends the verdict to `docs/research/2026-10-31-odoo20-dev-bed-verification.md` §9 "O2 findings", and adds a synthetic shape sample to `pmo-portal/src/lib/adapterSeam/odoo/__fixtures__/purchase.ts` where a slice needs it. Verify: `scripts/with-odoo-lock.sh node scripts/odoo-probe.mjs 2>&1 | grep '<claim id>'`. The bed needs `purchase stock account project analytic l10n_id` installed (the bed report's module list) and one seeded vendor, one costed storable product, one cost account.

- **P0-T1 (V-OPP1)** order create with `order_line` tuples → `button_confirm`; read `state`, `name`, `amount_total`; then repeat with `po_double_validation` on above its threshold: state and approve method name.
- **P0-T2 (V-OPP2)** for each of order, transfer, bill, payment: write a probe string into each candidate field, run the model's confirm/validate/post, read it back, and `search_read` with `ilike`; edit it as a second user and record whether a UI user can. Verdict: the `ODOO_ANCHORS` table.
- **P0-T3 (V-OPP3)** receipt flow: the picking created by confirm, its moves, the done-quantity field, `button_validate` result complete and partial, tracked product.
- **P0-T4 (V-OPP4)** the backorder / immediate-transfer wizard via stock calls or a context key; verdict "completable" or "unavailable".
- **P0-T5 (V-OPP5)** bill create with `purchase_line_id` and `analytic_distribution`; `action_post`; double post; the order's billed quantity and `invoice_status`.
- **P0-T6 (V-OPP6)** the Indonesian taxes on the bed (PPN, PPh 23, PPh 4(2)): sign, repartition account type, a service bill with 11% + 2% withholding: `amount_total`, `amount_tax`, `amount_residual`, tax lines; derive gross, VAT, withheld to the cent.
- **P0-T7 (V-OPP7)** payment: create, post, reconcile via the register wizard or `reconcile`; `payment_state`/`amount_residual` afterwards, partial, overpay, `in_payment`.
- **P0-T8 (V-OPP8)** `write_date` shape and sweep filters on the four models; keyset stability at 200/1000.
- **P0-T9 (V-OPP9)** edit a confirmed order's lines; the refusal when below received or billed.
- **P0-T10 (V-OPP10)** the minimal service-user group set that passes P0-T1…T9; extend the runbook note (NFR-ODC-003).
- **P0-T11 (V-OPP11)** error body shapes for a validation failure on each call.
- **P0-T12** update spec §9 with the verdicts, and any deviation from a spec FR as a numbered spec delta in this plan's §1 (Director signs). **Stop rule:** if V-OPP4 or V-OPP7 shows a required call cannot be made with stock models, escalate to the Director before P1; do not design a workaround (NFR-OPP-008).

---

## P1 — Contract first: pure parts, fake Odoo, harness (Orca worker, opus-grade)

ACs: 002, 003, 042, 043, 044, 063, 071, 072 (logic half). Order matters: the shared suites go red first, then green.

- **P1-T1 (red)** `odoo/contract.test.ts` already runs every `supported` suite. Add a temporary local case in `odoo/purchase/nextStep.test.ts` asserting `nextStep('order', {state:'draft', anchor:'ours'})` is `confirm`, `{state:'purchase'}` is `adopt`, `{absent:true, probe:'conclusive'}` is `create`, `{absent:true, probe:'inconclusive'}` is `hold`; same table for `bill` (draft→post, posted→adopt), `payment` (draft→post, posted-unreconciled→reconcile, reconciled→adopt; inconclusive→hold, never `create`), `receipt` (done→adopt). Verify red: `cd pmo-portal && npx vitest run src/lib/adapterSeam/odoo/purchase/nextStep.test.ts`.
- **P1-T2 (green)** `odoo/purchase/nextStep.ts`: one exhaustive `switch` per kind returning `'create'|'confirm'|'post'|'reconcile'|'validate'|'adopt'|'hold'`; `payment` and `bill` hold on inconclusive (OQ-OPP-10).
- **P1-T3 (red→green)** `odoo/purchase/anchors.ts` + test: `ODOO_ANCHORS` per kind (filled from P0-T2) with `mutable: boolean`; key regexes per PD-4; `anchorValue(key)` produces `pmo:<key>`; a test that a key without a UUID is rejected.
- **P1-T4 (red→green)** `odoo/purchase/taxValidate.ts` + test (AC-OPP-042): table-driven over the malformed and well-formed sets of the AC, from a mirrored-tax fixture; refusal carries `config-rejected` and the tax name only; a PPh-only set passes. Mutation check: change `sum >= 100` to `>`, test red, restore.
- **P1-T5 (red→green)** `odoo/purchase/moneyHeader.ts` + test (AC-OPP-043, 044): from an `account.move` read plus its tax lines (P0-T6 fixture) derive `{gross, vat, withheld, outstanding}` as decimal strings by integer-cent arithmetic; missing part ⇒ `null` (not `0`); a `compareSent(sent, observed)` returning `match|mismatch` with a one-currency-unit tolerance.
- **P1-T6 (red→green)** `odoo/purchase/status.ts` + test (AC-OPP-071): order, transfer, bill, payment state tables from FR-OPP-081; cancelled ⇒ tombstone flag.
- **P1-T7** extend `odoo/fakeOdoo.ts` (and `fakeOdoo.test.ts`): models `purchase.order(+line)`, `stock.picking(+move)`, `account.move`, `account.payment`, `account.journal`; state transitions per P0 verdicts; stock-effect on validate; per-call fault seam (`before`, `after-commit` lost response) and a call log. Test: confirm then validate then bill then pay reproduces the P0 sequence on the fake.
- **P1-T8** `odoo/contract.harness.ts`: implement `pushProcurement` (ownership preflight with `erpCalls`), `pushPurchase` (activated/not/absent), `pushPurchaseStep`, `mirrorPurchases`, `revise`, replacing the `pending(…)` rejects. They call the **real** preflight functions P2 will wire; until P2 they call a shared pure `procurementPreflight()` (new, `odoo/purchase/preflight.ts`) that P2 imports from dispatch, so the suite and production run one function.
- **P1-T9** `odoo/purchase/preflight.ts` + test: link ownership (case, vendor, bill), activation state, cutover answer (`true|false|'unknown'`) → `{outcome, code, erpCalls}`; unknown refuses. Verify with the shared suites in the next task.
- **P1-T10** run the shared suites against the Odoo harness **locally with the declarations still `pending`** by calling the suite functions directly in a scratch test (`odoo/purchase/suites.scratch.test.ts`, deleted in P9): all of `purchasePushSuite`, `billPushSuite`, `vendorPaymentPushSuite`, `purchaseLinkExistingSuite`, `cutoverPurchaseSuite`, `cutoverActivationSuite`, revise suite green for Odoo. This is the red/green proof AC-OPP-002/003/072 own; P9 turns them into the permanent registration.
- **P1-T11** assert the numeric relationships of FR-OPP-073 (AC-OPP-063) in `odoo/purchase/constants.test.ts` importing the Odoo deadline/attempt/reclaim constants from one `odoo/purchase/constants.ts` (new) that the client and dispatch use.
- Gate: P1 changes no shipped file except `fakeOdoo.ts` and `contract.harness.ts`. ERPNext suites untouched.

---

## P2 — Enablement, tier-agnostic gates, outbox wiring (Director-dispatched; ships alone)

ACs: 001, 004, 060, 061 (gate half), 064 (P half). Migrations **0505**, **0509**. Money-path change for both tiers: the ERPNext suites are the regression proof.

- **P2-T1** read the shipped DDL for `admin_change_domain_ownership`, `external_domain_ownership`, `external_command_outbox` (migration 0096 + successors), `org_has_active_erpnext_binding`, `assert_integration_link_actor`, `external_master_records` kind CHECK, and record in the PR body which tier/kind CHECKs need widening (spec §11, 0505).
- **P2-T2 (red)** pgTAP `supabase/tests/odoo_procurement_enable.test.sql` (AC-OPP-004): per role (Admin, Finance, Executive, Project Manager, Engineer) + Operator, `admin_change_domain_ownership(org,'procurement','odoo','employ')` under a user JWT: only the roles allowed to employ succeed; refused when an active ERPNext binding exists; refused when the Odoo binding is not activated or the snapshot lacks a required model; outbox accepts a `tier='odoo'` row with each kind; `unique` claim for a duplicate key (AC-OPP-060). Namespaced UUIDs, begin/rollback, finish().
- **P2-T3 (green)** `supabase/migrations/0505_odoo_procurement_enable.sql` + `rollback/0505_odoo_procurement_enable_down.sql`; new definers granted to `service_role`/authenticated per the 0137/0178 rules and added to the inventories. Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/odoo_procurement_enable.test.sql' 2>&1 | grep -E "Parse errors|not ok|Result"`.
- **P2-T4 (red)** Deno `supabase/functions/adapter-dispatch/odooGates.test.ts` (imports the shipped handler from `./index.ts`, mocks `fetch`): for tier `odoo` and domain `procurement`, a command is refused with the **same status and wording** as the ERPNext one for each gate: wrong role (authGuard), other-tenant link, closed case, SoD-b (approver pays), SoD (author pays), `procurement_payment_allowed`, ceiling, unlinked project, billed-order revise cancel; each with `erpCalls = 0` and no outbox row (AC-OPP-054 gate half, 061). Verify red.
- **P2-T5 (green)** generalise: replace tier-literal checks with a command-shape predicate in `authGuard.ts`, `procurementGateGuard.ts`, `projectGateGuard.ts`, `paymentGate.ts`, `poReviseGuard.ts`, `index.ts` (the `org_has_active_erpnext_binding` skip, the "ERPNext binding" lookups, the PMO-target binding check), driven by one `EMPLOYED_TIERS` lookup (new RPC result or the ownership table). **ERPNext byte-for-byte:** run the ERPNext Deno suites listed by `ls supabase/functions/adapter-dispatch/*.test.ts` that touch these guards, plus `dispatchGateWiring.test.ts` in the seam. Mutation check (PD-7): set `paymentGate`'s Odoo branch to allow → `odooGates.test.ts` SoD case red; restore.
- **P2-T6 (red→green)** register the tier: `adapter-dispatch/index.ts` adapter registry gets `odoo` + domain `procurement`, `MONEY_OUTBOX_RESOLVERS.odoo`; `adapter-dispatch/odooMoneyOutbox.ts` (new) builds the DB-backed outbox deps with `probeByAnchor(kind, key)` closures using `ODOO_ANCHORS` and the payment composite probe (vendor, bill, amount, date window); `reissueOnInconclusiveAbsence` derived from `ODOO_ANCHORS[kind].mutable` and OQ-OPP-10 (bills and payments `false`). Test `odooMoneyOutbox.test.ts`: zero/one/many matches per kind → adopt/reissue/hold, mirroring `recoveryProbe.test.ts` cases; unescaped `%`/`_` in a key cannot match another (primer bucket 2).
- **P2-T7 (red→green)** journal kind (SD-4): parser in `odoo/kinds.ts` + `kinds.test.ts` (`account.journal`: id, name, type bank/cash, company, active); `sweep.ts` includes it; **0509** `supabase/migrations/0509_odoo_journal_kind.sql` (+ down) allows `journal` in the master-record kind CHECK and adds `set_odoo_payment_journal_default(org, journal_ext_id)` actor-checked (Admin, Finance) writing the id into binding config through `merge_external_org_binding_config`; pgTAP `supabase/tests/odoo_journal_default.test.sql` (role matrix, a non-bank journal refused, inactive journal refused).
- **P2-T8** `external-set-company` Odoo router verbs `propose-config` / `save-defaults` accept the journal (FR-OPP-093, OQ-OPP-6): auto-propose when exactly one bank journal; Deno test.
- **P2-T9** employ verb in the setup checklist: `employ-domain` with `domain: 'procurement'`, `tier: 'odoo'` (PQ-12 parity); Deno test; browser `erpSetupRequest` already takes `tier`.
- Gate: ERPNext Deno + Vitest suites for every touched guard file, the two pgTAP files, `Parse errors` grep, 0136/0137/0178 inventories updated in this slice.

---

## P3 — Purchase order push and revise (Director-dispatched; ships alone)

ACs: 010–017, 014, 021. No new migration (0505).

- **P3-T1 (red)** `odoo/purchase/orderBody.test.ts`: `buildOrderBody(po, ctx)` yields vendor id, company, expected date, `order_line` create tuples with product, qty, price, unit (mapped), tax ids, `analytic_distribution {"<id>": 100}` on every line, anchor value in the anchor field, vendor reference and case number in their fields; unmapped item/unit/vendor → throws `commit-rejected` naming the thing before any call (AC-OPP-013); two-project case refuses (AC-OPP-014).
- **P3-T2 (green)** `odoo/purchase/orderBody.ts`.
- **P3-T3 (red)** `odoo/procurementAdapter.test.ts` order cases on the fake: create+confirm happy path; fault after create → retry confirms the draft, one order; fault after confirm → adopt; lost response → probe adopts; "to approve" → `pushed-not-approved`, approve never called (AC-OPP-011, 012). Mutation check: make `nextStep` return `create` for a found draft → test red; restore.
- **P3-T4 (green)** `odoo/procurementAdapter.ts`: `commit` for `procurement`/`purchase-order`: observe → `nextStep` → perform → read back (`amount_total`, `state`, name) → return `{externalRecordId, canonical}`. Errors through `toAdapterError`; no Odoo body leaves.
- **P3-T5** AC-OPP-015: canonical carries both totals; repository/DAL test in `pmo-portal/src/lib/repositories/procurement.external.test.ts` (extend) shows both and does not overwrite.
- **P3-T6** project gate (FR-OPP-020/021): `projectGateGuard` for tier odoo calls the O1 shared resolver (`resolve…` from FR-ODC-102; builder confirms the exported name); Deno test with unlinked/needs-attention/ok (AC-OPP-014); un-link/re-link refusal reuses the shared check (AC-OPP-021 U) — pgTAP half is O1's `odoo_project_links_config.test.sql` extended with "a case with an Odoo reference refuses re-link" (`supabase/tests/odoo_project_links_config.test.sql`).
- **P3-T7 (revise, red)** extend `adapter-dispatch/poReviseGuard.test.ts` + new `odoo/purchase/orderRevise.test.ts`: revision 2 raises/lowers lines once and replays as a no-op; below received/billed refuses with no write; cancelled/done refuses; billed order never cancelled (AC-OPP-016/017). Key `porev:<po>:<rev>`.
- **P3-T8 (revise, green)** `poReviseGuard.ts` takes `{reviseCancels}` from a per-tier table (`erpnext: true`, `odoo: false`) instead of the literal in `index.ts:1192`; `procurementAdapter.ts` `operation: 'revise'`: edit lines by `write` with line commands, reading received/billed first.
- **P3-T9 (bed)** `supabase/functions/adapter-dispatch/odooPurchase.bed.test.ts` — AC-OPP-010 and AC-OPP-016 on the real bed under the locks (§2.3). Seed a vendor/item/cost account; assert one confirmed order, lines, distribution, total; revise 2/3.
- **P3-T10 (verify and mutation evidence)** final gate; paste the red→green for the mutation in T3 and the SoD-allow mutation of P2.
- **Build notes (P3, 2026-11-03).** (1) The order anchor is the stock external identifier, so the order body carries no key; the case number goes in Source and the PMO reference in the vendor reference. (2) `recoverOrder`/`recoverRevise` (in `procurementAdapter.ts`) are the outbox recovery probes: they adopt a found order, write a missing identifier, confirm a draft and return the read-back, because an adopted bare reference would be mirrored as issued. The order composite (vendor, untaxed total, line count, window; no PMO identifier) is persisted with the outbox row like the payment one; exactly one adopts, several throw (held), none is conclusive absence. `GAP_COVERED.order` is now true. (3) Bed finding: on Odoo 20 the order-line unit field is `uom_id` (not `product_uom_id`); `tax_ids` and `analytic_distribution` are as expected. (4) A confirmed line cannot be deleted (bed: 422), so a line dropped by a revision is set to zero when nothing was received or billed, and refused otherwise. Only a `purchase` order is revised. (5) PMO procurement lines carry no unit column: a line with no unit uses the product's own unit; a line that names a unit needs it mapped (`unit_map`). Item mapping reads `item_map` (PMO line name to Odoo product id), taxes `purchase_tax_ids`, both from the binding config until O1-S7 ships their setters. (6) The cost account is resolved by `resolveOdooCostAccount` (`_shared/odooPurchaseRefs.ts`), the FR-ODC-102 helper; a case with no project pushes without a distribution, as on ERPNext. (7) Currency (OQ-OPP-9, per the spec default: company currency only): adapter selection reads the Odoo company currency and the case's `currency`, refuses `config-rejected` (`currency-mismatch`, `currency-unreadable` when either side cannot be read) before any outbox row, and the create sends the company's `currency_id` explicitly. Not yet confirmed on the bed that an explicit `currency_id` overrides a vendor's purchase-currency property. (8) Review round: a PO with its own revision-1 lines (a subcontract PO) is created from them keyed by BoQ item code, the only identity a revision has; a PO without them keeps the case lines keyed by name. An unanchored order of the vendor that misses the composite's exact match holds the row (window 10 min). A revision older than one already applied on the order is held (`revision-superseded`). The mirror does not yet store `odoo_outcome` or `pmo_amount`: P7/P8 own those columns, and P8 must not assume they are persisted.
- Review battery: spec-reviewer, code-quality-reviewer, **security-auditor** (money + SoD + token custody paths).

## P4 — Goods receipt push (Director-dispatched; ships alone)

ACs: 030–032. No new migration.

- **P4-T1 (red)** `odoo/purchase/receiptBody.test.ts`: per-line done quantity from the command; quantity above open refuses before any write (AC-OPP-031 refusal); cumulative digest key (PD-4).
- **P4-T2 (green)** `receiptBody.ts`.
- **P4-T3 (red)** adapter cases on the fake (AC-OPP-032): lost response after validate + same cumulative quantities → adopt, stock moved once; different quantities → `hold`; partial → backorder created via the P0-T4 path; wizard not completable → `unavailable` refusal (AC-OPP-031b). Mutation check: remove the "state is done → adopt" branch; double stock → red; restore.
- **P4-T4 (green)** extend `procurementAdapter.ts` `procurement`/`goods-receipt`; read back booked quantities; the order's received status is read, not typed (FR-OPP-034).
- **P4-T5 (bed)** AC-OPP-030, 031: order 10, receive 6 then 4; on-hand rose by 6 and 4; 11 refused. If V-OPP4 said unavailable, the bed test asserts the refusal instead (AC-OPP-031b).
- **P4-T6** repository/DAL display of booked vs entered quantity (extend `procurement.external.test.ts`).
- **Build notes (P4, 2026-11-03).** (1) Odoo opens the incoming transfer when the order is confirmed, so PMO mints no document: a receipt writes the done quantity on each move of the order's single open incoming transfer (zero on lines it does not name), validates it, completes the stock backorder wizard for a partial and reads the transfer back. Any other follow-up wizard is `receipt-unavailable`; a tracked product's missing lot is Odoo's own refusal and is not supported in O2. More than one open transfer, or a move with no order line, is refused before any write. (2) The receipt's plan (what Odoo had received per line, `base`, and what this receipt adds) is computed from live Odoo on the first attempt, refused above the open quantity before any outbox row (AC-OPP-031), stored in the outbox payload and read back verbatim on every retry; a stored plan that is unreadable or fails its digest is refused, never recomputed from a state the receipt itself changed. Its digest is the third part of the key `gr:<receipt id>:<digest>` (PD-4). (3) The anchor is the stock external identifier on the open transfer, written BEFORE the validate: a retry that finds the anchored transfer done adopts it, but only when Odoo booked exactly this receipt's quantities, and stays correct after a later receipt moved the order on. With no anchor, the order's received quantities at the plan's base mean nothing was booked (the adapter does it); anything else (the plan's cumulative with no anchor to prove it ours, another receipt, half booked) holds. This is stricter than FR-OPP-033's "adopt when equal": equal quantities alone cannot show the receipt was ours. (4) A write that another writer changed before the validate (a second receipt, a clerk in Odoo) is `receipt-conflict` and nothing is validated. (5) The entered quantities travel as `receiptLines: [{itemRef, quantity}]` on the command (the order body's line identity, read through the item mapping); none means every open quantity, as ERPNext receives the case lines. The repository's `createReceipt` signature is unchanged: the entry control and its parameter belong to P8. (6) The canonical carries `odoo_booked` and `odoo_entered` per line and `odoo_receipt_status` (Complete only when every order line is received in full, read from Odoo); the shared receipt mirror writer stores that status when present and is byte-for-byte for ERPNext. The booked and entered quantities are not persisted columns: P7/P8 own that. (7) `GAP_COVERED.receipt` is true: the probe answers "nothing" only when the quantities are provably at base. (8) The fake Odoo now opens a transfer on confirm, books `qty_received` on validate and leaves zero-quantity moves on the backorder (bed V-OPP3/4 behaviour). (9) Review round: Odoo numbers ids per model, so every purchase external ref is model-qualified (`odooExternalRef(model, id)` in `purchase/anchors.ts`, e.g. `purchase.order:42`, `stock.picking:42`; bills and payments use `account.move:<id>` / `account.payment:<id>`); the receipt's `po_id` canonical is the order's qualified ref. A bare ref is not read as an order. No real Odoo org exists yet, so no bare refs need migrating. The fake Odoo numbers ids per model. A transfer belongs to the first receipt that anchored it: a second receipt finding another receipt's identifier on the transfer holds, and a done transfer carrying another receipt's identifier is never adopted. (10) Booked and entered quantities per line (FR-OPP-034, `odoo_booked`/`odoo_entered`) are owned by **P7-T1** (decides the columns and persists them in the mirror writer); P8 only displays them.
- Final gate + review battery as P3.

## P5 — Vendor bill and withholding push (Director-dispatched; ships alone)

ACs: 020, 040–046. No new migration.

- **P5-T1 (red)** `odoo/purchase/billBody.test.ts`: vendor invoice number → vendor-reference field, vendor date, due date, lines with `purchase_line_id` when the bill names an order else free-standing, explicit tax ids, cost account on every line, anchor not the vendor reference (FR-OPP-040).
- **P5-T2 (green)** `billBody.ts`; no-tax-chosen path resolves the company default purchase tax from the mirror and runs `taxValidate` first (AC-OPP-046).
- **P5-T3 (red→green)** adapter cases on the fake: create then post, fault between, lost response (AC-OPP-041); mismatch path (AC-OPP-044) sets `needs attention` and never overwrites; missing cost account on a read-back line sets `needs attention: cost account missing` (AC-OPP-020 U). Mutation check: make `compareSent` always `match` → AC-OPP-044 test red; restore.
- **P5-T4** bill write-back into the existing PMO columns (`amount` gross, `tax_amount` VAT, `withheld_amount`, `erp_outstanding_amount`) via the shipped finalize path; the 0196/ADR-0082 constraint (`withheld` sign-matched, no larger than gross) is respected: a read-back that would violate it refuses the mirror write and flags the bill (U, extend `readModelWriters` tests if a shared writer is touched).
- **P5-T5 (P)** pgTAP `supabase/tests/odoo_bill_ceiling.test.sql` (AC-OPP-045): a bill above the ceiling is refused by the database before an outbox row; skip if the shipped `procurement_payment_within_ceiling` pgTAP already covers it for any tier (builder confirms and cites the file).
- **P5-T6 (bed)** AC-OPP-040, 020: order then bill 100 + PPN 11% + PPh 23 2%; gross/VAT/withheld/net equal Odoo's to the cent; bill lines carry the cost account; free-standing bill likewise.
- Final gate + review battery.
- **Build notes (P5, 2026-11-03).** (1) The bill anchor is the stock external identifier (`bill_<id>`), written right after the create; the vendor reference is the vendor's own invoice number and nothing else. A bill is created, anchored, posted: `recoverBill` (the outbox recovery probe) finds it by identifier, else by the composite (vendor, untaxed total, line count, window; vendor bills only, no PMO identifier), anchors it, posts a draft and returns it read back; exactly one match adopts, any other unanchored bill of the vendor in the window throws (held). `GAP_COVERED.bill` is true but a bill is still never reissued on a miss (OQ-OPP-10). (2) Taxes: the command's `taxIds` (P8 adds the picker; the repository does not forward them yet), else the binding's `purchase_tax_ids`, else none; the tax line is always sent explicit, `[[6,0,[]]]` included. Validation reads the mirrored directory (rate, scope, active) and, because the mirror holds neither, Odoo read-only for the tax's company and for a withholding tax's repartition account being a liability account. A refusal is `config-rejected` naming the tax, at adapter selection, before any outbox row; a replay resolves nothing at selection. (3) The figure PMO sent is computed from the lines and explicit rates (per-line, per-tax, half away from zero) and persisted with the outbox row beside the composite (`odoo_expected_total`, `odoo_cost_account`; derived, so outside the payload digest); a recovered bill is judged against the stored one. A difference over one cent, or a posted line without the cost account, puts `odoo_outcome: needs-attention` and `odoo_attention` on the canonical; Odoo's own money is still what is mirrored. **The mirror has no column for that flag yet: P6's payment gate and P7/P8 must read it (a bill that is needs-attention is not payable until confirmed, FR-OPP-044).** (4) A money header that is incomplete or that 0196 would refuse leaves the money keys out of the canonical; the shipped writer refuses a create, and (one line added) now also writes neither the outstanding amount nor the status on an update when that key is absent. (5) AC-OPP-045: no create-time bill ceiling exists on any tier. The shipped rule is the payment-time ceiling over the mirrored bills (`procurement_payment_within_ceiling`, tier-agnostic: `0349_procurement_payment_ceiling.test.sql`, `procurement_erp_link_guards.test.sql` I-1), so no pgTAP was written and no migration added; the payment gate test for tier odoo is `odooGates.test.ts`. (6) Odoo numbers ids per model, so the bill's external reference is model-qualified (`account.move:<id>`, `purchase/externalId.ts`, the one place that builds and reads it) and the fake numbers ids per model; a test pushes an order and a bill that are both 1000. The order's reference is still the bare id (P3); the P4 fix round's shared helper should converge on this form. (7) Bed (Odoo 20): the company with the Indonesian chart had no warehouse, so an order there fails `picking_type_id` until one is seeded; the bed test seeds it once. Bill line unit field (`product_uom_id`) is not exercised: PMO bill lines name no unit.

## P6 — Vendor payment push (Director-dispatched; ships alone)

ACs: 050–055, 053, 054. Migration **0508**.

- **P6-T1** read the shipped `payment`-path DDL and the `transition_procurement` Paid branch; record in the PR body what `0508` must change for an Odoo-tier payment (spec §11).
- **P6-T2 (red)** pgTAP `supabase/tests/odoo_vendor_payment_gate.test.sql`: `procurement_payment_allowed` and the ceiling accept/refuse an Odoo-tier payment as an ERPNext one; held-row resolution RPC: creator refused, Engineer refused, Finance and Admin succeed, audit row written (AC-OPP-064 P half).
- **P6-T3 (green)** `supabase/migrations/0508_odoo_vendor_payment_gate.sql` + down; definers added to the 0178 allow-list and inventories.
- **P6-T4 (red)** `odoo/purchase/paymentBody.test.ts` (AC-OPP-050/051): bill reference required, posted bill only, amount in `(0, outstanding]`, company currency, journal from the config default or the override; refusals before any write.
- **P6-T5 (green)** `paymentBody.ts`.
- **P6-T6 (red)** adapter cases on the fake (AC-OPP-052, 053): fault after create, after post, after reconcile, lost response → one posted, reconciled payment; post-window probe 0 matches → `hold`, 2 matches → `hold`, unique conjunction → `adopt`, never `create`. **Mutation check (PD-7):** make the decision "reissue" on 0 matches → red; restore.
- **P6-T7 (green)** `procurementAdapter.ts` `procurement`/`payment`; payer attribution from the JWT subject through the shipped stamp path; partial payments (40 then 58); overpay refused before the write.
- **P6-T8 (red→green)** Deno served-handler test `odooVendorPaymentGate.served.test.ts` (modelled on `vendorPaymentGateServed.test.ts`): approver, bill author, third Finance user, with a payload claiming `paid_by` (AC-OPP-054): only the third succeeds, recorded payer is the JWT subject, refusals leave no outbox row and no Odoo call. Mutation check: gate allows → red.
- **P6-T9 (U)** AC-OPP-055: payment accepted and residual still positive → bill shows "payment sent, awaiting Odoo", not Paid (status derivation test in `odoo/purchase/status.test.ts` plus the repository selector).
- **P6-T10 (bed)** AC-OPP-050, 062: pay 98 of a net-payable-98 bill from the chosen journal; residual 0; split 40+58; 99 refuses; proxy-kill interruption after commit → sweep tick links and confirms with one payment; anchor edited in Odoo → `held`.
- Final gate + review battery (security-auditor mandatory; the held resolve RPC and the SoD gate are the focus).

## P7 — Inbound feed, status reconciliation, link-existing, census (Orca worker; security-auditor mandatory; DB lock)

ACs: 062 (derived status via feed), 070, 073, 074, 071/072 production wiring. Migrations **0506**, **0507**.

- **P7-T1** read the shipped mirror DDL (`purchase_orders`, `procurement_receipts`, `procurement_invoices`, `payments`, the procurement mirror guard, the ERPNext feed writers in `readModelWriters.ts` and `_shared/erpnextFeedDeps.ts`); record which `erp_*` columns Odoo can reuse and which facts need new columns. Includes the receipt's booked and entered quantities per line (P4 build note 10): P7 persists them, P8 shows them.
- **P7-T2 (red)** pgTAP `supabase/tests/odoo_purchase_mirror_guard.test.sql` (AC-OPP-070): two orgs; a user JWT cannot insert/update any mirror column; a service-role page apply carrying org B's context cannot touch org A's rows; `force row level security` intact.
- **P7-T3 (green)** `0506_odoo_purchase_mirror_columns.sql` + down: additive columns, guard extension.
- **P7-T4 (red)** pgTAP `supabase/tests/odoo_purchase_page_apply.test.sql` (AC-OPP-074 DB half, 073 DB half): page apply upserts and advances the watermark in one transaction; an older `write_date` never overwrites a newer row; a failure leaves the cursor; census tombstones a missing bill and clears when it returns; org taken from the binding, a body `org_id` ignored.
- **P7-T5 (green)** `0507_odoo_purchase_feed_apply.sql` + down; grants per 0137; inventories per 0136/0178.
- **P7-T6 (red→green)** Deno `supabase/functions/_shared/odooPurchaseFeed.test.ts`: filters (`in_invoice`, outbound supplier), overlap window, keyset paging, mapping through `status.ts` and `moneyHeader.ts` (whole-header rule, AC-OPP-043 production wiring), unmapped vendor/project → row stored with a `needs attention` reason, not dropped; a replayed window writes identical rows (AC-OPP-074 U); a record committed late is picked up.
- **P7-T7** `_shared/odooSweep.ts` / `odoo-sweep/index.ts`: add four purchase passes and the census for them to the tick, inside the existing single-flight lease and budget; skipped for disconnected / non-activated / kill-switched orgs; Deno test extends `odooSweep.test.ts`.
- **P7-T8 (link-existing, AC-OPP-072)** Odoo-native order/bill appear once at newest figures; an anchored orphan (anchor present, no `external_refs` row) is surfaced as an adoption proposal row, never auto-created again; the PMO case's value counts a linked document once (#1350 behaviour, tier odoo): extend `ErpPurchases` repository tests (`pmo-portal/src/lib/repositories/erpPurchases.test.ts`).
- **P7-T9 (bed)** AC-OPP-073: delete a bill in Odoo, census, tombstone, not counted.
- Final gate; `security-auditor` review is a merge condition.

## P8 — PMO screens (Orca UI worker; impeccable + taste + ui-ux-pro-max; one rendered review)

ACs: 080–083. No migration. UI/redesign lane (CLAUDE.md): machine gates + `scripts/ux-proof.sh` on touched routes; Director does one rendered review; cap one review + one fix.

- **P8-T1 (red)** component tests (extend `pages/ProcurementDetails.test.tsx` and `src/components/procurement`): outcome class strings for confirmed / pending / held / needs-attention / refused, the as-of age, the next step; unhealthy connection keeps last data and actions fail honestly with nothing queued (AC-OPP-080).
- **P8-T2 (green)** outcome badge + helper text component (new, `src/components/procurement/OdooOutcome.tsx`), wired to the repository's external-outcome read; i18n keys in `public/locales/en` **and** `id`.
- **P8-T3 (red→green)** withholding display reuse: VAT / tax withheld / net payable under the amount, shown only when withheld > 0 (reuse the shipped component from #876; AC-OPP-081); tax and journal pickers from the mirrored directories, disabled with a reason when empty/stale.
- **P8-T4 (red→green)** held list for Admin and Finance with the two resolve actions behind `ConfirmDialog`; `can()`/`<CanWrite>` gating on the real JWT role; impersonation view-only (AC-OPP-082).
- **P8-T5** setup checklist: payment-journal default row (accept proposed).
- **P8-T6** axe + 320 px + i18n parity checks; sibling suites that mock these sections (grep `ProcurementDetails` mocks) run.
- **P8-T7** `scripts/ux-proof.sh` on the touched procurement routes; capture and attach; Director rendered review.

## P9 — Declarations, parity, vocabulary guard, cutover, acceptance (Director-dispatched)

ACs: 084, 090. No migration.

- **P9-T1 (red)** flip `odoo/workflowDeclarations.ts` entries `purchase.push`, `bill.push`, `vendor-payment.push`, `purchase.link-existing`, `cutover.purchase`, `cutover.activation`, `purchase-order.revise` to `supported` at version 1 in a test first (`contractSuite/parity.test.ts` and `odoo/contract.test.ts` red because the harness path is not yet wired to production code); delete `odoo/purchase/suites.scratch.test.ts`.
- **P9-T2 (green)** wire the harness to the production functions (P1-T8's shared `procurementPreflight`, P3–P6 adapter via the fake); parity green (AC-OPP-084).
- **P9-T3** vocabulary guard (AC-OPP-083): extend the guard list with the new model/field names; verify red when a model name is planted in `pmo-portal/src/lib/repositories`, then restore.
- **P9-T4 (E)** `pmo-portal/e2e/AC-OPP-090-odoo-purchase-to-payment.spec.ts`: the curated journey as one real user would walk it: approved purchase → record receipt → record bill with VAT and PPh → a different Finance user pays → status Paid; asserts DB rows **and** rendered figures (VAT, withheld, net payable, status); interruption + recovery leg. Gated on the dependency (`ODOO_BED_URL`/served functions), never on `CI`; `@e2e-isolation` tag per `docs/e2e-parallel-conventions.md`; run `scripts/e2e-local.sh AC-OPP-090` under the locks.
- **P9-T5 (B)** the composite bed run of AC-OPP-010/030/040/050/052/062 in one session; paste output.
- **P9-T6** runbook: `docs/environments.md` Odoo section gets the minimal group set (P0-T10), "double validation must be off", the journal default, the held-row procedure; no host/tenant names.
- **P9-T7** update `docs/backlog.md` § CURRENT STATE and the pinned roadmap issue body source per the repo rule (when a Now item ships); add OD/DD lines for signed owner decisions to `docs/decisions.md`.
- **P9-T8** the owner-facing demo script (synthetic data) in the PR body.

---

## 4. Traceability: AC → owning layer → test file

| AC | Layer | Test (path, `AC-OPP-###` leads the test title) |
|---|---|---|
| 001 | U (+B) | `pmo-portal/src/lib/adapterSeam/odoo/purchase/preflight.test.ts` (+ `supabase/functions/adapter-dispatch/odooPurchase.bed.test.ts`) |
| 002 | U | shared `cutoverPurchaseSuite`/`cutoverActivationSuite` via `odoo/contract.test.ts` |
| 003 | U | shared `purchasePushSuite`/`billPushSuite`/`vendorPaymentPushSuite` via `odoo/contract.test.ts` |
| 004 | P | `supabase/tests/odoo_procurement_enable.test.sql` |
| 010 | B | `supabase/functions/adapter-dispatch/odooPurchase.bed.test.ts` |
| 011, 012, 013, 014, 015 | U | `odoo/procurementAdapter.test.ts`, `odoo/purchase/orderBody.test.ts`, `supabase/functions/adapter-dispatch/odooGates.test.ts` |
| 016 | B | `odooPurchase.bed.test.ts` |
| 017 | D | `supabase/functions/adapter-dispatch/poReviseGuard.test.ts` |
| 020 | B | `odooPurchase.bed.test.ts` (U secondary: `procurementAdapter.test.ts`) |
| 021 | U (+P) | `odoo/purchase/orderBody.test.ts` · `supabase/tests/odoo_project_links_config.test.sql` |
| 030, 031 | B | `odooPurchase.bed.test.ts` |
| 032 | U | `odoo/procurementAdapter.test.ts` |
| 040 | B | `odooPurchase.bed.test.ts` |
| 041 | U | `odoo/procurementAdapter.test.ts` |
| 042 | U | `odoo/purchase/taxValidate.test.ts` |
| 043, 044 | U | `odoo/purchase/moneyHeader.test.ts` |
| 045 | P | `supabase/tests/odoo_bill_ceiling.test.sql` (or the shipped ceiling pgTAP, cited) |
| 046 | U | `odoo/purchase/billBody.test.ts` |
| 050 | B | `odooPurchase.bed.test.ts` |
| 051, 052, 053 | U | `odoo/purchase/paymentBody.test.ts`, `odoo/procurementAdapter.test.ts` |
| 054 | D (+P) | `supabase/functions/adapter-dispatch/odooVendorPaymentGate.served.test.ts` (+ `supabase/tests/odoo_vendor_payment_gate.test.sql`) |
| 055 | U | `odoo/purchase/status.test.ts` |
| 060 | P | `supabase/tests/odoo_procurement_enable.test.sql` |
| 061 | U | `supabase/functions/adapter-dispatch/odooGates.test.ts` (error classes: `odoo/purchase/errors.test.ts`) |
| 062 | B | `odooPurchase.bed.test.ts` |
| 063 | U | `odoo/purchase/constants.test.ts` |
| 064 | D+P | `odooGates.test.ts` + `supabase/tests/odoo_vendor_payment_gate.test.sql` |
| 070 | P | `supabase/tests/odoo_purchase_mirror_guard.test.sql` |
| 071 | U | `odoo/purchase/status.test.ts` |
| 072 | U | shared `purchaseLinkExistingSuite` via `odoo/contract.test.ts` |
| 073 | B | `odooPurchase.bed.test.ts` (DB half in `odoo_purchase_page_apply.test.sql`) |
| 074 | U | `supabase/functions/_shared/odooPurchaseFeed.test.ts` |
| 080–082 | U | `pmo-portal/pages/ProcurementDetails.test.tsx`, `src/components/procurement/OdooOutcome.test.tsx` |
| 083 | U | vocabulary guard test (`odoo/vocabulary.test.ts`, extended) |
| 084 | U | `pmo-portal/src/lib/adapterSeam/contractSuite/parity.test.ts` |
| 090 | B+E | `odooPurchase.bed.test.ts` composite + `pmo-portal/e2e/AC-OPP-090-odoo-purchase-to-payment.spec.ts` |

Coverage is never lost by moving an AC to a higher layer; a layer is chosen once, here (ADR-0010).

## 5. Risks and ceilings

- **Anchors on Odoo are editable.** Mitigation: held-on-inconclusive for bills and payments (OQ-OPP-10), composite probe for payments; ceiling: a person must clear a held row; upgrade path: if P0-T2 finds a system-owned field, that kind moves to the reissue-capable class.
- **Wizard-bound steps (backorder, payment register) may not be completable by stock calls.** Mitigation: P0 stop rule; the AC has a named alternative (031b); never a module.
- **Odoo double validation on.** Mitigation: runbook + honest "waiting inside Odoo" state; no auto-approve.
- **Gate generalisation touches the ERPNext money path.** Mitigation: P2 ships alone, ERPNext suites are the proof, mutation checks recorded.
- **Clock skew and `write_date` ties** inherit O1's overlap window and keyset; ceiling documented there.
- **Latency.** Sweep-only plus post-write re-read (OQ-OPP-11); webhook nudge is a later optional slice.
- **Throughput.** A first scan of a large Odoo purchase history is bounded per tick by the O1 budget; the user sees "scanning" with progress, not a stale zero.

## 6. Rollout

Dev only (owner ceiling 2026-10-17): each slice merges to `dev` on green `verify` + `unit` + (when run) `pgtap`; the browser suite runs on the release PR to `main`. Nothing is pushed or promoted to `main` or production by a worker. Production remains a separate, explicit, owner-gated instruction naming production. A backout of any slice is its `rollback/` down script plus a revert; the Odoo documents already created are Odoo's, and PMO's mirror rows are reconstructible from Odoo by a reset of the purchase watermarks (an O1 admin verb).
