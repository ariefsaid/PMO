# Walk fix: finding things, and the field forms

Source: a first-time-person walk of the released build (phone at 390 px, organisation language Bahasa Indonesia). Each item is a
symptom that was traced to its cause in the code before it was fixed. Money rules are untouched. The database stays the authority
for who may do what; the screen mirrors it and no rule is looser than before.

## Requirements (EARS)

- **FR-NAV-001** The menu shall list Work orders for every full account, and the home shall carry a Work orders tile (the reader's open work orders with status); a light account's home shall list the work orders it is on today. The name shall come from the terminology dictionary everywhere.
- **FR-NAV-002** The menu shall offer Safety (only where the organisation switched the module on), the equipment asset register, the approvals inbox to every full account, and the billing board to Finance, Executive and Admin (with the revenue module).
- **FR-NAV-003** The menu shall order its groups by the person's function (HR first on My work; no Sales or Finance group for HR) and put that function's own places first in a group. HR shall have People as the first entry after Home.
- **FR-NAV-004** A light account shall reach one settings page (profile, language, text size) from its home and return.
- **FR-NAV-005** While no session exists the sign-in pages shall follow the browser language, show a visible language switch and remember the choice.
- **FR-DSR-020** When a daily report with no progress, no hours, no photo, no consumables and no idle time is sent, the database shall refuse it and name what is missing; the screen shall word it in the reader's language.
- **FR-DSR-021** The author shall be able to withdraw a sent report until it is validated or returned; nobody else shall.
- **FR-DSR-022** When a work order has no contract items, the report shall say so and name the project manager.
- **FR-CRW-050** On a phone the roster tick shall show the status word and keep every control at least 44 px.
- **FR-TS-050** Submitting the week shall confirm what is sent (hours, week) and to whom, and report it afterwards; a project with exactly one open work order shall have it preselected.
- **FR-INC-050** The reporter of an issue shall see who is in charge, what happens next and who can close it; evidence (photo) stays open to the reporter.
- **FR-MRQ-050** The "already requested" figure shall open the earlier requests behind it and the stock already sent.
- **FR-I18N-050** Every notification title the database writes shall have English and Bahasa Indonesia text, enforced by a gate that scans the migrations; role, warehouse-kind and checklist labels shall not appear in English on a Bahasa screen; a headline and its detail shall not print a doubled full stop.

## Acceptance criteria (Given / When / Then)

- **AC-NAV-001** Given any full account, When the menu opens, Then Work order(s) is listed and opens the list. *(unit: Rail.walkNav, WorkOrders)*
- **AC-NAV-002** Given safety is off, Then the menu has no Safety; Given on, Then it has. *(unit)*
- **AC-NAV-003** Given an HR role, Then People follows Home and the groups are My work then Delivery. *(unit)*
- **AC-NAV-004** Given a light account on its home, When it taps Settings, Then the profile page opens and My work returns. *(unit: LightShell)*
- **AC-NAV-005** Given a browser in Bahasa Indonesia and no session, Then the sign-in page is Indonesian with a switch, and a tap is remembered. *(unit)*
- **AC-DSR-020** Given an empty draft, When the author submits, Then the database refuses with the missing parts and the status stays draft. *(pgTAP 1620)*
- **AC-DSR-021** Given a sent report, When its author withdraws, Then it is a draft again; another person, or a validated report, is refused. *(pgTAP 1620)*
- **AC-TS-050** Given a timesheet week with hours and a line manager, When the person submits, Then the dialog and the result name the hours, the week and the manager. *(unit)*
- **AC-INC-050** Given a reporter who cannot close, Then the issue shows the person in charge, the next step and the closing roles. *(unit)*
- **AC-MRQ-050** Given a line with earlier requests, When "already requested" is tapped, Then those requests and any stock already sent are listed. *(unit)*
- **AC-I18N-050** Given a title in any migration, Then a template with both languages exists. *(unit gate)*
