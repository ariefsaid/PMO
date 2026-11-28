# Job role step rights

The job roles performing work order preparation, scheduling, reporting and attendance review need the corresponding actions in the portal. Existing approval and organisation boundaries continue to apply.

## Requirements

- FR-001: When an engineer captures or edits a work order, the system shall permit the action only while it is a Draft and shall preserve the existing issuance rule.
- FR-002: When an engineer opens a rate catalogue, the system shall permit its read subject to the organisation's price visibility rule.
- FR-003: When an engineer sets a work order's area or check-in point, the system shall save valid values for that organisation.
- FR-004: When an engineer plans a work order, the system shall permit reading and writing its plan figures.
- FR-005: When an engineer reviews billing, the system shall permit reading progress claims and billing steps without granting a write action.
- FR-006: When a planner schedules work, the system shall permit linking tasks to work orders and managing task dependencies.
- FR-007: When an HR officer reviews attendance, the system shall permit reading crew attendance without granting recording or approval.
- FR-008: When a project administrator reviews equipment hours, the system shall permit reading work-order usage.
- FR-009: When a project administrator schedules progress or summary emails, the system shall permit managing schedules created by that role, subject to recipient eligibility.
- NFR-001: The system shall retain active membership, organisation isolation, field-account restrictions and existing separation of duties.

## Acceptance criteria

- AC-RR-001: Given an engineer, when they capture and edit a Draft, then the Draft is saved and issuance remains separately controlled.
- AC-RR-002: Given an engineer, when they open the catalogue, then permitted rates are readable and catalogue writes remain restricted.
- AC-RR-003: Given an engineer and a work order, when they set its area and check-in point, then valid settings are saved.
- AC-RR-004: Given an engineer and a work order, when they save a plan figure, then it appears on that order.
- AC-RR-005: Given an engineer, when they open progress claims and billing steps, then they can read them without acquiring their write rights.
- AC-RR-006: Given a planner, when they link tasks and add a dependency, then the schedule is saved.
- AC-RR-007: Given an HR officer, when they open crew attendance, then recorded attendance is visible and approvals remain restricted.
- AC-RR-008: Given a project administrator, when they open work-order equipment usage, then recorded hours are visible.
- AC-RR-009: Given a project administrator, when they schedule progress and summary emails, then their schedules can be managed with eligible recipients.
