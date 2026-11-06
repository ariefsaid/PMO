# Plan: a no-ERP org invoices a signed-off T&M claim (#1817)

> Map #1481. Spec: `docs/specs/time-and-materials-claims.spec.md` (FR-TM-030..037, AC-4). Floor ruling: `OD-VISION-ERP`
> (`docs/decisions.md`). Reuses: native revenue (`docs/specs/no-erp-revenue.spec.md`, migration `0275`/`0534`), the T&M
> sign-off bridge (`0517`), the claim fence (`0250` §7, extended `0517`). Executor: Director-dispatched, one fresh worker
> (money + SoD tier). Migration number: **0704** only; rollback `supabase/migrations/rollback/0704_native_tm_invoice_down.sql`.
> Base checked: `origin/dev` @ `67d5ed1ba`.

## 1. Problem

**Who:** Finance or Admin in an org with no ERP connected (revenue owned by PMO, `OD-VISION-ERP` floor).
**Doing what:** a time-and-materials claim has been assembled, the client signed it off, and a second person confirmed it
(`confirm_tm_signoff`). Finance now wants to bill it.
**Wrong outcome:** the claim row shows no "Create invoice" action, so the signed hours cannot be billed from PMO. The
org falls back to typing a free invoice by hand, which loses the link to the claim: the hours are not marked invoiced,
nothing stops billing the same claim twice, and the invoice does not carry the signed lines and rates.

## 2. Current paths (file:line, read on `origin/dev`)

| What | Where |
|---|---|
| Confirm writes the claim's `progress_claims` row (`kind='time_materials'`, `id` = claim id) + evidence, in one transaction. Works with no ERP. | `supabase/migrations/0517_tm_signoff.sql:212` (`confirm_tm_signoff`), insert at ~`:279` |
| Claim fence: blocks an unsigned/withdrawn T&M claim. It is a trigger on `external_command_outbox` only, so it never fires for a PMO-native insert. | `0517_tm_signoff.sql:300` (`assert_progress_claim_raisable`), trigger `0250_progress_billing.sql:665` |
| Invoice authors for a claim invoice (preparer, sign-off preparer, confirmer). Trigger on `sales_invoices` insert, keyed on `new.id` = claim id. Fires for any insert. | `0517_tm_signoff.sql:343` (`append_progress_claim_author`), trigger `0250:~690` |
| ERP raise is the only claim → invoice path. It rejects with `revenue-not-enabled` when revenue is not externally owned. | `pmo-portal/src/lib/repositories/workOrders.ts:96` (`raiseInvoice`) |
| UI gate: `canBill = may('create','progressClaim') && erp.connected && clientId !== null && claimScopeReady`. T&M's `canCreateInvoice` and `onCreateInvoice` use it, so no ERP = no button. | `pmo-portal/pages/project-detail/tabs/BillingTab.tsx:152`, `:563`, `:567` |
| The T&M panel renders the button only if `canCreateInvoice(claim.id)`; it shows "Invoiced · {{number}}" from `invoiceNumberFor`. | `pmo-portal/pages/project-detail/TimeAndMaterials.tsx:507`, `:510`, `:535` |
| ERP lines for a T&M claim are resolved from claim lines in the edge/dispatch layer. | `pmo-portal/src/lib/adapterSeam/erpnext/progressClaimItems.ts:39`, `dispatchRevenue.ts` |
| Native (no-ERP) invoice: one RPC makes the Draft with `pmo_native=true`, project VAT, caller as author. Always a fresh `gen_random_uuid()` id and free-typed lines, so it cannot carry a claim id. | `0534_feature_enforcement.sql:182` (`create_native_sales_invoice`, latest body), `0275_native_revenue.sql:189` (origin) |
| Native approve (approver ≠ every author), receipts, cancel. Unchanged by this plan. | `0275_native_revenue.sql:316` `transition_native_sales_invoice`, `:139` `assert_sales_invoice_approver` |
| Work-order reserve: unraised claims already count against their work order at confirm; an invoice with the same id excludes itself. | `0337_contract_quantities.sql:406` (`assert_work_order_invoiceable`), `0262_billing_by_work_order.sql:260` |
| Cancel → withdraw: `withdraw_tm_signoff` after the invoice is cancelled releases the hours; a withdrawn claim's invoice cannot be revived. Both are triggers on `sales_invoices`/`progress_claims`, so they work for native rows. | `0517_tm_signoff.sql:177`, `:184`, `:197` |
| Native DAL / repository / mutation helpers. | `pmo-portal/src/lib/db/revenueNative.ts:77`, `pmo-portal/src/lib/repositories/revenueNative.ts`, `pmo-portal/src/hooks/useTimeAndMaterials.ts:85-105` |
| The curated T&M e2e stops at the confirmed claim: "This lane has no live ERP bench". | `pmo-portal/e2e/AC-TM-018-time-and-materials-claim.spec.ts:443` |

Prior-art sweep: `scripts/prior-art.sh "T&M"`, `"claim invoice"`, `"no-ERP"`. Silent on any decision that excludes this.
`no-erp-revenue.spec.md` §2 lists "progress-billing claim invoices without an ERP" as out of scope for #784 (a deferral,
not a ruling). OD-NAR-1(5) defers "Invoice this work order" for no-ERP the same way.

## 3. Design (smallest change)

**One new RPC, no new table, no new status, no new fence.** `create_native_tm_invoice(p_claim uuid) returns uuid`
(SECURITY DEFINER, `search_path = public`). It is `create_native_sales_invoice` with the lines, customer, project,
work order and currency read from the confirmed claim instead of typed, and with the invoice `id` = the claim id.

Rules, in body order (same shape as `create_native_sales_invoice`, comments marked SECURITY):
1. `assert_is_active_member()`; role in (`Admin`,`Finance`) else `42501`. (Same role set as the ERP path, FR-TM-042.)
2. `assert_feature_on(org, 'sales_invoices')` (0534 rule).
3. `perform 1 from organizations … for share;` then refuse `42501` / detail `erp-owns-revenue` if `domain_externally_owned(org,'revenue')`. The ERP path stays the one for connected orgs.
4. Lock order: `lock_work_order_billing` (if the claim has a work order) → project row `for share` → claim row `for update`. Same as `confirm_tm_signoff`.
5. **Claim gate (the fence the outbox trigger gives the ERP path):** claim exists in the caller's org; `tm_claims.status = 'SignedOff'` and `confirmed_by is not null`; the `progress_claims` row (`id` = claim) exists with `withdrawn_at is null` and has at least one evidence row. Else `55000`, same messages as `assert_progress_claim_raisable` so the UI headlines work for both paths.
6. **Double-billing guard:** refuse `P0001` / detail `claim-already-invoiced` if a `sales_invoices` row with `id = p_claim` exists (any status, so a Cancelled one also blocks; the user withdraws the claim and re-assembles, exactly as for the ERP path, `0517:195`). The primary key is the backstop under concurrency; the claim row lock is taken first so the race returns the friendly error.
7. Project VAT, currency, customer: identical to `create_native_sales_invoice` (project `subject_to_vat` → project rate and base; VAT project with no rate → `vat-rate-missing`). Customer = `projects.client_id`; none → `P0002` / detail `no-client`. Currency = claim currency (equals project currency, checked at confirm; equals work-order currency when linked). Re-check both equal, refuse `23514` otherwise.
8. Lines built from `tm_claim_lines` (order by `kind`, `label`, `basis`): `description` = `label` + `' (' || unit || ')'` + `' standby'` when `basis='standby'` (cut to 140), `qty` = `units`, `rate` = `rate`, `item_code` null. Amount per line = `round(units*rate,2)` = the stored `amount` (the claim's CHECK already pins this; rounding differences from #1801 do not arise because no ERP recomputes). Header = Σ lines; refuse if it differs from `tm_claims.gross_amount` (`23514`, detail `claim-total-mismatch`).
9. Insert `sales_invoices` with `id = p_claim`, `pmo_native=true`, `status='Draft'`, `billing_kind='contract'` (FR-TM-034), `author_user_id = auth.uid()`; insert the caller into `sales_invoice_authors`. The existing `append_progress_claim_author` trigger adds preparer, sign-off preparer and confirmer, so the approver must differ from all four (FR-TM-035) through the unchanged `assert_sales_invoice_approver`.
10. `log_audit('tm_native_invoice.create', …)`. Grants: `revoke all … from public, anon; grant execute … to authenticated; alter function … owner to postgres`.

**Why a new RPC, not a `p_id` argument on `create_native_sales_invoice`:** that function is listed by signature in six pgTAP files, `0178` and the isolation manifest; and a client-supplied id on a general-purpose creator would need the whole claim gate inside it anyway. The cost of the copy is VAT/currency drift, covered by a parity test (AC-TM-023).

**Approve / receipts / cancel:** unchanged (`0275`). The invoice is an ordinary `pmo_native` Draft that appears in `/approvals` "Customer invoices awaiting you".

**FE:** the repository seam stays: add `invoiceNativeTmClaim(claimId)` to `TimeAndMaterialsRepository` (DAL `rpc('create_native_tm_invoice')`), a `useInvoiceTmClaimNative` mutation (invalidates `['progress-claims']` and sales-invoice queries), and in `BillingTab` a second gate:
`canBillNative = revenueMode === 'native' && may('create','salesInvoice') && clientId !== null` (no `erp.connected`). `canCreateInvoice` = `(canBill || canBillNative)` and the same claim-state checks; `onCreateInvoice` opens the existing confirm dialog, whose body and button copy switch by `revenueMode` ("A draft invoice is created in PMO from this claim. A different Admin or Finance user approves it." / "Create invoice"). The confirm runs the native mutation when `revenueMode==='native'`, else the unchanged ERP `raiseInvoice`. Refusal headlines: reuse the `55000` override and add `claim-already-invoiced`.

**Out of scope (and why it is safe to leave):** volume (BoQ) progress claims without an ERP (their lines come from a different table; #784 deferral stands); printable PDF (`OD-INV-PDF-1` follow-up); down-payment on T&M (`FR-TM-037`); ERP connect afterwards (the invoice is an ordinary `pmo_native` row, so `DD-NAR-11` freezes it and `OD-NAR-1(1)` tallies it with no change here).

## 4. Slices (TDD; red before green; each task 2-5 min)

Run everything from the worktree root unless a path says `pmo-portal/`. All DB work: `scripts/with-db-lock.sh`, reset + test in ONE hold. pgTAP gate output: grep for `Parse errors`.

### Slice A: database (migration 0704) — owning layer pgTAP

Fixture: copy fixture F1 from `supabase/tests/tm_signoff.test.sql:1-60` (org with Finance ×2, Admin, PM, Engineer; foreign-org admin; one-member org). Ids prefix `17170000-…` (namespaced). Org A has no `external_domain_ownership` revenue row (native). Seed one SignedOff claim by calling `prepare_tm_signoff` / `confirm_tm_signoff` as two different Finance users, as `tm_signoff.test.sql` does.

| # | Task | File | Verify |
|---|---|---|---|
| A1 | Write `supabase/tests/tm_native_invoice.test.sql` (begin; pgtap; plan(N); rollback). Tests below, all red (function missing). | `supabase/tests/tm_native_invoice.test.sql` | `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/tm_native_invoice.test.sql'` → fails with "function … does not exist" |
| A2 | Write `supabase/migrations/0704_native_tm_invoice.sql` with the RPC per §3. Header comment cites #1817, FR-TM-030..037, `OD-VISION-ERP`. | `supabase/migrations/0704_native_tm_invoice.sql` | same command → A1 green, 0 `Parse errors` |
| A3 | Rollback: `drop function if exists public.create_native_tm_invoice(uuid);` and refuse (raise) if any `sales_invoices` row has `pmo_native` and `id` in `tm_claims` (rows made by this RPC cannot be told apart from history; the rollback file says so and aborts instead of orphaning). | `supabase/migrations/rollback/0704_native_tm_invoice_down.sql` | `scripts/with-db-lock.sh bash -c 'psql … -f rollback'` via the repo's rollback runner pattern in `supabase/tests/0410_billing_kinds_down_runner.sql`; add `supabase/tests/0704_native_tm_invoice_rollback.test.sql` modelled on `0410_billing_kinds_rollback.test.sql` |
| A4 | Isolation manifest entry for the new function; run live and self-test. | `scripts/isolation-probe-denominator.json` (add `create_native_tm_invoice(uuid)` in the function list and a `write` probe with `expect_denial` 403/`42501` and 500/`P0002`, source `supabase/migrations/0704_native_tm_invoice.sql:<line>`) | `scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs` and `node scripts/check-isolation-denominator.mjs --self-test` |
| A5 | Update the sibling files that enumerate native creators: `supabase/tests/0275_native_revenue_acl.test.sql` (EXECUTE not to `public`/`anon`, `authenticated` yes), `supabase/tests/0178_anon_executable_definers.test.sql` (grep for the allow-list/count; the new function is not anon-executable so the count must not move, assert that), `supabase/tests/0275_revenue_write_roles.test.sql` (add the role matrix row for the new RPC). | those three | `scripts/with-db-lock.sh supabase test db supabase/tests/0275_native_revenue_acl.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0275_revenue_write_roles.test.sql` |
| A6 | Run sibling suites that touch what 0704 touches (invoice insert triggers, claim fence, authors, work-order billing): `tm_signoff`, `tm_assembly`, `0275_native_revenue_create`, `_approve`, `_crossing`, `billing_kinds`, `line_pricing_parity`, plus `grep -l "sales_invoice_authors\|progress_claims" supabase/tests/*.sql` (run those too). Also pgTAP 0136 (side-mirror inventory) and 0137 (service_role grants) files: `ls supabase/tests \| grep -E "0136\|0137"`. | none | `scripts/with-db-lock.sh supabase test db <files>`; grep output for `Parse errors` and `not ok` |
| A7 | Mutation checks inside ONE lock hold, each restored in the same hold: (1) change `status = 'SignedOff'` check to `true` → AC-TM-020 unsigned test must go red; (2) drop the `claim-already-invoiced` check → AC-TM-021 must go red; (3) drop the role check → AC-TM-022 must go red; (4) drop the `domain_externally_owned` refusal → AC-TM-022b red. Paste red output in the report. | none | `scripts/with-db-lock.sh bash -c '<apply mutation>; supabase test db …; <git checkout the migration and db reset>'` |

pgTAP tests in `tm_native_invoice.test.sql` (one owning test per AC; description's leading token is the AC id):

- `AC-TM-020: Finance creates a Draft native invoice from a signed-off claim` — the issue acceptance. Given org A (no ERP) and claim C1 signed off (120 h × 50,000.00 = 6,000,000.00, project not subject to VAT), when Finance user F1 calls `create_native_tm_invoice(C1)`, then `sales_invoices` has id = C1, `pmo_native`, `status='Draft'`, `amount=6000000.00`, `billing_kind='contract'`, `native_lines` one line qty 120 rate 50000 with the label in its description. (The creator may also be an author; only the approver is restricted. AC-TM-019 already exists in the spec; this plan registers AC-TM-020..026.)
- `AC-TM-021: unsigned / withdrawn / foreign claims are refused` — Draft claim → `55000` "confirm the client's sign-off…"; Withdrawn claim → `55000` "withdrawn"; claim of org B called by org A's Finance → `P0002`; random uuid → `P0002`.
- `AC-TM-022: double billing is refused` — second call → detail `claim-already-invoiced`; after the first invoice is cancelled (`transition_native_sales_invoice(…,'Cancelled')`) a third call is still refused; after `withdraw_tm_signoff` the hours are released and a NEW claim assembled from them can be invoiced once. Concurrency note: not tested in pgTAP (single connection); the PK is the backstop and `0275_native_revenue_serialise.test.sql`'s pattern is not copied (no race the lock order does not already cover).
- `AC-TM-023: access and ownership` — PM, Engineer, Executive → `42501`; inactive Admin → refused; org with an `external_domain_ownership` revenue row → `42501` detail `erp-owns-revenue`; feature `sales_invoices` off → typed `feature_off`; anon cannot execute.
- `AC-TM-024: SoD on approval` — the invoice's author set contains the creator, the claim preparer, the sign-off preparer and the confirmer; `transition_native_sales_invoice(inv,'Unpaid')` by each of them → `42501` / `sod-self-approval`; by a third Admin → `Unpaid`, `INV-` number minted.
- `AC-TM-025: tax and currency parity` — on a VAT project (12% on 11/12) the tax of the T&M invoice equals the tax `create_native_sales_invoice` yields for the same single-line body (compare the two rows); VAT project with no rate → `vat-rate-missing`; a claim with a work order draws on it (`work_order_billing_lines` total unchanged vs. before invoicing: the claim already counted, the invoice must not count twice).
- `AC-TM-026: consistency` — header = Σ lines = claim `gross_amount`; the claim row, progress-claim row and invoice share one id; `audit_events` has `tm_native_invoice.create`; an equipment `standby` line renders "(hour) standby" in the description.

### Slice B: data layer — owning layer Vitest

| # | Task | File | Verify |
|---|---|---|---|
| B1 | Regenerate `pmo-portal/src/lib/supabase/database.types.ts` for the new RPC using the repo's existing method for this file (check `docs/environments.md` / git log of the file; if unsure add the one function type by hand in the file's existing `Functions` format, args `{ p_claim: string }`, returns `string`). Do not run `supabase` outside the DB lock. | `pmo-portal/src/lib/supabase/database.types.ts` | `npm run typecheck` (inside `pmo-portal/`, under `scripts/with-test-lock.sh`) |
| B2 | Red test: `invoiceTmClaimNative` calls `supabase.rpc('create_native_tm_invoice', { p_claim })`, returns the id, maps an error through the file's existing `fail`. Test name `AC-TM-020 DAL: invoiceTmClaimNative sends the claim id and returns the invoice id`. | `pmo-portal/src/lib/db/timeAndMaterials.test.ts` | `cd pmo-portal && scripts/with-test-lock.sh npx vitest run src/lib/db/timeAndMaterials.test.ts` red |
| B3 | Add `invoiceTmClaimNative` to the DAL. | `pmo-portal/src/lib/db/timeAndMaterials.ts` (next to `confirmTmSignoff`, ~`:374`) | same → green |
| B4 | Add `claim-already-invoiced`, `no-client`, `claim-total-mismatch` to `NATIVE_REVENUE_REFUSALS` and a test that the detail code is surfaced as the error code. | `pmo-portal/src/lib/db/revenueNative.ts` (list near `:55`), its test file | `npx vitest run src/lib/db/revenueNative.test.ts` |
| B5 | Contract + repository: `invoiceNativeTmClaim: typeof dal.invoiceTmClaimNative` on the interface; wire `wrap(() => dal.invoiceTmClaimNative(claimId))`. Red test first in the repo test: `AC-TM-020 repo: invoiceNativeTmClaim never dispatches to an ERP`. | `pmo-portal/src/lib/repositories/contracts/timeAndMaterials.ts`, `pmo-portal/src/lib/repositories/timeAndMaterials.ts`, `pmo-portal/src/lib/repositories/__tests__/timeAndMaterials.test.ts`, `pmo-portal/src/lib/repositories/composition.test.ts` (it enumerates repository members: add the new one) | `npx vitest run src/lib/repositories/__tests__/timeAndMaterials.test.ts src/lib/repositories/composition.test.ts` |
| B6 | Hook `useInvoiceTmClaimNative` via `useTmMutation(…, ['progress-claims', 'sales-invoices'])` after checking the keys the Sales Invoices list and the approvals queue use (`grep -rn "queryKey: \['sales" pmo-portal/src`) and invalidate those too. Red test in the hook test first. | `pmo-portal/src/hooks/useTimeAndMaterials.ts` (`:85-105`), `pmo-portal/src/hooks/useTimeAndMaterials.test.tsx` | `npx vitest run src/hooks/useTimeAndMaterials.test.tsx` |

### Slice C: UI — owning layer Vitest/RTL (+ axe), then rendered proof

| # | Task | File | Verify |
|---|---|---|---|
| C1 | Red tests in `BillingTab.test.tsx` (its `useErpItemOptions` mock has `connected`; add a `revenueMode` mock for `useRevenueMode`): `AC-TM-020 UI: no ERP, signed-off unraised T&M claim shows "Create invoice" to Finance`; `AC-TM-020 UI: confirm calls the native mutation, not the ERP raise`; `AC-TM-021 UI: no button for a Draft, a withdrawn, an already-invoiced claim`; `AC-TM-023 UI: no button for a Project Manager or Engineer`; `AC-TM-020 UI: with an ERP connected the ERP raise is used and the native one is never called` (regression). Use `userEvent` and role queries; no snapshot. | `pmo-portal/pages/project-detail/tabs/__tests__/BillingTab.test.tsx` | `scripts/with-test-lock.sh npx vitest run pages/project-detail/tabs/__tests__/BillingTab.test.tsx` red |
| C2 | Implement the gate and the dialog switch (§3 FE). `canCreateInvoice` / `onCreateInvoice` at `BillingTab.tsx:563-571`, `runRaise` at `:193` (branch on `revenueMode`), dialog copy at `:574-592`. Keep `canBill` unchanged for volume claims. | `pmo-portal/pages/project-detail/tabs/BillingTab.tsx` | same file → green |
| C3 | Refusal headlines: extend the `fail(err, {...})` map with `claim-already-invoiced` ("This claim already has an invoice.") and `no-client`. Test: toast text on the mocked refusal. | `BillingTab.tsx`, `BillingTab.test.tsx` | same |
| C4 | i18n keys in BOTH locales: dialog title/body/confirm for native, toast "Invoice drafted in PMO", the two headlines. Namespace is `project` (`pmo-portal/public/locales/{en,id}/project.json`, near `projectDetail.billing.claims.confirmRaise` at en `:226`). Plain words, no jargon; Indonesian by the existing glossary. | `pmo-portal/public/locales/en/project.json`, `pmo-portal/public/locales/id/project.json` | `cd pmo-portal && npm run check:guards` (it runs the locale parity check) |
| C5 | Sibling suites that mock BillingTab sections or the repository: `grep -rln "useProgressBillingMutations\|timeAndMaterials" pmo-portal/pages pmo-portal/src --include='*.test.tsx'` and run each file (at least `pages/project-detail/TimeAndMaterials.test.tsx`, `pages/__tests__/ProjectDetail*.test.tsx` if present). | none | `scripts/with-test-lock.sh npx vitest run <files>` |
| C6 | Rendered proof on the project Billing route with a signed-off claim in a no-ERP org: `scripts/ux-proof.sh <route>` (route per its usage text); Director does the one rendered review (impeccable + taste). | none | `scripts/ux-proof.sh <billing route>` clean |

### Slice D: journey + docs

| # | Task | File | Verify |
|---|---|---|---|
| D1 | Extend the curated journey (do NOT add a spec): replace the stop at `AC-TM-018-time-and-materials-claim.spec.ts:443` with: Finance clicks "Create invoice", confirms, sees the claim row read "Invoiced · Draft"; then (second user in the existing helper pattern: admin session via `login`) approve from `/approvals`, claim row shows `INV-…`. Oracle stays "invoice shows approved units and rate": open the invoice and assert the 120 h line quantity and rate (use the existing fixtures `HOURS`, `RATE`). Update the spec header comment (it says the lane has no ERP bench: now true and no longer a limit). | `pmo-portal/e2e/AC-TM-018-time-and-materials-claim.spec.ts` | `scripts/e2e-local.sh AC-TM-018` (read `docs/e2e-parallel-conventions.md` first; `@e2e-isolation` tag already self-isolated; a SignedOff claim and its invoice are retained as the current fixture is) |
| D2 | Spec: add rows AC-TM-020..026 to the traceability table and a one-paragraph "No-ERP orgs" note under AC-4 (FR-TM-038: *Where no ERP owns revenue, the system shall let Admin or Finance create the Draft invoice from a signed-off claim in PMO, with the claim's lines, at most one per claim.*). Docs only; push direct per repo rule when implementing. | `docs/specs/time-and-materials-claims.spec.md` | `git diff --stat` docs-only |
| D3 | `docs/decisions.md`: DD-TMN-1 (new RPC rather than `p_id` on the generic creator; invoice id = claim id is the double-billing guard) and the owner answers to §5 once given. `docs/backlog.md` § CURRENT STATE: close #1817 line. | `docs/decisions.md` | docs-only |

### Final local gate (builder, paste output bodies in the report)

In `pmo-portal/`: `npm run check:guards`; `scripts/with-test-lock.sh npm run typecheck`; `npx eslint --max-warnings=0 pages/project-detail/tabs/BillingTab.tsx src/lib/db/timeAndMaterials.ts src/lib/db/revenueNative.ts src/lib/repositories/timeAndMaterials.ts src/lib/repositories/contracts/timeAndMaterials.ts src/hooks/useTimeAndMaterials.ts` and the touched test files; touched vitest files (never the full suite). Root: the A-slice pgTAP files under the lock; `node --test scripts/*.test.mjs` is NOT needed unless `scripts/` changes beyond the denominator JSON (then CI's file set, per the common rules). Before the branch push: `git log --format=%B origin/dev..HEAD | grep -qi co-authored` finds nothing.

Migration-risk checklist: pgTAP 0137 (service_role grants: new function only, no table, so none needed), 0136 (no new table), 0178 (revoked from anon, count unchanged), isolation denominator (A4), `features.dbRegistry.test.ts` (no new feature key).

## 5. Owner questions (only the owner can answer; each has a default, none blocks the build)

1. **OWNER: Sole-operator org.** A one-person no-ERP org can sign off a claim (`sole_operator` basis) but can never approve the invoice, because approval needs someone outside the author set (`DD-NAR-5`, no Admin exemption, same as the ERP path). *Default:* leave as is (the invoice stays a Draft until a second user exists). *Alternative:* a sole-member exemption on native approval, mirroring `0298`. That changes a money SoD rule for all native invoices, so it is its own decision.
2. **OWNER: Volume (BoQ) progress claims without an ERP.** Same gap as #1817 but for quantity-based claims; their invoice lines come from `progress_claim_lines`. *Default:* out of scope here; filed as a follow-up once T&M ships, then reuse this RPC's shape.
3. **OWNER: Invoice line wording.** Default: one line per rate line, text `"<label> (<unit>)"` plus ` standby` for machine standby; no item code. *Alternative:* a per-org default sales item code or the rate line's own item mapping (the ERP path maps lines to ERP sales items, #1802). No ERP means no item master, so the default stands unless a printed invoice needs a code.
4. **OWNER: Cancelled invoice, same claim.** Default: a cancelled claim invoice cannot be re-created from the same claim; withdraw and re-assemble (matches the ERP path and `0517`). *Alternative:* allow re-invoicing the same signed claim after a cancel (needs a new invoice id, so the claim-id-equals-invoice-id rule would change).

## 6. Deviations and risks to report back

- This is a plan only; no code was run. Line numbers marked `~` were read from the file but not re-verified after the plan's last edit.
- `database.types.ts` regeneration method was not found in-repo by grep; B1 gives the fallback.
- The claim gate in §3 step 5 duplicates the outbox fence's logic in SQL. If a third claim kind appears, both must change; A6 includes the fence tests so a drift shows.
