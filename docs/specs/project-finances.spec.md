# Project finances — issue #1008

> **Status: Ready for owner sign-off**
>
> Director rulings are recorded below. The companion plan is build-ready; implementation still requires owner spec sign-off.

## Decisions

| Ruling | Decision | Rejected alternative and why |
|---|---|---|
| OQ-PFIN-001 — settlement, not project cash receipts | No allocation mirror or receipt schema expansion. Show **Invoiced = Σ amount**, **Outstanding = Σ erp_outstanding_amount**, and **Settled = Σ(amount − erp_outstanding_amount)** for the project's submitted, non-cancelled invoices, separately per currency. Label Settled **settled against invoices (cash, withholding and credits)**, not cash received. A NULL outstanding still contributes its amount to Invoiced, but makes Settled/Outstanding **Incomplete — ERP outstanding missing**. | Reject a payment-allocation mirror, a cash/withholding split, proportional allocation, and limiting totals to single-invoice receipts. Nothing a project manager asks breaks without allocation: ERP outstanding answers exactly how much is still owed on this project. Company-level cash flow is later scope. Settlement includes non-cash adjustments and must not masquerade as cash. |
| OQ-PFIN-002 — audience | Only the existing revenue read set: **Admin, Finance, Executive, Project Manager**. Reuse `salesInvoice.view`; no new role. Engineers do not see or fetch this section. Enforce the read audience at the server too. Existing project Overview access is unchanged. | Reject widening the section to Engineer project viewers. The consolidated revenue surface follows its existing audience rather than introducing a second visibility contract. Prove the predicate and source scope at their owning layers. |
| OQ-PFIN-003 — time and currency | **Lifetime-to-date**, all fiscal years summed, for revenue, settlement, GL costs and selected budget context alike. Undated submitted invoices and NULL-fiscal-year GL facts count; no year is invented. Margin = lifetime billed-work revenue (the existing `sales_invoice_work_billed` net + recovery, excluding advances) − lifetime mapped GL cost, only within the same currency. Different invoice/base currencies yield **Unavailable — different currencies**. | Reject a fiscal-year selector on this section and currency conversion. The existing year-specific Budget Projection remains unchanged; comparing a lifetime revenue figure with one year's costs would give a misleading margin. No FX contract is authorized. |

Date: 2026-10-14. Lane: revenue attribution / money-path, Director-dispatched; not the factory.

## 1. Job story and scope

When historical books enter the connected accounting system directly, I want invoices attributed to their mapped projects, an explicit correction action for the remainder, and one project finance section, so that project revenue and cost can be understood without creating or activating a budget first.

In scope: project-aware Sales Invoice adoption, durable ERP project provenance, idempotent repair of existing unassigned mirrors, Finance/Admin attribution correction, and a project finance section.

Out of scope: ERP write-back, changing money or submission/approval rules, procurement adoption, a homegrown ledger, currency conversion, receipt allocation schema, and per-project cash/withholding splits. Existing native revenue behavior, contract-basis invoicing comparison and the year-specific Budget Projection are preserved.

## 2. Evidence and compatibility

These are repository-head observations, not claims about any deployed database:

- `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.ts` consumes binding `config.project_map` as **PMO project ID → ERP Project name**. Its inverse resolver returns null for an ERP name claimed by multiple PMO projects. Reuse that exact resolver; do not reverse the persisted map's direction.
- `supabase/functions/_shared/erpnextFeedDeps.ts` has claim-first adoption, customer/invoice lookup, lifecycle repair and an existing unassigned-invoice Finance notification. The new behavior extends this path, not a parallel importer.
- `pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts` owns `siFromDoc` and `SI_FROM_DOC_FIELDS`; durable ERP project provenance must travel through both, including full-document and poll reads.
- `supabase/migrations/0123_sales_incoming_payments_flip.sql` defines `incoming_payments.sales_invoice_id`; payments have no project column. The current mapper in `bodies/incomingPayment.ts` retains ERP references and header receipt figures; the feed resolves the first reference. The schema supplies neither an allocation child relation nor a per-invoice allocation figure. This is the schema evidence behind the settlement ruling: receipt header cash is not a per-project allocation oracle. This issue leaves the receipt schema and mapper unchanged.
- `pmo-portal/src/auth/policy.ts` defines revenue writers as **Admin + Finance**; Executive and Project Manager are revenue viewers, not writers. Admin is already in this set; OD-PROC-1 is not a reason to widen it or bypass same-org/active-member checks.
- `supabase/migrations/0275_native_revenue.sql` and the earlier revenue flip establish the current setter and mirror-guard patterns. Assignment is a narrow PMO-attribution command, not permission to edit native money fields.
- `supabase/migrations/0278_invoice_change_history.sql` registers invoice history. Assignment must join that existing mechanism, including project parent context, rather than invent another audit stream.
- `pmo-portal/src/lib/db/revenue.ts` uses per-(project, currency) keys. Its revenue definition reads `sales_invoice_work_billed`: net work billed, excluding down payments and adding claim recovery. Outstanding is separately sourced from the ERP outstanding mirror. Preserve these meanings.
- `supabase/migrations/0153_budget_line_item_fiscal_year.sql` defines the projection's Active-version/year logic and GL-account→category join. `0246_budget_account_map_multi.sql` permits several accounts per category, with one category per account. All mapped accounts count toward actuals, not only push targets.
- `docs/adr/0082-vendor-withholding-gross-amount-and-withheld-column.md` §Decision 6 puts project actual cost on the GL mirror, not vendor invoice gross or withholding.
- `pmo-portal/pages/project-detail/ProjectDetail.tsx` and `tabs/OverviewTab.tsx` own the detail surface. There is already an invoicing-against-contract section; extend/consolidate it rather than add another competing financial summary.
- `scripts/prior-art.sh "project_map"` found no matches in its five searched sources; source code above does define the map. `scripts/prior-art.sh "revenue per project"` returned this issue and prior revenue/report issues, including #831. Neither search proves absence outside its scope.

FR-PFIN-001/002 supersede FR-SAR-085's unconditional-null adoption rule. `require_project_on_si` remains a create/submit gate: historical inbound adoption is not rejected when the map is absent, ambiguous or unknown. Assignment changes attribution only; it does not submit a document or claim body authorship.

## 3. Decided defaults and alternatives

| Decision | Adopted default | Alternative not selected |
|---|---|---|
| D1 | **No ERP write-back.** Project assignment is PMO attribution. | Update ERP Project on the submitted invoice; would require a separate accounting/GL-consistency contract. |
| D2 | A sweep may fill a **NULL only**; it never overwrites an existing assignment, including a manual correction. | ERP-wins resynchronization or a last-writer-wins project link. |
| D3 | Reassignment is permitted as an audited correction. | Immutable assignment, or requiring cancel/amend to correct PMO attribution. |

### ERP submitted-field fact (verified 2026-10-14)

Stock **ERPNext v15 and v16 both declare `Sales Invoice.project` with `allow_on_submit: 1`**. Therefore D1 is a product boundary, not a claim that stock ERP forbids the edit.

Versioned primary sources (field `project` in the DocType metadata):

- [v15 metadata](https://github.com/frappe/erpnext/blob/bfd8100d42162048248b7b947f2e21fdf7999a91/erpnext/accounts/doctype/sales_invoice/sales_invoice.json)
- [v16 metadata](https://github.com/frappe/erpnext/blob/7474d9e786277383de1242ab882f16856d17a9c9/erpnext/accounts/doctype/sales_invoice/sales_invoice.json)
- [Frappe Allow on Submit documentation](https://docs.frappe.io/framework/doctypes/allow-on-submit): field editability does not establish the safety or recalculation of related transaction effects; controllers, permissions and validations still matter.

No claim is made that editing this header reattributes posted GL entries.

## 4. Functional requirements — EARS

### A. Adoption and history repair

- **FR-PFIN-001:** When an inbound Sales Invoice carries an ERP Project name uniquely mapped by its binding to an existing same-org PMO project, the system shall adopt it with that `project_id`, using the same inverse resolver as the actuals snapshot.
- **FR-PFIN-002:** When that project cannot be uniquely resolved, the system shall adopt the invoice with `project_id = NULL` and retain the existing Finance action-required notification, without rejecting adoption because `require_project_on_si` is on.
- **FR-PFIN-003:** When a source payload states its ERP project, the system shall persist the source text in a nullable `sales_invoices.erp_project` mirror column; when a partial payload omits it, the system shall leave previously recorded source text unchanged.
- **FR-PFIN-004:** When a later feed update resolves a project for an unassigned invoice, the system shall fill its NULL attribution atomically; while its attribution is non-NULL, the system shall preserve it regardless of the source project or binding-map change.
- **FR-PFIN-005:** When the one-shot historical repair is run, the system shall hydrate missing ERP project provenance for existing ERP invoice mirrors from their current external references, resolve using the shared resolver, and fill only NULL project links; repeat runs shall not change previously assigned rows or create new invoices.
- **FR-PFIN-006:** While a receipt has an invoice link, its project identity shall derive through that invoice's current `project_id`; an on-account receipt shall have no project, and the system shall not introduce `incoming_payments.project_id` or an allocation mirror. The finance section shall not sum receipt headers as project cash.

### B. Operator attribution

- **FR-PFIN-007:** When an active Finance or Admin member assigns or corrects an adopted ERP invoice's project, the system shall perform the change through a narrow security-definer RPC after checking the invoice and project belong to the caller's org.
- **FR-PFIN-008:** When any other caller requests assignment, the system shall refuse it without changing attribution or recording a successful change; while revenue is ERP-owned, direct client writes shall remain refused.
- **FR-PFIN-009:** When assignment changes the project, the system shall record caller identity and old/new project references using the existing record-change history mechanism; when the same assignment is repeated, it shall not produce a duplicate change event.
- **FR-PFIN-010:** When Finance/Admin views an unassigned adopted invoice, the system shall offer **Assign project** both through the Revenue by Project Unassigned group and on the invoice row; when it is assigned, the invoice row shall offer **Change project** for correction, gated by `can()`/`usePermission`.
- **FR-PFIN-011:** When an operator selects a project, the system shall use the shared form/Combobox primitives; when correcting an existing assignment, it shall confirm the old and new project before writing; when the request fails, it shall classify the error, retain the selection and offer retry without pretending success.
- **FR-PFIN-012:** When assignment succeeds, the system shall refresh the invoice, revenue, old/new project finance and record-history query families without a page reload or ERP command.

### C. Project finance section

- **FR-PFIN-013:** While an Admin, Finance, Executive or Project Manager views a readable project's detail Overview, the system shall provide one consolidated **Project finances — lifetime to date** section showing contract value and tax basis, per-currency Invoiced, Settled and Outstanding, billed-work revenue, GL cost actuals by budget category, selected budget and margin. Engineers shall not see or fetch it; the existing `salesInvoice.view` predicate shall be reused.
- **FR-PFIN-020:** When submitted, non-cancelled invoices are aggregated, the system shall group by currency and calculate Invoiced = Σ amount, Outstanding = Σ erp_outstanding_amount, Settled = Σ(amount − erp_outstanding_amount); if any outstanding is NULL, it shall retain the complete Invoiced figure but withhold complete Settled/Outstanding figures and explain missing ERP readings. It shall describe Settled as **settled against invoices (cash, withholding and credits)**, never as cash received.
- **FR-PFIN-021:** While finance figures are displayed, the system shall use lifetime-to-date scope with no fiscal-year filter: all submitted invoices including undated invoices, all current-generation mapped GL rows including NULL fiscal years, and all lines of the selected budget version. The existing year-specific Budget Projection shall retain its behavior and return shape.
- **FR-PFIN-014:** When cost actuals are requested, the system shall read a single current `erp_actuals_snapshot` generation through caller-visible data, map every configured account to its budget category through one shared SQL definition, and return actuals independently of any Active budget.
- **FR-PFIN-015:** When a project has an Active budget, the section shall show that version; when none exists but Draft versions exist, it shall show the latest Draft and label it **Draft — not active**; when neither exists, it shall say **No budget**, not show a fabricated budget.
- **FR-PFIN-016:** While displaying finance figures, the system shall group invoice settlement and revenue by their own currencies, label contract and budget with their header currencies and actuals with the ERP company/base currency, and shall never sum or subtract different currencies.
- **FR-PFIN-017:** When margin is displayed, the system shall calculate lifetime billed-work revenue minus lifetime mapped GL cost actuals in the same currency; when currencies differ, it shall say **Unavailable — different currencies**; when either operand is unavailable or incomplete, it shall explain unavailability rather than substitute zero. Margin is not contract less commitments, nor cash received less cost.
- **FR-PFIN-018:** While source visibility excludes restricted GL rows, the section shall neither disclose them nor describe a partial total as complete; it shall label totals as excluding restricted rows. The new section/read is confined to the existing revenue readers; tests shall prove those roles' approval-rank visibility over Employee-party ledger facts and reject other callers. Future narrowed scopes shall fail closed or use the explicit restricted-row label, never a silently complete partial total.
- **FR-PFIN-019:** When queries are pending, empty or failed, the section shall show distinct loading, empty and recoverable error states; unavailable readings or unmapped categories shall not render as known zero.

## 5. Non-functional requirements — EARS

- **NFR-PFIN-001:** The system shall preserve RLS, active-member checks and the `org_id` seam on every new read/write surface, including service-role attribution writes; no browser shall supply tenancy authority.
- **NFR-PFIN-002:** Every schema change shall use migration **0287**, with a reviewed down migration, grants, indexes and catalog assertions; **0286 is reserved and shall not be used**. Rollback shall preserve operator assignments and audit history or explicitly stop rather than silently discard them.
- **NFR-PFIN-003:** The system shall aggregate persisted money with SQL numeric or exact integer-unit arithmetic and transport exact figures; absent or malformed money shall not become a successful zero.
- **NFR-PFIN-004:** The system shall use bounded/keyset reads for historical repair and server-side project-scoped aggregation for finance totals, with indexed org/project/invoice joins; totals shall not depend on a truncated PostgREST page or per-invoice N+1 reads.
- **NFR-PFIN-005:** The system shall reuse one inverse project resolver and one category-mapping aggregate; refactoring the existing projection shall preserve its Active/year/attribution/ETC behavior and RPC return shape.
- **NFR-PFIN-006:** The interface shall use `DESIGN.md` tokens, shared accessible dialogs, keyboard-operable selection, localized English/Bahasa copy and narrow-screen wrapping; deterministic money and accessibility oracles shall be tests, not visual-review assumptions.
- **NFR-PFIN-007:** Every acceptance criterion shall have one canonical, ID-tagged owning test at ADR-0010's lowest sufficient layer; authorization tests shall detect a deliberately broken role predicate.
- **NFR-PFIN-008:** Reads shall use Supabase through typed repositories and org-scoped query caches; assignment shall not create an outbox command or call ERPNext.

## 6. Acceptance criteria — Given / When / Then

These are concrete requirements to prove, not claims of passing coverage. `Submitted`, `Unpaid`, and `Paid` are the positive submitted-state allow-list, as in `revenue.ts`; Draft and Cancelled never count.

| ID | Given | When | Then |
|---|---|---|---|
| AC-PFIN-001 | A uniquely mapped ERP project and a same-org PMO target | An inbound invoice is adopted | The project link and ERP project provenance are stored; no unassigned notification is raised. |
| AC-PFIN-002 | An absent, unmapped, duplicate-mapped or invalid target, with the create/submit project gate on | The invoice is adopted | It remains NULL and the existing Finance notification is used; adoption still succeeds. |
| AC-PFIN-003 | A previously assigned invoice, including a manual correction | A newer source event carries a different project or a partial event omits project | The assignment survives; only explicitly carried ERP provenance is refreshed. |
| AC-PFIN-004 | Existing NULL-linked ERP mirrors with current external references, assigned mirrors, unresolved ERP projects and one failed source read | The bounded historical repair hydrates provenance and is repeated | Known unique same-org matches fill NULL only using the shared resolver; assigned links survive; a completed repeat performs no repeat writes or inserts; failed reads are reported as incomplete and can be retried without skipping the failed row. |
| AC-PFIN-005 | A linked receipt and an on-account receipt | The linked invoice is assigned and then corrected | Project identity follows the invoice join; on-account remains unattributed, with no payment project column. |
| AC-PFIN-006 | An active Finance/Admin member and same-org adopted invoice/project | The member assigns or corrects attribution | The RPC succeeds and changes only attribution; ERP and native money remain untouched. |
| AC-PFIN-007 | Other roles, inactive membership, absent authentication, or foreign-org input | Assignment is attempted, or a direct client attribution update is attempted while ERP-owned | The request is refused and no attribution change occurs. |
| AC-PFIN-008 | A permitted operator change followed by an identical repeat | Assignment history is read | One change records the real actor and old/new projects; the repeat adds no change event. |
| AC-PFIN-009 | Unassigned and assigned invoice rows and different viewer roles | Revenue and invoice row actions render | Finance/Admin can find Assign/Change; non-writers cannot; selection, confirmation, failure and retry use the shared accessible flow. |
| AC-PFIN-010 | A successful attribution correction | Query caches refresh | Invoice/revenue/history and both affected project finance scopes refresh; no adapter command is dispatched. |
| AC-PFIN-011 | Two snapshot generations, no Active budget, Labor mapped to two accounts, Materials to one, and an unmapped category | Project actuals are read | Only the current generation contributes; both Labor accounts sum; reading `as_of` is returned; mapped actuals exist without a budget; unmapped or never-read categories are unavailable, not zero. |
| AC-PFIN-012 | An Active version 1 and Draft version 3; alternatively only Drafts 2 and 3; alternatively neither | Budget context is selected | Active 1 wins; otherwise Draft 3 (version descending, created_at descending, id descending tiebreakers) is labelled Draft — not active; otherwise No budget is shown. All selected-version lines count, regardless of fiscal year. |
| AC-PFIN-013 | USD billed-work revenue 130 (net 100 + claim recovery 30, down payments excluded), USD mapped costs 50, and a separate IDR invoice group | Margin is derived from the lifetime readings | USD margin is 80; IDR margin is Unavailable — different currencies; no conversion or cross-currency addition occurs. Unknown work revenue or unknown mapped cost makes its margin unavailable; NULL outstanding alone does not invalidate independently known billed-work revenue. |
| AC-PFIN-014 | Active same-org Admin, Finance, Executive, Project Manager, Engineer, inactive member and foreign-org project fixtures, including Employee-party GL facts | Project finance RPC reads execute | The four revenue readers can read their project's finance and approval-rank ledger facts; Engineer, inactive/anonymous and foreign-org reads return no finance data. Totals never disclose restricted facts or present an excluded-row total as complete. |
| AC-PFIN-015 | Pending, empty, failed and unavailable readings | The consolidated section renders | The correct state and retry/remedy are visible, without false zero or duplicate competing finance sections. |
| AC-PFIN-016 | A Finance session, one isolated adopted USD invoice amount 100 / ERP outstanding 25, and a readable project with no budget | The user enters from Unassigned, selects that invoice, assigns the project, then opens its Overview and reloads | The persisted project link leaves Unassigned and appears in Project finances; Invoiced 100, Settled 75 and Outstanding 25 are labelled USD; No budget does not hide actuals or invoices. No ERP command is sent. |
| AC-PFIN-017 | Submitted USD invoices (100, outstanding 25) and (80, outstanding 0), plus Draft 900, Cancelled 700, and submitted IDR (1000, outstanding 200) | Lifetime settlement is aggregated; then USD invoice (20, outstanding NULL) is included | Initially USD Invoiced 180 / Settled 155 / Outstanding 25 and separate IDR 1000 / 800 / 200 are returned. Afterwards USD Invoiced 200 remains known but Settled/Outstanding are Incomplete — ERP outstanding missing. Settled is described as settlement including cash, withholding and credits, never cash received. |
| AC-PFIN-018 | Submitted revenue facts in two fiscal years and without invoice dates, and mapped GL rows in two fiscal years and with NULL fiscal_year | Lifetime project finance and year-specific Budget Projection are read | Lifetime revenue/cost include all those facts exactly once in the current generation; the projection remains year-specific with its existing Active/year/attribution/ETC semantics and output columns. |
| AC-PFIN-019 | Finance-forward roles and an Engineer project viewer | Overview renders | Only roles permitted by the existing salesInvoice.view predicate mount/fetch the new section. Engineer's existing project Overview and delivery summary remain accessible, without the new finance section. |
| AC-PFIN-020 | A USD inclusive contract 220, a USD submitted invoice 100 exclusive plus tax 10, and Draft/Cancelled invoices | The consolidated contract comparison renders | The existing contract-basis comparison is preserved: invoiced against contract 110 inclusive, remaining 110 inclusive. The separate settlement card uses the stored amount 100 as ruled; differing bases are labelled rather than conflated. A different-currency or unknown-tax-basis contract comparison remains unavailable. |

### Owning-layer traceability (ADR-0010)

| AC | Requirements | Owning layer | Canonical test location |
|---|---|---|---|
| 001–003 | 001–004 | Unit: Deno handler-bound feed test | `supabase/functions/erpnext-sweep/projectInvoiceAttribution.test.ts` |
| 004 | 005 | Unit: handler-bound Deno historical repair | `supabase/functions/erpnext-sweep/projectInvoiceBackfill.test.ts` |
| 005 | 006 | Integration: pgTAP invoice/payment join | `supabase/tests/0287_project_finances_reads.test.sql` |
| 006–008 | 007–009 | Integration: pgTAP RPC/RLS/history | `supabase/tests/0287_assign_invoice_project.test.sql` |
| 009 | 010–011 | Unit: RTL form and entry points | `pmo-portal/pages/__tests__/SalesInvoices.assignProject.test.tsx` |
| 010 | 012 | Unit: repository/hook transport | `pmo-portal/src/hooks/useRevenue.assignProject.test.tsx` |
| 011 | 014 | Integration: pgTAP actuals aggregate | `supabase/tests/0287_project_finances_reads.test.sql` |
| 012 | 015, 021 | Integration: selected-version aggregate | `supabase/tests/0287_project_finances_reads.test.sql` |
| 013 | 016–017 | Unit: exact margin derivation | `pmo-portal/src/lib/projectFinances.test.ts` |
| 014 | 018 | Integration: pgTAP read visibility | `supabase/tests/0287_project_finances_reads.test.sql` |
| 015 | 013, 019 | Unit: RTL section | `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` |
| 016 | 010, 012–013 | E2E: one curated persisted assignment journey | `pmo-portal/e2e/AC-PFIN-016-project-finances.spec.ts` |
| 017 | 013, 020 | Integration: exact settlement aggregate | `supabase/tests/0287_project_finances_reads.test.sql` |
| 018 | 014, 021; NFR-005 | Integration: lifetime/projection compatibility | `supabase/tests/0287_project_finances_reads.test.sql` |
| 019 | 013, 018 | Unit: RTL audience/mounting | `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` |
| 020 | NFR-005; existing contract comparison | Integration: contract-basis aggregate | `supabase/tests/0287_project_finances_reads.test.sql` |

Every range denotes individually tagged test descriptions, not an untagged broad test. The companion plan fixes all signatures, oracles, migration/rollback changes and verification commands.

## 7. Sign-off boundary

All three Director questions are resolved; no product question remains open. Owner spec sign-off is the remaining approval before a builder is dispatched. D1–D3 and existing ADR-0010, ADR-0048, ADR-0055, ADR-0080 and ADR-0082 govern this implementation; these rulings reuse the existing ledger oracle, revenue audience and repository seams rather than introducing a new ledger, receipt schema, tenancy model or architectural dependency. Migration 0287 is the sole new forward migration.
