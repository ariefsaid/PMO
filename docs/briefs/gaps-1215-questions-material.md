# Open questions — lane "Material, purchasing and roles"

Each line: question · recommended answer · what was built meanwhile.

## price-visibility-roles
- Which other roles should lose prices when hiding is on? Today, with hiding on, the officer roles without the price right and a person with no job role at the base engineer level also lose them. · None beyond Foreman and Field user; office roles keep prices · Nothing changed (steering): field accounts are already cut off from prices; acceptance tests prove it per channel. The follow-up, if agreed, is one data row per officer role plus dropping the base-engineer clause.

## usage-warning
- Should the project manager also be told when the work order has a responsible person? · No; the responsible person is told, the project manager only when none is set · Responsible person, falling back to the project manager.

## material-vs-progress
- Should a warning that is still open send a reminder? · No; one notice per episode · One notice per episode.

## wo-per-purchase-line
- Should cost be split per purchase line by work order? · Yes, later, as a separate money change · Work order and discipline are traced per line; when all lines share one work order it is copied to the header, so cost reads are unchanged.

## cash-advance-estimate
- Does "advance needed" mean the top-up to site cash or a cash advance to a named person? · The top-up to site cash · A read-only list of open, not-yet-ordered purchase requests beside the monthly plan, with "start the plan from these".

## roles-that-decide
- Should people not yet given a job role count for job roles built on their access level? · Yes, so chains keep working while roles are assigned · Built that way; one condition switches to "holders only".
- Who may raise and send purchase orders by job role? · The Admin names Buyer in the ordering setting · Setting ships empty, so nothing changes until an Admin sets it.
- May a Buyer order a purchase that is not yet approved? · No · Built as no.

## opening-stock-history
- Do history "out" rows need a project or work-order destination? · No · No destination column.
- How far back does the history go? · From the first receipt still on hand · Up to 5000 rows per file, any date up to go-live.
- Can a location with a balance-only opening be replaced by a history? · Reverse, then reload · Refused with that next step.
