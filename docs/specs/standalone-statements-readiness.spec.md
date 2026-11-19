# Standalone financial statements readiness (#1494)

**Status: unsigned proposal for owner decision; not a build authorization or roadmap schedule.** OD-FS-023 parks independent statement calculation. OD-VISION-ERP records the standalone ERP destination and requires a future native-ledger ADR and roadmap map; it does not schedule either. The connected ERP remains authoritative for the domains assigned to it. This proposal does not amend either ruling.

## Job and boundary

When Finance prepares a period's accounts for an organization without an ERP, they need a trustworthy trial balance, profit and loss and balance sheet in PMO, with clear source and period, so they can understand the organization's financial position. Operational invoices, receipts, paid purchases and budget categories alone are not a complete accounting basis. Until an approved complete source exists, the honest interim is the existing unavailable state; a retained, eligible historical ERP publication remains an ERP-sourced historical report, not a PMO-generated statement or evidence of current books. No new import or manual statement workflow is authorized by this proposal.

## Proposed requirements (conditional on owner sign-off)

- **FR-SSR-001:** While a complete, authorized statement source for the selected organization, scope and period is unavailable, the system shall show statements as unavailable and shall not present operational aggregates as a trial balance, profit and loss or balance sheet.
- **FR-SSR-002:** When displaying a retained connected-ERP publication, the system shall identify its source and original acquisition/publication time and shall not represent it as newly calculated from PMO records.
- **FR-SSR-003:** Where the owner approves a native accounting source, the system shall produce statements only from a complete, reconciled and explicitly identified accounting basis for the chosen organization, period and currency, using approved accounting rules and a traceable source generation.
- **FR-SSR-004:** When a required input, mapping, opening position, or approved basis is incomplete or cannot be reconciled, the system shall withhold the affected native statement and explain its availability without substituting zero or an operational estimate.
- **FR-SSR-005:** When statement source ownership changes, the system shall preserve the source and period of each publication and shall not combine sources or duplicate opening/history amounts without an approved reconciliation and cutover rule.
- **NFR-SSR-001:** The system shall enforce organization, role and project scope at the authoritative read/write boundary and retain audit evidence sufficient to trace each published amount to its approved source.
- **NFR-SSR-002:** Connected ERP reports shall retain the existing preservation, publication and privacy contracts in `financial-statements.spec.md`; native reporting shall not change their values or provenance.

## Acceptance and proof ownership

| ID | Given / When / Then | Lowest sufficient owner |
|---|---|---|
| AC-SSR-001 | Given no eligible complete source for a selected period, when Finance opens statements, then the period is unavailable and no operational estimate is labeled as a statement. | Unit/RTL availability and display |
| AC-SSR-002 | Given an eligible retained ERP publication, when Finance opens it, then its ERP source and original time are shown and it is not described as current native accounting. | Unit/RTL provenance |
| AC-SSR-003 | Given an approved complete native basis and independently agreed accounting examples, when a statement is generated, then its amounts and traceable generation match those examples. | Unit calculation oracle, after rules are decided |
| AC-SSR-004 | Given incomplete mapping, opening position or failed reconciliation, when publication is attempted, then the affected result is withheld and no fabricated zero is published. | Integration/pgTAP publication contract |
| AC-SSR-005 | Given an approved cutover and reconciled opening/history, when ownership changes, then a publication uses the authorized source once and identifies its source and period. | Integration/pgTAP cutover contract |
| AC-SSR-006 | Given authorized and unauthorized roles, projects and organizations, when statement detail or totals are read, then only the authorized scope is returned. | Integration/pgTAP authorization |
| AC-SSR-007 | Given an approved native basis with published statements, when Finance selects a period and opens each statement, then the displayed values and provenance match that publication. | Curated E2E cross-stack journey |

## Decision gates and candidate slices

1. **Owner decision, no build implied:** confirm destination and priority; decide source-of-truth, initial statement scope, currencies, periods and accountant-validated reporting rules. Specify completeness and reconciliation criteria, opening balances, historical data, adjustments, corrections and close. Decide chart/account ownership and mapping review, posting sources and timing, roles, and standalone-to-connected cutover/duplicate prevention. Specify whether any external statement upload is desired separately; no such workflow is assumed.
2. **Architecture gate:** if native accounting is authorized, write and approve the native-ledger ADR and roadmap map required by OD-VISION-ERP. Specify balanced posting, source coverage, idempotency, reversals, audit, tenancy, and migration/cutover; define each posting event and financial rules with the owner and accountant. Dependencies: decision 1. Proof: design review plus independently specified posting and reconciliation examples.
3. **Readiness and provenance:** after sign-off, implement only the approved availability/source messaging and source-specific publication contract. Dependencies: accepted source and UX. Proof: AC-SSR-001/002/006 and connected-report regression.
4. **Accounting foundation and source coverage:** only after gate 2, deliver separately reviewable account setup, opening balances and each approved transaction-to-posting slice; reconcile each before enabling reporting. Dependencies: approved ADR and source-specific rules. Proof: pgTAP posting, balance, idempotency, reversal, tenancy and reconciliation tests; do not infer completeness from a single operational domain.
5. **Native report publication:** after every required source and reconciliation gate for a defined period is satisfied, add report calculation, complete publication, source provenance and Finance journey. Dependencies: slices 2–4 and accountant-approved examples. Proof: AC-SSR-003–007; retain connected-report contracts. Sequencing is dependency ordering only, not scheduling or approval.
