# Movements awaiting proof: the storekeeper's chase list (MAP)

Issue #2689 (map #2516). Status: **Draft for sign-off, 2026-11-21**. Plan `docs/plans/2026-11-21-stock-movements-awaiting-proof.md`.
IDs: `FR-MAP-###`, `AC-MAP-###`. Not a money path: a read-only list over the proof status read of #2690. Stacked on #2690
(`docs/specs/stock-two-step-transfer.spec.md`, migration 1309, FR-TST-070). Owner ruling: OD-SCOPE-10 (`docs/decisions.md`).

**Job story.** When a movement needs its signed paper and it has not arrived, I want a list of those movements, so the storekeeper can
chase them.

## 1. AS-IS
- #2690 lets an organisation choose `stock_proof_timing = may_follow`: a transfer then posts or is received without its proof and stays
  **proof outstanding** until the proof its tag rule asks for is attached (one-step: a photographed paper on the document; two-step: a
  paper or in-app confirmation on the transfer).
- `get_stock_movement_proof_status(p_status, p_from, p_to)` (1309) returns every movement that carries a proof rule, with `proof_status`
  (`outstanding` / `complete`), the missing proof, the date, both locations and `mode` (`one_step` / `two_step`). It is computed live from
  the evidence, so an archived paper reads outstanding again. Nothing lists outstanding movements in one place; the two-step Transfers
  tab only marks each row.
- The stock home is `/stock` (On hand). Proof is attached on the document detail (`/stock/documents/:id`, one-step) or the transfer detail
  (`/stock/transfers/:id`, two-step; the late-proof form of FR-TST-056).

## 2. Design decisions
1. **A live read is the "refreshed daily" list.** The ticket asks for a list that is refreshed daily. A read of the proof status function
   is computed from the live evidence on every load, so it is never staler than a daily refresh and a proof attached an hour ago leaves
   the list at once. No daily snapshot table, no scheduled job: a snapshot would add a place the list can be wrong (a paper attached after
   the snapshot still shows as missing) and a job to keep running, for no benefit. The card shows when it was read ("Updated 09:14") and
   refetches when the person returns to the tab, so it is visibly fresh. The age of each movement ("waiting 6 days") is computed from its
   date and today, which is what changes daily.
2. **Daily notification: not built.** A notification to storekeepers would need a recipient rule per person and a new scheduled job
   (`pg_cron`, ADR-0044 patterns); the ticket asks for a list "available on the stock home", which the live card meets. It stays out; if an
   organisation later wants a daily nudge it is a setting-gated addition on top of this read, not a rework of it.
3. **No new database object.** The existing read already carries every column the list needs and is already tenancy-proven (1309 pgTAP).
   This ticket adds no migration (1325 to 1329 stay unused) and no table; it changes only the stock home page, one hook and strings.
4. **Default-off by the timing setting.** The card renders only while the organisation's `stock_proof_timing` is `may_follow`, the one
   setting under which an outstanding proof is an expected state. Under `before_posting` (every existing organisation) the card never
   renders, even if an old movement reads outstanding (for example a paper archived after posting, or a tag set to require paper after
   older transfers posted), so no existing organisation sees a new card.
5. **Who sees it.** The people who can attach proof: Admin (all movements) and a warehouse keeper (movements where they keep the source or
   destination). A role that cannot attach sees nothing. The database read stays open to every active member as in #2690 (stock
   documents are readable by all members, FR-STK-061); the page filters, and the attach itself stays enforced by the existing
   `stock_can_attach` and `record_stock_handover` rules. Impersonation is view-only: the real role decides.
6. **Oldest first.** The list is for chasing, so the longest-waiting movement is first.
7. **Where each row goes.** A two-step row links to `/stock/transfers/:id`; a one-step row to `/stock/documents/:id` (the movement id is the
   document id). Both screens already hold the attach affordance.

## 3. Requirements (EARS)
- FR-MAP-001 While the organisation's proof timing is `may_follow` and at least one movement the person can attach proof to is
  outstanding, the stock home (`/stock`) shall show a card "Waiting for proof (N)" above the filters.
- FR-MAP-002 While the proof timing is `before_posting`, or no listed movement is outstanding, or the person cannot attach proof, or the
  read is loading or failed, the stock home shall render exactly as before: no card, no empty state, no error banner for this card.
- FR-MAP-003 Each row shall show the movement number, the from and to location names, the movement date, the whole days waiting (today
  minus the movement date, never negative), and the missing proof in words (signed paper, confirmed in PMO, or either).
- FR-MAP-004 The rows shall be ordered by movement date ascending, then number ascending, and shall show the first five with a control
  "Show all N" / "Show fewer" when there are more.
- FR-MAP-005 Each row shall link to where its proof is attached: `/stock/transfers/:id` for a two-step movement, `/stock/documents/:id`
  for a one-step one.
- FR-MAP-006 An Admin shall see every outstanding movement; a keeper shall see those whose source or destination they keep; any other
  role shall see none (FR-MAP-002).
- FR-MAP-007 The card shall show the time the list was read, and the list shall refetch when the window regains focus and after any
  transfer or document-attachment write (the proof query keys are already invalidated by `useTransferRefresh`; the attachment path
  invalidates the same key).
- FR-MAP-008 The card shall fit a 390 px phone (rows stack, no horizontal scroll) and a 1440 px desktop, and every string shall exist in
  English and Bahasa Indonesia.
- FR-MAP-009 The page shall not write anything and shall not read a movement of another organisation (the read is org-scoped by the
  database, 1309).

## 4. Settings
| Setting | Where | Default | Effect here |
|---|---|---|---|
| `stock_proof_timing` (#2690, FR-TST-056) | organisation, Admin | `before_posting` | `may_follow` is the only value under which the card can show |
| `stock_tags.proof_required` (#2690, FR-TST-050) | per stock tag | `none` | which movements carry a proof rule at all (the client's own rule) |

No new setting.

## 5. Default-off statement
Every existing organisation is `before_posting` and every existing tag keeps its proof rule, so FR-MAP-002 holds: the stock home is
byte-identical in markup to today (the card component returns null; its read still runs but renders nothing). An organisation sees the card
only after an Admin chooses `may_follow` and a movement then posts without its proof. The proof read adds one request to the stock home
for a keeper or Admin; it is skipped for any other role (`enabled` is false).

## 6. Acceptance criteria (Given / When / Then; owning layer)
- AC-MAP-001 (unit) Given timing `may_follow` and two outstanding movements, When a keeper of one of them opens `/stock`, Then the card
  "Waiting for proof (1)" lists only that movement, oldest first.
- AC-MAP-002 (unit) Given timing `before_posting` and an outstanding row, When an Admin opens `/stock`, Then no card renders and the
  page matches the no-card render.
- AC-MAP-003 (unit) Given `may_follow` and nothing outstanding, Then no card and no empty state.
- AC-MAP-004 (unit) Given a role that is neither Admin nor a keeper, Then no card and the proof read is not requested.
- AC-MAP-005 (unit) Given a row dated 6 days ago, Then it reads "waiting 6 days"; a row dated today reads "waiting 0 days" (never
  negative for a future date).
- AC-MAP-006 (unit) Given seven outstanding rows, Then five show with "Show all 7"; activating it shows seven and "Show fewer".
- AC-MAP-007 (unit) A two-step row links to `/stock/transfers/:id`; a one-step row to `/stock/documents/:id`.
- AC-MAP-008 (unit) The missing proof reads in words for `paper`, `confirmation`, `either` and a combination.
- AC-MAP-009 (unit) The read failing renders no card and no error for it; the rest of the page still renders.
- AC-MAP-010 (unit) The Bahasa Indonesia strings render (no English fallback on the card).
- AC-MAP-011 (e2e) Given an organisation on `may_follow` with a one-step paper-tag transfer posted without paper, When the keeper opens
  `/stock`, follows the row to the document and attaches the paper, Then returning to `/stock` the card is gone.
- AC-MAP-012 (pgTAP, existing) Tenancy and role of the read: owned by `supabase/tests/1309_stock_movement_proof_status.test.sql`
  (#2690); this ticket adds no database object, so no new pgTAP file and no mutation target. A guard test asserts no migration from 1325
  to 1329 exists (`pmo-portal/src/lib/stockProofList.noMigration.test.ts` is not needed; stated here so the reviewer knows it is intended).

## 7. Out of scope
No daily notification, no snapshot, no export, no reminder email, no change to the proof rules or to who may attach proof.
