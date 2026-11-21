# Email notifications (#2711)

Email is a second delivery channel for the in-app notification (ADR-0044 §5 seam, FR-AAN-037). Provider: Resend HTTP API, one adapter inside one edge function.
Out of scope: phone push, messaging-app channels (Q1 2027).

## Events
Four event keys: `approval_request`, `billing_step`, `overdue_item`, `document_expiry`. `notify_workflow_user` takes an optional `p_email_event` and stamps `metadata.email_event`; the channel reads only that mark, and only when it was written by a trusted (non-client) role.
When no event is passed, one classifier inside `notify_workflow_user` maps the existing producers, so none of them is edited:
- `approval_request`: every hand-off titled "... awaiting your approval" (procurement, timesheet, expense claim, customer invoice, site cash).
- `overdue_item`: the task reminder (0442) and the overdue site issue (1028).
- `document_expiry`: the expiry run (0971, entity `expiry_document`).
- `billing_step`: no billing-step producer exists on `origin/dev`; generic hook only, the billing work passes `p_email_event => 'billing_step'`.

## Requirements (EARS)
- **FR-EML-001** Where an organisation has switched an event on, when a notification carrying that event mark is inserted, the system shall queue exactly one outbox row for it, in the same transaction.
- **FR-EML-002** The system shall default every event OFF for every organisation; with no settings row no email is queued and no existing behaviour changes.
- **FR-EML-003** The recipients of an event are the notification's addressee plus, where the organisation lists extra roles for the event, every other active member of the same organisation holding one of those roles; recipients are de-duplicated and the acting user is not copied.
- **FR-EML-004** Where a user has opted out, the system shall queue no email for that user; the in-app notification is unaffected.
- **FR-EML-005** The system shall never queue email for a user who is not an active member of the notification's organisation.
- **FR-EML-006** When the delivery function runs, it shall claim pending rows with a lease, send each once through Resend with the outbox id as idempotency key, and mark it sent; a failed send is retried up to a limit, then marked failed.
- **FR-EML-007** If the sender secret is absent, the function shall send nothing, change no row, log one structured line and return success.
- **FR-EML-008** The function shall accept only the dedicated bearer secret (constant-time compare); anything else gets 401.
- **FR-EML-009** The system shall render subject and body from a template per event in English or Bahasa Indonesia (organisation setting, default English), with the notification text as parameters and no organisation or client name in the template.
- **FR-EML-010** Only an Admin shall read and change the organisation's event settings; any user shall read and change only their own opt-out. Both are enforced by RLS / a security-definer RPC.
- **FR-EML-011** The outbox shall be unreadable to every client role (service role only).

## Acceptance criteria (owning layer)
- **AC-EML-001** Given an event ON and a marked notification, then one outbox row exists; inserting nothing twice for the same notification (unique). *(pgTAP)*
- **AC-EML-002** Given no settings, or the event OFF, then no outbox row. *(pgTAP)*
- **AC-EML-003** Given extra roles, then addressee plus those role holders get one row each, no duplicates, none from another org. *(pgTAP)*
- **AC-EML-004** Given an opted-out addressee or extra recipient, then no row for them; in-app row still exists. *(pgTAP)*
- **AC-EML-005** Given a non-member or other-org addressee, then no row. *(pgTAP)*
- **AC-EML-006** Given a client-inserted notification carrying an event mark, then no row. Given overdue reminder and expiry run with their events ON, then rows are queued. Given a procurement Draft to Requested with `approval_request` ON, then each approver gets one row and the requester none. *(pgTAP)*
- **AC-EML-007** Given a claim run twice concurrently, then each row is claimed once; a sent row is never claimed again. *(pgTAP)*
- **AC-EML-008** Given pending rows and the secret present, then Resend is called once per row with the Idempotency-Key and the row is marked sent. *(Deno, shipped handler, mocked fetch)*
- **AC-EML-009** Given Resend answers 5xx then the row returns to pending with attempts+1; at the limit it is failed. *(Deno)*
- **AC-EML-010** Given the secret absent, then no fetch, no row change, 200 and a log line. *(Deno)*
- **AC-EML-011** Given a wrong or missing bearer, then 401 and no fetch. *(Deno)*
- **AC-EML-012** Given each event and each language, then subject and body render, contain the notification text and no organisation name. *(Deno)*
- **AC-EML-013** Given non-Admin writes to event settings, or any client select on the outbox, then denied. *(pgTAP)*
- **AC-EML-014** Given the settings screen, then Admin toggles events, picks roles and language; labels render in English and Bahasa; the opt-out switch saves. *(Vitest; phone and desktop screenshots)*
- **AC-EML-015** Given an unset sender secret end to end, then the in-app notification is delivered as before. *(pgTAP: in-app row unchanged; existing notification tests stay green untouched)*
