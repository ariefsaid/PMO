# Vendor bill job roles

## Requirements

- FR-VBJR-001: When an equipment officer or buyer opens a vendor bill, the system shall allow the person to read its match, subject to organisation and price-visibility rules.
- FR-VBJR-002: When an equipment officer records a supplier bill, the system shall use the existing bill origination states and validations.
- FR-VBJR-003: When a buyer inspects a purchase, the system shall show its vendor bills and paid status, subject to organisation and price-visibility rules.
- FR-VBJR-004: The system shall preserve separation of duties for match exceptions and shall not grant payment or exception approval to either job role.

## Acceptance

- AC-VBJR-001: Given a bill in the organisation, when an equipment officer or buyer opens its match, then the match is readable under the applicable price rule.
- AC-VBJR-002: Given an eligible purchase, when an equipment officer records a bill, then the bill is created through the existing origination path.
- AC-VBJR-003: Given either job role, when the person attempts to approve a match exception or record payment, then the system refuses; given a bill author who has an approver role, when they attempt to approve its exception, then the system refuses.
- AC-VBJR-004: Given a buyer and a purchase with bills, when the buyer opens the purchase, then its bills and paid status are visible.
- AC-VBJR-005: Given an unrelated role, when the person requests a bill match, then the system refuses.
