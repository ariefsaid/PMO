# Planning rights and expiry recipients

FR-SR-001: When an active Project Control Manager or Planner edits a work-order revenue target, the system shall permit the edit within their organisation, preserving feature, frozen-work-order and field-account restrictions.
FR-SR-002: When a Planner plots crews against work orders, the system shall allow placement creation and end-date edits, without granting worker membership or crew-master writes.
FR-SR-003: When a Planner opens a work-order revenue plan, the system shall return that plan, without granting general revenue or cost reads.
FR-SR-004: When an Equipment Officer requests equipment availability and use figures, the system shall return operational figures within their organisation, without granting cost reads.
FR-SR-005: When medical expiry warnings run, the system shall notify the people-right holders and direct manager, excluding the worker before release approval; managers without document rights shall receive plain notices. Other types shall retain their per-type person switch.

| Acceptance | Given / When / Then | Owning proof |
|---|---|---|
| AC-SR-001 | Given PCM and another project's manager, when PCM sets a target, then it persists and unrelated roles and organisations remain refused. | 2515_source_role_rights pgTAP |
| AC-SR-002 | Given Planner, when plotting a crew, then the placement persists and worker membership stays refused. | 2515_source_role_rights pgTAP |
| AC-SR-003 | Given Planner, when setting monthly and daily targets, then edits persist and only work-order plan reads are admitted. | 2515_source_role_rights pgTAP |
| AC-SR-004 | Given Equipment Officer, when reading monthly figures, then operational figures are returned without cost authority. | 2515_source_role_rights pgTAP |
| AC-SR-005 | Given a medical expiry and worker login, when warnings run, then people team and manager receive warnings and the worker receives none. | 2382_medical_warning_recipients pgTAP |

Project-role assignment is a later refinement; existing organisation scope applies. Existing approval workflows are unchanged; work-order revenue target entry has no approval transition.
