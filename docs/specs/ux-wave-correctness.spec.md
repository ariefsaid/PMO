# UX-wave correctness follow-ups (#1073)

Status: preparation for Director inspection. Source baseline: `67203567` on `codex/correctness-1073`.
Owner authorized continuing the queue; this preparation does not reorder execution:
**#1071 → private prerequisites → #1074 B1b → #1073**.

## Job, scope and prerequisite

When an Admin follows an old project-numbering link or previews a number, they should reach the
existing setup panel and see its organisation-year convention. When a finance viewer reads project
cash, they should see only receipt cash uniquely attributable through known invoice allocations,
with honest incomplete states where the source cannot establish it.

Before planning/building, rebase onto the completed prerequisite `dev`, re-read the four deciding
surfaces below, and reconcile this spec with their shipped interfaces. Especially recheck B1b's
ledger/repository changes and #1071's test splits. Do not overwrite prerequisite work or revive an
obsolete issue premise. No production access was used for this spec; database observations below
are migration/source contracts, not claims about deployed policies or cloud migration level.

In scope: two administration corrections, preserve/prove the already-live expense edit path, and
one bounded receipt-cash read. Out of scope: new expense UI, cash allocation write rules, an ERP
write, a financial attribution algorithm, FX conversion, a new ledger, or raw receipt grants.

## Deciding source and concrete outcomes

**Administration redirect.** `pmo-portal/pages/Administration.tsx:319–332` redirects the old Accounting
number-pattern hash to `/administration/projects#org-project-number-pattern`; the bare
`/administration` branch recognizes only the budget-map hash and otherwise selects Users (or the
existing Finance destination). An Admin following `/administration#org-project-number-pattern`
therefore reaches Users instead of the numbering control. The existing hash effect focuses and
scrolls the target. `pages/AdministrationShell.test.tsx:278` covers the Accounting redirect.

**Year convention exists.** `pages/admin/OrgProjectNumberPattern.tsx:91` passes browser-local
`getFullYear()` into `previewProjectNumber`. `supabase/migrations/0231_project_numbering.sql:165–182`
instead reads `organizations.default_timezone`, uses `coalesce(...,'UTC')`, and extracts the year
of the creation instant in that zone. Migration `0198_locale_preference_columns.sql` introduced
the stored default; it is not a new setting. For example, at `2026-12-31T18:00:00Z`, a UTC browser
previews 26 while an Asia/Jakarta organisation assigns 27. `src/lib/db/orgs.ts:getOrgLocaleDefaults`
already reads the org preference. `src/hooks/useResolvedLocale.ts` exposes an org-default hook,
but its placeholder has null defaults and hides query status; its resolved viewer timezone can
also include a personal override, which is not the numbering business-year authority.

**Expense premise is stale.** Production has two consumers of `ExpenseClaimFormModal`:
`pages/ExpenseClaims.tsx:138` creates without `initial`; `pages/ExpenseClaimDetail.tsx:104,170–190`
opens Edit details, supplies `initial`, and sends the submitted patch through
`useExpenseClaimMutations().update`. The modal's edit title/Save label, prefilled values and
create-only posting-readiness note are live. `src/hooks/useExpenseClaims.ts:112` routes update
through `repositories.expenseClaim.update`; the DAL retains claim-line-derived amounts and
advance-only entered amounts. No dead-branch removal is justified. Existing detail tests exercise
claim actions, but the inspected detail/form tests do not drive this edit modal to a saved patch;
add that targeted proof without deleting existing tests or inventing an edit consumer.

**Cash is a new capability.** `pages/project-detail/ProjectFinancesSection.tsx:71` truthfully reports
unavailable. `src/hooks/useProjectFinances.ts` → `repositories.revenue.getProjectFinances` →
`src/lib/db/revenue.ts:325` → migration `0290_project_finances.sql:get_project_finances` supplies
invoice settlement, budget and mapped Actual, without receipt cash. Its active-member, own-project
and finance-view role contract is the existing aggregate boundary. Intended roles are Admin,
Finance, Executive and Project Manager; retain that contract and its pgTAP proofs.

S-06's `0301_receipt_allocation_details.sql` adds JSON allocations containing invoice id/number,
exact decimal amount and invoice currency; null means unreported and `[]` means reported none.
`supabase/functions/_shared/receiptAllocations.ts` resolves links through the source invoice;
unresolved links/amounts/currencies stay unknown. `0309` stamps bounded allocation refreshes.
`src/lib/db/revenue.ts:listIncomingPayments` correctly pages all rows and can filter by invoice FK
or JSON containment. It does not provide a project-cash total. `src/lib/revenue/receiptAllocation.ts`
provides display coverage/unapplied settlement, not a per-project cash oracle.

`DD-RCPT-1` in `docs/decisions.md` distinguishes cash in `received_amount`, withholding in
`withheld_amount`, and gross invoice allocation. `bodies/incomingPayment.ts:peReceiveFromDoc`
mirrors those separate source facts. `0275_native_revenue.sql:record_native_receipt` writes one
native invoice link, its currency, cash and withholding; receipts can exceed invoice outstanding.
Native cancellation keeps the row and marks `cancelled_at`; ERP posting/cancellation is represented
by docstatus, `erp_cancelled_at` and the shared `deriveIpStatus` mapping. Do not infer cash from
invoice Paid status or gross settlement. `DD-MONEY-1..4` retain their separate Actual, margin,
Committed and active-budget meanings. The earlier project-finances cash deferral is superseded
only for this new read capability; its settlement oracles remain binding.

## Bounded design decisions

Director choice: extend the existing guarded `get_project_finances` read with a receipt-cash
aggregate where practical, retaining its repository seam. Do not transfer all organisation
receipts to the browser, fan out one request per invoice, widen raw-data grants, or add a privileged
bypass. Migration **0315 is reserved exclusively for this issue**; do not use 0310–0314.

Director choice: relevance means an existing invoice FK or allocation link to an invoice currently
assigned to the requested project. Unrelated receipts and known on-account receipts do not make
this metric incomplete. A relevant ambiguous receipt does. This is **cash attributable through
known invoice allocations**, not a claim to recover every unlinked bank receipt for a project.
No proportional division of withholding, arbitrary first-invoice attribution, or guessed FX rate.

Director lifecycle choice: a still-posted receipt with a relevant known allocation to a
draft/cancelled/unposted invoice is incomplete until the source linkage resolves. Preserve stable
invoice identity where available: unlinking a legacy FK does not establish zero when a known JSON
allocation/stable invoice identity still identifies this project's receipt. A truly unlinked
receipt with no discoverable target-project identity is outside this scoped metric and does not
degrade every project's coverage. Cancelled receipts are excluded using authoritative lifecycle fields.

Reuse existing org-default reading for the preview, through a state-bearing query and repository
wrapper if needed. Preserve the existing locale hook's public behavior for its other consumers.
Do not derive the business year from the viewer's resolved personal timezone.

## Requirements (EARS)

**FR-001.** When an Admin follows either legacy project-number-pattern hash, the application shall
replace-navigate to `/administration/projects#org-project-number-pattern`, retain the anchor,
select Project setup, and focus/scroll the existing target. Other administration redirects and
role restrictions shall retain their existing behavior.

**FR-002.** When the pattern and org timezone have been read successfully, the preview shall expand
the current instant's two-digit year in the organisation's stored timezone, matching the server's
UTC fallback only for a successfully read null timezone. While timezone data is pending, failed,
missing or unusable, it shall show a neutral loading/unavailable preview state rather than guess
the browser year or treat placeholder data as a successful UTC read. Pattern validation, saving,
illustrative client/sequence tokens and the “illustrative only” explanation shall remain intact.

**FR-003.** While an expense record offers the existing Edit details action, the application shall
retain the initial/edit branch and its update behavior. Creating a claim/advance shall continue
to use the creation path and its posting-readiness explanation; editing shall retain its current
prefill, Save label, validation, retry, permissions and number-locale parsing. No removal is planned.

**FR-004.** When authorised project finances are read, the new aggregate shall return receipt-cash
coverage without changing existing settlement, tax-normalised contract comparison, margin, Actual
or budget values. Use exact source numeric/decimal arithmetic and receipt denominations; do not
sum unlike currencies, convert cash to net-of-VAT revenue, or cap received cash at outstanding.

**FR-005.** When a receipt is native, Paid, uncancelled and directly tied to an eligible project
invoice, its known `received_amount` shall contribute once in its own currency. Native eligibility
shall use stored `pmo_native`, receipt `status`/`cancelled_at`, invoice `pmo_native`/`status`, and
applicable ERP cancellation/docstatus fields according to the shipped create/cancel contract;
display labels such as “Received” or “Paid” are not lifecycle evidence. Recheck that exact stored
contract against prerequisite code before planning. When an ERP receipt
is submitted and uncancelled, exact all-cash same-currency invoice allocations may contribute their
target-project allocation amounts. A whole receipt's header cash may contribute once when complete
links identify only this project/currency and its gross allocations reconcile to cash plus known
withholding. Never add header cash again for each matching invoice or duplicate primary/JSON link.

**FR-006.** While any relevant receipt has ambiguous multi-project withholding, unknown allocation
coverage/amount/linkage, a missing cash or withholding fact needed for reconciliation, unlike
currencies, inconsistent totals, or unsupported posting/invoice lifecycle facts, the aggregate
shall be incomplete and shall withhold a full cash total. An exact supported subtotal shall never
masquerade as complete project cash. Unknown is not zero; absent ERP allocation coverage is not
an empty array, and a legacy first-invoice FK is not evidence of a whole ERP receipt's allocation.

**FR-007.** When a receipt is cancelled in PMO or ERP, or is a known unposted/Scheduled receipt,
it shall not contribute received cash. Invoice reassignment shall derive attribution through the
current invoice relation, without duplicating a project id onto receipts. Unrelated/on-account
cash shall remain outside this metric, including a truly unlinked receipt with no discoverable
target-project identity. If an unlinked legacy FK still has a known JSON allocation/stable invoice
identity identifying this project, that source identity shall retain relevance; the null FK alone
shall not establish zero. A still-posted receipt's relevant allocation to a
draft/cancelled/unposted invoice shall make coverage incomplete, without altering lifecycle writers.

**FR-008.** When no relevant received receipt exists in a successful authorised complete aggregate,
the UI shall show known zero with scope wording. A null legacy FK shall not establish zero where a
known JSON allocation/stable invoice identity still makes the receipt relevant; truly unlinked
receipts without discoverable project identity remain outside the metric. Denied/failed/malformed reads shall not establish
zero. New output shall discriminate `known` (currency buckets of exact amounts), `incomplete`
(reason codes, no complete amounts), and unavailable/not-reported. A legacy payload without the
new field shall remain unavailable; malformed present cash shall be rejected as a cash reading
while separately valid legacy finance values remain usable. Cash-only coverage
failure shall not hide otherwise valid settlement/Actual. Preserve the current layout and provide
English/Bahasa labels explaining “receipt cash linked to this project's invoices.”

**FR-009.** When implementing the aggregate, the server shall retain the existing finance-read
roles, active-member/org/project checks, invoker/RLS pattern and grants; the FE shall use the
existing repository/query permission seam. Aggregate the complete matching relation in SQL,
without first-page limits or client-side assumptions about filtered-out rows. Retain role/org
contract tests and add cash-specific proofs against the actual local schema after prerequisites.

**NFR-001.** The query shall reuse the existing `(org_id,project_id)` invoice and
`(org_id,sales_invoice_id)` receipt indexes. Allocation membership is JSONB containment, not a
child table. Source migration search through this baseline found no allocation GIN index; inspect
actual local indexes and EXPLAIN for the selected query during build, adding only necessary hot-path
support in 0315 (a JSONB containment GIN index is a candidate). Keep the migration reversible and
avoid multiplying receipt totals through joins. No test, timeout, skip or unrelated UI relaxation.

## Acceptance and one lowest-sufficient owning proof each

| AC | Given / When / Then | Owning proof |
| --- | --- | --- |
| AC-UWC-001 | Given the bare legacy hash and the Accounting legacy hash, when each is opened as Admin, then Project setup and its numbering target are selected/focused with the canonical anchored URL; unrelated legacy destinations retain their behavior. | Unit: `pages/AdministrationShell.test.tsx`, one parameterized route test. |
| AC-UWC-002 | Given `2026-12-31T18:00:00Z`, org Asia/Jakarta and an opposing viewer/browser year, when default/custom previews render, then YY is 27; UTC org gives 26 and personal overrides do not change either result. | Unit: `pages/admin/OrgProjectNumberPattern.test.tsx`, fixed-clock parameterized case. |
| AC-UWC-003 | Given pending, failed, missing and unusable timezone data, when the valid pattern panel renders, then it shows no guessed year, saving remains independently governed by pattern validity, and successful timezone recovery restores the illustrative preview. | Unit: `pages/admin/OrgProjectNumberPattern.test.tsx`, state/recovery case. |
| AC-UWC-004 | Given the current claimant's editable claim and advance, when Edit details is opened and saved, then original fields prefill and the existing update patch is sent once (advance amount only where allowed); create still uses Create and the readiness note. | Unit: `pages/ExpenseClaimDetail.test.tsx`, real modal with mocked update seam; existing `ExpenseClaims.test.tsx` remains supporting creation proof. |
| AC-UWC-005 | Given native cash 980/withheld 20/gross 1000 and an ERP all-cash receipt allocating 30 and 20 to two projects, when each project's aggregate is read, then native cash is 980 and ERP cash is respectively 30/20, never gross/header duplication; a fully allocated same-project multi-invoice withholding receipt contributes its header cash once. | Integration: new `supabase/tests/0315_project_receipt_cash.test.sql`, exact-amount fixture matrix. |
| AC-UWC-006 | Given a relevant multi-project withholding receipt or each FR-006 unknown/mismatched case, when aggregated, then the state is incomplete with no full amount; unrelated, known on-account, and truly unlinked receipts with no discoverable target-project identity alone do not degrade coverage. | Integration: the same pgTAP file, ambiguity/coverage matrix; pair the exclusion fixtures with AC-UWC-007's still-identifiable receipt. |
| AC-UWC-007 | Given native/ERP receipt cancellations, authoritative stored unposted/cancelled native states despite display labels, a still-posted receipt allocated to a cancelled/draft/unposted invoice, and a receipt whose legacy FK is null but known JSON allocation/stable invoice identity still identifies this project, when read, then cancelled/unposted receipts are excluded and still-identifiable ambiguous allocations remain incomplete rather than zero; reassignment follows current invoice identity and a complete multi-page-sized fixture counts each receipt once with currencies separate. | Integration: the same pgTAP file, lifecycle/completeness matrix, paired with AC-UWC-006's truly-unlinked exclusion. |
| AC-UWC-008 | Given each existing finance-view role, a disallowed/inactive caller and another organisation's project, when the guarded read is called, then the existing read contract is preserved and denial cannot return an apparent zero cash result. | Integration: the same pgTAP file, role/org contract matrix; existing `0290_project_finances_reads.test.sql` remains green. |
| AC-UWC-009 | Given known zero, multiple currency amounts, incomplete, absent legacy cash, malformed present cash and failed finance reads, when the checked payload/UI handles them, then the new value/state is honest, bilingual and accessible, while settlement wording and DD-MONEY values remain unchanged. | Unit: `ProjectFinancesSection.test.tsx` owns rendering; `src/lib/db/projectFinances.test.ts` supplies supporting checked-payload proof without a second owning AC tag. |

## Exact affected paths and recheck facts

- Administration: `pmo-portal/pages/Administration.tsx`, `pages/AdministrationShell.test.tsx`,
  `pages/admin/OrgProjectNumberPattern.tsx` and `.test.tsx`, `src/lib/projectNumberPattern.ts`
  and `.test.ts`, `src/hooks/useOrgProjectNumberPattern.ts`; reuse `useResolvedLocale.ts` /
  `db/orgs.ts` via a narrow repository wrapper in `src/lib/repositories/{types,index}.ts` as needed.
- Expense: `pmo-portal/pages/ExpenseClaimDetail.test.tsx`; the form and both production consumers
  are preservation evidence, not deletion targets. No existing edit-test contract is removed.
- Cash: `supabase/migrations/0315_project_receipt_cash.sql`, its matching rollback under
  `supabase/migrations/rollback/`, `supabase/tests/0315_project_receipt_cash.test.sql`,
  `pmo-portal/src/lib/projectFinances.ts`, `src/lib/db/{revenue.ts,projectFinances.test.ts}`,
  `pages/project-detail/{ProjectFinancesSection.tsx,ProjectFinancesSection.test.tsx}` and
  `public/locales/{en,id}/common.json`. Keep `useProjectFinances` and repository signatures unless
  prerequisite code makes one narrowly guarded separate aggregate necessary.

No business-definition decisions remain open after the Director's unique-attribution and lifecycle
rulings above. Known zero means zero cash attributable through discoverable project invoice links;
it does not certify that no undiscovered/unlinked bank receipt belongs economically to the project.
Recheck the final prerequisite RPC/type shape, authoritative stored native receipt/invoice lifecycle
contract, actual local grants/policies/indexes,
and representative query plan before build; source inspection alone cannot certify deployed state.
If the existing guarded RPC cannot be extended cleanly after B1b, the Director chooses one narrow
project-cash aggregate using the same read contract, rather than a broad financial API.

After rebase, targeted TDD, locked typecheck/changed-importer Vitest and touched pgTAP are required;
reset+migration+pgTAP hold one DB lock if 0315 is added. CI remains the full-suite/wave-closing gate.
No tests, DB commands or implementation were run during this preparation.
