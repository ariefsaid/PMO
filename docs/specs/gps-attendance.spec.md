# Spec: GPS attendance and requests (#1517)

**Status:** proposed; all owner decisions below require sign-off before implementation. Route #1481, rulings #1496 and #1501; blocked by #1516 and #1520. IDs `FR-GPS-###`, `NFR-GPS-###`, `AC-GPS-###`. Director-dispatched SoD/auth work ships alone. This is a standard attendance workflow, independent of industry.

## Job story and outcome

When I arrive at or leave my assigned site, I want to record a clock event on my phone even without connectivity, and request leave or overtime through the existing approval experience, so that my attendance and request status are visible without treating an unverified location as confirmed. Success is a revalidated, attributed event and a visible decision for each valid request; neither an offline queue nor GPS alone is proof of work.

## Scope and dependencies

#1516 owns employee-to-user identity, effective-dated project/site assignment, roster and site geometry; this feature consumes its actual shipped contracts, not a second roster. #1520 owns the device queue, idempotent delivery, Needs fixing and action notifications; this feature registers clock events and uses its actual contract. Both are hard prerequisites for all slices. #902 owns configurable role matrix; register actions with its shipped interface when available, otherwise use the existing policy and server enforcement and make registration a release dependency. #1518 owns payroll: no salary, tax, payroll calculation or automatic timesheet generation here. Existing timesheets remain distinct records; no inferred approved hours. ADR-0094 makes attendance PMO-owned. Reuse ADR-0016 `can()` for affordances, ADR-0017 repositories, ADR-0018 archive where appropriate, ADR-0019 server-enforced SoD, the approvals inbox and the timesheet transition pattern. `spend_approval_route` is budget/amount-specific; do not invent monetary values or substitute it for a non-spend authority decision.

## Owner decisions (defaults are proposals, not rulings)

| ID | Decision requiring owner and, where applicable, Indonesian counsel | Recommended default | Named failure if wrong |
|---|---|---|---|
| OD-GPS-1 | Lawful basis and consent for employment location processing | Controller obtains counsel-confirmed basis and gives Indonesian-language notice before capture; if consent is the chosen basis, explicit granular opt-in with version, time and withdrawal, and a non-GPS manual review path. No GPS capture until configured and acknowledged. Device permission is not legal consent. | Forced or unrecorded consent can make employee location processing unlawful; refusing permission must not silently mark an employee absent. |
| OD-GPS-2 | Retention and legal holds | Proposed 90 days for raw coordinates after event capture, then irreversible purge; retain timestamp, assigned site and check outcome for 2 years, subject to counsel and applicable payroll/recordkeeping rules. Purge local queue on sync or cancellation and expire stale items after 30 days with visible warning; holds suspend server purge. | Keeping raw locations indefinitely exposes movements; purging too early can destroy evidence needed for disputes or statutory retention. |
| OD-GPS-3 | Location precision and geofence | Collect a single device fix at each clock action, its reported accuracy in metres, and site boundary; no background tracking. Store latitude/longitude rounded to five decimal places, accuracy and derived result. Evaluate the unrounded fix server-side before rounding. Site radius comes from #1516, never a hard-coded default. | Too coarse or uncertain a fix can misclassify a worker; excess precision reveals more than the attendance purpose requires. |
| OD-GPS-4 | Who sees raw location | Employee sees own evidence; explicitly authorized HR/attendance reviewers see only assigned-scope evidence; approvers see check outcome but not coordinates unless independently granted evidence access. Admin is not automatically a location viewer. Deny all other reads at server. | Broad access exposes employee movements; overly narrow access prevents legitimate dispute resolution. |
| OD-GPS-5 | Unavailable, inaccurate or outside location | Save no verified event; offer manual review request with reason, no fabricated coordinates. An accuracy circle fully inside the site radius is inside; fully outside is outside; any overlap is uncertain and requires review. | A borderline or denied fix marked verified can falsely certify presence; outright refusal without review can deny legitimate attendance. |
| OD-GPS-6 | Request routing and SoD | Requester submits leave/overtime online; an authorized manager in scope other than requester approves or rejects; if no eligible approver, remain submitted with explicit unassigned state. No self-approval or sole-user exception. | Self-approval permits unreviewed overtime or leave; no fallback can stall a real request. |
| OD-GPS-7 | Event ordering, timestamps and corrections | Store device occurrence time and server receipt separately; accept only alternating in/out for an employee, in occurrence-time order, within an effective assignment. A late or conflicting queued event enters Needs fixing; correction is a new audited review, never rewrite captured evidence. | Trusting device time as authoritative can reorder shifts; rejecting late legitimate events without recourse loses attendance. |

**Legal context, not legal advice:** [UU 27/2022 official text](https://jdih.komdigi.go.id/produk_hukum/view/id/832/t/crc32/) articles 20–22 address processing bases and notice/consent; articles 35, 43 and 44 address retention and ending processing. Applicable implementing rules and employment record obligations require counsel review; the proposed periods and basis above are not statutory conclusions. Controller must decide data subject rights, withdrawal, deletion and hold handling before release.

## Requirements (EARS)

- FR-GPS-001 When a signed-in employee initiates clock-in or clock-out, the system shall resolve their active #1516 identity and assignment at the captured occurrence time and display the assigned site and check outcome.
- FR-GPS-002 When a user opts into location capture under the configured lawful basis, the system shall request one device position and record occurrence time, accuracy, site and immutable check result; it shall never collect a continuous location trail.
- FR-GPS-003 When a fix is received, the server shall validate finite latitude −90..90, longitude −180..180, accuracy > 0, the assignment and the site's effective radius, and classify the accuracy circle per OD-GPS-5. Missing, outside or uncertain fixes shall not be represented as verified.
- FR-GPS-004 When location permission is refused, unavailable or the check fails, the system shall offer a reasoned manual review path and shall not assert absence or verified presence.
- FR-GPS-005 When an event is captured offline, the system shall queue a new event via #1520, display pending state, and on reconnect invoke the same server validation and authorization as a live submission. Rejection shall remain in Needs fixing with a reason; it shall not silently overwrite a record.
- FR-GPS-006 When the same client event identifier is retried, the system shall return the original result without a duplicate; conflicting payload reuse shall be rejected. Event ordering and corrections follow OD-GPS-7, with concurrent writes serialized per employee.
- FR-GPS-007 When a user requests leave or overtime, the system shall capture request type, date/time interval, reason and assignment/project, validate start < end and show Draft, Submitted, Approved or Rejected state and decision reason; submissions and decisions require a live connection.
- FR-GPS-008 When a request is submitted, the system shall place it in the existing approvals inbox for an authorized in-scope non-requester; a missing eligible reviewer shall be visibly unassigned. A server transition shall enforce active membership, scope, legal state transitions and SoD atomically and audit actor, time and decision; repeated decisions shall not create a second decision.
- FR-GPS-009 When a user views attendance or a request, the system shall enforce organization and action/scope authorization on every server read and mutation, including raw evidence, and expose coordinates only under OD-GPS-4. The client shall not send org_id as authority.
- FR-GPS-010 When evidence reaches its approved retention deadline, the system shall purge raw coordinates, including eligible device copies, except under a recorded legal hold; it shall retain the approved minimum attendance record and audit the purge without location data.
- FR-GPS-011 When a person withdraws consent where consent is the basis, the system shall stop new location collection and offer manual review; it shall route requests concerning past evidence to the controller's rights process rather than promise unconditional deletion.
- FR-GPS-012 When the employee opens attendance, the system shall show their events, pending sync/review and request decisions, including occurrence and receipt times separately. Approvers shall see only scoped requests and the result needed for their decision.

## Non-functional requirements

- NFR-GPS-001 RLS and RPC authorization shall enforce tenancy and least privilege independently of hidden UI controls; sensitive data shall not appear in logs or notifications.
- NFR-GPS-002 Timestamps shall be stored as instants with timezone-aware display; tests shall cover a midnight and DST boundary without inferring an untrusted device clock is correct.
- NFR-GPS-003 Offline event storage shall use #1520's identity-bound queue and deletion lifecycle; sign-out must not expose a previous user's queued records to a later user.
- NFR-GPS-004 The mobile flow shall support keyboard and screen readers, accessible permission/error messages and English/Indonesian copy. No third-party map request may disclose coordinates.

## Acceptance criteria and owning layer

- **AC-GPS-001 (pgTAP):** Given an employee with an effective site assignment, when a valid accurate clock-in is submitted, then one event is attributed to that assignment and classified inside with both times recorded.
- **AC-GPS-002 (pgTAP):** Given an outside, overlapping, invalid or unauthorized fix, when submitted, then it cannot become a verified event and the server returns a reason.
- **AC-GPS-003 (unit):** Given denied permission or an uncertain fix, when the employee clocks in, then a manual review action and reason are visible and no verified state is shown.
- **AC-GPS-004 (e2e):** Given a captured offline event, when the connection returns, then it syncs after server revalidation or remains in Needs fixing with its reason, and the employee sees its real state.
- **AC-GPS-005 (pgTAP):** Given concurrent or retried event submissions, when the same identifier or invalid sequence is sent, then at most one valid event exists and conflicting payloads are rejected.
- **AC-GPS-006 (e2e):** Given an assigned employee, when they submit leave or overtime online, then the eligible reviewer sees it in the existing inbox and the employee sees the resulting approval or rejection.
- **AC-GPS-007 (pgTAP):** Given a submitted request, when its requester, an out-of-scope user or another organization attempts a decision, then no decision is made; a qualified reviewer can decide once.
- **AC-GPS-008 (pgTAP):** Given own, scoped reviewer and unprivileged users, when raw location evidence is read, then only the owner and specifically authorized scoped reviewers receive coordinates.
- **AC-GPS-009 (pgTAP):** Given expired evidence and an active legal hold, when the retention job runs, then unheld raw coordinates are purged, held evidence remains, and the minimum record survives.
- **AC-GPS-010 (unit):** Given consent is withdrawn or collection is not configured, when capture is attempted, then GPS is not requested and the manual path is offered.
- **AC-GPS-011 (pgTAP):** Given no eligible reviewer or an invalid request interval, when submitted, then the former remains visibly unassigned and the latter is rejected without a decision.
- **AC-GPS-012 (unit):** Given occurrence and receipt on different dates, when attendance is displayed, then both instants are labelled in the selected timezone without claiming receipt is occurrence.

## Errors and recovery

| Condition | User-visible result / recovery |
|---|---|
| Location permission, unavailable fix or ambiguous boundary | Explain the outcome and offer manual review; do not claim verified attendance. |
| Assignment changed, stale offline event or sequence conflict | Keep in #1520 Needs fixing with the server reason; allow correction/review, never silent discard. |
| Offline request decision | Disable online-only operation and retain draft locally only if #1520 supports it; never claim submitted. |
| No eligible approver | Show submitted/unassigned; route to an authorized administrator for assignment, who cannot self-approve. |
| Network retry or duplicate | Idempotent original outcome; conflicting identifier requires a new correction. |

## Implementation checklist

- [ ] Sign off OD-GPS-1–7 and legal/retention operating procedure; confirm #1516/#1520 contracts and #902 integration.
- [ ] Implement isolated server slices, tests and reversible migrations 0537–0540; enforce location visibility and SoD.
- [ ] Integrate repository, inbox, mobile and offline queue; cover every AC at its owning layer.
- [ ] Run required project gates, privacy review and rendered mobile review before release.
