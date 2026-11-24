# Receive goods against an order

Job story: When goods arrive at my warehouse, I want to record what I counted against the sent order, so stock and purchasing share one receipt without asking me to enter prices.

## Requirements

- FR-RGO-001: While an organisation has receive-against-order enabled, the system shall let its warehouse keeper record counted quantities against mapped lines of an approved, sent purchase order.
- FR-RGO-002: While the setting is disabled (the default for existing organisations), the system shall retain the existing receiving path.
- FR-RGO-003: When a purchasing-rights user maps an order line to a stock item, the system shall verify both belong to the same organisation. While a receipt exists for that line, the system shall refuse mapping changes. The receiver shall have no mapping write authority.
- FR-RGO-004: While a line has no stock mapping, the receiving screen shall explain that it follows the existing service or direct-to-work-order path.
- FR-RGO-005: While the actor is a storekeeper, receiving reads shall return item identity and unit without ordered quantity, outstanding quantity or price. Purchasing users shall see ordered, received and outstanding quantities and not-received, partly-received or fully-received status.
- FR-RGO-006: When a receipt is posted, the system shall derive unit cost from the order line, converting to the organisation's default currency at the receipt date using `fx_rate_on`; same-currency receipts shall use 1. It shall snapshot the applied rate and publication date. When no rate exists, the system shall refuse with the currency pair and date in a plain message.
- FR-RGO-007: When a receipt exceeds outstanding quantity, the system shall require approval of that excess by a different person with purchasing rights. Concurrent receipts shall serialize against the same order before evaluating outstanding quantity.
- FR-RGO-008: When a receipt is recorded, the existing three-way match shall consume its counted order-line quantities. Existing receipts shall preserve their match behaviour.
- FR-RGO-009: While a bill is matched to a receipt, the system shall refuse receipt edits. Corrections shall use a separately attributed reversing movement.
- NFR-RGO-001: The database shall enforce tenancy, mapping authority, order-derived cost and separation of duties through every granted write path.
- NFR-RGO-002: Receipt posting shall be atomic and idempotent and shall use the existing stock ledger writer.

## Acceptance (owning layer: pgTAP unless noted)

- AC-RGO-001: Given an existing organisation, when its setting is read, then receive-against-order is off and its old receipt flow remains available.
- AC-RGO-002: Given a purchasing user and a line without receipts, when they assign a same-organisation stock item, then the mapping is saved; a receiver and a cross-organisation mapping are refused.
- AC-RGO-003: Given a recorded receipt, when anyone tries to change its line's mapping, then the change is refused.
- AC-RGO-004: Given a storekeeper and an enabled organisation, when all granted receiving table, view and function reads are exercised, then no ordered or outstanding quantity or price is returned.
- AC-RGO-005: Given an order line and a receipt date, when the counted quantity is posted, then its stock value equals the order rate times the snapshotted receipt-date currency conversion times quantity, with stock-engine rounding.
- AC-RGO-006: Given a foreign-currency order with no applicable rate, when receipt posting is attempted, then it fails atomically and names the pair and date.
- AC-RGO-007: Given a partial receipt, when purchasing reads the order, then received and outstanding totals and the partial status agree with its receipt lines.
- AC-RGO-008: Given an excess count, when no distinct purchasing approver has approved that exact excess, then posting is refused; the receiver cannot approve it themselves.
- AC-RGO-009: Given an old receipt and bill, when matching runs, then its result remains unchanged; a new receipt contributes exactly once.
- AC-RGO-010: Given a matched receipt, when an edit is attempted, then it is refused; a new reversal preserves the original audit evidence.
- AC-RGO-011: Given another organisation's identifiers, when receiving or approval is attempted, then neither reads nor writes cross the organisation boundary.
- AC-RGO-012 (component): Given an unmapped line, when receiving renders in English or Bahasa, then it explains why that line is not received into stock and offers no stock-item or price input.

## Director rulings, 24 November

Purchasing maps the line before receipt; the receiver never chooses the stock item. Unmapped lines retain today's service/direct-use behaviour. Conversion uses the receipt date, snapshots its rate, refuses missing rates and does not change supplier bills or the existing match's currency rules.

## Prior-art boundary

`scripts/prior-art.sh fx_rate_on` identifies ADR-0085 and migration 0291. ADR-0085 defines JISDOR as a display equivalent; the new receipt valuation is an explicitly authorised additional use. Migration 1018's match compares quantities and rates in the purchase currency; migration 0349 refuses a bill in a different purchase currency. Those rules remain as shipped.
