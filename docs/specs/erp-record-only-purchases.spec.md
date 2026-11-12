# Record existing ERP costs as project purchases — #2195

An Admin can turn existing journal costs or an ERP invoice into a purchase on the project.
The purchase records history, skips approval, and can never send anything to the ERP.
Journal costs stay unchanged; an invoice assigned in PMO counts on its chosen project exactly once.
The screen says “Project assigned in PMO” when the ERP invoice itself has no project.
An Admin can undo the link; overhead stays unassigned and the ERP books never change.

- **Status:** Owner sign-off required before build acceptance; P0. Owner defaults relayed 2026-11-12 are binding below.
- **Plan:** `docs/plans/2026-11-12-erp-record-only-purchases.md`.
- **IDs:** FR-ROP / NFR-ROP / AC-ROP. Job: as an Admin reconciling project history, I want every existing project cost represented by a purchase, so its vendor and supporting order are findable without booking it again.
- **Separate spec:** extends #1919's explicitly excluded Q2 without rewriting its shipped attach-to-existing contract. Existing ordinary link/attach roles and behavior remain governed by that spec and ADR-0093.
- **Delivery:** S1 = reversible SQL, server rules and CLI dry run for both sources, **no frontend changes**; eligible for the no-frontend hotfix lane. S2 = journal-list and unassigned-invoice-list actions, purchase and cost-line markers, and Admin undo. S1 is operational through CLI while S2 supplies the visible markers; do not call the complete screen experience shipped with S1.

## Evidence and binding prior rulings

These observations describe the checked-out `origin/dev` source at `7556b969c3fafc6fba30be56c19f4bb85ec38e8d`, not a claim about a deployed database.

| Ruling / artifact | What it binds |
|---|---|
| #2195 body and owner comment; 2026-11-12 coordinator ruling | Admin-only create/undo; journals and unassigned supplier invoices; no ERP write; PMO-side assignment; overhead unassigned; S1/S2 split |
| ADR-0093 §§1–5; #1319 | Link ERP documents, do not copy them into PMO invoice/order/payment records; count ledger costs once; preserve ordinary derived status, gates and SoD |
| DD-XING-2, amended for purchases by ADR-0093 | Historical ERP documents remain immutable read models; purchase links are the explicit exception to “never adopted” |
| ADR-0048 / ADR-0082; #1919 FR-JEC-020–023; migrations 0687, 0765 | Ledger is the amount oracle; journal links affect commitment, never actuals; cancelled/reposted lines follow mirror truth |
| OD-SAR-GATES, OD-SAR-PMO-IS-THE-UI | Flexible entry; ordinary process gates stay intact; users need no ERP Desk action |
| ADR-0055 and ADR-0059; OD-SAR-DRAFT-SUBMIT | Respect domain ownership; this historical wrapper is **not** a new push-on-approval process and does not alter sales approval |
| ADR-0078 / ADR-0081; 0765 | PMO-posted expense/imprest and mirrored invoice journal vouchers remain excluded from stray journals; no second procurement for the same source |
| 0376, 0471, 0497, 0720, 0794 | Preserve rule attribution, equipment allocations, category mapping, audience restrictions and unconfigured fast paths |
| ADR-0016 / ADR-0017 / ADR-0019 / ADR-0010 | Real-role UX; typed repository seam; database-enforced role/tenancy/SoD; lowest sufficient owning test |
| 0364 and `docs/runbooks/pmo-cli.md` §6 | Existing set-aside/undo for overhead; CLI preview before apply, bounded inputs and explicit refusals |

Shipped create-from-document machinery is `supabase/migrations/0378_erp_document_recorded_by_pmo.sql:119` (`link_erp_purchase_documents`); at lines 224–232 it creates an `origin='erp_link'` wrapper when no purchase is supplied. Its `document_has_no_project` guard is at lines 244–247; **retain that guard for ordinary links**, adding an explicit Admin record-only assignment path. Existing supplier resolution is `erp_supplier_company` (0369); document-family locking and same-vendor/project constraints come from 0372/0378. The client seam is `pmo-portal/src/lib/repositories/erpPurchases.ts:162` (`linkErpPurchaseDocuments`; line references verified during planning).

Journal attach/detach is `supabase/migrations/0687_erp_journal_cost_lines.sql:111` / `:192`; its stable key is `(org_id, erp_doctype, voucher_no, project_id, account)`. Current ERPNext/Odoo line derivation is `supabase/migrations/0765_odoo_ledger_basis.sql:99`. Client reuse is `pmo-portal/src/lib/repositories/erpJournalLines.ts` and `src/hooks/useErpJournalLines.ts`.

## 1. Record-only means no approval, no push, no duplicate spending

**FR-ROP-001** When an active Admin records eligible sources, the system shall atomically create an immutable record-only purchase wrapper, its vendor/reference metadata and its existing-source links, without creating a PMO purchase order, invoice, receipt or payment. “Record-only” describes historical evidence, not new spending authorization (ADR-0093).

**FR-ROP-002** While a purchase is record-only, the server shall refuse ordinary submit/approve/pay transitions, new transactional child records, conversion to an ordinary purchase, and every ERP command for it; no outbox row or posting intent shall be created, including forged dispatch and retry attempts. Screen hiding and CLI routing are not enforcement (ADR-0019; money-path primer). Files and descriptive metadata may be maintained through existing authorized paths; source amount/vendor/project are changed only by undo and a fresh record operation.

**FR-ROP-003** When journal lines are recorded, the wrapper shall show “Already settled in ERP” as historical evidence, without inventing a Payment Entry or implying a new payment. Journal amounts already count through the ledger; neither wrapper value nor links shall be added to actuals. The wrapper shall create zero open commitment, including after ERP cancellation/repost. Its history remains inspectable with source cancellation/reversal warnings (#1919 FR-JEC-022/042).

**FR-ROP-004** When an ERP invoice is recorded, the wrapper shall retain the ERP invoice's actual settlement evidence; an unpaid invoice shall not be labelled paid. A tagged invoice adds no actuals. A genuinely untagged invoice assigned in PMO contributes its eligible mirrored expense lines once, in ledger currency; the wrapper amount never contributes a second time. Record-only wrappers always contribute zero commitment; outstanding ERP liability remains visible through existing invoice/aging reads (ADR-0093; 0651).

### Deciding actuals paths and deduplication

`project_mapped_actuals(uuid,text)` and `project_mapped_actuals_all(text)` (head bodies 0497) combine tagged `erp_actuals_snapshot`, rule-attributed GL and equipment charges. `project_finance_actuals` (0560), `get_project_finances` (0791), budget reads and executive/finance dashboards consume those shared reads; the two entry points must remain equivalent. `cost_attribution_allocations` (head evolution 0376/0471) is the rule/equipment allocation seam; 0720/0794 wrap its aggregates with fast paths. `procurement_ledger_held` / `_many` (0687) feed `procurement_open_commitment` and `project_committed_spend` (0651); they are commitment reads, not actuals.

**FR-ROP-005** The system shall apply one source precedence per ledger line: ERP project tag first, explicit PMO invoice assignment second, existing rule/equipment attribution third, otherwise unassigned. A non-empty but unmapped ERP project is **not** an unassigned invoice. Assigned invoice lines shall be excluded at the shared allocation input, including attribution preview, to prevent two projects claiming the same cost. Actuals remain ledger-derived, grouped by account/category/fiscal year and using debit minus credit; never use invoice grand total or purchase total as an actuals fallback (0376; ADR-0048).

**FR-ROP-006** When an assignment is applied or undone, the shared per-project and all-project actuals shall expose it in the same committed transaction, with unknown/unmapped values remaining unknown. When subsequent ERP sync tags, cancels, reposts or changes that invoice, the next coherent actuals generation shall use the source once; a tag moving to another project supersedes the PMO assignment and the purchase shall flag the discrepancy for Admin correction. A snapshot/GL refresh in progress shall expose a refreshing/unknown result rather than a plausible incomplete or duplicate amount. No silent currency conversion or fabricated zero is permitted.

## 2. PMO-side project assignment is visible and changes PMO project reports

**FR-ROP-010** When an Admin chooses a project for an ERP supplier invoice whose ERP project is genuinely empty, the system shall store that assignment in PMO only, linked to the mirrored document and purchase, and leave the ERP document, mirror project fields and ERP GL rows unchanged. **PMO's project cost report will then differ from the ERP's own project report for that invoice** (#2195 owner comment; #1008 is revenue prior art, not procurement implementation authority).

**FR-ROP-011** While that assignment is active, the purchase and its invoice cost line shall each display “Project assigned in PMO” and explain “The ERP invoice has no project; this assignment changes PMO project reporting only.” Cost-line detail shall show the linked purchase, account, date, ledger amount and assignment origin. API/CLI reads shall carry the same explicit origin from S1; S2 renders it. Assigned rows must be findable on the selected project's Procurement list even though the mirror's original `project_ids` stays empty.

**FR-ROP-012** The system shall accept tagged invoices only on their mapped project and shall refuse multi-project, ambiguous or unresolved ERP-project invoices for this operation, retaining 0372 consistency and existing ordinary-link behavior. Invoice adoption is whole-document, not a percentage split; only eligible expense-account GL lines enter actuals. Missing ledger evidence or account mappings shall cause an explicit refusal rather than guessing an amount.

## 3. Admin authority and source validation

**FR-ROP-020** When create, preview or undo is requested, a security-definer RPC shall require an active **Admin** in the caller's own organization, derive organization and actor from authentication, and validate all source/project/vendor links server-side. Finance, Executive, Project Manager, Engineer, inactive members and anonymous callers shall be refused. Existing ordinary attach/link roles are unchanged. The new screen's `can()` check is UX only (ADR-0016/0019).

**FR-ROP-021** When multiple journal lines form a purchase, the system shall require one mapped project and one unambiguous vendor, preserve all line keys, and sum current positive line amounts in the organization's ledger currency. The Admin supplies the supporting order/reference and title; the amount is server-computed, never editable. Where the GL party does not identify a supplier, the Admin shall explicitly select a same-org vendor and confirm that choice; a conflicting known supplier or multiple parties shall be refused. Free-text remarks shall not be used as automatic vendor identity.

**FR-ROP-022** When any source in one purchase group is invalid, the system shall refuse the entire group without partial wrappers or links, using stable reasons for already-attached sources, different vendors/projects/currencies, cross-org or missing references, cancelled/draft ERP documents, non-positive journals, PMO-posted journals, returns, missing ledger basis and unsupported source kinds. Existing source uniqueness constraints and sorted source/family locks shall serialize competing operations (0372, 0687).

**FR-ROP-023** When an applied request is retried with the same request identity and payload, the system shall return the existing purchase without a second cost or audit-create event; changed payload with that identity shall be refused. Preview shall validate through the same server path but write no durable data, audit, numbering increment, link, assignment, outbox or intent. Groups are independently atomic within a maximum of 500 source rows; output identifies every refused group and source.

**FR-ROP-024** Where existing document links support a foreign document currency, invoice wrappers shall retain that currency and existing net-total semantics; actuals shall use mirrored company-currency GL values, never convert using a newly invented rate. Journal wrappers shall use ledger currency only, as 0687 requires. Refuse a currency/basis the mirror cannot prove. Odoo journal eligibility follows 0765; do not re-list an Odoo invoice as a journal.

## 4. Undo preserves ERP cost and history

**FR-ROP-030** When an Admin confirms undo with a reason, the server shall atomically unlink all sources from that record-only purchase, deactivate its PMO-side invoice assignment, and cancel the historical wrapper using the existing procurement terminal convention rather than hard-delete it (ADR-0019). The record-only marker shall remain immutable. Source documents and journal rows return to their previous unlinked list; a previously set-aside mark shall be restored. Repeated undo shall be an explicit no-op.

**FR-ROP-031** When undo completes, journals and tagged invoices shall retain their existing project actuals; an untagged invoice shall return to the cost placement the ERP and any pre-existing attribution rule give it. Its PMO-only assignment disappears, so the chosen PMO project's cost may fall. Undo is **not** an ERP cancellation, refund or movement of cost. Record-only commitment remains zero. Ordinary unlink/detach must not leave half an active record-only purchase; direct those calls to this complete undo or refuse with `record_only_use_undo`.

**FR-ROP-032** The system shall append audit events recording create/undo actor, time, source keys, purchase, project, vendor selection, assignment origin, before/after placement and reason. Undo shall retain its original create event, document references and readable history. Audit contents follow existing money-audience restrictions; no posting intent is an audit substitute.

## 5. CLI preview for both cases

**FR-ROP-040** The CLI shall offer the following bounded commands through the existing authenticated `pmo purchases` surface (runbook §6), without generic table writes or a new credential path:

```text
node scripts/pmo.mjs purchases record-only history.json --dry-run
node scripts/pmo.mjs purchases record-only history.json
node scripts/pmo.mjs purchases undo-record-only PURCHASE --reason "Incorrect link" --dry-run
node scripts/pmo.mjs purchases undo-record-only PURCHASE --reason "Incorrect link"
```

The undo command reverses links and cancels a wrapper; it deletes no business record, preserving the runbook's no-delete rule. `history.json` is an array of purchase groups. Each group has `request_id` (UUID), `project_id`, `vendor_id`, `reference`, `title` and exactly one source kind: `journal_lines` with the existing doctype/voucher/project/account keys, or `erp_documents` with mirrored document id(s). Do not mix journal and invoice sources in one wrapper. The API uses the same representation and RPCs for screen and CLI.

**FR-ROP-041** Each preview/apply result shall include request identity, source keys, `create|skip|refused`, stable reason, proposed project/vendor/reference, wrapper currency/amount, actuals before/after delta by affected project, `assignment_origin` (`erp_project|pmo_assignment`), and `erp_write:false`. Preview newly-created purchase ids shall be null, with `would_create:true`; apply returns the real id. Preview of a journal group shall show zero actuals delta; an unassigned invoice shall show the new placement and any superseded attribution, not claim “spending unchanged.” Refusals shall exit 2 with per-group reasons; transport/unknown outcomes shall preserve request identities for safe retry, not mint a fresh request.

## 6. Exclusions and overhead

**FR-ROP-050** While an invoice remains overhead, the system shall keep it unassigned and off project Procurement lists. Admin may leave it unlinked or use the existing set-aside action (0364; Admin/Finance ordinary marking unchanged); neither action shall create a project assignment. A set-aside source requires explicit confirmation before record-only creation; preview shall report the cleared mark and undo shall restore it. Existing independent attribution rules continue to operate until intentionally changed; the workflow shall warn if a purported overhead invoice is already allocated by such a rule.

**NFR-ROP-001** No ERP write of any kind is in scope: no invoice/project edits, posting, payment, approval, backfill or migration of accounting amounts. No ordinary purchasing workflow redesign, native-history import (#1855), source splitting, general rule editor, revenue changes, HR expense/imprest adoption, new FX mechanism or Odoo ledger cutover is included.

**NFR-ROP-002** Reads shall retain existing audience/tenancy and paging, use indexed source keys and set-based all-project aggregates, preserve equipment attribution and zero-configuration fast paths, and invalidate project procurement, actuals, dashboards and orphan/journal queries after apply/undo. S2 shall use existing form/confirm primitives, DESIGN.md tokens and screen rules with loading, empty, error, conflict and keyboard states.

## Acceptance criteria and canonical owning layer

Every title below is the exact owning-test prefix; ids are namespaced to avoid collisions with other specs. Other layers may reference the id but do not take ownership (ADR-0010).

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-ROP-001 | Given eligible same-vendor journal lines on one project and no purchase, when Admin records one group, then one wrapper holds every line, its amount is their sum, journal reads name the purchase and actuals are unchanged. | pgTAP |
| AC-ROP-002 | Given a tagged supplier invoice, when Admin records it, then its existing project actuals are unchanged and no PMO transaction copy exists. | pgTAP |
| AC-ROP-003 | Given an untagged invoice and an overlapping attribution rule, when Admin assigns it in PMO, then its eligible ledger cost appears on the chosen project once and disappears from the superseded rule placement; single/all-project reads agree. | pgTAP |
| AC-ROP-004 | Given a record-only purchase, when create/transition/child-write/ERP-command paths are attempted, then approval-to-ERP is refused, no outbox or posting intent exists, and commitment stays zero. | pgTAP |
| AC-ROP-005 | Given each real role and inactive/anonymous callers, when create/preview/undo is called, then only active Admin succeeds, and existing ordinary-link SoD refusals still hold. | pgTAP |
| AC-ROP-006 | Given another organization's source, vendor or project, when Admin submits it, then it is refused as not found without cross-org output or writes. | pgTAP |
| AC-ROP-007 | Given duplicates, mismatched vendors/projects/currencies, cancelled/draft/return/PMO-posted sources or missing basis/mapping, when a group is previewed/applied, then the whole group is refused with its stable reason and no partial wrapper. | pgTAP |
| AC-ROP-008 | Given valid groups of either source kind, when preview then apply then identical retry occurs, then preview changes no durable state, apply creates once and retry returns that purchase; changed request payload is refused. | pgTAP |
| AC-ROP-009 | Given an active wrapper of either kind, when Admin undoes it twice, then sources unlink, assignment and prior mark revert, wrapper is cancelled once, ledger cost stays in its original ERP/rule placement and audit history survives. | pgTAP |
| AC-ROP-010 | Given a foreign-currency invoice or ledger-currency journal, when it is recorded, then wrapper currency follows existing linking and actuals use company-currency GL once; unsupported conversion is refused. | pgTAP |
| AC-ROP-011 | Given a linked source, when ERP cancel/repost/project-tag changes synchronize, then a coherent read counts the current cost once, cancellation/reversal/conflict is visible in read metadata, and no new commitment or push appears. | pgTAP |
| AC-ROP-012 | Given journal and invoice input files, when CLI preview/apply/undo runs, then exact RPC arguments, identities, delta/origin output, refusal exit 2 and transport retry guidance match FR-ROP-040/041. | unit (node:test) |
| AC-ROP-013 | Given Admin on the project journal list, when selecting lines and recording the supporting order, then the purchase appears on Procurement, its links open correctly and displayed project spending is unchanged. | e2e (S2) |
| AC-ROP-014 | Given Admin on the unassigned-invoice list, when choosing a project and confirming the PMO-only warning, then its purchase and cost line display the PMO assignment marker and undo restores the unassigned state. | e2e (S2) |
| AC-ROP-015 | Given overhead or set-aside invoices, when left alone or explicitly recorded and undone, then no implicit project assignment occurs, confirmation is required for a marked source and its original mark returns on undo. | pgTAP |
| AC-ROP-016 | Given loading/error/empty/conflict states and real non-Admin roles, when S2 forms/lists render and are used by keyboard, then role affordances, clear reasons, focus restoration and source-origin markers follow the contract without a fabricated zero. | unit (RTL) |

No unresolved owner defaults remain: Admin only, Admin undo, zero journal spend delta, PMO invoice assignment counted once, overhead unassigned, and S1 server/CLI before S2 UI are ruled. The implementation plan must preserve these outcomes; signature refinements are engineering choices, not permission to narrow either source case.
