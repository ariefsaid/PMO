# Open questions — lane gap-billing (gaps round, 22 Nov 2026)

Each line: question · recommended answer · what was built meanwhile.

## billing-steps (work-order step list)
- May OD-SCOPE-6 ("steps live on the claim") read as: the claim keeps its own gating steps, and the work order carries an advisory step list from issue, which later claims link to? · Yes · Built as an advisory list on the work order; the claim's steps and the invoice gate are unchanged.
- Who holds "see billing steps" and "run billing steps" by default? Giving survey, project-administration and site-supervision roles read access widens who sees billing steps beyond today's four levels · Accept the widening for the work-order list only · Built with those defaults; claim steps keep today's readers.
- The capability catalogue is the same for every organisation, so hiding one step from one role is done per step (a "hidden from" role list on the template step, organisation data) · Keep the per-step list · Built; the named person still sees their own step.

## survey-cap
- Is the quantity survey internal, or joint with the customer's supervisor? · Record who took part as data on each survey; no rule depends on it · Built as data.
- Should a claim over the surveyed or accepted quantity be refused? An owner ruling keeps over-claim a warning · Warning by default; refusal is an organisation setting · Built with default "warn".

## billed-per-month
- The work-order figure counts submitted invoices, the same as the work-in-hand screen, so it does not add up to "invoiced + pending" on the same panel (pending claims are not in a month) · Keep one definition shared with work in hand · Built on the shared calculation.

## missing-list
- Should a quantity reported but not accepted block closing, or only be listed? · Listed as lacking; the database does not refuse closing for it today · Built as information, worded as lacking.

## change-review
- Which roles review quantity change requests besides today's approver levels? · An organisation setting listing role keys, empty by default (today's route unchanged) · Built as a setting, default empty.
- Should "record sent" and "record decision" also follow that setting? · No; they already admit the project manager level · Not changed.

## issue-closing-measure
- What does "hours worked" mean for effective hours? · The daily report's site day, minus its recorded stopped time · Built that way; person-hours from timesheets not used.
- May anyone add an issue type on the spot? · No; an Admin keeps the list; old rows keep their free text · Built Admin-only.
- Should closing time exclude stopped days? · No; closing time stays calendar time, effective hours shown beside it · Built that way.

## discipline-profit-check
- How should shared people and equipment cost reach a discipline: by the work orders' share of direct cost (today), by revenue share, or by a rate the customer sets? · Keep the direct-cost share and the per-project custom split; add no per-discipline rate until asked · Nothing new built; shared cost shown as its own column, margin before and after it.
- May a confirmed survey exceed the accepted quantity? · Yes, the surveyed figure is the cap the ask names; no cross-check · Built without a cross-check.
- Confirming a survey follows the acceptance rule (recorder cannot confirm their own record unless they are the only active member, and that basis is stored) · Keep the same rule · Built that way.

## Base-branch notes (not this lane's change)
- The isolation-denominator guard reports a function from migration 1550 missing from its manifest on the base branch · Add the manifest entry in the fix round · Not changed in this lane.
- Is each survey an increment (summed into the certified figure) or a cumulative reading (latest wins)? · Increment, with a correction replacing a mistaken survey · Built as increments; the screen says so; every confirmation needs the survey sheet attached.
- Should the database stop on over-claim be selectable per project as well as per organisation? · No, per organisation only · Built per organisation, default warn.
- Should a survey line read "reported" as progress to date or as the measured figure in the missing list? · Progress to date · Built as progress to date.

## checklist-target-dates
- From when does a site-clearance item's target count, given there is no per-person checklist creation? · From the person record's creation; people created before the target was set get no due date · Built that way (in progress).
- Who is told when an item has no owner? · The checklist's creator (close-out: the person who issued the work order; clearance: whoever created the person record), else the Admins · Built that way (in progress).
