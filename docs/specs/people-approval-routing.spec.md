# People approval routing

## Functional requirements

- **FR-PEO-001** When a leave request is pending, the active manager on the person's record is its only decider. If that manager is missing, inactive, the person themself, or the request entrant, the request routes to active HR Managers; if there are none, it routes to active Admins. A person and the request entrant can never decide it.
- **FR-PEO-002** When a leave request is submitted, each person in its resolved decision route receives a notice, and only that route can see it in the waiting list. The request list names the people who must act.
- **FR-PEO-003** When a consumable plan is generated or edited, it remains pending until an eligible approver other than its creator approves the current plan. Generation records the generator as creator for that plan version; later line edits retain the creator and role route. PCM approves Engineer-authored plans; an Admin or the project's PM approves a PCM-authored plan. Material requests use a stored plan only while its approval fingerprint matches the current plan inputs.
- **FR-PEO-004** When an inspection purchase is raised by a Quality Inspector, a Quality Manager or a higher authorized approver may approve it, and the requester cannot approve it.
- **FR-PEO-005** When any work-order close-out checklist item is completed, it has an attached project document and is completed by its named owner job role.

## Acceptance criteria

- **AC-PEO-001** Given a worker with an active manager on `people.manager_id`, when a leave request is pending, then that manager can decide it and an unrelated Project Manager cannot; the manager receives the pending notice.
- **AC-PEO-002** Given a worker with no active manager, when a leave request is pending, then active HR Managers receive the notice and can decide it; when no active HR Manager remains, active Admins receive the notice and can decide it. The employee and request entrant cannot decide it.
- **AC-PEO-003** Given a consumable plan author and an eligible approver, when the approver tries to approve the current plan, then the author is refused, a PCM may approve an Engineer-authored plan, and Admin or the project's PM may approve a PCM-authored plan. Requests ignore an unapproved or stale plan and use the existing allowance fallback.
- **AC-PEO-004** Given an inspection purchase raised by a Quality Inspector, when it is Requested, then the inspector cannot approve it and its Quality Manager can.
- **AC-PEO-005** Given an incomplete close-out item, when its named owner role tries to complete it without a document, then the write is refused; after attaching a document, that owner role can complete it.
- **AC-PEO-006** Given a PCM-authored plan, when its project manager is absent or cannot be resolved in the work order's organisation, then a Project Manager cannot approve it; an Admin can.
- **AC-PEO-007** Given a PCM-generated plan, when an Engineer edits one of its lines, then the original creator and PCM approval route remain; the creator and another PCM are refused, while an Admin or the project's PM can approve.
