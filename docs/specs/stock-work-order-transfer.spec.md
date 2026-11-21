# Transfer between work orders in one document (WOT)

Issue #2691 (map #2516). Status: **Accepted, 2026-11-21** (Director rulings recorded in §9). Plan `docs/plans/2026-11-21-stock-work-order-transfer.md`.
IDs: `FR-WOT-###`, `AC-WOT-###`. **Money path: stock ledger and work-order cost.** The ledger stays written only by `stock_write_entry`
(FR-STK-072); nothing here writes it except through the existing return and issue engine. Ships alone. Stacked on #2690 (two-step
transfers, migrations 1305-1309) and #2683 (vendor location). Reads: `stock-site-work.spec.md` (work-order issue, return, balance),
`stock-two-step-transfer.spec.md`.

**Job story.** When leftover material moves from one work order to another, I want it recorded as one move, so both balances are right.

## 1. AS-IS
- An issue takes stock out of a location to a project and may name a work order (the document's `work_order_id`, #2517); a return cites
  posted issue lines (`source_line_id`), is capped per cited line (`STK_RETURN_EXCEEDS`, 0414), takes back the cost the issue left at,
  and names the work order (inherited from the issue when it names none, 1102).
- To move leftovers from work order A to work order B today a keeper posts a return (A) and then an issue (B): two documents, two
  numbers, two posts. A failure between them leaves A returned and B never issued, and nothing says the two belong together.
- `get_work_order_stock_balance` (1031) reports per work order received, moved out, issued and on-site quantity (and value for roles
  that see cost) from ledger rows only. `mrq_prior_quantity` (1100) counts what was already moved to a work order by posted transfers
  plus other people's open requests, so a new material request does not ask twice.
- A transfer posts only between locations; kind `return` and `issue` are refused at vendor locations (1300) and transit locations (1305).

## 2. Design decisions (the questions the ticket left open)
1. **One document, two ordinary documents inside it.** The new record `stock_wo_transfers` (number prefix `WOT`) is the one document the
   person sees, signs off and finds. It owns exactly two stock documents written in the same transaction: a **return** that cites
   work order A's posted issue lines, and an **issue** to work order B, both at one location. The two inner documents keep their own
   `RTN`/`ISS` numbers (document numbers are unique per organisation and are not reused), are marked "part of WOT-nnnn" and link back
   (`stock_documents.wo_transfer_id`). Because they are a real return and a real issue, **every existing rule, report and test of those
   documents keeps working untouched**: the posting engine, the return cap, the project-active rule, work-item (BoQ) checks, cost
   attribution, work-order cost totals. Nothing is re-implemented.
2. **One physical location, same project.** The leftover physically sits somewhere; the return lands there and the issue leaves from
   there, so the location's quantity is net zero. The location is a `site`, `yard` or `staging` location **of the work orders' project**.
   Moving goods between two locations is a different act, the existing transfer, done first. Vendor and transit locations are refused
   (kinds the engine already refuses for return and issue). Both work orders must belong to the **same project**: a move between projects
   changes two projects' cost and budget and is not a work-order scope move; it is refused (`STK_WOT_PROJECT`), not deferred.
3. **Two-step organisations.** The move is allowed in both transfer modes and is **not** a two-step transfer. Nothing leaves the
   location, so there is no handover, no in-transit stock, no recount, no proof (tag proof rules govern movements of kind transfer
   only). The one-step guard (`STK_TWO_STEP`) targets transfers and is not touched. Handover confirmations are not offered.
4. **The quantity rule.** For one item the quantity moved cannot exceed work order A's **net issued balance** of that item: its posted
   issues less the posted returns that cite them. The RPC spreads the quantity over A's issue lines oldest first (each return line
   cites one issue line) and refuses with `STK_WOT_EXCEEDS` (held, requested) when A does not hold enough. The engine's per-issue-line cap
   (`STK_RETURN_EXCEEDS`) stays as the second guard under the lock, so two concurrent moves cannot both succeed.
5. **Cost follows the engine, unchanged (FR-STK-017); accepted by the Director.** A's cost nets down by the cost its issue lines left at (the return takes that
   back, last return takes the remainder). B's issue takes the location's moving average at that moment (`stock_write_entry` derives an
   out value; nothing passes a value in). When the location's average equals A's issue cost B is charged exactly what A is relieved of;
   otherwise the difference stays in the location's stock value and in no work order. The ledger conserves quantity and value at every step.
6. **Balances.** "Moved to B" is stock received by B and "moved off A" is stock moved off A, not a consumption by B and an un-consumption by
   A on site. So `get_work_order_stock_balance` counts the issue half of a WOT as B **received** and the return half as A **moved out**
   (on-site quantity of both work orders unchanged and A's on-site value unchanged; B's received value is the value A gave up, so B's on-site
   value reads the average-cost drift of decision 5, zero when the averages match; issued quantity and cost move: A down, B up), and
   `mrq_prior_quantity` adds the signed quantity of WOT documents (B +q, A -q) so material requests see what was moved. Sums over
   work orders and unassigned still equal each location's ledger balance (FR-SSW-032). Both functions return byte-identical results for
   any organisation that has no WOT (the new terms are zero).
7. **Who may do it.** The same people as a return or issue at that location: its **keeper**, or an **Admin** (audited `stock.admin_post`
   as today). View-only impersonation cannot. No new role, no new setting.
8. **Atomic, immutable, correctable.** One RPC does everything; any refusal rolls back both halves. A posted WOT cannot be edited,
   cancelled or deleted; the correction is a WOT the other way (B to A), which the same rules allow. Replays with one client request id
   return the original.
9. **Cancelled work orders (known limit, accepted).** A cancelled work order takes no new cost (existing `check_cost_attribution` rule), and a return names
   its work order, so a move naming a cancelled A or B is refused with `COST_WO_CANCELLED: the work order is cancelled`. The screen shows that message in the
   person's language. Leftover on a cancelled work order is therefore moved off by re-opening the work order first. The rule is not loosened here.
10. **Off until an Admin turns it on.** The organisation setting `stock_wo_transfers` (default off) gates the whole feature: while off, the RPC refuses
   (`STK_WOT_OFF`) and no screen, link or menu entry appears. Only an Admin changes it, through an audited RPC (`stock.wo_transfers`).

## 3. Requirements (EARS)
- FR-WOT-001 The system shall provide `post_stock_wo_transfer(header, lines, client request id)`, taking the location, work order A (from),
  work order B (to), optional date, note and discipline of B's cost, and lines of item, quantity and optional work item (BoQ) of B.
- FR-WOT-002 It shall, in one transaction, create the WOT with a number, post a return naming A (citing A's issue lines) and post an issue naming B,
  both at the location, both through the unchanged engine (`stock_apply`, `stock_write_entry`), and link both to the WOT. If any part is refused
  nothing is written.
- FR-WOT-003 A and B shall be different work orders of one project of the caller's organisation; the location shall be a `site`, `yard` or `staging`
  location of that project, not archived (`STK_WOT_PROJECT`, `STK_WOT_LOCATION`, `STK_ARCHIVED`).
- FR-WOT-004 For each item the quantity shall not exceed A's net issued balance of the item (`STK_WOT_EXCEEDS`). An item appears once per WOT.
- FR-WOT-005 Each issue line takes the work item of the return lines it relieves when they share one; otherwise the request must name it; it
  must belong to the project (`STK_BOQ_MISMATCH`, engine).
- FR-WOT-006 The return half shall carry A's discipline of the cited issues when they share one; the issue half carries the discipline named in the request.
- FR-WOT-007 Only the keeper of the location or an Admin may post it (`STK_NOT_KEEPER`); the date rules of any stock document apply (`STK_BACKDATE`);
  the project must be Ongoing and un-archived (`STK_PROJECT_NOT_ACTIVE`); an organisation whose inventory is run in a connected ERP is refused (`STK_OWNED_BY_ERP`).
- FR-WOT-008 `stock_documents.wo_transfer_id` shall be settable only by `post_stock_wo_transfer`, and a deferred check at commit shall prove that each
  WOT has exactly one Posted return naming A and one Posted issue naming B, same location and project, equal quantity per item, and net zero ledger
  quantity at the location (`STK_WOT_INCOMPLETE`). A WOT row cannot be updated or deleted.
- FR-WOT-009 `get_work_order_returnable(work order)` shall list, per item, A's net issued balance (quantity; value only for roles that read stock
  value) and the default work item, so the screen shows what can move. Organisation-isolated, member-only.
- FR-WOT-010 `get_work_order_stock_balance` and `mrq_prior_quantity` shall include WOT documents as in decision 6.
- FR-WOT-011 The WOT, its lines (through its two documents) and the two RPCs are organisation-isolated; nothing is client-writable except through the RPC.
- FR-WOT-012 The move screen and the WOT detail work at 390 px wide, strings in English and Bahasa Indonesia, using the shared form primitives and
  DESIGN.md tokens. The detail shows both halves, links to both documents and both work orders.
- FR-WOT-014 The organisation shall have `stock_wo_transfers` (boolean, default false), changed only by an Admin through `set_stock_wo_transfers`, audited
  as `stock.wo_transfers`; while off, `post_stock_wo_transfer` refuses `STK_WOT_OFF` and the entry link, the move screen and the WOT detail do not render.
  Turning it on needs the organisation to run its own inventory (`STK_OWNED_BY_ERP` otherwise).
- FR-WOT-013 The ledger and stock-document screens shall show a WOT's two documents as "part of WOT-nnnn" with a link.

## 4. Settings
| Setting | Where | Default | Meaning |
|---|---|---|---|
| Work-order transfers | `organizations.stock_wo_transfers`, Stock setup (Admin) | off | on lets stock writers move leftover between work orders |

The ticket lists none; the Director ruled (2026-11-21) that nothing alters an existing screen until a setting turns it on. No per-tag or per-item flag, no new role.

## 5. Default-off statement
New table, new nullable column, new boolean setting defaulting to off, new functions only. While the setting is off nothing renders and the RPC refuses.
`get_work_order_stock_balance` and `mrq_prior_quantity` are re-created with terms that are zero without a move (AC-WOT-012; the existing tests of both run
unedited). With the setting on, the one visible entry is the link "Move leftover to another work order", shown only to a stock writer. Existing tests are not edited.

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-WOT-001 | Given A issued 10 of an item at a site location and B in the same project, when the keeper moves 4 from A to B, then one WOT exists with a return naming A and an issue naming B, both Posted, the location's quantity is unchanged and A's issued net is 6, B's 4. | pgTAP |
| AC-WOT-002 | Given a move of 4, then `get_work_order_stock_balance` shows A issued -4 and B issued +4, on-site quantity and value of both unchanged, and the sum over work orders plus unassigned equals the location's ledger balance. | pgTAP + Layer-1 money test |
| AC-WOT-003 | Given the same move, then `mrq_prior_quantity` of B is up by 4 and A's down by 4; for a work order with no WOT it is the value 1100 gives. | pgTAP |
| AC-WOT-004 | Given A holds a net 6 of an item, when 7 is moved, then refused `STK_WOT_EXCEEDS` and nothing is written; after a first move of 4, a second of 3 is refused, of 2 succeeds. | pgTAP (mutation-check) |
| AC-WOT-005 | Given A's issues are two lines (3 then 5), when 6 is moved, then the return cites both lines (3 + 3), oldest first, and a late partial return of one cited line elsewhere cannot push either over its cap (`STK_RETURN_EXCEEDS`). | pgTAP |
| AC-WOT-006 | Given A issued at cost 5 and the location's average is 5, then A's cost drops by q x 5 and B's rises by q x 5; given a different average, then B is charged the average and the difference stays in the location value; ledger value is conserved either way. | pgTAP + Layer-1 money test |
| AC-WOT-007 | Given a work order of another project, another organisation, a cancelled work order, A = B, then each is refused with its own error and nothing is written. | pgTAP |
| AC-WOT-008 | Given a location that is a vendor, transit, central, archived, or belongs to another project, then refused; a site, yard and staging location of the project post. | pgTAP |
| AC-WOT-009 | Given a user who is not the location's keeper and not Admin, then refused `STK_NOT_KEEPER`; the keeper succeeds; an Admin succeeds with a `stock.admin_post` audit row; view-only impersonation hides the entry in the UI (the real role is the authority). | pgTAP + Unit |
| AC-WOT-010 | Given a two-step organisation, then the move posts, creates no transfer, no transit location and no handover, and one-step transfers are still refused as before. | pgTAP |
| AC-WOT-011 | Given a failure in the issue half (project not Ongoing, work item of another project, no stock after rounding), then the return half is not written either; replaying one client request id returns the same WOT with no second posting. | pgTAP |
| AC-WOT-012 | Given an organisation with no WOT, then `get_work_order_stock_balance` and `mrq_prior_quantity` give the results the shipped tests (stock_site_work, 1100) expect, unedited. | pgTAP (existing files re-run) |
| AC-WOT-013 | Given the commit-time check, when a WOT row exists with a missing half, unequal quantities, a different location or a Draft half, then it is refused (`STK_WOT_INCOMPLETE`); a client cannot set `wo_transfer_id`, update or delete a WOT. | pgTAP (mutation-check) |
| AC-WOT-014 | Given two organisations, then each sees only its own WOTs and `get_work_order_returnable` of another organisation's work order is refused. | pgTAP |
| AC-WOT-015 | Given zero-cost (client-supplied) items, then the move carries value 0 on both halves. | pgTAP |
| AC-WOT-016 | Given work order A with returnable lines, when the form is filled and submitted, then the request carries the right payload, `STK_WOT_EXCEEDS` is shown in the person's words, and a quantity above the returnable shows before submitting. | Unit (RTL) |
| AC-WOT-017 | Given the strings, then every key exists in `en` and `id`, and no view-only or non-keeper sees the entry point. | Unit |
| AC-WOT-019 | Given the setting off (default), then the RPC is refused `STK_WOT_OFF` and the link and routes do not render; only an Admin turns it on or off, each change audited, a repeat is a no-op, another organisation is unaffected. | pgTAP + Unit |
| AC-WOT-018 | Given a keeper on a phone viewport, when moving leftover from A to B and opening the WOT, then both work orders' balances change as stated and the WOT shows both halves. | E2E (one journey) |

## 7. Mutation checks (written now; run on the integration branch)
Each is broken, the named AC must go red, then restored (`supabase/tests/1310_stock_wo_transfer.test.sql`, `1311_stock_wo_transfer_balances.test.sql`, `1314_stock_wo_transfer_setting.test.sql`):
`mut:wot_net_cap` (drop the net-issued check, AC-WOT-004) · `mut:wot_engine_cap` (drop the engine's per-line cap under the lock, AC-WOT-005) ·
`mut:wot_same_project` (AC-WOT-007) · `mut:wot_location_kind` (AC-WOT-008) · `mut:wot_keeper` (AC-WOT-009) · `mut:wot_atomic` (post the return outside the
RPC transaction block or swallow the issue error, AC-WOT-011) · `mut:wot_pair_check` (drop the commit-time check, AC-WOT-013) · `mut:wot_system_only`
(allow a client to set `wo_transfer_id`, AC-WOT-013) · `mut:wot_balance_in` / `mut:wot_balance_moved` (drop the received or moved-out term in
`get_work_order_stock_balance`, AC-WOT-002) · `mut:wot_mrq` (drop the WOT term in `mrq_prior_quantity`, AC-WOT-003) · `mut:wot_setting_admin` (drop the Admin check of the setting RPC, AC-WOT-019).

## 8. Out of scope
Moves between projects. Moves between two physical locations (use the transfer). Moving stock that was never issued to work order A (that
is a transfer, or a plain issue to B). Reservations (#2693). Editing or cancelling a posted WOT (correct it with the reverse WOT).

## 9. Director rulings (2026-11-21)
1. B's issue is costed at the location's moving average (engine unchanged). Accepted (decision 5).
2. The cancelled-work-order refusal stays as the existing rule; recorded as a known limit with its error (decision 9).
3. Moves between projects stay refused (`STK_WOT_PROJECT`).
4. The entry stays off until an Admin turns on the organisation setting (decision 10, FR-WOT-014, AC-WOT-019).
