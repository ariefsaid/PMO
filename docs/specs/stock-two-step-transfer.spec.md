# Two-step transfer with recount, and handover confirmed in PMO (TST)

Issue #2690 (map #2516). Status: **Draft for sign-off, 2026-11-21**. Plan `docs/plans/2026-11-21-stock-two-step-transfer.md`.
IDs: `FR-TST-###`, `AC-TST-###`. **Money path: stock ledger** (transfers, value carried, write-off). The ledger stays written only by
`stock_write_entry` (FR-STK-072). Ships alone. Stacked on the vendor location (#2683, migration 1300); #2689 (daily proof list),
#2691 (work-order to work-order transfer) and #2693 (reservations) stack after it. Owner ruling: OD-SCOPE-10 (`docs/decisions.md`).

**Job story.** When material is sent and received, I want the receiver to recount and confirm it in PMO, so shortfalls are recorded
and nobody signs on trust.

## 1. AS-IS
- A transfer is one document that posts two ledger rows at once (out at the source, in at the destination), value carried at the
  source's moving average (`stock_apply_transfer`, 0413). Nobody counts anything on arrival.
- Proof today: `stock_tags.paper_required` (1029, only on a zero-cost tag) makes `stock_post_core` (1030) refuse to post a transfer
  of such an item until a live photographed attachment exists (`stock_document_files`).
- Locations are client data (kinds central, site, yard, staging, vendor). Organisation settings are columns on `organizations`
  written by an Admin-only RPC (precedent `procurement_gates`, 0360).
- The material request approval creates a Draft transfer through `create_stock_document` (1001, 1101); a keeper posts it.

## 2. Design decisions (the questions the ticket left open)
1. **In-transit is a real location.** Each sent transfer gets its own system location of kind `transit`. Sent = an ordinary transfer
   leg source -> transit; the transit location then holds the goods. The ledger therefore always conserves quantity and value
   across all locations, goods never vanish from the books while on the road, and every step posts through the unchanged engine.
   One location per transfer (not one per organisation) so the value carried back out is that transfer's own cost, never a blend with
   another transfer's cost of the same item.
2. **Where accepted, rejected and short quantity go.** Counted = what the receiver physically counted (never above what was sent).
   Accepted -> destination. Rejected (counted but refused, quality or damage) -> posted straight back to the source location, as a
   leg transit -> source, and recorded on the line with a reason. Short (sent minus counted) -> **stays in the transit location as an
   open shortfall** until someone resolves it per line: *delivered late* (to the destination), *returned* (to the source) or
   *written off* (an adjustment out of the transit location, Admin only, with a reason and an audit row). Nothing is ever lost
   silently: while any shortfall is open the transfer is not Closed and the stock is visibly "in transit".
3. **Proof.** A tag's proof rule becomes one of `none`, `paper` (photographed signed paper), `confirmation` (handover confirmations
   in PMO) or `either`. Existing `paper_required = true` tags read as `paper` and keep today's behaviour exactly. The legacy boolean
   stays and is kept in step by the database (`paper` <-> `paper_required`), so existing code and tests are untouched.
4. **When a proof is demanded (owner ruling 2026-11-21: signed paper often arrives after the goods).** An organisation setting
   `stock_proof_timing` decides. `before_posting` (default) is today's blocking behaviour: a one-step transfer is refused at posting
   without its paper, a two-step transfer is refused at receive without its proof. `may_follow`: the movement posts or is received
   without the proof and stays **proof outstanding** until the proof the tag requires is attached or confirmed, then reads **proof
   complete**; nothing is blocked. `paper` is met by a photographed paper (one-step: an attachment on the document, as today;
   two-step: a paper confirmation); `confirmation` by a PMO confirmation at the receive stage; `either` by either. A transfer
   needing several tags' proofs must meet each tag's rule. The confirmation and either rules apply to two-step transfers only (a
   one-step transfer can only ever be proved by paper). The proof status of every movement is read through one function
   (FR-TST-070) for the daily list in #2689.
5. **Confirmation modes need two-step.** `confirmation` and `either` can only be satisfied by two-step handovers, so the database
   refuses to set them while the organisation is one-step, and refuses to turn two-step off while a tag uses them.
6. **Quality check is item data.** `stock_items.needs_quality_check` (default false). A flagged item's line needs a pass or fail at
   receive; fail means nothing of that line is accepted.
7. **Who may do what.** Send: keeper of the source or Admin (as any transfer). Receive and confirm: keeper of the destination, the
   named receiver (optional `to_user_id` on the transfer, the "delivery addressed to me" of the light accounts, OD-SCOPE-4), or Admin.
   The person who sent may not receive the same transfer (recount means a second person) unless Admin, audited (`stock.self_receive`).
   A person with no account signs on the logged-in person's phone: the logged-in person is recorded as the host.

## 3. Requirements (EARS)

**Settings and default-off**
- FR-TST-001 The organisation shall have `stock_transfer_mode`, `one_step` (default) or `two_step`, changed only by an Admin through
  `set_stock_transfer_mode`. While `one_step`, every shipped behaviour is byte-identical and send, receive, recall and shortfall resolution refuse (`STK_TWO_STEP_OFF`); recording a late handover confirmation stays possible.
- FR-TST-002 Switching to `two_step` shall be refused while any Draft transfer exists that is not a material-request draft (the
  admin posts or deletes it first); switching to `one_step` shall be refused while any transfer is Sent or has an open shortfall,
  or while a tag has proof `confirmation` or `either`.
- FR-TST-003 While `two_step`, posting a transfer that is not a leg of a two-step transfer shall be refused in the database
  (`STK_TWO_STEP`). A Draft transfer (the material-request draft) is sent in place instead (FR-TST-011).

**Send**
- FR-TST-010 `send_stock_transfer(header, lines, draft id, client request id)` shall create the transfer (number, source, destination, optional work order, optional named
  receiver, note, lines of item and quantity), create its transit location, and post the leg source -> transit through the engine.
  Value is carried: the value of each line at transit equals the value removed from the source. A shortage at the source refuses
  as today (`STK_INSUFFICIENT`).
- FR-TST-011 It shall accept an existing Draft transfer (not yet two-step) and send it in place: the draft keeps its identity and its
  lines; its destination moves to the transit location and the final destination and work order are kept on the transfer.
- FR-TST-012 The work order, if named, shall be validated as a transfer names it today (the destination's project, `check_cost_attribution`)
  and is stamped on the leg that reaches the destination.
- FR-TST-013 A transit location shall be creatable only by the send RPC, shall take only transfer legs and the shortfall write-off,
  shall be absent from location pickers and shall be archived by the system when its transfer closes.
- FR-TST-014 The sender may recall a Sent transfer before receipt: everything returns from transit to the source (leg transit -> source),
  the transfer is Cancelled with a reason. Source keeper, the sender or Admin.

**Receive**
- FR-TST-020 `receive_stock_transfer` shall take, per line: counted quantity, accepted quantity, rejected quantity, a reason for any
  rejection, and for a flagged item a quality result. It shall enforce `counted <= sent`, `accepted + rejected = counted`, all `>= 0`.
- FR-TST-021 A flagged item line without a pass or fail is refused; a fail forces `accepted = 0` (`STK_QUALITY`).
- FR-TST-022 It shall post accepted quantity transit -> destination (with the work order) and rejected quantity transit -> source,
  each through the engine as its own leg; the short quantity (`sent - counted`) stays in transit.
- FR-TST-023 It shall record who received (the logged-in person), when (server time) and each line's counts, immutably; a transfer can be
  received once. When no shortfall is open the transfer becomes `Closed` and its transit location is archived; otherwise it is `Received`.
- FR-TST-024 A sender may not receive their own transfer (`STK_SELF_RECEIVE`) unless Admin (audited).
- FR-TST-025 While the organisation's proof timing is `before_posting`, receive shall refuse unless every tag rule of the lines' items is met
  (`STK_PROOF_REQUIRED`). While `may_follow` it proceeds and the transfer is proof outstanding (FR-TST-056).

**Shortfall**
- FR-TST-030 Every line whose counted quantity is below sent has an open shortfall of the difference, listed until resolved.
- FR-TST-031 `resolve_stock_transfer_shortfall` shall resolve one line fully as `delivered`, `returned` or `written_off`, posting through
  the engine (leg to the destination, leg to the source, or an adjustment out of the transit location). `written_off` is Admin only
  and needs a reason (audit row `stock.transfer.write_off`); the others are for the keepers of either end or Admin.
- FR-TST-032 When the last shortfall is resolved the transfer becomes `Closed` and the transit location holds nothing.

**Handover confirmation**
- FR-TST-040 A handover confirmation shall record: the stage (`send` or `receive`), the proof type (`in_app` or `paper`), the signer's
  name, the time (server), the signer kind (`account` or `guest`), the logged-in person who recorded it, a snapshot of the counted
  quantities (copied by the server from the transfer lines, never supplied by the client), a photo of the goods and a photo of the
  signer; a `paper` confirmation carries one photo of the signed paper instead.
- FR-TST-041 For an `account` signer the name is the signer's profile name (server-set) and the signer is the logged-in person. For a
  `guest` (no account) the name is typed by the host, is required (2 to 120 characters) and the host is the logged-in person.
- FR-TST-042 Each photo shall be an object that exists in the private bucket `stock-handover` under
  `{org}/{transfer}/{confirmation}/{filename}`; a confirmation naming a missing or foreign object is refused (`STK_FILE_MISSING`).
- FR-TST-043 A confirmation is immutable and cannot be deleted by any role; its photos cannot be deleted once linked.
- FR-TST-044 A confirmation may be given at the send stage (by the sender, or a guest carrier signing on the sender's phone) and at the
  receive stage. The photos are uploaded to a path naming the transfer, so the transfer must exist first: a send-stage confirmation is
  recorded through `record_stock_handover` after the send; a receive-stage one travels with `receive_stock_transfer` in the same
  transaction, or afterwards through `record_stock_handover` (a Sent transfer takes a send-stage one; a Received or Closed transfer
  takes a receive-stage one or a paper one). Receivers and keepers as in design decision 7; the sender-not-receiver rule applies to an `account` signer at the receive stage.

**Proof rule per tag**
- FR-TST-050 `stock_tags.proof_required` is `none` (default), `paper`, `confirmation` or `either`. `paper_required` and `proof_required`
  are kept consistent by trigger: setting either updates the other (`paper` <-> true; `confirmation`, `either`, `none` -> false); if a
  statement sets both, `proof_required` wins.
- FR-TST-051 The existing check that `paper` needs a zero-cost tag stays; `confirmation` and `either` apply to any tag.
- FR-TST-052 `confirmation` and `either` shall be refused while the organisation is `one_step` (FR-TST-002).
- FR-TST-053 The one-step paper rule at posting (1030) is unchanged while `stock_proof_timing = 'before_posting'`; under `may_follow` the same
  post proceeds and the paper may be attached afterwards (attachments to a Posted document are already allowed).
- FR-TST-056 `organizations.stock_proof_timing` is `before_posting` (default) or `may_follow`, changed only by an Admin through
  `set_stock_proof_timing` (audited). Proof is **outstanding** for a movement whose tag rules are not all met, **complete** when they are.
  Complete is computed from the evidence on read, never stored, so an archived paper makes the movement outstanding again.

**Quality check and reading**
- FR-TST-060 `stock_items.needs_quality_check` (default false) is set by the roles that edit items today (existing column grants).
- FR-TST-061 `get_stock_on_hand` rows of a transit location read as kind `transit` so on-hand totals show stock in transit; pickers
  exclude it. The reorder suggestion counts a send into transit as usage by the transfer's final destination kind, never as usage by itself.
- FR-TST-070 `get_stock_movement_proof_status(p_status, p_from, p_to)` (`p_status` null, `outstanding` or `complete`) shall list, for the caller's
  organisation, each posted one-step transfer and each two-step transfer (Sent, Received, Closed) whose items carry a proof rule: id and number,
  mode, transfer status, movement date, source and destination (ids and names, so the list shows the location), the distinct tag rules and
  one `required_proof` (the rule, or `mixed`), whether paper is attached, whether a receive-stage confirmation exists, `proof_status`
  (`outstanding` or `complete`), `missing` and `proof_completed_at` (the time the last needed proof arrived, null while outstanding). Movements whose items need
  no proof are not listed. A Sent transfer with an unmet rule is outstanding. This is the single read #2689 lists from.
- FR-TST-071 A read-only reconciliation view `stock_transit_reconciliation` shall list per transit location and item the ledger balance
  and the outstanding quantity from the transfer lines; the two are equal for every row (proved by test).
- FR-TST-080 Transfers, lines, confirmations, the bucket and the new RPCs are organisation-isolated; nothing is client-writable
  except through the RPCs.
- FR-TST-090 The send, receive, confirm and shortfall screens work at 390 px wide and are used with a phone camera; strings English and Bahasa
  Indonesia; the organisation's own tag, location and term names are shown, never hard-coded.

## 4. Settings (organisation controls; every default keeps today's behaviour)
| Setting | Where | Default | Meaning |
|---|---|---|---|
| Transfer mode | `organizations.stock_transfer_mode`, Stock setup | `one_step` | `two_step` turns the whole feature on |
| Proof rule | `stock_tags.proof_required`, tag panel | `none` (`paper` where `paper_required` was true) | which proof counts for items of that tag |
| Quality check | `stock_items.needs_quality_check`, item form | false | receiving that item needs a pass or fail |
| Proof timing | `organizations.stock_proof_timing`, Stock setup (Admin) | `before_posting` | `may_follow` lets a movement post or be received first and leaves it "proof outstanding" |

## 5. Default-off statement
Migrations add only nullable or defaulted columns, new tables and new functions; `stock_post_core` is re-created with its one paper clause reading the proof timing (default `before_posting` keeps it identical). No existing row, function result, screen or test changes while
`stock_transfer_mode = 'one_step'`. The two existing function bodies replaced (`get_reorder_suggestions` for transit locations, none of which exist; `stock_post_core` for `may_follow`, which is off) differ in no default case. Existing `paper_required` tags map to `proof_required = 'paper'` by the migration and behave identically. The Transfers tab and the send and receive screens appear only when two-step is on (the movement form sends a transfer to the send screen only then). The one new control a one-step organisation sees is the Admin-only "Transfers and proof" button in Stock setup, which is where two-step is turned on. Existing tests are not edited.

## 6. Acceptance criteria
| AC | Given / When / Then | Owning layer |
|---|---|---|
| AC-TST-001 | Given an organisation left at the default, when a transfer is created and posted, then both legs post as before and `send_stock_transfer` is refused `STK_TWO_STEP_OFF`. | pgTAP |
| AC-TST-002 | Given an Admin, when switching modes, then it works; a non-Admin is refused; switching on with a non-material-request Draft transfer, or off with a Sent transfer, an open shortfall or a `confirmation`/`either` tag, is refused. | pgTAP |
| AC-TST-003 | Given two-step on, when posting an ordinary transfer, then `STK_TWO_STEP`; a material-request Draft transfer is sent in place and keeps its id and lines. | pgTAP |
| AC-TST-004 | Given 10 at the source (value 50), when 10 are sent, then source 0, transit 10 / value 50, no value created or lost; sending 11 is refused `STK_INSUFFICIENT`. | pgTAP (mutation: break value carry, red) |
| AC-TST-005 | Given a transit location, then a client cannot create or re-kind one, a receive/issue/return/adjust-by-user naming it is refused, and it is absent from picker reads. | pgTAP + unit |
| AC-TST-006 | Given 10 sent, when received counted 10 accepted 10, then destination +10 with the sent value, transit 0, transfer Closed, transit location archived. | pgTAP |
| AC-TST-007 | Given 10 sent, when counted 7 accepted 7, then destination 7, transit 3, shortfall 3 open, transfer Received (not Closed), on-hand shows 3 in transit. | pgTAP |
| AC-TST-008 | Given 10 sent, when counted 10 accepted 6 rejected 4 with a reason, then destination 6, source +4 back, transit 0; accepted + rejected not equal counted, or a rejection without a reason, is refused. | pgTAP |
| AC-TST-009 | Given 10 sent, when counted 11, then refused (check violation `23514`); negative figures and more than 3 decimals refused. | pgTAP |
| AC-TST-010 | Given a flagged item, when received without a result, then `STK_QUALITY`; result fail with accepted > 0 refused; fail with accepted 0 rejected = counted accepted; an unflagged item needs no result. | pgTAP (mutation: drop the fail rule, red) |
| AC-TST-011 | Given an open shortfall of 3, when resolved delivered, returned or written off, then the matching legs post and the transit location reaches 0 and the transfer Closed; write-off by a non-Admin or without a reason is refused; the write-off audits. | pgTAP |
| AC-TST-012 | Given a Sent transfer, when recalled by the sender, keeper or Admin, then all stock returns to the source and the transfer is Cancelled; a Received transfer cannot be recalled. | pgTAP |
| AC-TST-013 | Given the sender, when receiving their own transfer, then `STK_SELF_RECEIVE`; an Admin may, with an audit row. | pgTAP (mutation: drop rule, red) |
| AC-TST-014 | Given any mix of sent, counted, accepted, rejected and resolved quantities (a table of at least ten cases, zero-cost item included), then at every step total quantity and total value over all locations is unchanged except by a write-off, and `stock_transit_reconciliation` has no mismatch. | pgTAP |
| AC-TST-015 | Given a logged-in receiver, when confirming with both photos, then the confirmation stores the profile name, the server time, the counts copied from the lines and the two photo paths; it cannot be updated or deleted; a missing photo object is refused. | pgTAP |
| AC-TST-016 | Given no-account signer, when the host confirms with a typed name, then it saves with signer kind `guest`, that name and the host; a blank or one-character name is refused. | pgTAP |
| AC-TST-017 | Given an existing `paper_required` tag, after migrating, then `proof_required = 'paper'`; setting either column updates the other; the 1030 one-step paper rule behaves as before. | pgTAP (existing `stock_site_work` untouched) |
| AC-TST-018 | Given proof timing `before_posting` and tag rules none, paper, confirmation and either, when receiving with no proof, paper only, in-app only, or both, then the receive is accepted exactly where the rule is met, else `STK_PROOF_REQUIRED`; a transfer mixing two tags needs both. | pgTAP (mutation: drop the proof check, red) |
| AC-TST-019 | Given a one-step organisation, when setting a tag to `confirmation` or `either`, then refused. | pgTAP |
| AC-TST-020 | Given one-step, two-step Sent, Received and Closed transfers with and without proof (including a paper archived after posting and a rule changed later), when reading `get_stock_movement_proof_status`, then `proof_status`, `missing`, the tag rule, the movement date and the locations are right, `p_status` filters to outstanding or complete, movements needing no proof are absent, and another organisation's rows never appear. | pgTAP |
| AC-TST-021 | Given sends into transit, when the reorder suggestion is read, then a send counts as usage only by the final destination's kind. | pgTAP |
| AC-TST-022 | Given two organisations, then each cannot read or write the other's transfers, confirmations or photos; the new tables and RPCs pass the isolation probe. | pgTAP + isolation fragments |
| AC-TST-023 | Given the send screen, then it lists locations without transit, takes items and quantities, and offers "Send" only when two-step is on. | Unit |
| AC-TST-024 | Given the receive screen, then it prefills counted from sent, shows accept and reject per line, shows the quality choice only for flagged items, shows the open shortfall, and blocks submit on the rules above. | Unit |
| AC-TST-025 | Given the handover capture, then goods and signer photos are required for in-app proof, a guest mode asks for a typed name, and it fits a 390 px width. | Unit |
| AC-TST-026 | Given Stock setup, then the mode switch, the per-tag proof choice and the item quality flag read and write, hidden when inventory is ERP-connected. | Unit |
| AC-TST-027 | Given a one-step organisation, then the movement form and Stock navigation are unchanged. | Unit |
| AC-TST-029 | Given an Admin, when setting proof timing, then it saves with an audit row; a non-Admin is refused; an unknown value is refused; the default is `before_posting`. | pgTAP (mutation: drop the Admin check, red) |
| AC-TST-030 | Given `may_follow`, when posting a one-step transfer of a paper-rule item with no paper, then it posts and reads outstanding; after the paper is attached it reads complete; archiving that paper makes it outstanding again. Under `before_posting` the same post is refused as today. | pgTAP (existing `stock_site_work` untouched) |
| AC-TST-031 | Given `may_follow`, when receiving a two-step transfer of a confirmation-rule item with no proof, then it receives and reads outstanding; after `record_stock_handover` with the receive-stage confirmation (or a paper confirmation for `paper` / `either`) it reads complete; the stage and role rules of FR-TST-044 hold. | pgTAP (mutation: drop the late-proof actor check, red) |
| AC-TST-032 | Given a material-request draft transfer sent in place and received, when reading `mrq_prior_quantity` for its work order and item, then it equals the accepted quantity after receive (and the request is not counted twice). | pgTAP |
| AC-TST-033 | Given the setup screen, then an Admin sees the proof-timing choice; a non-Admin does not; the list screens show "proof outstanding" and "proof complete" in both languages. | Unit |
| AC-TST-028 | Given a keeper and a receiver on a phone viewport, when sending, receiving short with photos and a guest signing on the phone, then the shortfall shows open and in-transit stock reads on-hand. | E2E (one journey) |

## 7. Mutation checks (written now; run on the integration branch)
Each is broken, the named AC must go red, then restored (`supabase/tests/1305_stock_two_step_transfer.test.sql` and `1307_..`):
`mut:transit_carry` (value carried at send, AC-TST-004, 014) · `mut:one_step_block` (AC-TST-003) · `mut:count_cap` (counted <= sent, AC-TST-009) ·
`mut:accept_sum` (accepted + rejected = counted, AC-TST-008) · `mut:quality_fail` (AC-TST-010) · `mut:self_receive` (AC-TST-013) ·
`mut:proof_check` (AC-TST-018) · `mut:writeoff_admin` (AC-TST-011) · `mut:confirm_immutable` (AC-TST-015) · `mut:guest_name` (AC-TST-016) ·
`mut:transit_system_only` (AC-TST-005) · `mut:mode_off_guard` (AC-TST-002) · `mut:timing_admin` (AC-TST-029) · `mut:late_actor` (AC-TST-031) · `mut:timing_block` (the one-step paper block follows the timing, AC-TST-030).

## 8. Out of scope
Hardware (smart locks, scanners). Splitting one shortfall resolution across several actions. Receiving more than was sent. Work-order to
work-order transfer (#2691). Reservations (#2693). Offline capture. A direct accounting connector. Inventory run in a connected ERP: the
feature is standalone-ledger only, as tags and paper are (FR-SSW decision 8); the RPCs refuse `STK_OWNED_BY_ERP`.
