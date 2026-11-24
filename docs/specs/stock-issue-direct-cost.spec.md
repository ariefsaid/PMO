# Stock issue direct cost

FR-ISC-001: When an Admin enables stock issue costing with an effective date, the system shall count posted issues and returns on or after that date at their existing ledger value (moving average at issue, original issue value at return).
FR-ISC-002: While enabled on the PMO-paid basis, the system shall exclude a whole purchase from purchase costs when it has a Posted receive on or after the effective date. Direct deliveries retain existing treatment.
FR-ISC-003: When enabling with an earlier Posted purchase receipt whose purchase has counted bill/payment cost, the system shall refuse and request stock-cost migration first.
FR-ISC-004: When an ERP-ledger organisation requests enabling, the system shall refuse. No setting means off. Existing role, price and tenancy boundaries remain authoritative.
FR-ISC-005: While enabled, every work-order money reader and project total shall compose the same stock cost rows and purchase classifier.

## Acceptance (pgTAP owning layer)
- AC-ISC-001: Given no setting, when costs are read, then existing totals are unchanged.
- AC-ISC-002: Given a stocked purchase, two work-order issues and a return, when read, then work orders plus unissued stock equal the purchase once; the project total equals work orders plus direct deliveries.
- AC-ISC-003: Given a pre-cutover costed purchase receipt, when enabling, then migration is required; clean opening balances pass.
- AC-ISC-004: Given another organisation or a role without cost access, when reading or changing settings, then the existing boundary holds.
- AC-ISC-005: Given an ERP-ledger organisation, when enabling, then it is refused and existing ERP reads remain unchanged.

## Director decisions and known limits
Effective date applies to issue/return dates. Purchases received before cutover keep current treatment. Mixed stocked/direct lines in one purchase use whole-purchase exclusion; the classifier is one replaceable function. ERP reconciliation and migration of historically costed stock are follow-ups. No dependency on the receive-against-order branch.
