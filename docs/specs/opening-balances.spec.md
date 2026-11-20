# Opening balances at go-live (#2588)

Map: #2516. Migrations `1046_opening_balances.sql` (records and rules) and `1047_cli_opening_balances.sql` (CLI tier).

## Job

When the organisation goes live, an Admin loads where each running work order stands and what each stock
location holds, so progress, billing and stock continue from the right point instead of from zero.

## Scope

- In: per **running** (Issued) work order, progress to date per allocated contract line: quantity certified
  (accepted) and quantity already claimed (billed before go-live), with the claimed value derived at the line's rate.
  Per stock location, the counted quantity and unit cost of each item. A reconciliation report of what was loaded.
- Out: finished (Closed or Cancelled) work orders carry no opening balance. Full sales and cost history of
  finished work orders (after go-live). Pre-go-live revenue in dashboards and the management pack: those read
  invoices, and pre-go-live revenue lives in the accounting books' own opening entry.

## Rules

- **FR-OPB-001** Only an active Admin loads or reverses an opening balance.
- **FR-OPB-002** Every live opening of an organisation carries one date, the go-live date, set by its first load. It is
  never in the future. Once every opening of the organisation is reversed, the next load may set a new date. Loads of one
  organisation run one at a time, so the rule holds when two Admins load together.
- **FR-OPB-003** A work-order opening is refused unless the work order is Issued and has no acceptance (other than
  withdrawn), no live progress claim and no invoice. A location's stock opening is refused once the location has any
  stock movement. One live opening per work order and per location.
- **FR-OPB-004** The certified part is a Confirmed acceptance whose basis is `opening`, dated at go-live. Acceptances are
  cumulative, so the next real acceptance supersedes it and nothing counts twice. **Accepted exception to the
  second-person rule:** an ordinary acceptance is prepared by one person and confirmed by another; the opening acceptance
  is prepared and confirmed in one call by the loading Admin. It is accepted because it records work certified before
  go-live (outside PMO), only an Admin can make it, it is audited, and it is possible only before the work order's first
  real transaction.
- **FR-OPB-005** The claimed part counts as already invoiced work on the work order (remaining to invoice, the
  invoice cap) and as claimed and billed quantity per contract line (project billing, billing reconciliation). It
  never becomes a claim or an invoice, so nothing is sent to an ERP.
- **FR-OPB-006** The stock part is a stock document of kind `opening`, posted at go-live; its ledger rows carry kind
  `opening`. Its cost reaches no project actual (it names no project or work order).
- **FR-OPB-007** Loading and reversing are audited (`opening_balance.load`, `opening_balance.reverse`).
- **FR-OPB-008** An Admin may reverse an opening while nothing real has happened since: for a work order, no other
  live acceptance, claim or invoice; for a location, no later stock movement. Reversal removes the opening
  acceptance, stops the claimed part counting, and writes `opening_reversal` ledger rows that return the balance to zero.
  A reversed opening and its reversal are not movement: the work order or location takes a corrected opening. A stock
  reversal follows the same stock rules as a load (stock module on, inventory not owned by an ERP). A work-order reversal
  and an acceptance being prepared on the same work order run one after the other.
- **FR-OPB-009** Opening money is readable by the roles that read claims (not Engineers).

## Acceptance (owner layer: pgTAP, `supabase/tests/opening_balances.test.sql`)

- **AC-OPB-001** Given a Finance member, when they load or reverse, then it is refused.
- **AC-OPB-002** Given a Closed or Draft work order, when an Admin loads an opening, then it is refused.
- **AC-OPB-003** Given a running work order, when an Admin loads certified and claimed quantities, then a Confirmed
  `opening` acceptance dated at go-live exists and the load is audited.
- **AC-OPB-004** Given that opening, then the work order shows the claimed value invoiced once, remaining reduced by it,
  and the claimed quantity once in project billing and billing reconciliation; a claim that would bill past the
  order value is refused.
- **AC-OPB-005** Given a work order with real activity, when an Admin loads an opening, then it is refused; a second
  opening and an opening at a different go-live date are refused.
- **AC-OPB-006** Given a location with no movement, when an Admin loads counts, then on-hand quantity and value equal
  the counts once, and the ledger rows are marked `opening`; a location with a movement is refused.
- **AC-OPB-007** Given no activity since, when an Admin reverses, then the opening stops counting and is audited;
  given activity since, reversal is refused.
- **AC-OPB-008** Another organisation's Admin can neither load onto nor read these openings; an Engineer reads no opening money.
- **AC-OPB-009** The report lists every live opening with its certified value, claimed value, stock quantity and value.

## How an Admin loads (CLI, active Admin tier)

```
node scripts/pmo.mjs rpc load_work_order_opening '{"p_work_order_id":"…","p_as_of":"2026-12-14","p_lines":[{"boq_item_id":"…","certified_quantity":4,"claimed_quantity":3}]}'
node scripts/pmo.mjs rpc load_stock_opening '{"p_warehouse_id":"…","p_as_of":"2026-12-14","p_lines":[{"item_id":"…","counted_quantity":10,"unit_cost":5}]}'
node scripts/pmo.mjs rpc opening_balance_report '{}'
node scripts/pmo.mjs rpc reverse_opening_balance '{"p_id":"…"}'
```
