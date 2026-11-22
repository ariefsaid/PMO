# Open questions — lane "Material, purchasing and roles"

Each line: question · recommended answer · what was built meanwhile.

## price-visibility-roles
- Which other roles should lose prices when hiding is on? Today, with hiding on, the officer roles without the price right and a person with no job role at the base engineer level also lose them. · None beyond Foreman and Field user; office roles keep prices · Nothing changed (steering): field accounts are already cut off from prices; acceptance tests prove it per channel. The follow-up, if agreed, is one data row per officer role plus dropping the base-engineer clause.

## usage-warning
- Should storekeeper issues, rather than site reports, count as installed material? · Site reports by default · A per-organisation setting chooses; default site reports.
- Should the project manager also be told when the work order has a responsible person? · No; the responsible person is told, the project manager only when none is set · Responsible person, falling back to the project manager.

## material-vs-progress
- Should a warning that is still open send a reminder? · No; one notice per episode · One notice per episode.

## wo-per-purchase-line
- Should cost be split per purchase line by work order? · Yes, later, as a separate money change · Work order and discipline are traced per line; when all lines share one work order it is copied to the header, so cost reads are unchanged.

## cash-advance-estimate
- Does "advance needed" mean the top-up to site cash or a cash advance to a named person? · The top-up to site cash · A read-only list of open, not-yet-ordered purchase requests beside the monthly plan, with "start the plan from these".

## roles-that-decide
- Should people not yet given a job role count for job roles built on their access level? · Yes for approval steps, so chains keep working while roles are assigned; no for ordering purchases, where only holders of a named role order (ordering also widens what purchases a person reads) · Built that way; each is one condition.
- Who may raise and send purchase orders by job role? · The Admin names Buyer in the ordering setting · Setting ships empty, so nothing changes until an Admin sets it.
- Should the step that approves borrowing another work order's reserved stock also take a job role? · Yes, in a follow-up · It still names an access level.
- Billing steps count only people who hold the owner role, while approval steps also count people with no role at that level. Which one rule for the whole product? · Holders plus no-role people at that level for steps that only decide; holders only for anything that widens access · The function supports both; billing builds its own call.
- May a Buyer order a purchase that is not yet approved? · No · Built as no.

## opening-stock-history
- Do history "out" rows need a project or work-order destination? · No · No destination column.
- How far back does the history go? · From the first receipt still on hand · Up to 5000 rows per file, any date up to go-live.
- Can a location with a balance-only opening be replaced by a history? · Reverse, then reload · Refused with that next step.
