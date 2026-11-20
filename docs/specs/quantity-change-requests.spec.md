# Spec: Quantity change requests with versioned contract quantities and internal approval (#2578)

**Status:** proposed; owner decisions below need sign-off before build. Map #2516 (contractor field operations), after the go-live window. IDs `FR-QCR-###`, `NFR-QCR-###`, `AC-QCR-###`. Plan: `docs/plans/2026-11-20-quantity-change-requests.md`. **Money / SoD tier:** a contract quantity multiplied by its rate is billable value. Director-dispatched Orca workers, ships alone (never batched). Builds on `boq_items` (0250, 0337), `work_order_lines` and `work_order_acceptances` (0337), `progress_assessment_quantities` and `progress_claim_lines` (0250), and reads validated daily quantities from `dsr_progress_lines`/`daily_site_reports` (1040/1041, #1522 — already shipped).

> **Review 20 Nov** — checked against the shipped schema (`boq_items`/`progress_assessment_quantities`/`progress_claim_lines` 0250, `work_order_lines`/`work_order_acceptances`/`closing_value` 0337, `daily_site_reports`/`dsr_progress_lines` 1040/1041, `set_work_order_value` and the post-Issue freeze 0193, `record_history_config`/`record_history_visible` 0260, `audit_org_down_payment_item` 0250, the procurement file tables 0036). Changed: the reuse check called `WorkOrderCostVariations` an entity — it is the read function `work_order_cost_variations(uuid)`; the daily-report source is **already shipped** and is now named (`dsr_progress_lines` → `work_order_lines`, only `status = 'validated'`, not superseded or archived), not "once that ships"; the definition of reported progress now pins each source to the shipped query (the item's own latest assessment entry, not the project's; non-withdrawn claims whose invoice is not Cancelled; the latest Confirmed acceptance per work order); a `lump_sum` contract line can never change quantity (`boq_items_lump_sum_quantity` fixes it at 1) and is now refused explicitly; SoD needed an **editor set**, not a last-editor column, or an earlier editor could approve; the limit rule cannot be implemented without recording what a withdrawn request was withdrawn from; the over-contract notice needs a persisted per-item/kind row, or "once" is not implementable or testable; there is no shared attachment mechanism to register with — the plan now names a typed file table in the 0036 shape; and the largest correction: **raising a work order's allocation does not raise its billing ceiling** (`order_value` is frozen the moment the work order leaves Draft, 0193/DD-WO-5, and `assert_work_order_invoiceable` fences on it), so the accepted extra is billable only on a still-Draft work order or after a cancel-and-re-issue — new OD-QCR-10. Also: dates are organisation-local (projects carry no timezone); plan file paths corrected. Open owner decisions: OD-QCR-10 (billing ceiling), OD-QCR-2 (approver roles), OD-QCR-3 (no sole-operator exception), OQ-QCR-1..3.

## Job story

When reported progress or my forecast for a contract item passes its contract quantity, I want to raise a change request that a second person approves internally before it goes to the client, with every quantity version kept and a cap on how many requests one work order may raise, so that the client is only asked for a quantity change we have checked, and nobody can quietly move a billable quantity.

## Context and boundary

- The **contract quantity** is `boq_items.quantity` (3 decimals, positive; a `lump_sum` line is fixed at 1 by `boq_items_lump_sum_quantity`), one per contract item per project. A work order **allocates** part of it (`work_order_lines.quantity`, 0337). Billing, assessment and acceptance read the contract quantity today. `boq_items.work_order_id` was a legacy single-work-order link and was dropped in 0337; allocation is only through `work_order_lines`.
- **Reuse check (prior-art sweep, 2026-11-20):** no change-request or contract-quantity-version entity exists. The similarly named vendor-side records are **PO variations** (`po_variations`, 0474) and the `work_order_cost_variations(uuid)` read function over them — those change what we pay a supplier and are unrelated. This feature is revenue-side and new. It adds nothing to PO variations.
- **Submission to the client is a recorded status.** The system records that the request was sent, a client reference and date, an attachment, and the client's decision. It does not transmit anything to the client's own system (out of scope per map #2516).
- **Versions are the contract's history.** `boq_items.quantity` stays the single current figure every existing reader uses; it becomes a cache of the latest version, written only by the server (FR-QCR-015, FR-QCR-019). No existing reader changes.
- **The work order's billing ceiling is separate from its allocation.** An invoice is refused past `order_value` net of tax (`assert_work_order_invoiceable`, 0262), and `order_value` is frozen the moment the work order leaves Draft (0193 §4, DD-WO-5; `set_work_order_value` refuses a non-Draft row). Raising an allocation therefore does not make the extra billable on an issued work order (OD-QCR-10).
- This feature never changes a rate, a posted invoice, a confirmed acceptance or a paid claim. It changes only the quantity that future progress, claims and acceptances are measured against.

## Definitions (used by the acceptance criteria)

For one contract item:
- **Current contract quantity (C):** quantity of its latest version.
- **Reported progress quantity (P):** the greatest of
  (a) its **own** latest assessed quantity to date — the `quantity_to_date` on the most recent `progress_assessment_quantities` row of that item (join `project_progress_entries` and order by month then id; do **not** use the project's latest entry, which hides an item the newest month omitted);
  (b) its latest confirmed cumulative acceptance quantity summed across work orders — the `work_order_acceptance_lines.quantity` of the most recent `Confirmed` acceptance of each work order that allocates it, summed (mirrors `get_project_billing`'s `latest_bast`);
  (c) the sum of its `progress_claim_lines.quantity` on claims that are not withdrawn (`withdrawn_at is null`) and whose invoice, if one exists, is not `Cancelled`;
  (d) the sum of validated daily-report quantities for the allocations of that item: `dsr_progress_lines.quantity` joined through `work_order_lines`, where the report's `status = 'validated'` and it is neither superseded (`superseded_at is null`) nor archived (`archived_at is null`) — the same filter as `work_order_validated_revenue` (1041).
  The greatest is used so that no single source can hide an overrun; the screen names the source that set it.
- **Forecast quantity at completion (E):** a quantity a Project Manager records as the expected final total for the item (OD-QCR-1). Append-only; the latest wins. Distinct from the cost-side estimate at completion in the budget module.
- **Over-contract:** P > C **or** E > C (strictly greater; equal is not over). A `lump_sum` line cannot be over-contract in quantity (its quantity is fixed at 1 and assessments are capped at 1 by 0534), and cannot carry a request (FR-QCR-005).
- **Trigger snapshot:** the kind (`progress` or `forecast`), the figure and C at the moment the request is raised, stored on the request line.
- **Requested quantity (R):** the new total contract quantity asked for. Must satisfy R > C and R >= the trigger figure.
- **Quantity version:** one immutable row of (contract item, version number, quantity, source, request, actor, time). Source is `baseline`, `setup_edit` or `change_request`.
- **Request limit (L):** an organisation-set whole number of requests per work order; empty means no limit.
- **Attachment:** one row in the request's own typed file table (the 0036 procurement file-table shape) and one private storage object; the system has no shared attachment table to reuse.

## State machine

`draft` → `pending_approval` → `approved` → `sent_to_client` → `client_accepted` | `client_declined`.
`pending_approval` → `returned` (reason required) → `draft`. `draft` | `returned` | `approved` → `withdrawn` (reason required; not after `sent_to_client`). `client_accepted`, `client_declined` and `withdrawn` are terminal. Only `client_accepted` creates quantity versions.

## Requirements (EARS)

**Flagging and forecasts**
- FR-QCR-001 The system shall compute over-contract per contract item from the Definitions and show a flag on the contract lines, on the work order and in a per-project list, naming the trigger figure, C and the source that set P.
- FR-QCR-002 When a user with forecast permission records a forecast quantity for a contract item, the system shall keep it as an append-only row with actor, time and note and shall use the latest one as E.
- FR-QCR-003 When the trigger evaluation first finds an item over-contract for a kind (`progress` or `forecast`), the system shall notify the project's Project Manager once, and not again until the item has returned to not-over and passed C again. "Once" shall be a persisted row keyed by (contract item, trigger kind) holding the figure, C and the time notified, cleared when the item returns to not-over; the evaluation shall run on the writes that can raise P or E (a forecast insert, an assessment quantity write, a claim line insert, an acceptance confirmation) so a read never has side effects. Delivery uses the existing `notify_workflow_user` (0237).

**Raising**
- FR-QCR-004 When a user with raise permission opens a request from a work order, the system shall accept one or more lines of (contract item allocated to that work order, requested quantity R, reason) and shall store the trigger snapshot per line.
- FR-QCR-005 The system shall refuse a line whose item is not over-contract at the time of raising, whose R <= C or R < the trigger figure, or whose quantity is not finite, positive and at most 3 decimals. It shall also refuse a line whose item is `lump_sum`: its quantity is fixed at 1 by `boq_items_lump_sum_quantity` and cannot be raised, so a value change on a lump-sum line is a different feature. A later fall in P or E does not invalidate a request already raised.
- FR-QCR-006 The system shall refuse raising a request when the work order's request count has reached the organisation limit L, with a message naming the count and L. The check shall run in the same transaction as the insert under a lock on the work order (`for update`) so two simultaneous requests cannot both pass.
- FR-QCR-007 Requests that count toward L are all requests on the work order except those withdrawn **while still draft** (OD-QCR-4). The row shall therefore record what it was withdrawn from (a `withdrawn_from` status, stamped by the withdraw function), because the terminal `withdrawn` status alone cannot answer the count. Lowering L never alters existing requests; it blocks new ones.
- FR-QCR-008 Raising shall be idempotent on a client-generated `client_request_id` (the retry returns the same request id and does not count twice); it shall return the request's id.
- FR-QCR-009 Raising shall be refused on a work order that is `Closed` or `Cancelled`, and on a contract item with a request already open (`draft` to `sent_to_client`) so two requests never compete for one item. A `Draft` work order is allowed, because that is the one state in which its value can still rise (OD-QCR-10).

**Internal approval (server-enforced SoD)**
- FR-QCR-010 When the author or an editor with submit permission submits a draft for approval, the request shall move to `pending_approval` and its lines and quantities shall become read-only.
- FR-QCR-011 The system shall let only a user holding the approve permission approve (OD-QCR-2) and shall refuse approval by the request's author, by **any** user who edited it, and by whoever submitted it. "Any user who edited it" needs an editor **set** recorded on every edit (`editor_ids uuid[]` or a child table), not a last-editor column: replacing the last editor must not launder an earlier editor's SoD. There shall be no sole-user exception (OD-QCR-3). When no eligible approver exists the request stays `pending_approval` and the queue says so.
- FR-QCR-011a The approver cannot change a quantity; a different quantity means return with a reason, after which any editor becomes an editor for the purposes of FR-QCR-011.
- FR-QCR-012 When the approver returns a request, a reason is required; the author may edit and resubmit; every transition, actor, time and reason shall be kept in history.
- FR-QCR-013 The check of author, editors, role and state shall happen in a security-definer function, not in the client; `can()` only mirrors it for the UI (ADR-0016, ADR-0019).

**Client submission and decision (recorded status)**
- FR-QCR-014 When a user with the record-client permission marks an `approved` request as sent, the system shall store the date, a client reference and at least one attachment (the letter or form sent) and move it to `sent_to_client`. A request that is not `approved` cannot be marked sent. The attachment is a row in the request's own file table plus its private storage object (the 0036 pattern); nothing is filed in `project_documents`.
- FR-QCR-015 When the client's decision is recorded, the system shall require the decision date and, for acceptance, an attachment of the client's acceptance. On `client_accepted` the system shall, in one transaction, append one quantity version per line (source `change_request`), set the contract item's current quantity to R, and raise each line's work-order allocation by R minus the previous C (OD-QCR-6). If the work order is still `Draft`, the system shall also raise its `order_value` by the line's delta × rate through `set_work_order_value`, so the addition is billable; on an `Issued` work order it cannot (0193 freezes the value), and the request's screen shall say the extra is billable only after the work order is cancelled and re-issued (OD-QCR-10). On `client_declined` nothing changes except status.
- FR-QCR-016 A decision shall be refused if the contract item's current version is no longer the version the request was raised against (stale base): the request shall be returned for re-basing with the reason shown.

**Versions**
- FR-QCR-017 The system shall create a `baseline` version for every existing and every new contract item (version 1 = the quantity at creation or backfill) and keep every version permanently.
- FR-QCR-018 A version shall never be updated or deleted by any role, including Admin and the service role through the application (immutability trigger, 42501). A correction is a new version.
- FR-QCR-019 After a contract item has any progress, claim or confirmed acceptance, its quantity shall change only through an accepted request. Before that, a direct edit remains possible and shall append a `setup_edit` version automatically (OD-QCR-5). The guard honours the amend flag only when `current_user = 'postgres'` and the transaction flag is set by the accepting function (the 0337 closing-value pattern), so a client cannot pass it.
- FR-QCR-020 The system shall show each contract item's version history (number, quantity, source, request, actor, time) and the value change at the item's rate for each version, from stored rows.

**Limit setting**
- FR-QCR-021 The system shall hold the request limit as an organisation setting editable by Admin only, audited (before and after), and shall show it beside the work order's request count. The write path is a column grant (`update (quantity_change_limit)`) plus the Admin-only, active-member UPDATE policy shape of 0207/0231/0250, with an audit trigger in `audit_org_down_payment_item`'s shape.

**Access, lists, tenancy**
- FR-QCR-022 Actions (view, forecast, raise, edit own draft, submit, approve, return, withdraw, record sent, record decision, set limit) shall be registered in the role matrix (#902) and gated by `can()` on the real JWT role; RLS and the RPCs enforce.
- FR-QCR-023 Every new table carries `org_id` by default or trigger, RLS enabled and forced, and column grants limited so no client can write a status, an actor or a version directly; all writes go through the functions above.
- FR-QCR-024 Lists shall filter by project, work order, status and over-contract, newest first with a stable tie-breaker, bounded pagination (the 1000-row ceiling applies).

## Non-functional requirements

- NFR-QCR-001 Money exact decimals (`exactDecimal`) for value changes; quantities 3 decimals; rounding only for display; value = quantity x rate rounded to 2 decimals as in claim lines (0250).
- NFR-QCR-002 Over-contract computation for one project of 2,000 contract items runs as one indexed read, not one query per item.
- NFR-QCR-003 Phone-width usable, `DESIGN.md` tokens, English and Bahasa Indonesia complete; screens meet the `restructure` skill and `docs/ux/screen-rules.md`.
- NFR-QCR-004 Dates are organisation-local calendar dates (`organizations.default_timezone`), never browser time; projects carry no timezone of their own.
- NFR-QCR-005 The write functions are safe under concurrency: simultaneous raise, approve or decide on one request or work order produce one outcome (row locks, tested).

## Acceptance criteria and owning layer

Hand calculation (test fixture): contract item "Excavation", unit m3, rate 50,000, C = 1,000.000 (version 1). Latest assessed quantity 1,040.000; confirmed acceptance 980.000; claimed 900.000. **P = 1,040.000 (source: assessment). Over by 40.000.** Forecast E = 1,100.000. Request R = 1,100.000: value change (1,100 - 1,000) x 50,000 = **5,000,000.00**; version 2 = 1,100.000; allocation on a work order that held 600.000 becomes 700.000. Limit L = 2.

| ID | Given / When / Then | Layer |
|---|---|---|
| AC-QCR-001 | Given the fixture, when over-contract is computed, then P = 1,040.000 from the assessment source and the item is over by 40.000; with P = 1,000.000 exactly it is not over. | pgTAP (owner: server evaluates the over-contract trigger); also referenced: Unit (`quantityChangeRules`) |
| AC-QCR-002 | Given P <= C and E = 1,100.000, when evaluated, then the item is over-contract with trigger kind `forecast`. | pgTAP (owner: server evaluates the over-contract trigger); also referenced: Unit (`quantityChangeRules`) |
| AC-QCR-003 | Given an assessment that takes an item over-contract for the first time, when the evaluation runs, then one notification exists for the Project Manager; when it runs again unchanged, none is added; when the item returns to not-over and later crosses C again, a new one is added. | pgTAP |
| AC-QCR-004 | Given an over-contract item allocated to the work order, when a request line R = 1,100.000 is raised, then a `draft` request exists with the trigger snapshot (progress, 1,040.000, C = 1,000.000). | pgTAP |
| AC-QCR-005 | Given R = 1,000.000, R = 1,030.000 (below P), a not-over item, or an item not on the work order, when raised, then each is refused with its own reason. | pgTAP |
| AC-QCR-006 | Given L = 2 and two requests already on the work order, when a third is raised, then it is refused naming count 2 and L 2; with L empty it is accepted. | pgTAP |
| AC-QCR-007 | Given L = 1 and two sessions raising at the same time on one work order, when both run, then exactly one succeeds. | pgTAP (concurrency) |
| AC-QCR-008 | Given a draft withdrawn before submission, when the count is read, then it is not counted; a request withdrawn after submission is counted. | pgTAP |
| AC-QCR-009 | Given the same `client_request_id` sent twice, when raised, then one request exists and the count rises by one. | pgTAP |
| AC-QCR-010 | Given a Closed work order, or an item with an open request, when raised, then refused. | pgTAP |
| AC-QCR-011 | Given the author, the submitter, an editor, or a user who edited earlier and was then replaced as the last editor, when they approve, then refused with 42501; given a different user with the approve role, then it moves to `approved`. | pgTAP |
| AC-QCR-012 | Given a user without the approve role (or from another organisation), when they approve or read, then refused. | pgTAP |
| AC-QCR-013 | Given a sole eligible user who is also the author, when they approve, then refused and the request stays `pending_approval`. | pgTAP |
| AC-QCR-014 | Given `pending_approval`, when any role updates a line or quantity directly through the table API, then refused; when the approver returns with no reason, then refused; with a reason it moves to `returned` and the author can edit. | pgTAP |
| AC-QCR-015 | Given a request not `approved`, when marked sent, then refused; given `approved` without attachment or client reference, then refused; with both it is `sent_to_client`. | pgTAP |
| AC-QCR-016 | Given `sent_to_client`, when `client_accepted` is recorded with an acceptance attachment, then in one transaction version 2 = 1,100.000 exists, `boq_items.quantity` = 1,100.000, the allocation rose 600.000 to 700.000 and a history row names the actor. | pgTAP |
| AC-QCR-017 | Given `client_declined`, when recorded, then no version, quantity or allocation changed. | pgTAP |
| AC-QCR-018 | Given the contract item's current version moved on since the request was raised, when a decision is recorded, then refused as stale. | pgTAP |
| AC-QCR-019 | Given a version row, when any role (Admin, service role through the app) updates or deletes it, then refused 42501. | pgTAP |
| AC-QCR-020 | Given a contract item with a claim, when its quantity is edited directly, then refused; given a fresh item with no activity, when edited directly, then a `setup_edit` version is appended and numbers stay consecutive. | pgTAP |
| AC-QCR-021 | Given existing contract items, when the migration runs, then each has exactly one `baseline` version equal to its quantity; a new item gets one on insert. | pgTAP |
| AC-QCR-022 | Given the limit setting, when a non-Admin changes it, then refused; when Admin changes it, then an audit row holds before and after. | pgTAP |
| AC-QCR-023 | Given a version history of 1,000.000 then 1,100.000 at rate 50,000, when displayed, then the value change reads 5,000,000.00 and sums to the item's current value minus its baseline value. | Unit |
| AC-QCR-024 | Given a user in another organisation, when they read or write any new table or function, then refused (tenancy sweep on every new table). | pgTAP |
| AC-QCR-025 | Given a PM on a phone, when they see the over-contract flag, raise a request for the item, and a different Finance user approves it, then status shows approved with both actors. | E2E (one journey) |
| AC-QCR-026 | Given an approved request, when the PM records the send with an attachment and later the client's acceptance, then the contract line shows the new quantity and its version history lists both versions. | E2E (one journey) |
| AC-QCR-027 | Given the same user who raised the request opens it as approver, when they look for the approve action, then it is absent and the reason is shown. | Unit (component) |
| AC-QCR-028 | Given an item allocated to a work order, when a validated daily report records a quantity for that allocation that takes P above C, then the row is over-contract with source `daily report`; given the same report as `draft`, `submitted`, `returned`, superseded or archived, then it does not count. | pgTAP |
| AC-QCR-029 | Given a `lump_sum` contract item, when a request line names it, then it is refused with a message naming the lump-sum rule; given the same item, the forecast and assessment paths cannot make it over-contract. | pgTAP |
| AC-QCR-030 | Given a Draft work order whose value is 100,000 and a request accepted for a 10,000 value delta, then `order_value` becomes 110,000 through `set_work_order_value` and the extra is billable; given the same acceptance on an Issued work order, then `order_value` is unchanged, the allocation still rises, and the request screen says the extra needs a cancel-and-re-issue. | pgTAP |

## Errors

| Condition | Result |
|---|---|
| Limit reached | Refused with count and limit shown; no row created |
| R not above C, or below the trigger figure | Field error naming both figures |
| Item not over-contract / not on the work order | Refused with reason |
| Item is `lump_sum` | Refused: its quantity is fixed at one; a value change is not a quantity change |
| Open request already on the item | Refused, link to the open request |
| Approver is author, any editor, or the submitter | 42501 "separation of duties: the author cannot approve this request" |
| Approve role missing | 42501, action hidden in the UI |
| Return or withdraw without reason | Field error |
| Mark sent without client reference or attachment | Field error |
| Stale base at decision | Returned for re-basing, current quantity shown |
| Direct quantity edit after activity | 42501 "use a quantity change request" |
| Update or delete of a version | 42501 "quantity versions are append-only" |
| Client accepted on a work order already Issued | Succeeds, allocation rises, and the screen states the extra is billable only after a cancel-and-re-issue (OD-QCR-10) |

## Owner decisions (recommended defaults, not rulings)

| ID | Decision and default | If wrong, what breaks |
|---|---|---|
| OD-QCR-1 | Forecast quantity at completion is entered by a Project Manager per contract item (append-only), and "EAC passes the contract" means E > C. | Without it the EAC trigger never fires and overruns are seen only after the work is done; if entered carelessly the flag cries wolf and is ignored. |
| OD-QCR-2 | Approvers are Admin, Executive and Finance, never the author; authors are Project Manager, Admin, Executive, Finance. | Too wide lets a peer rubber-stamp; too narrow leaves a small team unable to approve. |
| OD-QCR-3 | No sole-user exception: a request nobody else can approve waits (differs from acceptance confirmation, 0337, which allows a sole operator via `confirm_basis = 'sole_operator'`). | A one-person organisation is blocked until a second user exists; a sole exception lets one person move a billable quantity alone. |
| OD-QCR-4 | The limit counts every request on the work order except drafts withdrawn before submission, so the withdraw function must stamp what it withdrew from. | Counting drafts punishes abandoned drafts; not counting resubmitted returns lets the limit be bypassed by cycling; without the stamp neither rule can be implemented. |
| OD-QCR-5 | Direct quantity edits stay possible only while an item has no progress, claim or confirmed acceptance, and append a `setup_edit` version. | Blocking all direct edits makes contract setup and import unusable; allowing them forever defeats the control. |
| OD-QCR-6 | On client acceptance, the work-order allocation rises by the same delta; on a Draft work order the value rises with it. | If not, a work order that has used all its allocation still cannot accept or bill the extra quantity; if it should be a separate step, quantity is approved but unusable. |
| OD-QCR-7 | The contract quantity changes only when the client accepts, not on internal approval. | If internal approval changed it, billing could run ahead of the client's agreement. |
| OD-QCR-8 | A request may only be raised while the item is over-contract (no proactive requests). | If proactive requests are wanted, the trigger rule must be relaxed and the limit will be spent earlier. |
| OD-QCR-9 | Default limit is empty (no limit) until the Admin sets one. | A non-empty default surprises existing work orders; empty lets churn go unchecked until set. |
| OD-QCR-10 | The billing ceiling is the work order's `order_value`, frozen once the work order leaves Draft (0193/DD-WO-5), and the invoice fence reads it (0262). So an accepted increase is billable without further work only while the work order is still Draft; on an Issued work order it is not billable until the work order is cancelled and re-issued with the new value. This spec records the fact and shows it; it does not add an amended-value path. | Opening a post-Issue value write would re-open the OQ-BUD-2 class (a changed value under an unchanged `issued_at` derives an identical ERP idempotency key and is silently discarded), so it needs its own ADR and ERP-push handling, not a line in this migration. Leaving the fact unsaid lets a PM promise the client a billable increase that cannot be invoiced. |
| OQ-QCR-1 | If a client accepts a different quantity than requested, record decline and raise a new request (default), or allow recording the accepted quantity? | Default spends one more count of the limit; the alternative needs a second SoD review of the changed number. |
| OQ-QCR-2 | Are decreases (R < C, a de-scope) in scope? Default no: this spec is increases only. | A decrease would need its own trigger and floor (P). |
| OQ-QCR-3 | Is the limit per work order only, or also per contract item? Default per work order only (as the ticket says). | A single item can absorb the whole limit. |

## Delivery checklist

- [ ] Owner signs OD-QCR-1..10 and answers OQ-QCR-1..3.
- [ ] Versions and the direct-edit guard ship before the request workflow; the request workflow (approval, decision, limit) ships alone.
- [ ] pgTAP for AC-QCR-011..022, 028..030 mutation-checked (plan, SoD step).
- [ ] Glossary: quantity change request, contract quantity, quantity version, forecast quantity at completion, over-contract, request limit.
