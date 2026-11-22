# Open questions — lane gap-people (People, crews and time)

Each line: question · recommended answer · what was built meanwhile.

## expiry-to-manager
- What does "the manager acts" mean? · The renewal (a new expiry date recorded by the people team) is the action; the worker is told then. A separate acknowledge button only if asked. · Built: the worker gets one notice when the document's expiry date moves later.
- With no direct manager on a person, fall back to the login's line manager? · Yes, as a follow-up once one manager field is canonical. · Built: no fallback; role recipients still apply.
- Should the worker get the expiry warnings too? · No; the manager chases. · Built: today's behaviour (worker not warned).

## people-import-update
- Should people missing from the file, or flagged inactive, be archived by the import? · No; archive on the register; an explicit "Active" column later. · Built: people absent from the file are never changed.
- Which columns does the daily export carry beyond code, name and job title? · Keep to those three until the register has more fields. · Built: code, name, job title.

## crew-followed
- May the receiving foreman record a follow without telling the home crew's foreman? · Yes; the home roster shows the person away and the follow is on the day record and audit. · Built: no notice to the home foreman.

## manpower-request
- Who approves a request? · A manager-level member other than the requester, one decision. · Built: that rule, enforced in the database.
- Is the organisation's trade (discipline) list the right list for the role asked for? · Yes; the Admin adds missing trades there. · Built: needs name a discipline.
- Should assigning a person also place them in a crew? · No; crews are still arranged on the Crews page. · Built: assignment is its own record.

## medical-release
- Does a rejected release keep the worker off the roster until a new decision? · Yes; the manager may decide again, audited. · Built: rejected holds; re-decision allowed.
- May the manager release before the leave end date? · Yes, from the day the leave is approved. · Built: as recommended.
- Does PMO ship a "sick" leave type? · No; the Admin marks which of their own leave types need a release. · Built: a per-type mark, off by default.

## no-login-labour-cost
- Overtime on attendance days: price by the timesheet's day-length rule, or by the overtime field on attendance? · Day-length rule (one rule, as logins already get). · Built: day-length rule.
- Should a class rate also price a login person who has no person or access-level rate? · Not now. · Built: class rates price no-login crew members only.
- Price by crew position as well as by labour class? · No; positions are free names per crew, the class list is organisation-wide. · Built: class only.
