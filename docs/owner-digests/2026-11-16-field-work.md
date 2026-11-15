# Owner digest, 16 Nov 2026: field work (site, people, phone)

Seven field-work tickets, in the order they have to be built: equipment, roster, offline phone app, Lark,
GPS attendance, daily site report, payroll. Each one has a single line on what it gives users, then its open
questions. Every question puts the recommended answer first and then says what changes if you answer no. Every
default below is still a proposal. Nothing here is built until you sign it.

Count: 42 questions (2 conflicts to settle first, then 40 by ticket).

---

## Settle these two first

They block more than one ticket, and the specs disagree with each other.

1. **Site GPS boundary.** Should the attendance feature own each site's GPS boundary (a list of sites per
   project, each with a centre and a radius), with roster assignments picking a site from that list?
   **Recommend: yes, attendance owns it.** Today the roster spec treats a site as a name only and says attendance
   should decide where locations live, while the attendance spec expects the roster to supply the boundary, so
   right now neither does. If no: the roster owns the boundary instead, and the roster build grows a map and
   radius step before anyone can schedule a crew.
2. **Pick lists on the phone while offline.** Should the phone keep a small, signed-in-user-only copy of the
   project and work-item lists, which expires after a set time and is re-checked by the server on sync?
   **Recommend: yes.** The daily site report needs those lists to start a report offline, but the offline app's
   default keeps no shared records on the phone at all. If no: a site report can only be started while
   connected, which defeats its main purpose at sites with no signal.

---

## 1. Equipment usage and allocation (#1519): already on dev

Gives each asset hours or days logged by project (with fuel and trips), costed by an internal hire rate or by
actual cost, with the cost shared across projects. All planned slices and the follow-up fixes are on dev, and
the ticket is closed.

What is left: release it beyond dev, which waits on your release approval like everything else on dev. It shipped
with the nine defaults in its spec, including no posting to the ERP ledger, monthly allocation, and Engineers and
above logging usage. No question is open unless you want to change one. Logging from the phone and from the
daily site report comes with tickets 3 and 6 below.

## 2. Employees, assignment and rotation roster (#1516)

Gives an operations admin field staff records that need no login, assigned to a project and site for a date
range on an on/off rotation (for example 14 days on, 7 off), with a roster view of who is where on each day.

1. Should a person have only one assignment per day, so the same person can't be on two sites on one day?
   **Recommend: yes.** If no: we also need a rule for splitting that day's time between sites, or later
   attendance and cost become ambiguous.
2. Should a site be just a name on the assignment, with its GPS boundary owned by attendance (see conflict 1)?
   **Recommend: yes.** If no: the roster takes on the boundary itself.
3. Should a rotation be a fixed number of on-days then off-days, with no one-off daily exceptions in this first
   version? **Recommend: yes.** If no: we add day-by-day overrides now. Until then, an irregular week means ending
   one assignment and starting another.
4. Should Admins manage people and their login links, Admins and Finance manage assignments, Admins, Finance and
   Executives see everything, and each linked person see only their own roster? **Recommend: yes.** If no: name
   who else schedules crews (for example an operations role), or that person can't plan.
5. Should assignments be dated periods (the end date can be left open), with corrections recorded in the
   history, and a person archived only after their current and future assignments end? **Recommend: yes.**
   If no: past assignments could be changed silently, which shifts costs already reported.
6. Should an employee record hold only a code, a display name, active or archived status and an optional login
   link, with no salary, contact, tax or bank details? **Recommend: yes; payroll adds what it needs later.**
   If no: we collect personal data the roster does not use and must protect it from day one.

## 3. Offline phone app and targeted alerts (#1520)

Gives field staff an app installed on the phone that records clock-ins, daily reports, material issues,
equipment logs and photos with no signal, sends them when the signal returns, and keeps a "Needs fixing" list
with the reason for anything refused. Each person gets one alert on the channel they chose. Approvals, money and
edits to shared records stay online.

1. Should unsent work stay on the phone until it is confirmed or the user throws it away, with a warning on
   sign-out? **Recommend: yes.** If no: automatic cleanup could delete days of unsent field work.
2. On a shared phone, should unsent work stay tied to the person who captured it, so only they can send it after
   signing in? **Recommend: yes. We will not promise encryption against whoever owns the device.** If no: a
   coworker could see or send someone else's field records.
3. Should alerts go by email when that is set up, and otherwise show "setup needed" with no automatic switch to
   another channel? **Recommend: yes.** If no: we pick a fallback channel, and people may get the same alert
   twice.
4. When a channel gives an unclear answer about whether an alert was delivered, should we hold it for checking
   rather than resend it automatically? **Recommend: hold it.** If no: resending can deliver duplicates.
5. Should a report and each of its photos be sent and confirmed separately, each with its own status, so a
   failed photo never hides a saved report and a photo stays on the phone until its own link is confirmed?
   **Recommend: yes. This settles a disagreement with the daily site report spec, which already assumes it.**
   If no: report and photos succeed or fail together, and one bad photo holds back the whole report.
6. Should alerts go only to the people the existing workflow says must act, with low-cash recipients and
   thresholds set by the cash-alert ticket? **Recommend: yes.** If no: everyone in a role gets the alert,
   including people who can't act on it.
7. Should the phone keep no shared records offline, only the app itself and the user's own unsent work, apart
   from the pick-list exception in conflict 2? **Recommend: yes.** If no: a design for a per-user offline copy
   of records people have viewed comes first, which is a larger job.
8. Should each person have one active phone for alerts, with switching phones done on purpose by the user?
   **Recommend: yes.** If no: we support several phones per person, and an old phone may still get alerts.
9. Should the app explain that clearing or losing the phone can lose unsent work, and leave export until a safe
   export is designed? **Recommend: yes.** If no: we design secure export now, before the first release.
10. Should new timesheet entries stay online only, and not be another thing the phone can capture?
    **Recommend: yes, until the timesheet rules for offline entries are designed.** If no: the site report's
    "enter hours here" path needs that design before it can ship.
11. Should leave and overtime requests need a connection to submit, with the open form kept on screen while
    offline? **Recommend: yes.** If no: we add a stored offline request draft as a new capture type.
12. Should the phone app's foundation ship before attendance, with the clock-in part switched on once attendance
    is built? **Recommend: yes.** Each spec lists the other as a prerequisite, and this breaks the loop. If no:
    the two must be built together, which is one large, risky release.

## 4. Lark assistant and approval cards (#1521): no spec yet

Gives a matched PMO user the PMO assistant in a Lark direct message, with their own permissions, and approvals
through explicit card buttons. Group chats get notifications only. There is no spec or plan yet, so these two
questions shape the spec.

1. Should a Lark account be linked to a PMO user once, on purpose (the user connects it or an Admin confirms
   it), rather than matched by email? **Recommend: yes, an explicit link.** If no: matching by email works only
   if the customer's IT lets Lark share email addresses, and anyone whose emails differ is refused.
2. Should Lark ship before the phone app's "send alerts to Lark" choice is switched on? **Recommend: yes.** That
   choice needs to know each person's Lark account. If no: Lark shows as "not available yet" in alert settings
   until this ships.

## 5. GPS attendance and requests (#1517)

Gives field staff clock in and out on the phone (works offline), checked against the assigned site, with leave
and overtime requests decided in the approvals inbox. GPS alone is never treated as proof of work.

The blocking question about where site boundaries live is conflict 1 above.

1. Should GPS capture stay off until the company has a counsel-confirmed legal basis and shows an
   Indonesian-language notice, with a non-GPS manual review path for anyone who refuses? **Recommend: yes.** If
   no: we risk unlawful location processing, and refusing the phone's location permission could wrongly mark
   someone absent.
2. Should raw coordinates be deleted after 90 days, with the time, site and check result kept for 2 years, both
   subject to counsel? **Recommend: yes, as a starting proposal.** If no: name other periods. Keeping
   coordinates longer exposes people's movements, and deleting sooner can lose evidence in a dispute.
3. Should we take one location reading at each clock-in or clock-out and never track in the background?
   **Recommend: yes.** If no: background tracking needs a much stronger legal basis and more data protection.
4. Should each person see their own location evidence, specifically authorized attendance reviewers see it only
   for their scope, and approvers see only the result, not the coordinates? Admins would not see locations
   automatically. **Recommend: yes.** If no: wider access exposes movements, and narrower access blocks dispute
   handling.
5. When the location is unavailable, too inaccurate, or partly outside the site, should the clock event go to
   manual review instead of counting as verified? **Recommend: yes.** If no: borderline readings either pass as
   present when they shouldn't, or are refused with no way to appeal.
6. Should leave and overtime be approved by an authorized manager other than the requester, with no self-approval
   even in a one-person team, and requests with no eligible approver shown as "unassigned"? **Recommend: yes.** If
   no: self-approval allows unreviewed overtime.
7. Should the phone's time and the server's receipt time both be kept, with clock events required to alternate
   in and out, and late or conflicting events sent to "Needs fixing" and corrected by a new reviewed entry?
   **Recommend: yes.** If no: trusting the phone's clock can reorder shifts, and editing captured events hides
   what really happened.

## 6. Daily site report (#1522)

Gives a foreman, per work item and offline, the day's installed quantities, crew hours, equipment, materials,
activities and photos, stored against the project. It also needs the inventory ticket, as well as the roster,
equipment and phone app tickets. The offline pick lists it needs are conflict 2 above.

1. Should a foreman enter only their own hours, with each crew member entering their own until a proper "enter
   for my crew" rule exists? **Recommend: yes.** If no: we design delegated entry first, or a foreman could put
   hours into someone else's approved week.
2. Should each part of a report (the report itself, each material issue, each photo) be sent and accepted
   separately with its own status? **Recommend: yes.** If no: one bad stock line holds back the whole day's
   report.
3. Should installed quantities stay as daily evidence, with the monthly progress assessment still entered
   separately online? **Recommend: yes.** If no: adding daily figures automatically can double-count revisions or
   overwrite a manager's monthly figure.
4. Should the report create only drafts of material issues and equipment logs, never submitting, posting or
   approving them? **Recommend: yes.** If no: stock and valuation could change before the storekeeper checks.
5. Should a report be visible to its author and to people allowed to view that project's reports, with each linked
   record keeping its own access rules? **Recommend: yes.** If no: broad project access exposes others' details,
   and narrower access stops the site team finding reports.
6. Should photos use the phone app's photo queue and the project's usual attachment retention, with no new
   retention rule? **Recommend: yes.** If no: we design a separate retention rule for site photos.

## 7. Manual payroll sheet and payslips (#1518)

Gives HR a monthly payroll sheet built from approved attendance, overtime and allowances, with tax and social
security amounts entered by hand, an approval step, payslips for each person, and project labour cost that ties to
the approved payroll.

1. Should payroll be approved by an authorized approver who did not edit that version, with no exception for a
   one-person team or for Admins? **Recommend: yes.** If no: a preparer could issue payroll nobody reviewed.
2. Should only authorized payroll HR and the approver see everyone's pay, each person see only their own approved
   payslip, and project managers see only project totals? Admins would get no automatic access. **Recommend:
   yes.** If no: pay becomes visible more widely than needed.
3. Should gross pay be shared across projects by approved attendance hours, with zero-hour cases assigned by hand
   with a reason? **Recommend: yes.** If no: name another basis, or project costs and margins are misstated.
4. Should employer-paid costs such as the employer's social security share stay out of project cost until a
   later slice adds them as separate entries? **Recommend: yes.** If no: we design employer-cost entries now.
   Until then, project labour cost is understated.
5. Should each sheet use one currency, two decimal places and one calendar month? **Recommend: yes.** If no:
   mixed currencies or periods give misleading totals.
6. Should payslips be issued only in the app, viewed after sign-in and printable, with no email attachments and no
   bank payments? **Recommend: yes.** If no: emailed payslips can expose pay to the wrong inbox.
7. Should a correction create a new locked version, with only the difference posted to project cost?
   **Recommend: yes.** If no: posting both versions counts the cost twice, and overwriting hides what was issued.

---

Planning note (no answer needed): the database slots named in the roster, offline, GPS, site report and payroll
plans are now taken by other work, so each is renumbered when it is planned.
