# ADR-0124: Order receipt valuation snapshots

Date: 24 November 2026. Status: accepted by Director ruling for the receive lane.

For organisations where PMO owns both purchasing and inventory, receive-against-order is an optional organisation setting. The receiving quantity is valued in organisation currency from the order line rate, using `fx_rate_on(order currency, organisation currency, receipt date)`. Same-currency conversion is 1. Absence refuses the receipt with the currency pair and date. The receipt stores both the applied rate and its publication date; later reference corrections do not revalue posted stock.

This is an additional, narrowly scoped use of the selector from ADR-0085. Its other consumers remain display equivalents. Supplier bills and three-way match continue to compare purchase-currency values, without conversion or a changed date policy. Connected inventory retains its accounting-system valuation authority and cannot enable this mode.

Purchasing owns the stock mapping before a receiver records a count. Pending counts freeze the mapping too, so approving an excess cannot approve a different item's stock. Counts and excess approvals are immutable witnesses. Posting reuses the stock engine's single ledger writer. A correction makes a separately attributed movement at the stock engine's existing moving-average rule and removes the reversed receipt from the match's available received quantity; its original evidence remains intact.

An excess approval snapshots the excess quantity per order line, under the same purchase lock that serializes receipt posting. If another receipt increases that excess before this count posts, it returns for review. A new approval appends a new immutable snapshot; the earlier decision stays recorded. The receiving reader and the shared purchasing inbox use the same current-approval predicate.
