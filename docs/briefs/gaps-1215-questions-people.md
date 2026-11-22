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
- Is the organisation's trade (discipline) list the right list for the position needed? · Yes until a position list exists. · Built: needs name a discipline.
- Should linking a person to a need also place them in a crew? · No; crews are still arranged on the Crews page. · Built: the link is its own record.

## no-login-labour-cost
- Overtime on attendance days: price by the timesheet's day-length rule, or by the overtime field on attendance? · Day-length rule (one rule, as logins already get). · Built: day-length rule.
- Should a class rate also price a login person who has no person or access-level rate? · Not now. · Built: class rates price no-login crew members only.
- Price by crew position as well as by labour class? · No; positions are free names per crew, the class list is organisation-wide. · Built: class only.

## pay-time
- Who may enter the second (surveyor or timekeeper) time record by default? · The quantity surveyor role plus manager levels; the organisation adds a timekeeper role in the setting. · Built: a setting with that default, editable by Admin.
- Should a source win automatically? · No; until a manager decides, the foreman's site-report figure stands and the week cannot be approved. · Built: as recommended.
- Which role decides a disagreement? · Leave it empty (today's week approvers) until the organisation names one. · Built: setting, empty by default.

## medical-release (minimal form)
- Should a deferral expire? · No; the manager decides again. · Built: a deferred release can be decided again; an approved one is final.
- May an Admin decide for a person with no direct manager? · No; set a manager first. · Built: only the direct manager decides.

## crew-multi-wo (on hold; decision note only, docs/specs/crew-multi-wo.spec.md)
- Reverse the "a crew serves one work order per day" ruling for mobile crews, or keep it? · Reverse it for crews whose members have no login. · Built: nothing; note only.
- Option A (no-login crews split their day across work orders) or B (everyone, which changes the timesheet key and the payroll push)? · A. · Built: nothing.
- Is "cannot exceed what was worked" today's 24-hour daily ceiling, or the hours recorded present that day? · Keep 24 hours, with a warning when the split total exceeds the day's recorded present hours. · Built: nothing.
- Was the one-work-order-per-day ruling signed? Its spec header still says "proposed". · Confirm its status. · Built: nothing.

## expiry-to-manager (after steering)
- Should a manager be able to record the renewal of a medical document? · No; medical documents stay with the people team. · Built: refused for managers.
