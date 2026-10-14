# UXS-031 — Tax-evidence recognition labels

**Spec:** `docs/specs/uxs-031-tax-evidence-labels.spec.md` (FR-UXT-001..007; AC-UXT-001..007)  
**Scope fence:** presentation/read-context only. Do **not** change money commands, tax calculations, withholding-slip lifecycle, eligibility/reconciliation, cursor ordering/page size, permissions/RLS, or repository write methods. No new route, schema table, or ADR.

## Design

### Identity model and data flow

Use one shared **vendor-invoice identity presenter** for the withholding picker, linked-slip details, payment picker, and vendor e-Faktur context:

```
BillRow (immutable invoice ID + external ref + VI number + case/project IDs + date)
  -> useVendorWithholdingBillContexts (one React Query batch per rendered page)
  -> repositories.vendorWithholdingSlips.readBillContexts (typed read seam)
  -> db/vendorWithholdingSlips (two RLS-scoped `.in(...)` reads: procurements, projects)
  -> VendorInvoiceIdentity (visible hierarchy + accessible name)
```

The presenter must always distinguish the external supplier reference from the PMO VI number. It renders this ordered, wrapping identity block:

1. localized **Vendor invoice reference** and the `reference_number`, or the explicit not-recorded fallback;
2. localized **System VI number** and the `vi_number`, or an explicit unavailable fallback;
3. localized **Case** title and **Project** name plus PMO project number, each with pending/unavailable fallback;
4. existing bill date.

The immutable `invoice_id` remains only the option/checkbox value, React key, and submit payload; it must never become the sole visible or accessible human identity. Render all supplied content as text, never HTML.

The existing `list_vendor_withholding_bills` response already exposes external reference plus procurement/project IDs. Extend only the existing security-invoker `get_vendor_withholding_slip` JSON read projection so its linked-bill envelopes also expose `reference_number` and `project_id`. Preserve its signature, invoker status, grants, visibility behavior, all existing fields, and no-write behavior. Add an explicit reversible migration and pgTAP contract proof because this is a DB projection change, not a schema change.

`useVendorWithholdingBillContexts(pages)` accepts page-shaped bill arrays. It deduplicates IDs within each page and uses React Query `useQueries` keys scoped by org + normalized page IDs. Each page triggers at most one batched procurement-title read and one batched project-label read; a previously seen page/ID set is served from cache, and no row issues its own request. It must expose a per-bill context state (`ready`, `pending`, `unavailable`) without altering the candidate query, cursor, page size, or eligibility arguments.

For the payment picker, the already loaded `ProcurementLedger.detail` supplies the common case/project context, so pass a typed context prop to `RecordCaptureForm`; do not fetch it again. Keep `<option value={invoice.id}>`, payment validation, amount prefill, and submitted `invoiceId` unchanged.

For e-Faktur, evolve `EfakturModal` from a scalar `recordLabel` subtitle to a typed, display-only context node/value. The vendor caller passes the shared identity hierarchy. The sales caller passes either issued number or a localized draft identity. Sales draft resolution must explicitly distinguish project-options pending, project unavailable after load, customer present, and customer not recorded; it must never substitute the invoice UUID. The modal adds the localized instruction to copy the number from the issued e-Faktur document while preserving the existing number/date pair and empty non-VAT rules.

### UI and accessibility

This is an **Operate** refinement in the existing quiet, dense finance UI: reuse `EntityFormModal`, `DataTable`, native select, and DESIGN.md typography/tokens. Identity stacks use `min-w-0`, `break-words`, muted secondary facts, and no new card, color, icon, or primary action. Checkbox labels are derived from the same identity text as the visible rows so keyboard/screen-reader names expose external ref, VI number, case/project, and date. At 390px, identity facts wrap rather than truncate the distinguishing field; retain the app-wide focus ring and existing 44px mobile checkbox/button treatments.

### Error and performance behavior

- Missing reference/VI/context renders the exact static localized not-recorded/pending/unavailable label while retaining every other available fact.
- Candidate failure/retry, refetch, page append, and label resolution update only display context; the existing selected-ID map, explicit deselections, unknown-type confirmations, typed facts, intent UUID, and exact-cent reconciliation remain authoritative.
- Context reads are RLS-scoped through repositories, deduplicated per page, cache-backed, and never raw DAL calls in React components. No context lookup is issued just to translate a label.
- The new projection/read path does not expose a row hidden by existing RLS. Absence maps to the localized unavailable state rather than a fabricated title.

## TDD implementation plan

Run commands from the repository root unless a command explicitly changes directory. Every behavior task is red first; do not add production code before its named assertion fails.

### Task 1 — Lock the linked-bill read projection before changing it

**Files**
- Create `supabase/tests/0287_tax_evidence_context_labels.test.sql`
- Create `supabase/migrations/0287_tax_evidence_context_labels.sql`
- Create `supabase/migrations/rollback/0287_tax_evidence_context_labels_down.sql`

**TDD (red first)**
1. Add a pgTAP fixture with one readable withholding slip/bill that has a supplier `reference_number`, `procurement_id`, and `project_id`; call the shipped `get_vendor_withholding_slip(uuid)` as an authenticated readable Finance fixture.
2. Assert the returned linked-bill JSON contains the correct `reference_number` and `project_id`, retains `invoice_id`, `procurement_id`, `vi_number`, date/money/coverage fields, and does not contain the slip write payload. This is a supporting DB-contract test, not a second owner for AC-UXT-004.
3. Confirm the test is red because the current 0282 envelope omits the two identity fields.
4. In migration `0287_tax_evidence_context_labels.sql`, `create or replace` the existing `public.get_vendor_withholding_slip(uuid)` body only: add `r.reference_number` and `r.project_id` to each linked-bill `jsonb_build_object`; retain `SECURITY INVOKER`, `STABLE`, `search_path`, P0002 behavior, joins, grants, and all pre-existing envelope fields exactly.
5. In the down migration, restore the exact 0282 function body and ACLs, with no `CASCADE`.

**Verify**
```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_tax_evidence_context_labels.test.sql'
```

**ACs:** supporting contract for AC-UXT-004.

### Task 2 — Add the typed, batched read seam for case and project labels

**Files**
- Modify `pmo-portal/src/lib/db/vendorWithholdingSlips.ts`
- Modify `pmo-portal/src/lib/db/vendorWithholdingSlips.test.ts`
- Modify `pmo-portal/src/lib/repositories/types.ts`
- Modify `pmo-portal/src/lib/repositories/vendorWithholdingSlips.ts`
- Modify `pmo-portal/src/lib/repositories/__tests__/vendorWithholdingSlips.test.ts`

**TDD (red first)**
1. In the DAL test, add a failing case for `readBillContexts({ procurementIds, projectIds })` with repeated, unsorted IDs. Assert it makes exactly two RLS-scoped Supabase reads: one `procurements` `.in('id', uniqueSortedProcurementIds)` selecting `id,title`, and one `projects` `.in('id', uniqueSortedProjectIds)` selecting `id,name,pmo_project_number`; assert it returns normalized ID-keyed label maps and sends neither `org_id` nor any write/RPC argument.
2. In the repository test, add a failing case proving `repositories.vendorWithholdingSlips.readBillContexts(...)` delegates once to the DAL, wraps an error through `toAppError`, and never calls `record`, `correct`, or `void`.
3. Implement the DAL method and exported `BillContextLabels`/input types. Reject empty arrays by returning empty maps without querying; normalize/dedupe IDs and preserve RLS as the authority.
4. Add `readBillContexts` to `VendorWithholdingSlipsRepository` and its implementation. Do not alter `listBills`, cursors, `coverage`, or any write method.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/vendorWithholdingSlips.test.ts src/lib/repositories/__tests__/vendorWithholdingSlips.test.ts'
```

**ACs:** AC-UXT-007.

### Task 3 — Cache context by candidate page and prove bounded lookups

**Files**
- Create `pmo-portal/src/hooks/useVendorWithholdingSlips.context.test.tsx`
- Modify `pmo-portal/src/hooks/useVendorWithholdingSlips.ts`

**TDD (red first)**
1. Mock only `repositories.vendorWithholdingSlips.readBillContexts` and mount a hook with a first 50-row candidate page whose rows share one procurement/project ID. Add the canonical test titled `AC-UXT-007 resolves each candidate page through one deduplicated case and project batch`.
2. Assert the hook issues exactly one repository call with the unique IDs (therefore one DAL lookup per entity), returns the resolved labels to all 50 rows, and makes no per-row request.
3. Append a second page with a different shared case/project and rerender. Assert page one’s query stays cached, page two gets one new batched call, labels already cached are reused, and the original `useVendorWithholdingCandidates` request still calls `listBills` with `candidatesOnly: true`, `limit: 50`, the original cursor, vendor, currency, and PPh type.
4. Add pending and rejected batch cases which return explicit context state rather than IDs or invented labels.
5. Implement `useVendorWithholdingBillContexts(pages)` with org-scoped normalized page keys and `useQueries`; merge returned case/project maps by invoice ID. Keep `useVendorWithholdingCandidates` and mutation invalidation semantics unchanged.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/hooks/useVendorWithholdingSlips.context.test.tsx src/hooks/useVendorWithholdingSlips.test.tsx'
```

**ACs:** AC-UXT-007 (owning test).

### Task 4 — Build the single localized invoice-identity presenter

**Files**
- Create `pmo-portal/src/components/procurement/VendorInvoiceIdentity.tsx`
- Create `pmo-portal/src/components/procurement/VendorInvoiceIdentity.test.tsx`
- Modify `pmo-portal/public/locales/en/common.json`
- Modify `pmo-portal/public/locales/id/common.json`

**TDD (red first)**
1. Add failing RTL cases for English and Bahasa that render: complete data, duplicate/missing external references, missing VI, pending context, and unavailable case/project context.
2. Assert the ordered visible text and exported accessible-label helper contain static localized labels for vendor invoice reference, system VI number, case, project, PMO number, bill date, and the specific not-recorded/pending/unavailable fallbacks. Assert no UUID fixture is rendered as the sole human identity and all supplied text is rendered as text.
3. Implement a typed display-only presenter plus `vendorInvoiceIdentityAccessibleLabel(...)`. Its input includes optional reference/VI/date plus resolved context state; it must never receive or format an immutable invoice ID as a human fallback.
4. Add static parser-visible keys in both catalogues for every new label and fallback. Do not use computed `t()` keys.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/components/procurement/VendorInvoiceIdentity.test.tsx'
```

**ACs:** shared presentation support for AC-UXT-001, AC-UXT-003, AC-UXT-004, AC-UXT-005.

### Task 5 — Label withholding-slip candidates without changing selection intent

**Files**
- Modify `pmo-portal/pages/procurement/VendorWithholdingSlipModal.test.tsx`
- Modify `pmo-portal/pages/procurement/VendorWithholdingSlipModal.tsx`

**TDD (red first)**
1. Add canonical failing tests `AC-UXT-001 ...` and `AC-UXT-002 ...` in this named owner file. Run each in English and Bahasa using the finance i18n provider.
2. For AC-UXT-001, render same-vendor candidate bills with similar VI numbers, duplicate/missing external references, different resolved cases/projects/PMO numbers, and dates. Assert every visible row and its checkbox accessible name has the shared identity hierarchy; assert none falls back to its invoice UUID alone.
3. For AC-UXT-002, begin with the initiating invoice, explicitly deselect it, select another bill and confirm an unknown PPh type, type valid slip facts, append page two, resolve labels, force candidate error and Retry, then submit. Assert selected/deselected IDs, unknown declaration, typed fields, exact-cent total, and final sorted `invoiceIds` are exactly the user’s choices.
4. Implement the context hook for candidate pages and render `VendorInvoiceIdentity` in the bill cell. Generate each checkbox label from the same identity helper while retaining `invoice_id` as the checkbox value/key and `toggle` map key. Apply `min-w-0`/wrapping classes to the identity container; retain all existing PPh, 100-bill, reconciliation, focus, retry, and submit logic byte-for-byte outside the label composition.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/procurement/VendorWithholdingSlipModal.test.tsx'
```

**ACs:** AC-UXT-001, AC-UXT-002 (owning tests).

### Task 6 — Give linked withholding-slip bills the same identity and stable destination

**Files**
- Modify `pmo-portal/pages/procurement/VendorWithholdingSlipDetails.test.tsx`
- Modify `pmo-portal/pages/procurement/VendorWithholdingSlipDetails.tsx`

**TDD (red first)**
1. Add the canonical `AC-UXT-004 ...` test to the existing details test file. Use the enriched JSON fixture from Task 1 for two linked bills and run it in English and Bahasa.
2. Assert each linked row displays external reference, separate VI, case/project/PMO identity, and current existing money facts; assert absent references/context use the localized fallback.
3. Assert each `Open bill in case` accessible name uses the human identity plus case title and that clicking it still passes the unchanged `(procurementId, slipId, invoiceId)` callback tuple.
4. Implement the shared context hook for the linked-bill array and render the same identity block. Preserve loading/error/card/history/correction/void behavior and do not alter navigation IDs.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/procurement/VendorWithholdingSlipDetails.test.tsx'
```

**ACs:** AC-UXT-004 (owning test).

### Task 7 — Make payment’s invoice options recognizable while preserving the ID write

**Files**
- Modify `pmo-portal/pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx`
- Modify `pmo-portal/pages/procurement/RecordCaptureForm.tsx`
- Modify `pmo-portal/pages/procurement/ProcurementLedger.tsx`

**TDD (red first)**
1. Add canonical `AC-UXT-003 ...` cases in English and Bahasa with two invoice options sharing a case but differing external references/system VIs. Assert the native select options and selected option expose supplier reference, system number, case/project/PMO context, and explicit fallbacks where unavailable.
2. Select an option by its recognizable label and assert the submitted `CreatePaymentInput.invoiceId` remains its immutable ID, external reference stays optional, required/optional billing behavior remains mode-dependent, and ERP outstanding amount still prefills unchanged.
3. Add an `invoiceIdentityContext` display prop to `RecordCaptureForm`; build native select option text with the shared identity helper while retaining option `value={invoice.id}`.
4. In `ProcurementLedger`, derive case title and project name/PMO number from its already loaded `detail`, pass the display-only context to `LedgerCaptureRow`/`RecordCaptureForm`, and make no new lookup or mutation-path change.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx pages/procurement/ProcurementLedger.test.tsx'
```

**ACs:** AC-UXT-003 (owning test).

### Task 8 — Give vendor e-Faktur its bill, case, and issued-document context

**Files**
- Create `pmo-portal/pages/procurement/ProcurementLedger.labels.test.tsx`
- Modify `pmo-portal/pages/procurement/ProcurementLedger.tsx`
- Modify `pmo-portal/src/components/EfakturModal.tsx`

**TDD (red first)**
1. In the new owner file, add canonical `AC-UXT-005 ...` cases in English and Bahasa for numbered and unnumbered vendor invoices, including missing external/context facts.
2. Open Record e-Faktur through the real ledger row action. Assert the modal’s context identifies external reference, separate VI, case/project/PMO context or explicit fallback, and the localized instruction “Copy the number from the issued e-Faktur document”; assert an incomplete number/date pair remains disabled and retains the existing validation message.
3. Change `EfakturModal` to accept a typed display-only context node/value rather than a UUID-prone scalar record label. Render the new instruction in the modal and retain every normalization, validation, dirty/discard, save/error, and non-VAT-empty-pair behavior.
4. Have `ProcurementLedger` construct vendor context from `LedgerRow.externalRef`, `systemNumber`, and its loaded case/project facts. Do not change `onSetEfaktur`, menu authorization, or the e-Faktur persistence payload.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/procurement/ProcurementLedger.labels.test.tsx pages/procurement/ProcurementLedger.efaktur.test.tsx'
```

**ACs:** AC-UXT-005 (owning test).

### Task 9 — Preserve human sales-draft identity in the shared e-Faktur editor

**Files**
- Modify `pmo-portal/pages/__tests__/SalesInvoices.efaktur.test.tsx`
- Modify `pmo-portal/pages/SalesInvoices.tsx`

**TDD (red first)**
1. Formalize the existing informal UXS-031 assertion as canonical `AC-UXT-006 ...`; retain its current no-UUID proof rather than replacing it.
2. Add EN/ID test rows for a numbered sales invoice and unnumbered drafts with: resolved project, project-options pending, loaded-but-missing project plus present customer, and neither project nor customer. Assert issued number or localized draft identity, the e-Faktur issued-document instruction, exact pending/unavailable/not-recorded states, and no UUID-only subtitle.
3. Keep using `useInvoiceProjectOptions`; make `invoiceDisplayLabel` return a localized context object/string that distinguishes unresolved options from a loaded missing project and uses customer only when actually present. Never invent a project/customer name.
4. Pass that display context to the refactored `EfakturModal`. Retain sales e-Faktur menu permissions, `setEfaktur` payload, status filters, draft lifecycle, and number/date validation.

**Verify**
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.efaktur.test.tsx'
```

**ACs:** AC-UXT-006 (owning test).

### Task 10 — Register every delegated UI surface and lock localization coverage

**Files**
- Modify `pmo-portal/public/locales/en/common.json`
- Modify `pmo-portal/public/locales/id/common.json`
- Modify `pmo-portal/src/lib/i18n/launch-scope-routes.txt`

**TDD / implementation**
1. Before finalizing, run `npm run check:i18n` and treat any missing/static-key or English-leak failure as red.
2. Complete both catalogues with the exact static keys introduced by Tasks 4, 8, and 9, including vendor-reference/system-number labels, case/project/PMO labels, context pending/unavailable/not-recorded fallbacks, and the issued e-Faktur instruction. Keep user-authored values, stored enums, URLs, provider names, and IDs outside English-leak assertions.
3. Extend the existing `/procurement/:procurementId` and `/procurement/:procurementId/:tab` entries to name `pages/procurement/VendorWithholdingSlipModal.tsx`, `VendorWithholdingSlipDetails.tsx`, `RecordCaptureForm.tsx`, `ProcurementLedger.tsx`, `src/components/procurement/VendorInvoiceIdentity.tsx`, and `src/components/EfakturModal.tsx`; extend `/sales-invoices` to name `src/components/EfakturModal.tsx`. Do not create a fake route or remove existing launch-scope files.
4. Verify all `t()` calls in changed files use parser-visible literal keys.

**Verify**
```bash
cd pmo-portal && npm run check:i18n
```

**ACs:** AC-UXT-007.

### Task 11 — Run focused gates, graduate the QA evidence, and perform the bounded Discover pass

**Files**
- Modify `docs/decisions.md`
- Modify `docs/qa-portfolio.md`
- Modify code/tests only if this pass finds an in-fence defect; return first to that defect’s red-green task.

**Verification**
1. Run all owning and close-regression tests under the shared test lock:
```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/vendorWithholdingSlips.test.ts src/lib/repositories/__tests__/vendorWithholdingSlips.test.ts src/hooks/useVendorWithholdingSlips.test.tsx src/hooks/useVendorWithholdingSlips.context.test.tsx src/components/procurement/VendorInvoiceIdentity.test.tsx pages/procurement/VendorWithholdingSlipModal.test.tsx pages/procurement/VendorWithholdingSlipDetails.test.tsx pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx pages/procurement/ProcurementLedger.labels.test.tsx pages/procurement/ProcurementLedger.efaktur.test.tsx pages/__tests__/SalesInvoices.efaktur.test.tsx'
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0287_tax_evidence_context_labels.test.sql'
```
2. Run required local gates:
```bash
cd pmo-portal && npm run check:i18n && npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 src/lib/db/vendorWithholdingSlips.ts src/lib/repositories/types.ts src/lib/repositories/vendorWithholdingSlips.ts src/hooks/useVendorWithholdingSlips.ts src/components/procurement/VendorInvoiceIdentity.tsx src/components/EfakturModal.tsx pages/procurement/VendorWithholdingSlipModal.tsx pages/procurement/VendorWithholdingSlipDetails.tsx pages/procurement/RecordCaptureForm.tsx pages/procurement/ProcurementLedger.tsx pages/SalesInvoices.tsx
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev'
/Users/ariefsaid/Coding/PMO/.claude/skills/impeccable/scripts/impeccable detect --json pmo-portal/pages/procurement/VendorWithholdingSlipModal.tsx pmo-portal/pages/procurement/VendorWithholdingSlipDetails.tsx pmo-portal/pages/procurement/RecordCaptureForm.tsx pmo-portal/pages/procurement/ProcurementLedger.tsx pmo-portal/src/components/EfakturModal.tsx pmo-portal/pages/SalesInvoices.tsx
```
3. Append seven UXS-031 graduation entries to `docs/decisions.md`, one per AC, using the spec’s exact retention note, canonical owning test path, and affected route×oracle cell. Add matching completed rows to `docs/qa-portfolio.md`’s graduation registry. This is evidence retention, not a new architectural decision or ADR.
4. Perform one manual rendered Discover pass at **1440×900** and **390×844**, in **en** and **id**, with rich fixtures including same-vendor bills across different cases/projects, duplicate/missing references, candidate page two, failed retry, linked-slip details, payment capture, and numbered/unnumbered vendor and sales invoices. Inspect: no horizontal page overflow; long distinguishing text wraps; visible and accessible identity agree; keyboard selection/focus remains intact; the payment value remains an ID; e-Faktur validation stays paired; no UUID-only subtitle; and no English system label leaks. Record all locale×viewport observations and graduate every new finding before acceptance. No new Playwright visual test is required by this signed spec.

**ACs:** AC-UXT-001, AC-UXT-002, AC-UXT-003, AC-UXT-004, AC-UXT-005, AC-UXT-006, AC-UXT-007.

## Acceptance traceability

| AC | Canonical owner | Why this is the lowest sufficient layer |
|---|---|---|
| AC-UXT-001 | `pmo-portal/pages/procurement/VendorWithholdingSlipModal.test.tsx` | Candidate render and checkbox accessible names are deterministic UI behavior. |
| AC-UXT-002 | `pmo-portal/pages/procurement/VendorWithholdingSlipModal.test.tsx` | RTL exercises page append/refetch/retry and the exact ID payload without changing a real money command. |
| AC-UXT-003 | `pmo-portal/pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx` | The select label/value/default behavior is local deterministic form behavior. |
| AC-UXT-004 | `pmo-portal/pages/procurement/VendorWithholdingSlipDetails.test.tsx` | The linked-row identity and unchanged Open callback are deterministic component behavior. |
| AC-UXT-005 | `pmo-portal/pages/procurement/ProcurementLedger.labels.test.tsx` | Ledger-to-modal vendor context and paired e-Faktur validation render in one RTL surface. |
| AC-UXT-006 | `pmo-portal/pages/__tests__/SalesInvoices.efaktur.test.tsx` | Sales draft-number/context selection and shared modal subtitle are deterministic page behavior. |
| AC-UXT-007 | `pmo-portal/src/hooks/useVendorWithholdingSlips.context.test.tsx` | Mocked repository calls precisely prove page-batch deduplication, cache reuse, and invariant candidate arguments. |

## Risk review

- **Recognition vs. authority:** context is display-only. IDs, exact-cent sum, eligibility and existing write payloads remain unchanged and are asserted by AC-UXT-002/003 regressions.
- **N+1 regression:** page-scoped, normalized React Query keys plus a two-query repository method prevent row-level context reads; AC-UXT-007 detects a per-row or repeated-page regression.
- **RLS leakage:** context reads are ordinary RLS-scoped DAL reads; unavailable source metadata gets an explicit fallback rather than a synthetic label.
- **Projection drift:** the one JSON-envelope addition has a reversible migration and pgTAP proof. No schema/RLS/write-path change is proposed.
- **Localization drift:** both catalogues, literal keys, launch-scope entries, and `npm run check:i18n` are required. No ADR is needed because this reuses the existing repository, i18n, React Query, and UI patterns.
