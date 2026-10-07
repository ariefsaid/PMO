# #893 — PMO-owned e-Faktur facts

## Decision and design

`docs/decisions.md` (OD-ERP-3/OD-ERP-4) establishes that PMO is the client-facing accounting surface. This issue adds two nullable PMO facts to **both** existing read-model rows: `sales_invoices` and `procurement_invoices` (the vendor-invoice rows loaded by `getProcurementDetail()` and rendered as Invoice rows in `ProcurementLedger`). There is no separate Vendor Bills route in the current application.

**DD-EFK-1:** These are PMO-owned tax-register facts, never ERP ledger facts. Each is set directly through a narrow SECURITY DEFINER RPC, after any non-cancelled lifecycle state, and never dispatches an ERP command. The adapter’s service-role read-model writers must omit both columns on insert/update so a refresh cannot erase them. Consequently this slice deliberately makes **no** ERP custom-field, ERP-body, onboarding, outbox, dispatch, or amendment change.

Data flow:

`SalesInvoices` / `ProcurementLedger` → shared e-Faktur dialog validation → repository/DAL → one of two PMO RPCs → own-org row → React Query invalidation. Adapter refreshes independently update ERP-owned fields while omitting e-Faktur fields. The future #898 tax registers read the PMO columns directly.

The two existing tables already have RLS and an `org_id` seam; this migration creates no table and needs no new index because neither fact is a current filter/join key. The setter locks its target row, re-asserts the row’s `org_id`, active membership, and Admin/Finance role, rejects cancelled rows and invalid values, and leaves the underlying direct UPDATE grant closed. `date <= current_date` is evaluated in the RPC rather than a table CHECK so the date constraint is not a time-dependent schema constraint. Blank UI input is converted to NULL, so non-VAT documents remain valid.

Use a shared client validator only for immediate UX feedback; the RPC is authoritative. It trims outer whitespace, permits a nonempty 1–32-character number consisting of digits, `.` and `-`, and rejects a future date. The two fields are independently nullable; entering/clearing one does not fabricate a value for the other.

## Acceptance traceability

| AC | Outcome | Owning proof (lowest sufficient layer) |
| --- | --- | --- |
| AC-EFK-001 | Admin/Finance can atomically set or clear trimmed e-Faktur number/date on an own-org, non-cancelled sales invoice; direct writes, wrong role/org, disabled members, cancelled rows, future dates and invalid number shapes are refused. | `supabase/tests/0270_efaktur_number.test.sql` |
| AC-EFK-002 | The identical guarded PMO-only setter contract applies to a vendor bill (`procurement_invoices`). | `supabase/tests/0270_efaktur_number.test.sql` |
| AC-EFK-003 | ERP mirror refreshes preserve PMO e-Faktur facts on both row types and adapter writer patches never contain them. | `supabase/tests/0270_efaktur_number.test.sql` (DB preservation) and `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` (writer omission) |
| AC-EFK-004 | Sales Invoice detail/list shows both optional facts and permits only Admin/Finance to open the validated edit dialog and save via the sales setter. | `pmo-portal/pages/__tests__/SalesInvoices.efaktur.test.tsx` |
| AC-EFK-005 | The Procurement detail ledger shows both optional facts for Invoice rows only and permits only Admin/Finance to edit a non-cancelled vendor bill via its setter. | `pmo-portal/pages/procurement/ProcurementLedger.efaktur.test.tsx` |
| AC-EFK-006 | e-Faktur values remain absent from ERP body mappings and from the onboarding custom-field inventory. | `pmo-portal/src/lib/adapterSeam/erpnext/efakturOwnership.test.ts` |

No new Playwright journey is required: the user-visible states are fully owned by RTL, and the cross-stack authorization/storage behavior is owned by pgTAP. Do not add an e2e merely to duplicate those proofs.

## Implementation tasks

### 1. Record the binding ownership decision (2 min)

**Files:** `docs/decisions.md`.

Add `DD-EFK-1` immediately after `OD-ERP-4`: PMO alone stores e-Faktur number/date on sales invoices and vendor bills; ERP is headless, the references are not ledger facts and are usually learned after issuance; `commitAmend` would wrongly reissue a submitted document; #898 reads PMO. State the explicit exclusions: no ERP custom field, mapper, onboarding change, or outbox command. This is a scoped build ruling, not a new ADR.

**Verify:** `grep -n -A8 -B2 'DD-EFK-1' docs/decisions.md`.

### 2. Write the failing database contract first (4 min)

**Files:** add `supabase/tests/0270_efaktur_number.test.sql`.

Before the migration, create two isolated organizations, active Finance/Admin/Project-Manager/disabled-Finance fixtures, and a sales invoice plus vendor invoice in each org. Add AC-leading pgTAP descriptions proving:

- `AC-EFK-001` Finance and Admin can set both sales fields in Draft, Submitted/Unpaid, and Paid states; either NULL clears; direct `UPDATE` is refused; Project Manager, disabled Finance, wrong-org Finance, and Cancelled status are refused; future date, over-32 number, and non `[0-9.-]` number are refused.
- `AC-EFK-002` has the same success/refusal matrix for `procurement_invoices`, including a Paid vendor bill and its Cancelled status.
- `AC-EFK-003` seeds both PMO facts, performs the same shape of unrelated `service_role` status/mirror-field update the read-model writer performs, and asserts the values are unchanged. This is the database half of mirror preservation; it must not update either e-Faktur column.
- The new RPC function ACLs deny `public` and `anon`, retain `authenticated`, and the existing RLS/org seam still scopes reads/writes.

Start with a test count matching the exact assertions. It must fail against migration 0264 because the columns/functions do not exist.

**Verify (expected RED before Task 3):**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0270_efaktur_number.test.sql'
```

### 3. Add the reversible 0265 schema and guarded setters (5 min)

**Files:** add `supabase/migrations/0270_efaktur_number.sql`; add `supabase/migrations/rollback/0270_efaktur_number_down.sql`.

In **0265 only**:

1. Add nullable `efaktur_number text` and `efaktur_date date` to `public.sales_invoices` and `public.procurement_invoices`. Add per-table CHECKs that a non-null number is already trimmed, has length 1–32, and matches `^[0-9.-]+$`; do not add a date CHECK involving `current_date`.
2. Create `public.set_sales_invoice_efaktur(p_si_id uuid, p_efaktur_number text, p_efaktur_date date)` and `public.set_procurement_invoice_efaktur(p_invoice_id uuid, p_efaktur_number text, p_efaktur_date date)`, each `SECURITY DEFINER SET search_path = public`, returning its row type. For each: lock/select the row; return P0002 when absent; use the #767 pattern to require `row.org_id = auth_org_id()`, `auth_role() IN ('Admin','Finance')`, and `is_active_member()`; refuse Cancelled with `23514`; normalize blank input to NULL; validate the normalized number and `p_efaktur_date <= current_date` with `23514`; update only the two new columns and return the row.
3. Explicitly `REVOKE ALL`/`REVOKE EXECUTE` for each exact signature from `PUBLIC` and `anon`, grant execute only to `authenticated`, and include a migration `DO` assertion based on the function ACLs that aborts if either forbidden role retains EXECUTE. Do not re-grant table UPDATE or alter existing RLS policies; existing RLS stays the row-read wall and the RPC is the only client writer.
4. Make the down migration reverse in dependency order: revoke/drop both functions, drop the two constraints, then drop both columns. It must be a real restore path, not a comment.

**Verify (GREEN and type generation in one DB lock hold):**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && supabase test db supabase/tests/0270_efaktur_number.test.sql supabase/tests/0178_anon_executable_definers.test.sql'
```

### 4. Regenerate the typed client and update security denominators (3 min)

**Files:** regenerated `pmo-portal/src/lib/supabase/database.types.ts`; `supabase/tests/0178_anon_executable_definers.test.sql`; `scripts/isolation-probe-denominator.json`.

Do not hand-cast generated types. Retain the output from Task 3’s local generator and inspect that both table Row/Insert/Update shapes have the nullable columns and both RPC signatures/returns exist.

Add both setter names to the explicit client-callable SECURITY DEFINER allow-list in `0178_anon_executable_definers.test.sql`, update its explanatory comments, and re-derive the hard-coded count from the list (59 + 2 = **61**) for both ACL assertions. Add `set_sales_invoice_efaktur(uuid,text,date)` and `set_procurement_invoice_efaktur(uuid,text,date)` to `definer_functions` in `scripts/isolation-probe-denominator.json`, preserving its sorted order and exact signatures.

**Verify:**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && supabase test db supabase/tests/0270_efaktur_number.test.sql supabase/tests/0178_anon_executable_definers.test.sql'
grep -n 'efaktur_number\|set_sales_invoice_efaktur\|set_procurement_invoice_efaktur' pmo-portal/src/lib/supabase/database.types.ts scripts/isolation-probe-denominator.json
```

### 5. Add the PMO-only DAL/repository/mutation seam and policy gates (5 min)

**Tests first:** extend `pmo-portal/src/auth/policy.test.ts`; add/extend `pmo-portal/src/lib/db/revenue.test.ts`, `pmo-portal/src/lib/db/procurementLifecycle.test.ts`, and the applicable repository/hook tests (`pmo-portal/src/lib/repositories/revenue.test.ts`, `pmo-portal/src/hooks/useRevenue.test.tsx`, `pmo-portal/src/hooks/useProcurementDetail.test.tsx`) if present. Tests must show the RPC argument mapping trims/uses null only at the UI normalizer boundary, the correct query families invalidate, and `record_efaktur` is Admin/Finance only for both entities. Run them red before implementations.

**Files:** `pmo-portal/src/auth/policy.ts`; `pmo-portal/src/lib/db/revenue.ts`; `pmo-portal/src/lib/db/procurementLifecycle.ts`; `pmo-portal/src/lib/repositories/types.ts`; `pmo-portal/src/lib/repositories/index.ts`; `pmo-portal/src/hooks/useRevenue.ts`; `pmo-portal/src/hooks/useProcurementDetail.ts`.

- Extend `Action` with `record_efaktur` and `Entity` with `procurementInvoice`. Allow that action only to `REVENUE_WRITE` (Admin/Finance) for `salesInvoice` and `procurementInvoice`; use it only as the UX gate.
- Add `efaktur_number`/`efaktur_date` to `SalesInvoiceRow` and hydrate their null-safe values in `toSalesInvoiceRow`. Use generated `Tables<'procurement_invoices'>` for vendor fields rather than a shadow interface.
- Add thin typed DAL wrappers for the two generated RPCs, passing only record id, nullable number, and nullable date; never send `org_id`. Expose matching repository methods. Add `setEfaktur` mutations to the sales and procurement hooks, invalidating their existing org-scoped sales/procurement detail query keys on success. These setters must call the PMO RPC directly even when the domain is externally owned; do not call dispatch, create an outbox command, or set pending-push state.

**Verify:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/auth/policy.test.ts src/lib/db/revenue.test.ts src/lib/db/procurementLifecycle.test.ts src/lib/repositories/revenue.test.ts src/hooks/useRevenue.test.tsx src/hooks/useProcurementDetail.test.tsx'
```

### 6. Lock the adapter preservation boundary without adding an ERP feature (4 min)

**Tests first:** extend `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts` and the sales-invoice writer test in the same directory. Feed each writer canonical input containing representative e-Faktur keys, then assert both create/update payloads omit `efaktur_number` and `efaktur_date`; the existing ORM-style update can therefore not null PMO’s facts. Add `AC-EFK-003` to the new assertions.

**Files:** `supabase/functions/adapter-dispatch/readModelWriters.ts`; `supabase/functions/adapter-dispatch/readModelWriters.money.test.ts`; the sales-writer test file that owns `upsertSalesInvoiceMirror`.

Add concise DD-EFK-1 comments at the sales and purchase invoice patch construction points stating the e-Faktur fields are intentionally absent and PMO-owned. Do not add the fields to `canonical`, the insert spread, either mapper, ERP list fields, dispatch factory, onboarding, or outbox.

**Verify:**
```bash
cd supabase/functions/adapter-dispatch && deno test . --config deno.json --allow-env --allow-net --allow-read
```

### 7. Add a shared, accessible e-Faktur editor and negative ERP contract (5 min)

**Tests first:** add `pmo-portal/src/components/EfakturModal.test.tsx` and `pmo-portal/src/lib/efaktur.test.ts`; add `pmo-portal/src/lib/adapterSeam/erpnext/efakturOwnership.test.ts`. The first two must initially fail for trim/clear, 32-character punctuation-valid values, invalid characters, future-date disablement, labelled inputs, and save payload. The adapter test is an intentional no-op regression proof: supply opaque e-Faktur keys to `siToBody`/`piToBody` and assert neither ERP body gets a key; assert `ERP_CUSTOM_FIELDS` has no e-Faktur entry.

**Files:** add `pmo-portal/src/lib/efaktur.ts`; add `pmo-portal/src/components/EfakturModal.tsx`; add the three tests above; `pmo-portal/public/locales/en/common.json`; `pmo-portal/public/locales/id/common.json`.

Implement one pure normalizer/validator and one `EntityFormModal`-based editor reused by both surfaces. It receives current nullable values, labels/help/errors, loading state and `onSave({ efakturNumber: string | null, efakturDate: string | null })`. It uses `TextField` date/text controls, converts whitespace-only number/date-empty input to null, prevents a future date or invalid number before submit, exposes field-level errors, and permits both values empty. Add all new English and Bahasa Indonesia labels (number, date, edit/record, optional non-VAT help, invalid number, future date, saved) in their respective namespaces; do not hard-code visible copy.

**Verify:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/efaktur.test.ts src/components/EfakturModal.test.tsx src/lib/adapterSeam/erpnext/efakturOwnership.test.ts && npm run check:i18n'
```

### 8. Wire Sales Invoices display and edit state (5 min)

**Tests first:** add `pmo-portal/pages/__tests__/SalesInvoices.efaktur.test.tsx`. Mock the repository/hook as the existing Sales Invoice tests do and prove `AC-EFK-004`: populated number/date render as date-only values; empty fields render an honest dash; Finance/Admin see the row-menu action on Draft, Submitted/Unpaid, and Paid rows; PM/Executive do not; Cancelled rows have no action; valid dialog save calls `setEfaktur` with trimmed/null values, waits for success, and preserves a classified failure in the open dialog.

**Files:** `pmo-portal/pages/SalesInvoices.tsx`; `pmo-portal/pages/__tests__/SalesInvoices.efaktur.test.tsx`.

Add e-Faktur number and date columns to the existing invoice table/export projection and a `efakturTarget` state. Gate the row-menu item with `may('record_efaktur', 'salesInvoice')` and `status !== 'Cancelled'`; render the shared dialog and call `useRevenueMutations().setEfaktur`. Reuse `classifyMutationError`, `useToast`, date-only formatting, query invalidation, and existing row-menu/modal conventions. Do not route this save through the create/edit/cancel ERP command paths.

**Verify:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.efaktur.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx'
```

### 9. Wire Procurement vendor-bill ledger detail and edit state (5 min)

**Tests first:** add `pmo-portal/pages/procurement/ProcurementLedger.efaktur.test.tsx` and extend `pmo-portal/src/lib/db/procurementLedger.test.ts`. Prove `AC-EFK-005`: only Invoice ledger rows map/display the two values (other record types do not claim them); nulls display as dashes; an Admin/Finance-only Invoice row menu opens the shared editor; Cancelled invoice and non-Finance/Admin have no edit action; a valid save calls the passed procurement setter with the selected `recordId` and refreshes on success.

**Files:** `pmo-portal/src/lib/db/procurementLedger.ts`; `pmo-portal/pages/procurement/ProcurementLedger.tsx`; `pmo-portal/pages/ProcurementDetails.tsx`; the two tests above.

Extend `LedgerRow` and its invoice branch only with the two PMO values; leave all other record types `null`/unset. Add read-only Number and Date columns to `ProcurementLedger`, and use `DataTable`’s existing `rowMenu` only for Invoice rows. In `ProcurementDetails`, compute `can('record_efaktur', 'procurementInvoice', { realRole })`, pass that boolean and an `onSetEfaktur(invoiceId, values)` callback backed by `useProcurementMutations().setEfaktur`; keep modal state in `ProcurementLedger` and close only after a successful mutation. This retains responsive DataTable card behavior and avoids a new Vendor Bills route.

**Verify:**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/procurementLedger.test.ts pages/procurement/ProcurementLedger.efaktur.test.tsx pages/__tests__/ProcurementDetails.test.tsx'
```

### 10. Run the scoped final gate and inspect scope (4 min)

Run these after every touched test is green; do not weaken a test or regenerate `package-lock.json`.

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && supabase test db supabase/tests/0270_efaktur_number.test.sql supabase/tests/0178_anon_executable_definers.test.sql'
cd supabase/functions/adapter-dispatch && deno test . --config deno.json --allow-env --allow-net --allow-read
cd ../../..
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx eslint --max-warnings=0 pages/SalesInvoices.tsx pages/ProcurementDetails.tsx pages/procurement/ProcurementLedger.tsx src/components/EfakturModal.tsx src/lib/efaktur.ts src/lib/db/revenue.ts src/lib/db/procurementLifecycle.ts src/lib/db/procurementLedger.ts src/hooks/useRevenue.ts src/hooks/useProcurementDetail.ts src/lib/repositories/index.ts src/lib/repositories/types.ts src/auth/policy.ts && npx vitest run --changed origin/dev && npm run check:i18n'
git diff --check
git diff -- supabase/functions/adapter-dispatch pmo-portal/src/lib/adapterSeam/erpnext
```

The final adapter diff must contain only the explicit mirror-preservation comments/tests: no ERP custom field, body mapper, field list, onboarding, dispatch, amendment, or outbox change. The local PR gate is targeted evidence only; CI remains the full-suite merge authority.

## Files deliberately not changed

- `pmo-portal/src/lib/adapterSeam/erpnext/erpCustomFields.ts`, ERP body mappers, ERP read-field arrays, adapter dispatch factory, onboarding functions, and outbox code: DD-EFK-1 forbids a new ERP representation or push.
- Routes and e2e specs: there is no vendor-bills route to create, and each acceptance criterion has a lower-layer canonical proof.
- `package-lock.json`: no dependency change and macOS lock regeneration is prohibited.
