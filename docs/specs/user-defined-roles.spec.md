# User-defined roles — proposed specification

**Status:** Draft for Director and owner review; #902, #905–#908, #1407, #1409.
**Design:** ADR-0103. Existing owner rulings remain binding; proposed defaults below are not yet rulings.

## Job story

When an organisation's work is divided among people with different responsibilities, an Admin wants to copy a familiar role and adjust what it can do on each module and project, so each person can do their job and approvals reach an eligible person.

## Requirements

- **FR-001** The system shall provide an org-scoped catalogue of distinct module/action permissions and organisation or assigned-project scope where applicable; absent, unknown or invalid grants deny.
- **FR-002** When an Admin copies a preset, the system shall create an independent role with its grants and rank; the five initial presets shall preserve the existing server and FE outcomes independently.
- **FR-003** When an authorised Admin edits or assigns a role, the system shall validate same-org ownership, protected administration, rank and audit the before/after values; a user shall hold one role in this release.
- **FR-004** While a grant is scoped to assigned projects, the system shall allow only records belonging to projects whose explicit team includes the actor; the named PM shall always be included (OD-ROLE-2). Organisation-only records cannot use assigned-project scope.
- **FR-005** When a permission or membership changes, subsequent transactions shall resolve the current server-side state; client impersonation and cached UI state shall not confer write authority.
- **FR-006** The system shall preserve existing lifecycle, assignment, rank, approval floor, separation-of-duties and explicitly authorised exceptions independently of grants.
- **FR-007** When an approval is requested, the system shall resolve configured document-type, currency, amount-band and project/organisation routes as additional restrictions, using the same eligible set for the transition and notifications. Band lower bounds are inclusive and upper bounds exclusive; overlapping bands for the same matching dimension shall be rejected. No currency conversion is implicit.
- **FR-008** While amount, currency, route or eligible approver is missing or ambiguous, the system shall refuse approval and present a route-configuration escalation, except for a separately authorised existing fallback.
- **FR-009** When the Admin opens Roles, the system shall show roles and assignment counts, offer copy-from-preset, name and rank, and a module × action grid with off / assigned projects / organisation controls; incompatible scopes shall be unavailable and explained. Locked independent SoD and approval rules shall be explained beside the grid; save errors and unsaved changes shall be visible.
- **FR-010** When an assigned role is archived, the system shall refuse and explain reassignment; an Admin shall not remove the last active administrator or protected recovery authority.
- **FR-011** The system shall support configuring #1407's organisation-wide project and procurement access and budget activation subject to editor SoD, without overhead or company finance access; #1409 shall support project administration and requests without approval rights. Exact ranks and final grants require owner review.
- **NFR-001** RLS, RPCs and server consumers shall enforce permissions on the real active actor and same-org record; the FE is an affordance only (ADR-0016).
- **NFR-002** The system shall preserve existing grants, independent safeguards and reachable behaviour through a catalog-derived parity proof before cut-over; performance shall be measured on representative procurement lists.
- **NFR-003** The role editor shall be keyboard operable, accessible and responsive using existing design tokens and form patterns.
- **NFR-004** Field-level permissions, multiple roles per user, per-user overrides and platform-operator roles are out of scope.

## Acceptance criteria and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-001 | Given each built-in role and each inventoried permission/context at schema head, when the new evaluator is compared with the independently captured server baseline, then all reachable outcomes match. | pgTAP |
| AC-002 | Given a preset, when an Admin copies and edits it, then the copy changes and the source does not. | pgTAP |
| AC-003 | Given an assigned-project grant and two projects, when a member accesses each, then only the team project is allowed and the named PM is included. | pgTAP |
| AC-004 | Given an active user with a grant, when an Admin revokes it, then the next transaction denies access without JWT refresh. | pgTAP |
| AC-005 | Given foreign-org, inactive, unknown and missing-context inputs, when a grant is evaluated, then access is denied. | pgTAP |
| AC-006 | Given an approval grant, when the actor is barred by existing SoD, rank, assignment or lifecycle rules, then the action remains barred, subject only to existing authorised exceptions. | pgTAP |
| AC-007 | Given adjacent amount bands for a document and currency, when an amount equals the boundary, then exactly the upper band applies; overlapping bands are rejected. | pgTAP |
| AC-008 | Given an unknown amount, unmatched route or empty eligible set, when approval is attempted, then it is refused with escalation unless an existing authorised fallback applies. | pgTAP |
| AC-009 | Given a configured route, when eligibility is resolved for a transition and its notification, then both use the same eligible people. | pgTAP |
| AC-010 | Given a role assigned to a user or the last active Admin, when an Admin attempts archive or removal, then the operation is refused and existing access remains. | pgTAP |
| AC-011 | Given an Admin editing a copied role, when they select module actions and scopes and save, then reopening displays the saved selections and locked-rule explanation. | E2E |
| AC-012 | Given an impersonating Admin, when a write is attempted, then server authority uses the real actor and the UI makes view-as state clear. | E2E |
| AC-013 | Given the proposed operational manager and project admin configurations, when their project, finance and approval permissions are evaluated, then they meet FR-011 including editor SoD. | pgTAP |
| AC-014 | Given the existing five presets, when each existing affordance is evaluated, then it matches its captured FE baseline even where that is stricter than the server. | unit |
| AC-015 | Given a role editor in loading, empty, validation-error or save-error state, when operated by keyboard, then the state is announced and controls remain usable. | unit |
| AC-016 | Given a cross-org assignment, rank escalation or self-escalation, when an actor attempts it, then the write is refused and the prior state remains. | pgTAP |

## Decisions for owner before build

Approve the proposal in ADR-0103: preset mutability and recovery, custom rank placement, route-band precedence and no-route behavior, integration with existing budget routing and its exceptions, and exact #1407/#1409 grants. #908 still needs its owner sketch-glance; this specification does not claim visual approval. Parity preserves both server and stricter UI results rather than silently choosing one. A historical catalogue must be refreshed at implementation head before defining concrete grant rows.
