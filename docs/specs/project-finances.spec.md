# Project finances — issue #1008

> **OPEN QUESTION OQ-PFIN-001 — receipt attribution (blocking).** The current receipt schema has one nullable invoice FK, whereas an inbound ERP Payment Entry can carry multiple invoice allocations and an unallocated remainder. Its mirrored receipt figures are header figures, not per-invoice allocation figures. A join can inherit a linked invoice's project, but cannot establish how much of a multi-invoice receipt belongs to each project. Which contract should this issue implement?
>
> - **Recommended:** authorize a separate allocation mirror, with invoice links, org scope, source allocation identity and denomination; retain header cash/withholding independently. This expands the requested schema scope and needs Director approval.
> - **Alternative:** limit this release to demonstrably single-invoice, fully allocated receipts; explicitly mark other project receipt totals unavailable. This changes the requested coverage and also needs approval.
> - **Not equivalent:** derive settlement from invoiced minus ERP outstanding. That can include credits, write-offs and other adjustments; it is not received cash from `incoming_payments`.
>
> Also decide whether **Received** means allocated cash or gross receivable settlement including withholding. The existing receipt model distinguishes them. No proportional allocation of cash/withholding, or FX conversion, is authorized by this brief.
>
> **OPEN QUESTION OQ-PFIN-002 — new-section audience.** Should the consolidated section serve the existing revenue read roles (Admin, Finance, Executive, Project Manager), or also Engineer project viewers with explicitly qualified caller-visible cost totals? Recommend the existing revenue read set; do not change the project's existing Overview access.
>
> **OPEN QUESTION OQ-PFIN-003 — time scope.** Should this section be lifetime-to-date, or fiscal-year selectable? Recommend lifetime-to-date for the consolidated contract/budget context, retaining the existing year-specific Budget Projection separately. Margin must compare revenue and actuals over the same period, including an explicit treatment of undated source facts.
>
> **Status: BLOCKED draft; not signed off and not build-ready.** Per the dispatch's schema-contradiction rule, implementation planning stops at this question. The requirements and test ownership below preserve the requested scope; they do not authorize guessing the receipt contract. The companion plan is a decision checkpoint, not a complete executable implementation plan.

Date: 2026-10-14. Lane: revenue attribution / money-path, Director-dispatched; not the factory.

## 1. Job story and scope

When historical books enter the connected accounting system directly, I want invoices attributed to their mapped projects, an explicit correction action for the remainder, and one project finance section, so that project revenue and cost can be understood without creating or activating a budget first.

In scope: project-aware Sales Invoice adoption, durable ERP project provenance, idempotent repair of existing unassigned mirrors, Finance/Admin attribution correction, and a project finance section.

Out of scope: ERP write-back, changing money or submission/approval rules, procurement adoption, a homegrown ledger, currency conversion, or silently expanding the receipt schema before OQ-PFIN-001 is decided. Existing native revenue behavior is preserved.

## 2. Evidence and compatibility

These are repository-head observations, not claims about any deployed database:

- `pmo-portal/src/lib/adapterSeam/erpnext/actualsSnapshot.ts` consumes binding `config.project_map` as **PMO project ID → ERP Project name**. Its inverse resolver returns null for an ERP name claimed by multiple PMO projects. Reuse that exact resolver; do not reverse the persisted map's direction.
- `supabase/functions/_shared/erpnextFeedDeps.ts` has claim-first adoption, customer/invoice lookup, lifecycle repair and an existing unassigned-invoice Finance notification. The new behavior extends this path, not a parallel importer.
- `pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts` owns `siFromDoc` and `SI_FROM_DOC_FIELDS`; durable ERP project provenance must travel through both, including full-document and poll reads.
- `supabase/migrations/0123_sales_incoming_payments_flip.sql` defines `incoming_payments.sales_invoice_id`; payments have no project column. The current mapper in `bodies/incomingPayment.ts` retains ERP references and header receipt figures; the feed resolves the first reference. The schema supplies neither an allocation child relation nor a per-invoice allocation figure. **This is the deciding artifact for OQ-PFIN-001.** A historical receipt spanning projects cannot be truthfully split by the existing FK.
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
- **FR-PFIN-006:** While a receipt has an invoice link, its project identity shall derive through that invoice's current `project_id`; an on-account receipt shall have no project, and the system shall not introduce `incoming_payments.project_id`. Per-project received figures remain subject to OQ-PFIN-001.

### B. Operator attribution

- **FR-PFIN-007:** When an active Finance or Admin member assigns or corrects an adopted ERP invoice's project, the system shall perform the change through a narrow security-definer RPC after checking the invoice and project belong to the caller's org.
- **FR-PFIN-008:** When any other caller requests assignment, the system shall refuse it without changing attribution or recording a successful change; while revenue is ERP-owned, direct client writes shall remain refused.
- **FR-PFIN-009:** When assignment changes the project, the system shall record caller identity and old/new project references using the existing record-change history mechanism; when the same assignment is repeated, it shall not produce a duplicate change event.
- **FR-PFIN-010:** When Finance/Admin views an unassigned adopted invoice, the system shall offer **Assign project** both through the Revenue by Project Unassigned group and on the invoice row; when it is assigned, the invoice row shall offer **Change project** for correction, gated by `can()`/`usePermission`.
- **FR-PFIN-011:** When an operator selects a project, the system shall use the shared form/Combobox primitives; when correcting an existing assignment, it shall confirm the old and new project before writing; when the request fails, it shall classify the error, retain the selection and offer retry without pretending success.
- **FR-PFIN-012:** When assignment succeeds, the system shall refresh the invoice, revenue, old/new project finance and record-history query families without a page reload or ERP command.

### C. Project finance section

- **FR-PFIN-013:** While a user views a readable project's detail Overview, the system shall provide one consolidated finance section showing contract value and its tax basis, invoiced, received, ERP outstanding, GL cost actuals by budget category, budget and margin; the receipt definition shall be ratified through OQ-PFIN-001 before implementation.
- **FR-PFIN-014:** When cost actuals are requested, the system shall read a single current `erp_actuals_snapshot` generation through caller-visible data, map every configured account to its budget category through one shared SQL definition, and return actuals independently of any Active budget.
- **FR-PFIN-015:** When a project has an Active budget, the section shall show that version; when none exists but Draft versions exist, it shall show the latest Draft and label it **Draft — not active**; when neither exists, it shall say **No budget**, not show a fabricated budget.
- **FR-PFIN-016:** While displaying finance figures, the system shall group invoice/receipt figures by their own currencies, label contract and budget with their header currencies and actuals with the ERP company/base currency, and shall never sum or subtract different currencies.
- **FR-PFIN-017:** When margin is displayed, the system shall calculate recognized billed-work revenue minus mapped GL cost actuals in the same currency and time scope; when either operand is unavailable or incomplete, it shall explain unavailability rather than substitute zero. Margin is not contract less commitments, nor cash received less cost.
- **FR-PFIN-018:** While source visibility excludes restricted GL rows, the section shall neither disclose them nor describe a partial total as complete; it shall label totals as excluding restricted rows. If the new section is confined to the existing approval-rank revenue readers, the design shall document that audience and prove it, rather than assume every project viewer has that visibility.
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

These are requirements to prove, not claims of passing coverage. Receipt arithmetic is intentionally not frozen while OQ-PFIN-001 is open.

| ID | Given | When | Then |
|---|---|---|---|
| AC-PFIN-001 | A uniquely mapped ERP project and a same-org PMO target | An inbound invoice is adopted | The project link and ERP project provenance are stored; no unassigned notification is raised. |
| AC-PFIN-002 | An absent, unmapped, duplicate-mapped or invalid target, with the create/submit project gate on | The invoice is adopted | It remains NULL and the existing Finance notification is used; adoption still succeeds. |
| AC-PFIN-003 | A previously assigned invoice, including a manual correction | A newer source event carries a different project or a partial event omits project | The assignment survives; only explicitly carried ERP provenance is refreshed. |
| AC-PFIN-004 | Existing NULL-linked ERP mirrors, assigned mirrors, and unresolved ERP projects | The historical repair runs twice | Known unique matches fill NULL only; provenance is retained; neither repeat writes nor new invoices occur. |
| AC-PFIN-005 | A linked receipt and an on-account receipt | The linked invoice is assigned and then corrected | Project identity follows the invoice join; on-account remains unattributed, with no payment project column. |
| AC-PFIN-006 | An active Finance/Admin member and same-org adopted invoice/project | The member assigns or corrects attribution | The RPC succeeds and changes only attribution; ERP and native money remain untouched. |
| AC-PFIN-007 | Other roles, inactive membership, absent authentication, or foreign-org input | Assignment is attempted, or a direct client attribution update is attempted while ERP-owned | The request is refused and no attribution change occurs. |
| AC-PFIN-008 | A permitted operator change followed by an identical repeat | Assignment history is read | One change records the real actor and old/new projects; the repeat adds no change event. |
| AC-PFIN-009 | Unassigned and assigned invoice rows and different viewer roles | Revenue and invoice row actions render | Finance/Admin can find Assign/Change; non-writers cannot; selection, confirmation, failure and retry use the shared accessible flow. |
| AC-PFIN-010 | A successful attribution correction | Query caches refresh | Invoice/revenue/history and both affected project finance scopes refresh; no adapter command is dispatched. |
| AC-PFIN-011 | Current GL actuals and no Active budget | Project actuals are read | Mapped category actuals and reading provenance remain available independently of budget activation, without mixing snapshot generations. |
| AC-PFIN-012 | Active and Draft versions, or only Draft versions, or no versions | Budget context is selected | Active wins; otherwise the latest Draft is visibly labelled; otherwise No budget is shown. |
| AC-PFIN-013 | Different invoice, budget, contract or base currencies and down-payment/claim invoices | Totals and margin are derived | Currency groups stay separate; billed-work revenue retains the existing net/recovery definition; incomparable margin is unavailable. |
| AC-PFIN-014 | Users with different source read scopes | Project finance reads execute | Only allowed data is returned; a partial total is explicitly qualified or the audience is proven to have complete source visibility. |
| AC-PFIN-015 | Pending, empty, failed and unavailable readings | The consolidated section renders | The correct state and retry/remedy are visible, without false zero or duplicate competing finance sections. |
| AC-PFIN-016 | A Finance session and an unassigned adopted invoice | The user enters from Unassigned, assigns it, then opens the project Overview and reloads | The real persisted assignment appears in the project and leaves Unassigned, exercising UI → RPC → read-model wiring. |

### Owning-layer traceability (ADR-0010)

| AC | Requirements | Owning layer | Canonical test location reserved for the unblocked plan |
|---|---|---|---|
| 001–003 | 001–004 | Unit: Deno handler-bound feed test | `supabase/functions/erpnext-sweep/projectInvoiceAttribution.test.ts` |
| 004 | 005 | Integration: pgTAP repair contract | `supabase/tests/0287_project_invoice_backfill.test.sql` |
| 005 | 006 | Integration: pgTAP invoice/payment join | `supabase/tests/0287_project_finances_reads.test.sql` |
| 006–008 | 007–009 | Integration: pgTAP RPC/RLS/history | `supabase/tests/0287_assign_invoice_project.test.sql` |
| 009 | 010–011 | Unit: RTL form and entry points | `pmo-portal/pages/__tests__/SalesInvoices.assignProject.test.tsx` |
| 010 | 012 | Unit: repository/hook transport | `pmo-portal/src/hooks/useRevenue.assignProject.test.tsx` |
| 011 | 014 | Integration: pgTAP actuals aggregate | `supabase/tests/0287_project_finances_reads.test.sql` |
| 012–013 | 015–017 | Unit: finance derivation | `pmo-portal/src/lib/projectFinances.test.ts` |
| 014 | 018 | Integration: pgTAP read visibility | `supabase/tests/0287_project_finances_reads.test.sql` |
| 015 | 013, 019 | Unit: RTL section | `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` |
| 016 | 010, 012–013 | E2E: one curated persisted assignment journey | `pmo-portal/e2e/AC-PFIN-016-project-finances.spec.ts` |

Every range denotes individually tagged test titles, not one untagged broad test. Additional receipt-allocation ACs and their exact oracles require the Director's answer; no complete acceptance claim can precede them.

## 7. Decision checkpoint

Director must resolve OQ-PFIN-001/002/003 and authorize their coverage/schema consequences, then secure owner spec sign-off before a builder is dispatched. Pin the finance section's read audience and lifetime vs fiscal-year context in the unblocked design; revenue and cost in a margin must use the same scope. The requested brief does not authorize inventing FX or allocation rules.

No new architectural ruling or ADR is ratified by this draft. Existing ADR-0010, ADR-0048, ADR-0055 and ADR-0082 remain the architectural authorities.
