# Spec — Recognizable tax-evidence labels (UXS-031)

**Status: SIGNED — Director, 2026-10-14**, under the owner's "do the UX follow-ups" mandate. Built in one run (AC-UXT-001..007).

Sources: UXD-C-013 and UXD-D-012 in `docs/reviews/2026-10-10-ux-discover-{C,D}.md`.

Job: when Finance matches an externally issued bukti potong or e-Faktur to bills/drafts, it can recognize
the intended record by supplier reference and case/project before opening another screen.
Glossary: external reference ≠ system-assigned number ≠ immutable ID. Keep all three roles distinct.

## Deciding surfaces and boundary

Paths are relative to `pmo-portal/`; this is recognition/presentation work, not tax calculation or issuance.

| Route / surface | Deciding source and states |
|---|---|
| `/procurement/:id/documents`: Record bukti potong → Eligible bills | `pages/procurement/VendorWithholdingSlipModal.tsx`: rows/checkbox names, initiating bill, loading/empty/error/retry/Load more, selected count/reconciliation |
| Same route: slip details → Linked bills | `pages/procurement/VendorWithholdingSlipDetails.tsx`: linked-row labels and Open bill accessible names; loaded/unavailable source |
| Same case: payment capture → Links to invoice | `pages/procurement/RecordCaptureForm.tsx`: invoice options and selected value; `ProcurementLedger.tsx` hosts capture |
| Same case: vendor invoice → Record e-Faktur | `pages/procurement/ProcurementLedger.tsx` passes `recordLabel` into `src/components/EfakturModal.tsx` |
| `/sales-invoices/:invoiceId`: draft/numbered invoice → Record e-Faktur | `pages/SalesInvoices.tsx` `invoiceDisplayLabel` → shared `EfakturModal`; project/customer lookup pending/missing |

Current source already gives an unnumbered sales draft `Draft invoice · {project/customer}` and has an informal
UXS-031 test in `pages/__tests__/SalesInvoices.efaktur.test.tsx`: retain and formalize that behavior, do not
claim it remains wholly unfixed. Candidate rows currently prefer `vi_number` over `reference_number` and show
`procurement_id`; `BillRow` already contains both references plus `procurement_id` and `project_id`, not their
titles. Hooks use repository-backed cursor pages (50 rows). Resolve human context through that seam, not raw IDs.

## Requirements (EARS)

- **FR-UXT-001:** When an eligible bill or linked bill renders, the interface shall show **“Vendor invoice reference” / “Referensi faktur vendor”** with `reference_number`, the system VI number separately, readable case title and project name/PMO number, and the existing bill date before drill-in.
- **FR-UXT-002:** When Finance chooses a bill in a picker, the interface shall expose the external reference, system VI number and case/project context in the option and its accessible name; the option value and checkbox identity shall remain the immutable invoice ID.
- **FR-UXT-003:** When external reference, system number or human context is absent, the interface shall show a localized specific unavailable/not-recorded label, retain any available recognition fields, and never substitute a UUID as the sole human identity or fabricate a reference.
- **FR-UXT-004:** While the slip form remains open, when pages append/refetch, labels resolve/change, or candidate loading fails and retries, the interface shall retain selected and explicitly deselected invoice IDs, unknown-type confirmations and typed slip inputs without reselecting the initiating bill.
- **FR-UXT-005:** When an e-Faktur form opens for a vendor bill, the interface shall show external/system invoice references and case/project context; when it opens for a sales invoice, it shall show its issued number or localized draft/customer/project identity, never a UUID-only subtitle.
- **FR-UXT-006:** When the e-Faktur form renders, it shall explain “Copy the number from the issued e-Faktur document” / “Salin nomor dari dokumen e-Faktur yang diterbitkan” and retain the existing number/date-together and non-VAT empty-pair rules.
- **FR-UXT-007:** The interface shall obtain system labels only from `public/locales/{en,id}/common.json` with static parser-visible keys; newly included delegated components shall be named in `src/lib/i18n/launch-scope-routes.txt` and `npm run check:i18n` shall pass.
- **NFR-UXT-001:** The implementation shall retain cursor ordering, page size, initiating selection, the 100-bill cap, same-vendor/currency/PPh eligibility, exact-cent reconciliation, stable write intent, linked-bill routes, permissions and org isolation.
- **NFR-UXT-002:** Human-context resolution shall use typed repositories and batched/cache-backed lookups: at most one case lookup and one project lookup per candidate page of up to 50 rows, zero requests per individual row, and zero lookups merely to translate labels.
- **NFR-UXT-003:** The interface shall retain DESIGN tokens, keyboard selection and focus behavior, render readable wrapping labels at 390px, and render user-supplied text as text rather than HTML.

## Acceptance criteria

- **AC-UXT-001** — Given two same-vendor bills with different external references and similar system numbers, When candidates render in en/id, Then each row and checkbox exposes its external reference, separate VI number, case/project and date before selection; missing/duplicate references remain distinguishable by the other fields, never UUID-only.
- **AC-UXT-002** — Given an initiating bill, another selected bill and one explicit deselection, When page two arrives, context labels resolve, a page fails/retries and the form is submitted, Then selection/declarations/inputs survive and `invoiceIds` names exactly the intended immutable IDs with the original exact-cent total.
- **AC-UXT-003** — Given payment capture with two available invoices, When Finance opens Links to invoice and selects by external reference in either locale, Then options/selected label show both references and case/project, while the submitted invoice ID and existing required/optional and amount-default behavior are unchanged.
- **AC-UXT-004** — Given a slip with linked bills, When details render in en/id, Then each bill shows external/system references plus case/project and the named Open action targets the same bill/case/slip context as before; unavailable human fields have explicit localized fallback.
- **AC-UXT-005** — Given numbered and unnumbered vendor invoices, When their e-Faktur editor opens in either locale, Then its context identifies external/system reference and case/project, the issued-document instruction is visible, and number/date validation still blocks an incomplete pair.
- **AC-UXT-006** — Given numbered sales invoices and unnumbered drafts with present/pending/missing project/customer context, When their e-Faktur editor opens in en/id, Then the issued number or human draft identity and issued-document instruction appear, never a UUID-only subtitle, and missing context is not invented.
- **AC-UXT-007** — Given a 50-row candidate page sharing case/project IDs, When context is resolved and the next page arrives, Then the repository calls are deduplicated and bounded to one batch per entity per page, existing cached labels are reused, and the cursor/eligibility arguments remain unchanged.

## One owner per AC + planned graduation

All owners are **unit (Vitest/RTL, mocked repository/hooks)** at the lowest sufficient layer (ADR-0010).
Each row assigns one canonical `it` named with its AC-id; other existing reconciliation/pgTAP/journey tests remain
supporting proof. A new `.labels`/`.context` test file below is planned, not already implemented.
Each row's note goes into `docs/decisions.md`; add its test + cell to the QA graduation registry after green.

| AC | Owning test file (relative to `pmo-portal/`) | Routes × oracle cell | Graduation note |
|---|---|---|---|
| AC-UXT-001 | `pages/procurement/VendorWithholdingSlipModal.test.tsx` | `/procurement/:id/documents` candidates × job-fit Finance + a11y labels | External recognition and immutable linkage are separate. |
| AC-UXT-002 | `pages/procurement/VendorWithholdingSlipModal.test.tsx` | same route, slip capture × state-coverage/data-correctness | Labels/page arrival cannot change selection. |
| AC-UXT-003 | `pages/procurement/__tests__/RecordCaptureForm.payment.test.tsx` | `/procurement/:id/documents` payment picker × cross-screen consistency | Picker labels carry reference/context; values stay IDs. |
| AC-UXT-004 | `pages/procurement/VendorWithholdingSlipDetails.test.tsx` | `/procurement/:id/documents` linked bills × action-completeness | The recognizable bill keeps its canonical destination. |
| AC-UXT-005 | `pages/procurement/ProcurementLedger.labels.test.tsx` | `/procurement/:id/documents` e-Faktur × job-fit Finance | Vendor tax evidence uses the same identity block. |
| AC-UXT-006 | `pages/__tests__/SalesInvoices.efaktur.test.tsx` | `/sales-invoices/:invoiceId` e-Faktur × state-coverage/recognition | Retain human draft fallback; no UUID-only subtitle. |
| AC-UXT-007 | `src/hooks/useVendorWithholdingSlips.context.test.tsx` | candidate source for `/procurement/:id/documents` × data-correctness | Resolve context in batches through repository/cache seam. |

## Error handling

| Condition | User outcome |
|---|---|
| Missing external reference | “Vendor invoice reference not recorded” / “Referensi faktur vendor belum dicatat”; still show system number/context. |
| Case/project lookup pending or unavailable | Localized pending/unavailable context; retain bill/reference/selection; do not pretend absent metadata changes bill eligibility. |
| Candidate-page failure | Existing localized retry with form/selection intact; no reset or false empty list. |
| Stale/ineligible bill, amount/type mismatch or refused save | Existing classified remedy and exact reconciliation remain authoritative; do not silently drop/substitute a selected bill. |

## Discover, exclusions and likely files

Manual Discover: Director judges agent-browser screenshots at **1440×900 and 390×844 × en/id**, using Finance
with two same-vendor bills in different cases/projects, duplicate/missing references, page-two candidates,
a failed-page retry, linked-slip details, payment picker and numbered/unnumbered e-Faktur contexts.
Sweep each AC cell for state-coverage, cross-screen consistency, WCAG-AA naming/focus and mobile@390. Capture
long references/context without truncating the only distinguishing field. This adds no Playwright visual gate;
recognition/selection ACs are sufficiently proved in RTL, so no new e2e is required. Existing slip journeys remain.

English-leak checks assert specific labels and exclude user-authored names/titles/notes/locations, provider/brand
names (ERPNext, ClickUp, Microsoft), stored enums, URL parameters and analytics names. Display mappings use static
keys, never dynamic `t()` keys; APIs keep stored values. Delivery work-chunks remain “Phase / Fase” (DD-VOCAB-1);
this spec does not rename sales-invoice navigation (batch A owns “Faktur Penjualan” and AC-FIN-002's amendment).

Out of scope: #898 monthly tax register, statutory issuance/cancellation, new tax validation/rates, eligibility or
reconciliation changes, payment workflow changes, global search/new picker engine, new routes, new permissions,
and renumbering/backfilling records. No schema change is required by this spec; prefer existing authorized
repository reads. Any proposed DB projection change needs an explicit plan and its lowest-layer contract proof.
Likely touched: all sources in the surface table; `src/hooks/useVendorWithholdingSlips.ts`, typed
`src/lib/repositories/vendorWithholdingSlips.ts` / `src/lib/db/vendorWithholdingSlips.ts` as needed for context,
shared reference-label presenter, catalogue pair, launch manifest and owning tests. Do not add direct DAL calls to UI.

## Implementation TODO

- [ ] Sign off identity hierarchy/fallbacks; plan the smallest shared presenter and batched repository context seam.
- [ ] Add each AC's failing owning test; formalize the existing sales-draft UXS-031 test as AC-UXT-006 without weakening it.
- [ ] Implement static labels/context and unchanged ID-based selection; extend launch scope; pass `npm run check:i18n` and scoped local gates.
- [ ] Complete manual Discover/cell sweep; record each row's retention note/test/cell and graduate any new findings before acceptance.
