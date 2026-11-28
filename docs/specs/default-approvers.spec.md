# Default approvers

## Requirements

- FR-001: When ordering roles are unset, the portal shall permit the Buyer job role to order approved purchases. An explicit Admin selection, including an empty selection, takes precedence. Existing empty selections migrate to unset; a future empty selection is explicit. Admins can reset to the default.
- FR-002: When a purchase reaches the project approval route and no named project approver exists for its tier, the portal shall route goods to the project deputy, or its project manager if no deputy is assigned, and services and rentals to active Procurement Manager job-role holders in the organisation.
- FR-003: When the requester is the only default candidate or no candidate exists, the portal shall fall back to the existing Admin path. The requester shall never approve their own request.
- FR-004: The portal shall preserve senior-first escalation for over-budget and unknown-figure purchases. Expense routes remain unchanged.
- FR-005: The portal shall include Project Control Manager in the default quantity-change approver roles, subject to the existing author, editor and submitter separation of duties.

## Acceptance criteria

- AC-001: Given unset ordering roles, when a Buyer orders an approved purchase, then the ordering action is allowed; given an explicit empty list, it is refused for a Buyer without other authority.
- AC-002: Given an Admin selection, when it is saved or reset, then the saved selection or default respectively governs ordering.
- AC-003: Given a within-budget goods purchase with no named project approver, when it is submitted, then the eligible deputy (or project manager if no deputy) is routed.
- AC-004: Given a within-budget service or rental purchase with no named project approver, when it is submitted, then active Procurement Manager holders are routed.
- AC-005: Given the requester is the only eligible default or no eligible default exists, when a purchase is submitted, then the Admin route is used.
- AC-006: Given an over-budget purchase with configured senior approvers, when it is submitted, then it routes to the senior set before any project default.
- AC-007: Given a quantity change created or edited by another user, when an eligible Project Control Manager reviews it, then the review is allowed; the author, editor and submitter cannot review their own request.

## Notes

- A purchase type counts as a service when `purchase_types.is_service` is set (seeded for the starter Service type, backfilled for existing ones); rentals use `is_rental`. Anything else is goods. An Admin control for `is_service` is a follow-up.
- The default applies only inside the within-budget project route. Over-budget and unknown-figure purchases keep senior-first routing; claims, imprest and projectless purchases keep today's routing.
