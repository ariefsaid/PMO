# Record existing ERP costs as project purchases — #2195

An Admin can capture all existing project purchases from a connected ERP in one preview and bulk acceptance.
The purchases show supplier, reference, date, description, amount and ERP stage alongside PMO-raised purchases.
Capture never resends ERP history or books its cost again; later steps can continue in PMO under ordinary rules.
Unassigned invoices wait for a bulk project choice or overhead decision, explicitly recorded on the PMO side.
A project report proves what was captured and names every remaining cost; Admin can undo any capture.

- **Status:** P0; expanded by owner restatement and Director build order on 2026-11-12. Owner sign-off required before build acceptance. Owner defaults relayed 2026-11-12 are binding below.
- **Plan:** `docs/plans/2026-11-12-erp-record-only-purchases.md`.
- **IDs:** FR-ROP / NFR-ROP / AC-ROP. Job: when connecting an ERP that already holds history, or reconciling later direct ERP activity, an Admin wants every project-related purchase captured in PMO without recreating its request chain or booking it again, while continuing only the remaining unpaid steps in PMO.
- **Separate spec:** completes #1919 Q2 and the purchase-history portion of #1599 / OD-ERP-ANYTIME-1. `erp-connect-anytime.spec.md` remains the authority for master matching, cutover and the shared setup pass.
- **Delivery order (latest Director ruling):** **A / slice 1** = ERP-neutral bulk proposer on the existing order/single-project-invoice link path plus completeness report, server + CLI only; A may ship independently. **D immediately after the A unlock** = continue eligible unpaid captured purchases through the shared per-step guard, also used by the separate existing `erp_link` continuation fix. **B1–B4**, each separately reviewed = bulk no-project-invoice assignments; per-project split invoices; journal-created purchases; payments without invoice. **C** = source line-item/description capture (not supplied by the checked existing link path), independently reviewed alongside B. **Slice 2** = screens, setup-pass offer and markers, after their owning server capability ships. No UI is required to release A; the full owner goal is not complete with A alone.

## Evidence and binding prior rulings

These observations describe the checked-out `origin/dev` source at `7556b969c3fafc6fba30be56c19f4bb85ec38e8d`, not a claim about a deployed database.

| Ruling / artifact | What it binds |
|---|---|
| #2195 body/comment; owner restatement and Director build order 2026-11-12 | Admin-only create/undo; journals and unassigned supplier invoices; no ERP write; PMO-side assignment; overhead unassigned; S1/S2 split |
| OD-ERP-ANYTIME-1; connect-anytime spec §§1, 4.2, 6 | All four connect cases, map once, propose all / accept all, ask only unclear rows; one adapter contract |
| ADR-0093 §§1–5; #1319 | Link ERP documents, do not copy them into PMO invoice/order/payment records; count ledger costs once; preserve ordinary derived status, gates and SoD |
| DD-XING-2, amended for purchases by ADR-0093 | Historical ERP documents remain immutable read models; purchase links are the explicit exception to “never adopted” |
| ADR-0048 / ADR-0082; #1919 FR-JEC-020–023; migrations 0687, 0765 | Ledger is the amount oracle; journal links affect commitment, never actuals; cancelled/reposted lines follow mirror truth |
| OD-SAR-GATES, OD-SAR-PMO-IS-THE-UI | Flexible entry; ordinary process gates stay intact; users need no ERP Desk action |
| ADR-0055 and ADR-0059; OD-SAR-DRAFT-SUBMIT | Respect domain ownership; this historical wrapper is **not** a new push-on-approval process and does not alter sales approval |
| ADR-0078 / ADR-0081; 0765 | PMO-posted expense/imprest and mirrored invoice journal vouchers remain excluded from stray journals; no second procurement for the same source |
| 0376, 0471, 0497, 0720, 0794 | Preserve rule attribution, equipment allocations, category mapping, audience restrictions and unconfigured fast paths |
| ADR-0016 / ADR-0017 / ADR-0019 / ADR-0010 | Real-role UX; typed repository seam; database-enforced role/tenancy/SoD; lowest sufficient owning test |
| 0364 and `docs/runbooks/pmo-cli.md` §6 | Existing set-aside/undo for overhead; CLI preview before apply, bounded inputs and explicit refusals |

Shipped create-from-document machinery is `supabase/migrations/0380_procurement_link_supplier_ref.sql:39` (`link_erp_purchase_documents`); at lines 139–155 it creates an `origin='erp_link'` wrapper when no purchase is supplied. Its `document_has_no_project` guard is at lines 165–168; **retain that guard for ordinary links**, adding an explicit Admin record-only assignment path. Existing supplier resolution is `erp_supplier_company` (0369); document-family locking and same-vendor/project constraints come from 0372/0378. The client seam is `pmo-portal/src/lib/repositories/erpPurchases.ts:162` (`linkErpPurchaseDocuments`; line references verified during planning).

Journal attach/detach is `supabase/migrations/0687_erp_journal_cost_lines.sql:111` / `:192`; its stable key is `(org_id, erp_doctype, voucher_no, project_id, account)`. Current ERPNext/Odoo line derivation is `supabase/migrations/0765_odoo_ledger_basis.sql:99`. Client reuse is `pmo-portal/src/lib/repositories/erpJournalLines.ts` and `src/hooks/useErpJournalLines.ts`.


## 0. Capture all, at connect and on demand

**FR-ROP-060** When an Admin requests capture for the whole organization or one project, the system shall census all existing source documents through one ERP-neutral adapter contract, propose all clear mappings together, and apply the accepted proposals in resumable bounded groups. Existing PMO documents shall be matched by strong external identity before any wrapper is created; ambiguous matches remain “Needs a decision.” Repeating capture shall create nothing twice and shall discover later direct ERP entries. It shall require no per-document clicking (OD-ERP-ANYTIME-1; connect-anytime §§2, 4.2, 6).

**FR-ROP-061** The shared contract shall expose opaque source/document/line identities, normalized `order|receipt|supplier_invoice|supplier_payment|journal|adjustment` kinds, supplier, project shares, reference, date, item/description lines, document and ledger currencies/amounts, source version and `draft|ordered|received|invoiced|part_paid|paid|cancelled` state. Server rules and CLI shall contain no ERP-specific doctype switches or ERP project-field assumptions. ERPNext shall implement the contract; Odoo shall implement it or return an explicit tested `unsupported` capability naming missing feeds/line-project evidence. Unsupported is neither an empty successful capture nor permission to fall back to ERPNext semantics (ADR-0055; OD-ERP-ANYTIME-1).

| Source kind / state | Result and delivery |
|---|---|
| Submitted order, no invoice | A: captured order-stage purchase; its open amount becomes committed once through the canonical commitment reads (ADR-0093 §2; 0723). Do not invent an invoice or settlement. |
| Submitted invoice, one mapped project | A: existing bulk-link path creates wrapper and derives invoice/payment evidence. Preserve unpaid/part-paid/paid source truth. |
| Order and invoice(s) belonging together | A: group the known supplier/project/currency document family into the same wrapper; existing family locks/checks remain authoritative. Do not count order plus invoice as two costs. |
| Invoice lines on multiple mapped projects | B2: one project purchase per project slice, preserving source line identity and exact project shares; no whole invoice attached repeatedly. Unmapped/ambiguous shares are named remainder. |
| Invoice with genuinely no project | A lists “Needs a decision”; B1 bulk-assigns PMO-side project or sets aside as overhead. No guessed project. |
| Journal costs already tagged to a project | A names the remainder; B3 creates one wrapper per eligible journal/project/vendor group with existing stable journal-line links. |
| Supplier payment with no invoice | A names the remainder; B4 captures paid-stage evidence, marks advance/payment-only where appropriate, and adds no cost absent an eligible expense GL line. Never infer expense from cash or payable movement. |
| Receipt-only | Listed from A, captured by the family path when supported; otherwise explicit receipt-only remainder until C's normalized line evidence is available. Received stage, no guessed ledger expense. |
| Draft/unsubmitted source | Listed from A with `unposted_source`; C captures read-only draft-stage history when adapter supplies its lines. Zero posted-cost component; no authorization implied. |
| Cancelled source | Listed from A; C retains/captures historical cancelled evidence with zero active recognized cost. A previously captured source follows cancellation immediately; it never re-enters approval. |
| Return, credit note, negative adjustment | Listed from A as `adjustment_requires_source_link`; C captures a signed correction tied to its original source, not a new positive purchase. Its signed GL component reconciles; no rebooking. |
| Already PMO-recorded or already linked | Match and skip creation; include its existing purchase in completeness, retain existing workflow. Never convert an ordinary PMO purchase silently. |
| Payroll, PMO-posted claims/imprest, revenue, balance-sheet-only movements | Not invented as supplier purchases; name cost-bearing remainder with `non_procurement_source` / `already_pmo_source` and its owning record. No employee data exposed to a wider audience (ADR-0078/0081). |

**FR-ROP-062** After each preview/apply, the system shall report per project and ledger currency: ERP ledger cost, recognized ledger cost represented by existing/captured purchases, and named signed remainder, satisfying **ledger cost = represented ledger cost + remainder** at one read generation. “Sum of captured purchases” here means their **recognized GL cost components**, not face values of orders, invoices and payments added together. Show purchase face values separately. Include every remainder source key, kind/state, amount and reason; explicit PMO-only assignments are a separate bridge from the ERP-project total to PMO actuals. Account/category scope, snapshot time, undiscovered-page/read failures and unmapped lines must be stated; an incomplete census shall never report “complete.” Orders/advances with no cost are included in document coverage with zero GL component. A run that only wraps tagged sources leaves actuals unchanged; capturing a previously unlinked open order adds its open commitment once, while rerunning already linked sources changes neither actuals nor commitment; explicit assignment intentionally changes PMO project placement once.

**FR-ROP-063** The CLI shall support `purchases capture --all --dry-run`, `purchases capture --project PROJECT --dry-run`, the corresponding `--apply` forms after preview, `purchases capture-report --all` or `--project PROJECT`, and `purchases assign assignments.json --dry-run` then apply for bulk unresolved-invoice choices. Each assignment row chooses exactly `project` or `set_aside`. Existing `purchases set-aside` remains reusable. Dry run prints clear proposals, existing matches, unclear rows and completeness; apply revalidates source revisions, refuses stale proposals and resumes by stable source identity. `capture --all` means the authenticated organization only. A reports B/C kinds as named remainder until each capability ships; it shall not accept a bulk assign it cannot yet enforce.

**FR-ROP-064** In slice 2 the existing setup pass shall offer “Capture existing project purchases”: propose all clear rows, accept all, ask only unclear rows, reuse master matches already accepted, and return to incomplete work without losing accepted decisions. The same action shall be available on demand. S-A (new PMO / populated ERP) and S-D (operational PMO / populated ERP) capture history; S-B (no ERP) has no ERP action until later connection; S-C (empty ERP) reports no incoming sources and sends nothing through capture. Existing S-C master sends and pre-connect native purchasing remain governed by ECA, not reimplemented here.

### What reuse already delivers, and what it does not

The checked `0380` link RPC accepts up to 500 rows, creates wrappers when `procurement_id` is absent, groups by project/group, validates suppliers and document families, supports dry run and reruns, and derives stage. `scripts/lib/pmo-purchases.mjs:159` (`runLink`) validates and batches that path. Therefore A adds a **proposer and census**, not a second ordinary linker. The existing path requires callers to enumerate rows; it does not itself census an organization or prove completeness. `0380:104–106` rejects a multi-project invoice; `:165–168` rejects an unprojected invoice against a project. These are existing integrity rules, not defects: B adds explicit slice/assignment contracts instead of deleting the checks.

In the scoped shipped path (`0380` link body; `0386` linked document total; `erpPurchases.ts`; `scripts/lib/pmo-purchases.mjs`), create/link updates wrappers and source links, and does not copy ERP item lines into `procurement_items`. `purchaseMirrorFeed.ts:47–67` holds header facts plus order/project references, not full descriptions/items; `:87–88` accepts submitted/cancelled source states, not drafts. C therefore supplies normalized read-only source-line evidence. This finding is limited to the enumerated path, not a claim about every adapter or every PMO document writer.

## 1. Record-only means no approval, no push, no duplicate spending

**FR-ROP-001** When an active Admin records eligible sources, the system shall atomically create an purchase wrapper marked captured from the ERP, its vendor/reference metadata and its existing-source links, without creating a PMO transactional purchase order, invoice, receipt or payment; read-only captured source/item evidence is allowed. “Record-only” describes historical evidence, not new spending authorization (ADR-0093).

**FR-ROP-002** When capture records ERP history, the server shall create no outbox row or posting intent and shall never resend any step at or before the captured ERP stage. In the **interim A unlock**, one shared guard shall refuse every forward workflow/ERP step on captured purchases; titles, descriptions, notes and files remain editable. In **D**, that same per-step guard shall permit only genuinely later steps on an unpaid captured purchase, under ordinary process gates, authorization and SoD, resolving parents through the existing ERP document links. Fully paid and journal-settled purchases remain history only. “Captured” is provenance, not a permanent prohibition on continuing an unpaid purchase. No replay, conversion or history edit may resend an existing ERP document (ADR-0019, ADR-0093; latest owner continuation ruling).

**FR-ROP-007** When a later step is requested after D, the shared guard shall compare the requested step and source identity with the already linked/recorded evidence, refuse an existing step as `step_already_recorded`, refuse paid/journal-settled history as `history_complete`, and otherwise evaluate the ordinary gates and SoD before outbox insertion. A new payment for an unpaid captured invoice shall reference that existing ERP invoice, without creating a second invoice or order. The separate correction for existing `origin=erp_link` purchases shall call this same guard; there shall not be two implementations of step ownership.

**FR-ROP-003** When journal lines are recorded, the wrapper shall show “Already settled in ERP” as historical evidence, without inventing a Payment Entry or implying a new payment. Journal amounts already count through the ledger; neither wrapper value nor links shall be added to actuals. The wrapper shall create zero open commitment, including after ERP cancellation/repost. Its history remains inspectable with source cancellation/reversal warnings (#1919 FR-JEC-022/042).

**FR-ROP-004** When an ERP invoice is recorded, the wrapper shall retain the ERP invoice's actual settlement evidence; an unpaid invoice shall not be labelled paid. A tagged invoice adds no actuals. Historical order/receipt/payment wrappers carry their own source stage, not a forced request stage. Open orders contribute `greatest(0, value − ledger-held)` once via `procurement_open_commitments` (0723) and `project_committed_spend` (0651); capture shall reuse those readers and 0386 document-value selection instead of calculating its own commitment. A genuinely untagged invoice assigned in PMO contributes its eligible mirrored expense lines once, in ledger currency; the wrapper amount never contributes a second time. A fully ledger-held invoice/journal contributes no open commitment; record-only is a no-push designation, not a blanket commitment exemption; outstanding ERP liability remains visible through existing invoice/aging reads (ADR-0093; 0651).

### Deciding actuals paths and deduplication

`project_mapped_actuals(uuid,text)` and `project_mapped_actuals_all(text)` (head bodies 0497) combine tagged `erp_actuals_snapshot`, rule-attributed GL and equipment charges. `project_finance_actuals` (0560), `get_project_finances` (0791), budget reads and executive/finance dashboards consume those shared reads; the two entry points must remain equivalent. `cost_attribution_allocations` (head evolution 0376/0471) is the rule/equipment allocation seam; 0720/0794 wrap its aggregates with fast paths. `procurement_ledger_held` / `_many` (0687) feed `procurement_open_commitment` and `project_committed_spend` (0651); they are commitment reads, not actuals.

**FR-ROP-005** The system shall apply one source precedence per ledger line: ERP project tag first, explicit PMO invoice assignment second, existing rule/equipment attribution third, otherwise unassigned. A non-empty but unmapped ERP project is **not** an unassigned invoice. Assigned invoice lines shall be excluded at the shared allocation input, including attribution preview, to prevent two projects claiming the same cost. Actuals remain ledger-derived, grouped by account/category/fiscal year and using debit minus credit; never use invoice grand total or purchase total as an actuals fallback (0376; ADR-0048).

**FR-ROP-006** When an assignment is applied or undone, the shared per-project and all-project actuals shall expose it in the same committed transaction, with unknown/unmapped values remaining unknown. When subsequent ERP sync tags, cancels, reposts or changes that invoice, the next coherent actuals generation shall use the source once; a tag moving to another project supersedes the PMO assignment and the purchase shall flag the discrepancy for Admin correction. A snapshot/GL refresh in progress shall expose a refreshing/unknown result rather than a plausible incomplete or duplicate amount. No silent currency conversion or fabricated zero is permitted.

## 2. PMO-side project assignment is visible and changes PMO project reports

**FR-ROP-010** When an Admin chooses a project for an ERP supplier invoice whose ERP project is genuinely empty, the system shall store that assignment in PMO only, linked to the mirrored document and purchase, and leave the ERP document, mirror project fields and ERP GL rows unchanged. **PMO's project cost report will then differ from the ERP's own project report for that invoice** (#2195 owner comment; #1008 is revenue prior art, not procurement implementation authority).

**FR-ROP-011** While that assignment is active, the purchase and its invoice cost line shall each display “Project assigned in PMO” and explain “The ERP invoice has no project; this assignment changes PMO project reporting only.” Cost-line detail shall show the linked purchase, account, date, ledger amount and assignment origin. API/CLI reads shall carry the same explicit origin from S1; S2 renders it. Assigned rows must be findable on the selected project's Procurement list even though the mirror's original `project_ids` stays empty.

**FR-ROP-012** The system shall accept tagged invoices only on their mapped project and shall route multi-project invoices only through B2 project slices. Ambiguous or unresolved ERP-project shares remain named remainder; ordinary whole-document links retain 0372 refusals. Invoice adoption is whole-document, not a percentage split; only eligible expense-account GL lines enter actuals. Missing ledger evidence or account mappings shall cause an explicit refusal rather than guessing an amount.

## 3. Admin authority and source validation

**FR-ROP-020** When create, preview or undo is requested, a security-definer RPC shall require an active **Admin** in the caller's own organization, derive organization and actor from authentication, and validate all source/project/vendor links server-side. Finance, Executive, Project Manager, Engineer, inactive members and anonymous callers shall be refused. Existing ordinary attach/link roles are unchanged. The new screen's `can()` check is UX only (ADR-0016/0019).

**FR-ROP-021** When multiple journal lines form a purchase, the system shall require one mapped project and one unambiguous vendor, preserve all line keys, and sum current positive line amounts in the organization's ledger currency. The Admin supplies the supporting order/reference and title; the amount is server-computed, never editable. Where the GL party does not identify a supplier, the Admin shall explicitly select a same-org vendor and confirm that choice; a conflicting known supplier or multiple parties shall be refused. Free-text remarks shall not be used as automatic vendor identity.

**FR-ROP-022** When any source in one purchase group is invalid, the system shall refuse the entire group without partial wrappers or links, using stable reasons for already-attached sources, different vendors/projects/currencies, cross-org or missing references, cancelled/draft/return documents submitted as live ordinary captures, non-positive journal purchase requests, PMO-posted journals, missing ledger basis and unsupported source kinds. Existing whole-document uniqueness and sorted source/family locks shall serialize competing operations; B2 adds unique project/source-line ownership instead of duplicating a whole-document link (0372, 0687).

**FR-ROP-023** When an applied request is retried with the same request identity and payload, the system shall return the existing purchase without a second cost or audit-create event; changed payload with that identity shall be refused. Preview shall validate through the same server path but write no durable data, audit, numbering increment, link, assignment, outbox or intent. Groups are independently atomic within a maximum of 500 source rows; output identifies every refused group and source.

**FR-ROP-024** Where existing document links support a foreign document currency, invoice wrappers shall retain that currency and existing net-total semantics; actuals shall use mirrored company-currency GL values, never convert using a newly invented rate. Journal wrappers shall use ledger currency only, as 0687 requires. Refuse a currency/basis the mirror cannot prove. Odoo journal eligibility follows 0765; do not re-list an Odoo invoice as a journal.

## 4. Undo preserves ERP cost and history

**FR-ROP-030** When an Admin confirms undo with a reason, the server shall atomically unlink all sources from that record-only purchase, deactivate its PMO-side invoice assignment, and cancel the historical wrapper using the existing procurement terminal convention rather than hard-delete it (ADR-0019). The captured provenance shall remain in history. Undo shall refuse `has_later_pmo_steps` once PMO has authored a subsequent transactional step; reverse that step through its ordinary controlled flow first, then retry undo. Source documents and journal rows return to their previous unlinked list; a previously set-aside mark shall be restored. Repeated undo shall be an explicit no-op.

**FR-ROP-031** When undo completes, journals and tagged invoices shall retain their existing project actuals; an untagged invoice shall return to the cost placement the ERP and any pre-existing attribution rule give it. Its PMO-only assignment disappears, so the chosen PMO project's cost may fall. Undo is **not** an ERP cancellation, refund or movement of cost. Undo cancels the wrapper and removes its former open commitment if any; journal cost and ERP books remain unchanged. Ordinary unlink/detach must not leave half an active record-only purchase; direct those calls to this complete undo or refuse with `record_only_use_undo`.

**FR-ROP-032** The system shall append audit events recording create/undo actor, time, source keys, purchase, project, vendor selection, assignment origin, before/after placement and reason. Undo shall retain its original create event, document references and readable history. Audit contents follow existing money-audience restrictions; no posting intent is an audit substitute.

## 5. CLI preview for both cases

**FR-ROP-040** The CLI shall offer the following bounded commands through the existing authenticated `pmo purchases` surface (runbook §6), without generic table writes or a new credential path:

```text
node scripts/pmo.mjs purchases record-only history.json --dry-run
node scripts/pmo.mjs purchases record-only history.json
node scripts/pmo.mjs purchases undo-record-only PURCHASE --reason "Incorrect link" --dry-run
node scripts/pmo.mjs purchases undo-record-only PURCHASE --reason "Incorrect link"
```

The undo command reverses links and cancels a wrapper; it deletes no business record, preserving the runbook's no-delete rule. `history.json` is an array of purchase groups. Each group has `request_id` (UUID), `project_id`, `vendor_id`, `reference`, `title` and exactly one source kind: `journal_lines` or `erp_documents`, each naming opaque normalized source ids returned by capture. Legacy doctype/voucher/project/account keys are translated inside adapters, never required by the new CLI contract. Do not mix journal and invoice sources in one wrapper. The API uses the same representation and RPCs for screen and CLI.

**FR-ROP-041** Each preview/apply result shall include request identity, source keys, `create|skip|refused`, stable reason, proposed project/vendor/reference, wrapper currency/amount, actuals before/after delta by affected project, `assignment_origin` (`erp_project|pmo_assignment`), and `erp_write:false`. Preview newly-created purchase ids shall be null, with `would_create:true`; apply returns the real id. Preview of a journal group shall show zero actuals delta; an unassigned invoice shall show the new placement and any superseded attribution, not claim “spending unchanged.” Refusals shall exit 2 with per-group reasons; transport/unknown outcomes shall preserve request identities for safe retry, not mint a fresh request.

## 6. Exclusions and overhead

**FR-ROP-050** While an invoice remains overhead, the system shall keep it unassigned and off project Procurement lists. Admin may leave it unlinked or use the existing set-aside action (0364; Admin/Finance ordinary marking unchanged); neither action shall create a project assignment. A set-aside source requires explicit confirmation before record-only creation; preview shall report the cleared mark and undo shall restore it. Existing independent attribution rules continue to operate until intentionally changed; the workflow shall warn if a purported overhead invoice is already allocated by such a rule.

**NFR-ROP-001** Capture itself writes nothing to the ERP: no historical invoice/project edits, reposting, payment, approval, backfill or migration of accounting amounts. D may send only a genuinely new later step through the ordinary money path; it never rewrites captured history. No ordinary purchasing workflow redesign, native-history import (#1855), arbitrary percentage splitting beyond source project shares, general rule editor, revenue changes, HR expense/imprest adoption, new FX mechanism or Odoo ledger cutover is included.

**NFR-ROP-002** Reads shall retain existing audience/tenancy and paging, use indexed source keys and set-based all-project aggregates, preserve equipment attribution and zero-configuration fast paths, and invalidate project procurement, actuals, dashboards and orphan/journal queries after apply/undo. Slice 2 shall use existing form/confirm primitives, DESIGN.md tokens and screen rules with loading, empty, error, conflict and keyboard states.

## Acceptance criteria and canonical owning layer

Every title below is the exact owning-test prefix; ids are namespaced to avoid collisions with other specs. Other layers may reference the id but do not take ownership (ADR-0010).

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-ROP-001 | Given eligible same-vendor journal lines on one project and no purchase, when Admin records one group, then one wrapper holds every line, its amount is their sum, journal reads name the purchase and actuals are unchanged. | pgTAP |
| AC-ROP-002 | Given a tagged supplier invoice, when Admin records it, then its existing project actuals are unchanged and no PMO transaction copy exists. | pgTAP |
| AC-ROP-003 | Given an untagged invoice and an overlapping attribution rule, when Admin assigns it in PMO, then its eligible ledger cost appears on the chosen project once and disappears from the superseded rule placement; single/all-project reads agree. | pgTAP |
| AC-ROP-004 | Given a captured purchase during interim A, when forward transition/child-write/ERP-command paths are attempted, then one shared guard refuses them before outbox/intent creation, descriptive edits remain allowed, and canonical commitment reflects its source once (open orders stay committed until ledger-held). | pgTAP |
| AC-ROP-005 | Given each real role and inactive/anonymous callers, when create/preview/undo is called, then only active Admin succeeds, and existing ordinary-link SoD refusals still hold. | pgTAP |
| AC-ROP-006 | Given another organization's source, vendor or project, when Admin submits it, then it is refused as not found without cross-org output or writes. | pgTAP |
| AC-ROP-007 | Given duplicates, mismatched vendors/projects/currencies, cancelled/draft/return/PMO-posted sources or missing basis/mapping, when a group is previewed/applied, then the whole group is refused with its stable reason and no partial wrapper. | pgTAP |
| AC-ROP-008 | Given valid groups of either source kind, when preview then apply then identical retry occurs, then preview changes no durable state, apply creates once and retry returns that purchase; changed request payload is refused. | pgTAP |
| AC-ROP-009 | Given an active wrapper of either kind, when Admin undoes it twice, then sources unlink, assignment and prior mark revert, wrapper is cancelled once, ledger cost stays in its original ERP/rule placement and audit history survives. | pgTAP |
| AC-ROP-010 | Given a foreign-currency invoice or ledger-currency journal, when it is recorded, then wrapper currency follows existing linking and actuals use company-currency GL once; unsupported conversion is refused. | pgTAP |
| AC-ROP-011 | Given a linked source, when ERP cancel/repost/project-tag changes synchronize, then a coherent read counts the current cost once, cancellation/reversal/conflict is visible in read metadata, and commitment follows the canonical remaining-open amount with no ERP push. | pgTAP |
| AC-ROP-012 | Given journal and invoice input files, when CLI preview/apply/undo runs, then exact RPC arguments, identities, delta/origin output, refusal exit 2 and transport retry guidance match FR-ROP-040/041. | unit (node:test) |
| AC-ROP-013 | Given Admin on the project journal list, when selecting lines and recording the supporting order, then the purchase appears on Procurement, its links open correctly and displayed project spending is unchanged. | e2e (S2) |
| AC-ROP-014 | Given Admin on the unassigned-invoice list, when choosing a project and confirming the PMO-only warning, then its purchase and cost line display the PMO assignment marker and undo restores the unassigned state. | e2e (S2) |
| AC-ROP-015 | Given overhead or set-aside invoices, when left alone or explicitly recorded and undone, then no implicit project assignment occurs, confirmation is required for a marked source and its original mark returns on undo. | pgTAP |
| AC-ROP-016 | Given loading/error/empty/conflict states and real non-Admin roles, when S2 forms/lists render and are used by keyboard, then role affordances, clear reasons, focus restoration and source-origin markers follow the contract without a fabricated zero. | unit (RTL) |
| AC-ROP-017 | Given ERP orders/single-project invoices and existing PMO matches across more than one page, when Admin previews then accepts capture for an organization or project and repeats it after later direct ERP costs arrive, then all clear supported sources become record-only purchases once, strong matches are reused, conflicts are listed actuals do not change, an unlinked open order adds its canonical open commitment once, and a rerun changes neither figure. | pgTAP |
| AC-ROP-018 | Given all source kinds/states including unmapped and unsupported rows, when capture-report runs, then every project satisfies the signed ledger reconciliation, every remainder is named, document-only sources are covered separately and incomplete reads never claim completeness. | unit (Deno shared contract suite) |
| AC-ROP-019 | Given one invoice with lines on two projects, when B2 capture applies, then each project gets its own purchase and exact source-line shares, each GL component belongs once and ordinary whole-document links cannot overlap them. | pgTAP |
| AC-ROP-020 | Given a supplier payment without invoice, when B4 capture applies, then paid/advance evidence appears without inventing an expense, and any genuine expense GL component reconciles once. | pgTAP |
| AC-ROP-021 | Given the shared neutral capture contract, when ERPNext and Odoo capability tests run, then ERPNext covers A kinds and Odoo either satisfies the same cases or returns a tested unsupported result naming missing sources; server/CLI inputs contain no ERP-specific document types. | unit (Deno shared contract suite) |
| AC-ROP-022 | Given the existing setup pass for each connect scenario, when Admin opens capture, then S-A/S-D offer bulk acceptance with only unclear rows needing decisions, S-B has no ERP action and S-C reports empty without sending anything. | e2e (slice 2) |
| AC-ROP-023 | Given source items/descriptions and draft/cancelled/adjustment evidence, when C capture runs, then supplier, reference, date, items/description, original currency/amount and truthful stage are available from each resulting purchase, with signed corrections and no ERP write. | unit (Deno shared contract suite) |

| AC-ROP-024 | Given an unpaid captured invoice, already linked earlier steps and a fully paid/journal-settled purchase, when D requests a later payment or replays an earlier step, then only the genuinely later authorized payment passes ordinary gates/SoD and targets the existing invoice, earlier steps never resend, settled history is refused, and ordinary erp_link continuation uses the same guard. | pgTAP |

### Four connect cases: AC mapping (OD-ERP-ANYTIME-1)

- **S-A / S-D:** AC-ROP-001–021 and 023–024 apply to populated ERP history and later direct ERP activity; S-D additionally exercises pre-existing PMO matches in 017. No epoch filter may silently discard historical source rows.
- **S-B:** AC-ROP-004–008, 012, 016–018 and 021–022 cover refused/no-action capture without an ERP; after connection it follows S-A or S-D and all source ACs apply.
- **S-C:** AC-ROP-004–008, 012, 016–018 and 021–022 cover an empty read-only incoming census, zero created purchases, unchanged native history and no outgoing capture command; once ERP sources exist the S-D source ACs apply.
- **S-A / S-B / S-C / S-D setup UI:** AC-ROP-022 is the canonical four-case screen journey; the earlier source e2e ACs 013/014 run under S-A and S-D data shapes.

### Release acceptance by increment

A: 002, 004–008, 010–012 (order/single-project scope), 017–018, 021; all unsupported B/C sources named, never dropped. D (immediately after unlock): 024, preserving 004 for settled/interim records; B1: 003, 009, 015 plus invoice portions of 004–012; B2: 019; B3: 001 plus journal portions of 004–012; B4: 020. C: 023. Slice 2: 013–014, 016, 022. Each increment must preserve all previously shipped ACs; “all captured” is reserved for a report with no unexplained remainder and complete document coverage.
