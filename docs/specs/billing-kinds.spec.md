# Billing kinds: contract drawdown and other project revenue

Status: proposed specification for owner sign-off; not an implementation claim.
Decision: [#1443 owner comment, 2026-10-28](https://github.com/ariefsaid/PMO/issues/1443#issuecomment-6467371128). Bug: [#1046](https://github.com/ariefsaid/PMO/issues/1046).

## Problem and job story

Finance links licences, reimbursables and work outside a contract to the same project as contract invoices. Treating all those invoices as contract drawdown makes Remaining to invoice misleading. A real contract overrun also needs an explanation and its source invoices.

When I link or correct an invoice's project billing attribution, I want to distinguish contract billing from other project billing, so that I can trust both the contract balance and the project's total revenue and margin.

## Owner decisions — verbatim

> **Owner decision (2026-10-28):**
> 1. A project carries two kinds of billing. *Contract billing* draws down the contract value; *other billing* (licences, reimbursables, work outside the contract) counts toward the project's revenue and margin but never reduces 'Remaining to invoice'. Finance chooses the kind where they link an invoice to a project; the default is *counts against contract*, so existing projects are unchanged.
> 2. When contract billing exceeds the contract value, show 'Invoiced above contract by X' listing the invoices behind it — never a bare negative remaining.
>
> Unblocks #1046.

Coordinator scope clarification (2026-10-28, this dispatched specification): choose the kind at every invoice-to-project link point, including adopted ERP attribution and native creation; allow narrow Finance/Admin kind-only correction of already-linked invoices, including paid invoices; preserve project/body/SoD restrictions. This clarification applies the owner decision and is not an additional owner quote.

## Prior art and compatibility

Ran `scripts/prior-art.sh billing` and `scripts/prior-art.sh 'Remaining to invoice'` before proposing requirements.

- [Project finances specification](project-finances.spec.md), FR-PFIN-007–012: assignment is audited PMO attribution, not an ERP body write; FR-PFIN-016/017/020/021 preserve per-currency, lifetime revenue and margin rules. This spec narrows contract drawdown membership, not total revenue membership.
- [Decisions](../decisions.md), OD-TAX-1: compare on the stored contract tax basis and label it. DD-CUR-6: preserve original currency buckets; never invent a conversion. DD-MONEY-2: margin is billed-work revenue less Actual, with existing completeness conditions.
- [ADR-0010](../adr/0010-test-strategy-pyramid.md) governs lowest-sufficient-layer ownership; [ADR-0016](../adr/0016-fe-authz-primitive-and-impersonation.md), [ADR-0017](../adr/0017-repository-api-seam.md) and [ADR-0019](../adr/0019-server-enforced-sod-and-delete-gating-for-crud.md) govern UX authorization, the repository seam and server enforcement.
- [ADR-0080](../adr/0080-billing-by-work-order.md) preserves work-order billing fences and invoice identities. The new project attribution kind is not a change to work-order authorization or claim/down-payment recovery accounting.

Repository evidence at this branch: `get_project_finances` is defined in `supabase/migrations/0376_cost_attribution.sql`; its `invoice_rows`, `inv`, `work` and `contract_rows` separate the aggregate bases. `ProjectFinancesSection.tsx` renders `contract_invoiced` and `remaining_to_invoice`. `InvoiceProjectModal.tsx` and `SalesInvoices.tsx` provide adopted-invoice assignment and invoice creation. These are source observations, not live database verification; this task runs no DB or browser.

## Functional requirements (EARS)

- **FR-001:** The system shall persist exactly one billing kind per invoice's project attribution: **Contract billing — counts against contract** or **Other billing — does not count against contract**; an invoice shall not be split between kinds.
- **FR-002:** When migrating existing invoices or accepting creation/link requests that omit the kind, the system shall use Contract billing; it shall not infer Other billing from descriptions, customer, payment state or invoice amount.
- **FR-003:** When Finance/Admin links an invoice to a project through adopted-invoice assignment or invoice creation, the system shall offer both kinds beside the project choice, default new choices to Contract billing, explain their effect, and save project and kind atomically. While editing an existing attribution, the system shall display its saved kind.
- **FR-004:** When Finance/Admin corrects the billing kind of an already-linked invoice, including a paid invoice, the system shall allow a kind-only correction on the same project without reopening, resubmitting or rewriting the invoice body, receipts, authorship or approval state. Existing restrictions on changing an invoice's project shall remain in force.
- **FR-005:** When the project or kind changes, the system shall audit old/new attribution using existing record history and refresh affected invoice, revenue, history and old/new project finance caches; when neither changes, it shall produce no duplicate change event. When only kind changes on the same project, it shall still save and refresh that project.
- **FR-006:** When computing Invoiced against contract, the system shall include only Contract billing invoices in the existing submitted, non-cancelled lifetime scope, normalized to the contract currency and stored tax basis. Other billing shall not reduce Remaining to invoice or invalidate an otherwise comparable contract total because its currency or tax basis differs.
- **FR-007:** When computing project total invoiced revenue, billed-work revenue, settlement, outstanding and margin, the system shall retain eligible invoices of both kinds exactly once under existing currency, net-of-tax, down-payment exclusion, recovery and actual-cost completeness rules. A kind-only correction shall not change those total-revenue or margin inputs.
- **FR-008:** While comparable contract billing does not exceed contract value, the system shall show Remaining to invoice equal to contract value minus contract billing, with zero at exact equality; where all eligible invoices are Other billing, contract billing shall equal zero and remaining shall equal the known contract value.
- **FR-009:** When comparable contract billing exceeds contract value, the system shall replace the negative remaining presentation with **Invoiced above contract by X**, where X is the exact positive excess on the contract's basis, and shall list the contributing Contract billing invoices with invoice reference, normalized contribution and a path to inspect the invoice. The list shall reconcile to contract billing and shall exclude Other billing, draft and cancelled invoices; it shall identify all contributors rather than arbitrarily blame a single invoice.
- **FR-010:** While contract value or any included Contract billing comparison is unavailable, the system shall show an explained unavailable comparison and shall not invent zero remaining or a known excess. While there are no linked eligible invoices, the existing no-invoices presentation shall remain available.
- **FR-011:** When a save fails, the system shall retain the project/kind choice, display a classified recoverable error and offer retry; when finance reads are pending or failed, it shall retain distinct loading/error states and shall not present stale success as a completed correction.
- **FR-012:** When ERP feeds, polling, mirror refresh or attribution backfill revisit an invoice, the system shall preserve an explicitly saved PMO billing kind; new invoice rows without an explicit kind shall take the default. Kind-only correction shall not enqueue an ERP money command or dispatch ERP writes.

## Non-functional requirements

- **NFR-001:** Authorization shall use real-role `can()`/`usePermission`, existing revenue read audiences, active membership, server-side role checks and RLS/`org_id` enforcement. Only Finance/Admin may mutate billing kind; impersonation shall grant no write authority. No client-provided org shall establish tenancy.
- **NFR-002:** Aggregation shall use SQL numeric/exact integer units and exact money transport; tax normalization shall use the existing stored-basis rules. No floating-point UI recomputation of financial totals or FX-based contract comparison is permitted.
- **NFR-003:** Totals shall be server-side project-scoped aggregates independent of PostgREST page limits. Contributor reads shall be org/project-scoped and deterministically ordered with complete pagination if needed; no per-invoice N+1 fetches or silently truncated reconciliation list.
- **NFR-004:** The implementation shall reuse repository interfaces, shared form/confirmation/error primitives and `DESIGN.md` tokens; controls, explanations and excess details shall work by keyboard, wrap on narrow screens and have English/Bahasa translations. Existing loading, empty, error and unknown-money distinctions shall survive.
- **NFR-005:** Schema rollout shall be reversible and default-compatible. Rollback shall preserve explicitly recorded Other billing classifications or stop with an explicit preservation requirement rather than silently changing their meaning.

## Acceptance criteria and owning proof

All amounts below are synthetic units of one example currency unless stated otherwise. Each AC has exactly one owning layer; test titles must carry its ID scoped to this spec. Paths below are proposed owning tests, not claims that the feature is already tested.

| ID | Given | When | Then | Owning layer and test |
|---|---|---|---|---|
| AC-001 | Existing native and adopted invoices, and older callers omitting kind | Migration runs and omitted-kind writes occur | Every applicable row is Contract billing and existing known contract totals are unchanged; invalid or null explicit kinds are refused | pgTAP — new `supabase/tests/billing_kinds.test.sql` |
| AC-002 | A known exclusive contract of 1,000; Contract billing 600; Other billing 300; complete same-currency work costs 200 | Project finance totals are read | Contract invoiced is 600, remaining 400, total invoice/work revenue is 900 and margin is 700; settlement/outstanding retain both kinds | pgTAP — new `supabase/tests/billing_kinds.test.sql` |
| AC-003 | A 1,000 contract, only Other billing, plus draft/cancelled rows of either kind | Contract comparison is read, including exact-equality and no-eligible-invoice variants | Other billing never consumes the contract; drafts/cancellations are excluded; zero eligible contract billing gives remaining 1,000 and contract billing of 1,000 gives remaining zero | pgTAP — new `supabase/tests/billing_kinds.test.sql` |
| AC-004 | Contract invoices 700 and 400 against 1,000, plus Other billing 250 | The finance section renders an excess reading with contributors | It says “Invoiced above contract by 100”, never bare remaining −100, and lists the two contract invoices with inspect links and contributions totaling 1,100; other/draft/cancelled invoices are absent | unit — `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` |
| AC-005 | Contract and invoice tax bases differ; Other billing has another currency or unknown tax basis | Finance aggregates are read, then an included Contract billing row becomes incomparable | Known contract rows normalize on the recorded contract basis; Other billing stays in its own revenue bucket without affecting comparison; an incomparable Contract billing row makes comparison/excess unavailable | pgTAP — new `supabase/tests/billing_kinds.test.sql` |
| AC-006 | A Finance/Admin user and an already-linked paid invoice of either source type | Kind alone is corrected, then the identical save repeats | Project, money, state, receipts and authorship remain unchanged; one attributed old/new kind history event exists, no duplicate event or ERP command exists, and same-project correction succeeds | pgTAP — new `supabase/tests/billing_kinds.test.sql` |
| AC-007 | Finance/Admin, Executive, Project Manager, Engineer, inactive, unauthenticated and foreign-org callers | They attempt kind writes through supported RPC and direct-write paths, or request contributor details | Only active same-org Finance/Admin can mutate; readers retain existing revenue visibility; tenancy and existing project/body/approval constraints hold and refused writes leave no successful change | pgTAP — new `supabase/tests/billing_kinds_roles.test.sql` |
| AC-008 | The adopted assignment dialog is open | Finance selects a project and kind, edits a saved kind, encounters failure, retries or cancels | Both choices and clear explanations are accessible, default/stored values are correct, kind-only changes enable Save, duplicate submit is blocked, failure retains inputs, and cancel persists nothing | unit — `pmo-portal/src/components/InvoiceProjectModal.test.tsx` |
| AC-009 | A successful assignment or same-project kind correction | Its mutation resolves | Invoice/revenue/history and affected old/new project finance caches invalidate; no ERP dispatch occurs | unit — new `pmo-portal/src/hooks/useRevenue.billingKinds.test.ts` |
| AC-010 | Finance sees an already-linked paid adopted invoice included in a project's contract excess | Finance opens its attribution action, marks Other billing, saves, visits project finances and reloads | Kind persists, remaining reflects only contract billing, excess disappears when resolved, and total project revenue/margin remain unchanged | e2e — new `pmo-portal/e2e/serial/AC-010-billing-kinds.spec.ts` |
| AC-011 | A new native invoice with a selected project | Its creation request explicitly chooses Other billing or omits kind | Project and chosen/default kind persist atomically, with the same native invoice body, author and approval contract; a failed create leaves no partial attribution | pgTAP — new `supabase/tests/billing_kinds.test.sql` |
| AC-012 | An invoice explicitly classified Other billing | ERP refresh or project backfill revisits it | Saved kind is retained; an unseen invoice defaults to Contract billing | pgTAP — new `supabase/tests/billing_kinds.test.sql` |
| AC-013 | Finance readings are pending, failed, absent, or contain unavailable contract data | The section renders | It shows the corresponding loading, retry, empty or unavailable state without fabricating an excess or zero | unit — `pmo-portal/pages/project-detail/ProjectFinancesSection.test.tsx` |
| AC-014 | The native or connected invoice creation form has a selected project | Finance chooses a billing kind and submits, retries a failed request or cancels | The form defaults to Contract billing, submits the chosen kind with the project, retains inputs on failure and writes nothing on cancel | unit — `pmo-portal/pages/__tests__/SalesInvoices.createForm.test.tsx` |

## Data, migrations and affected surfaces

This is a docs-only specification. A later implementation needs a new forward migration and matching `supabase/migrations/rollback/` down migration; do not edit historical migrations. Allocate its number during planning against the current migration head.

Proposed minimal data shape: a non-null constrained `sales_invoices.billing_kind` (`contract` / `other`) defaulting to `contract`, representing PMO project attribution. No separate revenue-stream entity, split allocation table or ERP field is needed. Update `record_history_config` for kind changes and reuse `record_changes`. Preserve `sales_invoices.project_id`, ERP provenance, `projects.contract_value`, invoice tax data and existing references. Extend the project-link write contract to accept kind atomically, add/reuse a narrow kind-only correction command, and carry kind through native and connected creation paths without treating it as ERP money/body data. API overload/default compatibility and enum/check details belong in the implementation plan.

Read/write contracts and UI paths verified in this worktree:

| Surface | Exact existing files / relations |
|---|---|
| Adopted assignment and narrow mutation contract | `supabase/migrations/0290_project_finances.sql` (`assign_sales_invoice_project`, provenance/backfill, history setup); `sales_invoices`, `projects`, `record_history_config`, `record_changes` |
| Current finance aggregate and preserved costs/cash | `supabase/migrations/0376_cost_attribution.sql` (`get_project_finances`); `sales_invoice_work_billed` from `supabase/migrations/0262_billing_by_work_order.sql`; `incoming_payments` stays on its existing cash contract |
| Native creation | `supabase/migrations/0275_native_revenue.sql` (`create_native_sales_invoice`); `pmo-portal/src/lib/db/revenueNative.ts`; `pmo-portal/src/lib/db/revenueNative.test.ts` |
| Connected creation transport | `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts`; `pmo-portal/src/lib/repositories/index.ts`; `supabase/functions/adapter-dispatch/index.ts` (trace metadata persistence in planning; never forward billing kind as an ERP accounting field) |
| DAL, repository API and typed payload | `pmo-portal/src/lib/db/revenue.ts`; `pmo-portal/src/lib/repositories/index.ts`; `pmo-portal/src/lib/repositories/types.ts`; `pmo-portal/src/lib/projectFinances.ts`; `pmo-portal/src/lib/supabase/database.types.ts` |
| Assignment and creation forms | `pmo-portal/src/components/InvoiceProjectModal.tsx`; `pmo-portal/pages/SalesInvoices.tsx` (includes `SalesInvoiceFormModal`); `pmo-portal/pages/RevenueByProject.tsx` (entry into unassigned attribution) |
| Cache and finance presentation | `pmo-portal/src/hooks/useRevenue.ts`; `pmo-portal/src/hooks/useProjectFinances.ts`; `pmo-portal/pages/project-detail/ProjectFinancesSection.tsx` |
| UX policy and translations | `pmo-portal/src/auth/policy.ts`; `pmo-portal/public/locales/en/common.json`; `pmo-portal/public/locales/id/common.json` |
| Existing DB regression owners | `supabase/tests/0290_assign_invoice_project.test.sql`; `supabase/tests/0290_project_finances_reads.test.sql`; `supabase/tests/0290_project_invoice_backfill.test.sql` |

`pmo-portal/src/lib/projectInvoicing.ts` also contains a contract-summary helper; a scoped search found no production call sites outside its definition. Planning must decide whether to align that helper or leave it unused, without introducing a second calculation authority.

### RLS and role gates

Reuse `salesInvoice.view` for Admin/Finance/Executive/Project Manager readers and the real-role `assign_project` mutation permission for Finance/Admin, extending the policy vocabulary only if needed for the kind-only action. Retain existing active-member, org, adopted-invoice project reassignment, native creation and invoice approval predicates. Billing kind is PMO metadata: its narrow server mutation must work on native and ERP-linked invoices without broadening invoice-body writes. RLS remains the enforcement authority for table access; a security-definer command must explicitly validate caller, org, invoice/project references and allowed mutation fields. Retain forced RLS and explicit grants; prove the new contract and role matrix with pgTAP. These are implementation requirements, not findings about deployed controls.

## Error handling

| Condition | Required behavior |
|---|---|
| Missing project or invalid kind | Inline field error; no partial save |
| Refused role, membership or tenancy | Classified refusal; no successful history or cache success |
| Project conflicts with invoice context | Preserve existing refusal; allow eligible kind-only correction independently |
| Network/RPC error | Preserve selected project/kind, show retry, do not claim success |
| Unknown contract/money, comparison mismatch | Explained unavailable contract comparison; retain independent revenue buckets |
| Excess contributor read fails or is incomplete | Show excess only from verified aggregate; explicitly explain unavailable/incomplete details and offer retry, never a purportedly complete partial list |

## Implementation checklist and exclusions

- [ ] Obtain owner spec sign-off, then produce a separate implementation plan with exact migration number, command signatures, typed payloads and per-AC ownership.
- [ ] Add default-compatible storage, atomic attribution/create metadata, narrow kind correction and history; preserve incoming ERP refresh behavior.
- [ ] Filter only the contract aggregate; add reconciled excess contributors; preserve revenue, margin, cash and cost bases.
- [ ] Add form choices, same-project correction, refresh wiring and localized excess presentation using existing primitives.
- [ ] Implement AC proofs at their owning layers, including authorization mutation checks, then complete the applicable repository gates and rendered UI proof in the implementation lane.

Out of scope: invoice line splitting, configurable revenue streams, automatic classification or historical guesses, contract value changes, work-order ceilings/claims/down-payment recovery changes, ERP accounting changes, receipt allocation changes, new approval roles, currency conversion, management-pack recognition policy changes, and a project-detail redesign.

## Open questions

No unresolved product question after the owner decision and coordinator scope clarification. Storage/command naming, migration allocation and contributor pagination are implementation-plan decisions; owner spec sign-off remains required before build.
