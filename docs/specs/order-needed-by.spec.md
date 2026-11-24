# Purchase order needed-by date

Lane 1124d, decision 3. IDs: `FR-NBY-###`, `AC-NBY-###`. Not a money path (no amount, approval or ledger rule changes).

**Job story.** When we send an order to a supplier, I want it to say when we need the goods, so that the supplier plans delivery and the store plans receiving.

## As is
`procurement_items.needed_by` (1346) is a per-line request date, written only on a Draft while line planning is on. The order (a procurement case) has no header date. "Sent to the supplier" is the move to status `Ordered` (the PO number is minted there).

## Requirements (EARS)
- FR-NBY-001 The organisation shall hold one setting, "require a needed-by date before an order is sent", off by default, changed only by an Admin through `set_po_needed_by_required`, audited. The moment it is turned on is stored.
- FR-NBY-002 The order shall carry one header date, `procurements.needed_by`, written only by `set_procurement_needed_by` (the requester, Admin, Executive, Project Manager or Finance), while the order is not yet sent.
- FR-NBY-003 When the header date is saved, the system shall fill every line that has no date, or still carries the old header date. A line may carry its own date; a line given none follows the header.
- FR-NBY-004 While the setting is on, an order created after the moment it was turned on shall not move to `Ordered` without its header date; the refusal reads "Set the needed-by date before sending the order to the supplier."
- FR-NBY-005 An order created before the setting was turned on, and writes with no signed-in caller (imports), shall never be blocked.
- FR-NBY-006 Once the order is sent the dates are frozen. Nobody writes the header date directly.
- FR-NBY-007 While the setting is off, no purchase screen shows the panel (default-off for every existing organisation).

## Acceptance criteria (owning layer)
- AC-NBY-001 pgTAP `2102`: default off, an order is sent without a date.
- AC-NBY-002 pgTAP `2102`: only an Admin turns it on; the moment is kept.
- AC-NBY-003 pgTAP `2102`: with it on, an order without the date cannot be sent, and with the date it can.
- AC-NBY-004 pgTAP `2102`: the date fills every line; a line keeps its own date; moving the header moves the lines that followed it.
- AC-NBY-005 pgTAP `2102`: an order created before the rule is never blocked.
- AC-NBY-006 pgTAP `2102`: no hand writes, strangers refused, frozen after sending.
- AC-NBY-007 pgTAP `2102`: another organisation changes and reads nothing.
- AC-NBY-008 unit `procurementNeededBy.test.ts`; AC-NBY-009 unit `OrderNeededByPanel.test.tsx`; AC-NBY-010 unit `OrgOrderNeededBy.test.tsx`.

## Mutation checks (written here, run by the orchestrator)
`mut:required`, `mut:setting_admin`, `mut:write_path`, `mut:who`, `mut:frozen`, `mut:line_exempt` in `2102_order_needed_by.sql`; each alone must turn the assertion named in the test header red.
