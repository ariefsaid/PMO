# Feature: PMO Project Numbering (#771)

## Overview

PMO assigns each project a human-readable project number that can follow an organisation-configured
pattern. The number is independent from the organisation's own project code and from identifiers
assigned by connected external systems, so users can refer to a project from either side without
overloading one value.

## Domain Rules

- **OD-ID-1 is authoritative.** The PMO Project Number is minted by PMO. The Client Project Code is
  supplied by the organisation. An external system's identifier remains in the external-reference
  seam. These values are independent and must never be derived from or copied into one another.
- The Client Project Code remains optional, free-form, unique within its organisation, and visible
  alongside the PMO Project Number.
- A project's PMO Project Number is stable after it is assigned. Changing the organisation's
  pattern or a company's client-number segment affects future proposals only.
- The running sequence is scoped to one organisation and business year, shared across its companies,
  and allocated atomically so concurrent project creation cannot receive the same number. Gaps are
  allowed when a proposal is edited or a project form is abandoned.

## Functional Requirements

### FR-PNO-001: Configure an organisation's pattern

While an Admin edits organisation settings, when they save a valid project-number pattern, the
system shall persist that pattern for the same organisation. A valid Admin-defined pattern supports
literal text plus exactly one each of `{CLIENT}`, `{YY}`, and `{SEQ4}`. `{CLIENT}` resolves to the
selected company's client-number segment; `{YY}` resolves in the organisation's business timezone;
`{SEQ4}` is zero-padded to at least four digits and expands past four digits without truncation.
Unknown tokens, duplicate required tokens, and unmatched braces are invalid. The initial system
default is `PRJ-{YY}-{SEQ4}` so project creation works before an Admin saves a custom pattern; this
default does not count as an Admin-defined pattern and does not require a company-specific segment.

### FR-PNO-002: Maintain a company-specific segment

While an authorised user edits a company, when they save its client-number segment, the system shall
store the segment on that company within the current organisation. When a pattern uses this segment
and the selected company has none, the project form shall explain that the segment must be set before
it can propose a number.

### FR-PNO-003: Propose and persist a PMO Project Number

When an authorised user starts creating a project, the system shall propose the next PMO Project
Number from the organisation's pattern and the selected company's segment. The user may edit the
proposal before saving. When the project is saved, the system shall enforce organisation-scoped
uniqueness at the data boundary and return an actionable conflict if that number is already in use.

### FR-PNO-004: Keep existing project codes intact

When project numbering is introduced, the system shall preserve every existing Client Project Code
unchanged and assign existing projects a separate PMO Project Number without changing their record
identity or relationships. Existing projects receive numbers using `PRJ-{YY}-{SEQ4}`, their
creation year in the organisation's business timezone, and a stable ordering within each
organisation/year. The sequence counter then continues after the highest number assigned for that
organisation/year.

### FR-PNO-005: Display and search both identifiers

When a user views or searches projects, the system shall show the PMO Project Number and, when
present, the Client Project Code as separate values, and project search shall match either value.

## Non-Functional Requirements

### NFR-PNO-001: Tenant isolation

Pattern settings, company segments, project numbers, and Client Project Codes shall remain scoped to
the authenticated organisation. The server and database remain authoritative for organisation
membership, write access, and uniqueness; the client must not supply or override `org_id`.

### NFR-PNO-002: Predictable year boundary

The two-digit year and annual sequence boundary shall use the organisation's configured business
timezone. If the application has no configured timezone for an organisation, use UTC explicitly;
never use the host machine's local timezone.

### NFR-PNO-003: Stable project identity

Assigning or changing a PMO Project Number shall not change a project's internal identity, route,
external references, or existing relationships.

## Acceptance Criteria

### AC-CODE-001: Admin defines the organisation's number pattern

Given an Admin is editing the organisation's project-number settings,
when they save a pattern containing literal segments, the client-number segment token, a two-digit
year, and a zero-padded yearly sequence,
then the pattern is saved for that organisation and is available when a project is created.

### AC-CODE-002: Project creation proposes an editable unique PMO number

Given the organisation has a valid project-number pattern and the selected company has any required
client-number segment,
when an authorised user creates a project,
then the next PMO Project Number is proposed, the user can edit it, and saving succeeds only when
the chosen number is unique within that organisation.

### AC-CODE-003: Optional Client Project Code is visible and searchable

Given a project has an optional Client Project Code,
when a user views or searches the project,
then the PMO Project Number and Client Project Code are shown separately and searching by either
value finds the same project.

## Error Handling

| Condition | Expected behavior |
|---|---|
| Invalid pattern | Keep the current setting and show an inline explanation of the invalid token or format. |
| Pattern requires a missing company segment | Do not invent a segment; explain how to add one on the company. |
| Duplicate PMO Project Number | Reject the write at the database boundary and let the user correct the value. |
| Duplicate Client Project Code within the organisation | Reject the write using the existing organisation-scoped uniqueness behavior. |
| Unauthorised pattern or segment write | Refuse it using the existing server authorization and RLS conventions. |

## Implementation TODO

### Backend and data

- Add the organisation's project-number pattern and company-specific segment using the existing
  repository and tenant-boundary patterns.
- Add a PMO Project Number distinct from the Client Project Code and external-system identifiers.
- Assign a distinct PMO Project Number to existing projects while preserving their existing codes,
  IDs, and relationships.
- Allocate yearly sequences atomically and enforce uniqueness in the database.
- Keep all reads and writes within the authenticated organisation and existing role policy.

### Frontend

- Add Admin controls for the organisation pattern and a company field for the optional segment.
- Show the proposed, editable PMO Project Number and the separate optional Client Project Code on
  the project form.
- Show and search both values in the Projects surface, with accessible validation, loading, empty,
  and error states.
- Extend the incumbent UI with the shared form components and `DESIGN.md` tokens; do not redesign
  the application shell.

### Testing

- Cover each AC at its lowest sufficient owning layer and include the AC identifier in the test name.
- Prove organisation scoping, Admin-only configuration, atomic sequence allocation, and database
  uniqueness with pgTAP where those database contracts apply.
- Cover pattern parsing, proposal display/editing, client-code display/search, and form states with
  focused Vitest/RTL tests where those behaviors are owned.
- Run the touched E2E journey only if the plan determines an AC requires a real cross-stack proof.

## Out of Scope

- Changing the meaning of OD-ID-1 or reusing a Client Project Code or external-system identifier as
  the PMO Project Number.
- Changing project UUIDs, routes, lifecycle rules, or unrelated project/company behavior.
- Adding custom per-project identifier fields beyond the PMO Project Number and Client Project Code.
- Redesigning the application shell or introducing a new dependency.

## Open Questions

None. The pattern is configurable by an organisation Admin, and OD-ID-1 decides the relationship
between the PMO Project Number, Client Project Code, and external identifiers.
