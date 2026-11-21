# Jobs-to-Be-Done map — the Lens-D oracle (role × job)

**Status:** v0.4 (2026-11-21: §6 contractor block follows the 21 Nov scope, with light-account and new waiting jobs; v0.3, 2026-11-20: §6 gains the contractor field-operations jobs, map #2516; v0.2, 2026-11-16: §6 jobs by function added; §2 screen rows are the June seed and predate Stock, billing claims, expenses and site cash). First written 2026-06-14. The **oracle** that **Lens D — Product / Intent** grades every
screen against. Living foundation artifact: each new feature adds/updates its role's job stories during
intake (the grill captures the job story *before* spec). Owner-refinable — the seed below is grounded in
the app's real roles (`src/auth/policy.ts`) and real primary screens (`App.tsx` routes); sharpen the
priorities/expectations as the product owner corrects them.

> **How to use this doc (for reviewers):** for the screen under review, find its row(s) below. Each job
> story is a test oracle. Walk the **Lens-D 5 questions** (§4) against the *primary* job for the
> *primary* role on that screen. A screen passes Lens D when the primary role can, on arrival:
> recognise the job is doable here (information scent), see the decision-relevant facts first
> (priority/placement), and **act in one step** on what they see (actionability) — using the **same
> interaction paradigm** as analogous screens (§3).

The job-story format (Klement): **"When _[situation]_, a _[role]_ wants to _[motivation]_, so they can
_[expected outcome]_."** Grade against the **outcome**, never the spec.

---

## 1. Roles (from `src/auth/policy.ts`) and their overarching job

| Role | The one thing they come to the app to do |
|---|---|
| **Executive** | *"Is the business healthy and is delivery on track — and where do I need to intervene?"* Portfolio-level health + exceptions, not row-level work. |
| **Project Manager (PM)** | *"Are my projects on track, what's blocked, and what's the next action to keep them moving?"* Drives delivery; lives in project detail + approvals. |
| **Engineer** | *"What is assigned to me, what do I log, and what do I need approved?"* Task-level execution + timesheets; narrow write surface. |
| **Finance** | *"Is the money right — contract values, procurement spend, billing — and what needs my authority?"* Money authority (SoD on `contract_value`-on-won), master data, spend. |
| **Admin** | *"Is the org configured correctly and who can do what?"* Users/roles/config + destructive authority; rarely doing delivery work itself. |

---

## 2. Primary screens × the jobs users bring to them

Ordered by the app's mental model (overview → sales → delivery → workforce → master-data → admin). For
each screen: **primary role(s)**, the **top job(s)** as job stories, and the **"now-what" action** the
screen must make available adjacent to the insight (the actionability test).

### Overview
| Screen | Primary role | Top job(s) — job story | Expected "now-what" action (must be adjacent) |
|---|---|---|---|
| `/` Executive Dashboard | Executive | *When I start my day, I want to see portfolio health + the exceptions, so I can decide where to intervene.* | Each exception/KPI **drills into the offending record** in one click — a number is never a dead end. |
| `/my-tasks` | Engineer / PM | *When I log in, I want to see what's assigned to me and what's due, so I can pick what to work on next.* | Click a task → its **detail/action**; log time on it; mark progress. |

### Sales
| `/sales` Sales Pipeline | PM / Finance / Exec | *When I review the pipeline, I want to see where each opportunity stands and what's stalling, so I can advance or de-risk it.* | **Advance stage** / open the opportunity from the board; won → triggers the `contract_value` SoD. |
| `/sales/:id` Opportunity | PM / Finance | *When I open an opportunity, I want its full context + the next gate, so I can move it forward.* | The **advance / mark-won** action on the record, with money authority gated to Finance. |

### Delivery (the PM's home)
| `/projects` Projects (list / calendar / kanban) | PM / Exec | *When I scan my projects, I want to spot the ones off-track, so I can open the one that needs me.* | Each row/card/calendar-entry/kanban-card → **opens the project**; the off-track signal is visible *in the list*. The calendar/kanban views' job is **schedule/flow triage** — every entry must be **clickable into the record** (anchor #2). |
| `/projects/:id/:tab` Project Detail | PM | *When I open a project, I want to know "on track? what's blocked? what's next?" and act, so I can keep it moving.* | **Above the fold = the decision-driver for the PM** (status + what needs action), with the action adjacent. An analytic (S-curve) above the fold must answer **"behind plan → here's the lever"** (anchor #3) — not sit as a passive chart with the actionable tabs buried below. |

### Workforce
| `/timesheets` | Engineer (log) / PM (review) | *When I finish work, I want to log my hours against the right task fast; (PM) when reviewing, I want to approve/reject in batch.* | Engineer: quick entry. PM: **approve/reject inline** with a **preview** (anchor #1 — same preview paradigm as approvals). |
| `/approvals` (unified, `?scope=`) | PM / Finance | *When things await my decision, I want one inbox where I can preview the request and approve/reject without drilling in, so I can clear my queue.* | **Preview-in-place + approve/reject** — the canonical preview-before-drill-in paradigm every approvable object must match. |

### Procurement

Procurement is not one job — it is **four decision jobs** on one case (the old single "see phase + advance"
row under-specified it, which is why the module looked rich but did little; ADR-0033). Grade each row
against its **own** outcome. The primary screen for jobs P1–P3 is the **single procurement page** (full
pipeline + progression history, no drilling around); P4 is shared with `/approvals`.

| Screen | Primary role | Top job — job story | Expected "now-what" action (must be adjacent) |
|---|---|---|---|
| **P1 — Operate the case** `/procurement/:id` | Procurement admin *(operational hat: Admin/PM/Finance)* | *When I'm running a procurement, I already hold the real documents (PR, RFQ, quotes, PO, GR, invoice, payment); I want to capture each one — its real reference number **and** the file — and move the case forward, all on one page, so I don't hunt across screens.* | **Inline capture + upload of every record adjacent to its phase** on the single page; both the **system-assigned number and the external reference** shown; **advance** the case from here; the **full pipeline + historical progression** visible without navigating away. The doorway must be honest — every affordance the page implies must actually do something. |
| **P2 — Source / choose a vendor** `/procurement/:id` | PM / Finance | *When I have competing quotes, I want to compare bids side by side and pick one with a reason, so the sourcing decision is defensible.* | **Bid-comparison view** (vendors × amount × validity × terms), best-value signalled, **select-with-rationale** adjacent — not a flat list where I compare in my head. |
| **P3 — Control spend against budget** `/procurement/:id` | PM / Finance | *When I'm about to commit, I want to know whether this fits the project budget net of other pending commitments, so I don't over-commit.* | **Budget signal (healthy / warning / critical) adjacent to the approve/commit action**, on the committed basis (OD-BUDGET-2), pending-aware. Advisory vs blocking is an open decision (OD-W5-4/-5). |
| **P4 — Authorize / pay** `/approvals` + `/procurement/:id` | PM (approve) · Finance (pay) | *When spend awaits my authority, I want to preview the request and approve/reject — and separately release payment — without drilling in, so I can clear my queue under SoD.* | **Preview-in-place + approve/reject** (the canonical paradigm, anchor #1) with **SoD enforced** (approver ≠ requester; payer ≠ approver). |

### Master data (CRM)
| `/companies` + `/:id` | Finance / PM | *When I work an account, I want its record + related projects/contacts/opportunities, so I can act in context.* | Open → routable record (not a dead drawer); related objects clickable. |
| `/contacts` + `/:id` | PM | *When I follow up, I want the contact + activity history, so I can log the next touch.* | Log activity; jump to their company/opportunity. |
| `/incidents` + `/:id` | PM / Engineer | *When an incident is raised, I want its detail + status, so I can resolve and close it.* | Advance/resolve on the record — no dead-end (the routable-detail fix). |

### Admin / Reporting
| `/administration` | Admin | *When onboarding/offboarding, I want to manage users + roles, so access is correct.* | Create/edit user; assign role; archive. |
| `/reports` | Exec / Finance | *When I need to report out, I want to export/compose the numbers, so I can share them.* | Export (xlsx) / compose — *(placeholder today; job recorded for when built).* |

### Personal / composed views (ADR-0036 — user/agent-composed UI) · Agent assistant (ADR-0040)
| Agent assistant (in-app panel, ADR-0040) | Any role | *When I'm working in PMO and have a question about my own data or want something built, I want to ask my agent in plain language and have it act within exactly what I'm allowed to see and do, so I get answers/actions without leaving the app or exceeding my access.* | Ask in plain language (⌘J / Rail "Assistant" — A2); the agent **explores my own data** (read, deputy-bound — A1), later **acts** through the same repos/RPCs with approve/deny (A3) and **composes** views rendered natively (A4). Bounded by the **deputy model**: runs under my own JWT, **RLS is the ceiling**, `service_role` never handed to it; a prompt-injected "show all orgs" still hits my RLS. *(Runtime seam = A1; panel = A2; writes = A3; compose = A4 — ADR-0040.)* |
| `/views/:viewId` User-composed view | Any role | *When I've saved a composed view (dashboard), I want to open it and see it rendered with my live data, so I can monitor what matters to me without waiting for a built-in screen.* | Open from **"My Views"** (Rail group / ⌘K "Views"); each panel hydrates a real primitive from the saved spec, **re-executed under my own JWT** (never the author's cached rows — the deputy model); loading/empty/error/permission states are honest — no dead doorway. *(Renderer = I3; manual builder = I4; agent author = I5.)* |
| `/views` My Views | Any role | *When I want to manage the views I've made, I want to see them all and open/edit/archive any one, so I can curate what I monitor.* | List of **own** views (open → render, edit → builder, archive confirmed). Reachable from the "My Views" nav group. |
| `/views/new` + `/views/:id/edit` View builder | Any role | *When the built-in screens don't show exactly what I track, I want to compose my own view — pick a chart/table and point it at my data — and preview before saving, so I get the dashboard I need without waiting on engineering.* | Add panel → pick a registry primitive → configure a whitelisted query → **live preview** → save; **compile-before-save** blocks invalid specs; saves only my own view (RLS). *(Manual = I4; the agent composing it for me = I5.)* |

---

## 3. Cross-cutting interaction paradigms (the "5 record verbs" + preview)

Lens D's mental-model-consistency question (§4.5) grades against these. Analogous objects **must** share
one model — divergence is the exact defect class the coherence wave + the anchors target:

1. **Name** — one noun per concept ("Project" everywhere; an opportunity/deal/job is not a fourth word).
2. **Create** — one create-verb + one form paradigm (`EntityFormModal`).
3. **Open** — one record-open paradigm: **routable detail page** (`/entity/:id`), not a drawer-as-record.
4. **Advance** — one lifecycle-advance affordance (the bar stepper / status registry).
5. **Get-back** — one back/breadcrumb model.
6. **Preview-before-drill-in** — **any approvable / reviewable object** (approval, timesheet,
   **procurement evidence**) is previewable *in place* before you commit to drilling in. (Anchor #1.)

---

## 4. The Lens-D 5 questions (the interrogation, per screen × primary job)

1. **Job** — what job did the user come here to do? State it as a job story (use §2).
2. **Expectation** — does the user *expect* this feature/affordance **here**? Does placement + naming
   match their mental model and ERP/domain convention? (where-it-lives.)
3. **Priority / placement** — is information/affordance ordered by **decision-relevance to the job**
   (most-decision-relevant above the fold)?
4. **Actionability** — *"so what / now what?"* — can the user **act** on what they see in one step? Is
   the next action **adjacent** to the insight? (A display that drives no decision fails.)
5. **Mental-model consistency** — do analogous objects share one interaction paradigm (§3)?

## 5. Calibration anchors (must always be caught)

| Anchor | Job-story it violates | Lens-D Q |
|---|---|---|
| Procurement has no preview; approvals/timesheets do. | *…review evidence so I can approve spend* — broken by inconsistent preview. | Q5 (+Q4) |
| Calendar view on the project **list**, not clickable; not in task detail. | *…spot the off-track one so I can open it* — view with no job/scent, wrong place. | Q2 (+Q1) |
| S-curve above the fold, actionable tabs buried. | *…know what's next and act* — analytic with no adjacent lever. | Q3 (+Q4) |
| **Dishonest doorway — looks rich, does little.** A screen *implies* capability (polished pipeline, tabs, tiles) the module can't deliver: no bid comparison, no document upload, dual IDs absent, history not shown, capture buried off-page. | *…operate the case on one page* (P1) — the affordance the page advertises must actually work. | Q4 (+Q1) |

---

## 6. Jobs by function, end to end (the walk list)

§2 lists jobs per **screen**. This section lists them per **person**: what each function must be able to
finish, start to end, across screens. It exists because a feature can pass every test of its own and the
person still cannot finish the job (three such gaps were found by the owner on 16 Nov 2026: no invoice
from a claim without an ERP, Cancel leaving an Engineer on a page they have no menu for, no way to ask
for site stock).

**How it is used.** Each job is **walked in the running app as that login**, phone and desktop, English
and Bahasa, opening every drawer, dialog and menu on the way. A job is *done*, *blocked* (cannot finish)
or has *friction* (finishes, but with a detour, a dead end or a cut-off screen). A blocked job or a
friction becomes a ticket with its job story; a finished job becomes a journey test named by its id, so
it stays finished. The reference organisation for the walk is a contractor with **no ERP**, rupiah,
Bahasa first; the same list is walked for an ERP-connected organisation before a release that changes
the ERP paths. The walk itself (steps, friction types, severity) is the `friction-walk` skill.

Functions map to app roles: site engineer and storekeeper → Engineer · project manager → Project
Manager · purchasing, payables and receivables → Finance · director and finance director → Executive ·
administrator → Admin.

### Site engineer (Engineer)
- **ENG-1** Fill in this week's hours on my phone and submit them. *Done when* my approver has the week.
- **ENG-2** Fix and resubmit a week that was sent back. *Done when* it is with the approver again and I saw why it came back.
- **ENG-3** Request a purchase for my project from the project. *Done when* the request is with its approver and I can find it again from the project.
- **ENG-4** Change my mind while requesting. *Done when* Cancel leaves me on the project I started from.
- **ENG-5** See where my request stands. *Done when* I can tell who has it and what happens next, without a menu I do not have.
- **ENG-6** See what is low at my site and ask for it. *Done when* purchasing has a request naming the item and quantity.
- **ENG-7** Take materials out of the site store for the work. *Done when* stock on hand has dropped and the project carries the use.
- **ENG-8** Claim an expense with a photo of the receipt. *Done when* the claim is with its approver.
- **ENG-9** Report an incident from site. *Done when* it is recorded with its severity and the project manager can see it.
- **ENG-10** Log equipment use for the day. *Done when* the hours sit on the equipment and the project.
- **ENG-11** Find what is assigned to me and update it. *Done when* my task shows the new progress.
- **ENG-12** Find a project document or the minutes of a meeting and my actions from it.

### Storekeeper (Engineer)
- **STO-1** Receive a delivery into the store. *Done when* stock on hand has gone up and the purchase shows the receipt.
- **STO-2** Issue materials to a project. *Done when* stock is down and the project carries the cost of use.
- **STO-3** Move stock between stores. *Done when* both stores show the move.
- **STO-4** Count the store and record the difference. *Done when* the count is posted or waits for the person who must approve it.
- **STO-5** See what is at or below its reorder level and ask for it.
- **STO-6** Answer "what happened to this item?" from its ledger.

### Project manager
- **PM-1** Start the day: see which of my projects need me and why, and open the one that does.
- **PM-2** Clear what waits for my decision (hours, purchase requests, expense claims, site cash plans) with enough facts on the screen to decide.
- **PM-3** Send something back with a reason. *Done when* the requester sees the reason.
- **PM-4** Raise a purchase request and follow it to delivery.
- **PM-5** Know whether the budget can carry a purchase before I approve it.
- **PM-6** Record progress for the period. *Done when* the project's percent complete and what can be billed have moved.
- **PM-7** Prepare a billing claim from accepted work and attach its evidence. *Done when* Finance can raise its invoice.
- **PM-8** Propose a budget change and see it approved or refused.
- **PM-9** Plan and adjust phases and tasks; see what is late.
- **PM-10** Run a meeting record: minutes, actions, who owes what.
- **PM-11** Hand a won deal over into a project with its contract value and customer order.
- **PM-12** Answer the customer: what is invoiced, paid and still open on this project.

### Purchasing (Finance)
- **PUR-1** Pick up an approved request and ask suppliers for quotes.
- **PUR-2** Compare quotes and choose one with a reason.
- **PUR-3** Place the order. *Done when* the project shows the money as committed.
- **PUR-4** Record what arrived, including a part delivery.
- **PUR-5** Record the supplier's invoice against the order and pass it to payables.
- **PUR-6** See every open order that is late or incomplete.
- **PUR-7** Add or correct a supplier, with its tax details.
- **PUR-8** Act on a restock request from a site.

### Payables (Finance)
- **AP-1** See what must be paid this week and what is overdue.
- **AP-2** Record a payment to a supplier, with tax withheld where it applies. *Done when* the invoice shows paid and the project's spending has moved once.
- **AP-3** Issue or record the withholding slip for a supplier.
- **AP-4** Reimburse an approved expense claim.
- **AP-5** Top up a site's cash after its plan is approved, and see what each site holds.
- **AP-6** Answer a supplier: where is my invoice?

### Receivables (Finance)
- **AR-1** Raise an invoice straight from a claim (progress, down payment, time and materials).
- **AR-2** Approve an invoice someone else prepared; be stopped from approving my own.
- **AR-3** Record the tax invoice number against an invoice.
- **AR-4** Record a customer's payment and apply it to one or several invoices, including a part payment.
- **AR-5** See who owes what and how old it is; open the invoice behind any figure.
- **AR-6** Take a down payment and recover it across later claims; see what is still held.
- **AR-7** Cancel a wrong invoice and bill it again correctly.

### Director and finance director (Executive)
- **DIR-1** Start the day: is the business healthy, which projects are at risk, what waits for me.
- **DIR-2** Decide the purchases and claims that need my level, with the budget position in front of me.
- **DIR-3** Open any figure on the home screen and reach the records behind it.
- **DIR-4** See one project's money position: contract, invoiced, received, spent, committed, left.
- **DIR-5** See cash coming in and going out over the next weeks.
- **DIR-6** Read the month's management figures and export them.
- **DIR-7** Review the sales pipeline and what is stalling.

### Administrator (Admin)
- **ADM-1** Add a person, give them a role, and remove access when they leave.
- **ADM-2** Say who approves what, per project and above it.
- **ADM-3** Set up a new project with its customer, contract value, tax and budget (typed or imported).
- **ADM-4** Set up stores, items and units so the site can use Stock.
- **ADM-5** Keep company details, numbering, currencies and exchange rates right.
- **ADM-6** See what the organisation's plan includes and switch modules on or off.
- **ADM-7** Find out who changed a record and when.

### Contractor field operations under an umbrella contract (map #2516)

A contractor holds **one umbrella contract** with a client and runs that client's **work orders (call-offs)**
under it. Some material is client-supplied, work is measured against contract items, labour is by crew, and
equipment is part owned, part rented. Nothing here is one client's process: it is a day for any
contract-based contractor. The jobs below are walked exactly as §6's note describes — as that login, phone and
desktop, English and Bahasa — and map **#2516** carries the tickets.

**Status markers (as at 2026-11-20, production v0.42.0; round-3 fixes and additions on `dev`):** **walkable** = the job finishes end to end today ·
**partly** = a way exists but the named piece is missing · **waiting** = the ticket that delivers it is open.
Roles follow §1: project manager → Project Manager · site/field controller and storekeeper → Engineer ·
equipment manager → Project Manager or Engineer · finance → Finance · HR/admin → Admin · approvers → whichever
level holds the decision (Project Manager, Finance, Executive). From the 15 Dec release the built-in roles grow from 5 to 28 (#2709); the roles named in the jobs below are the function, and the five levels above are the base each new role starts from. Jobs added by the 21 Nov scope (owner, map #2516) read **waiting** with their ticket.

#### Project manager
- **CF-PM-1** When I open one work order, I want its scope and progress, what it has cost, what is billed and accepted, its documents and its open issues on one page, so I can run it without hopping between the project's tabs and modals. — *Where:* `/work-orders/:id` · *Tickets:* #2518 (page), #2521 (issues on it), #2531 (open tasks on it) · *Today:* **partly** — the work-order page is live with scope, cost, billing and documents (v0.42.0); its issues and open tasks join it on `dev` (#2521, #2531).
- **CF-PM-2** When a cost is entered, I want to say which work order and discipline it was spent on, so each work order's cost is right without disturbing the project totals I already trust. — *Where:* the cost's own form — `/timesheets`, `/procurement/:id` capture, `/stock/new/*`, `/equipment` · *Tickets:* #2517 · *Today:* **walkable**.
- **CF-PM-3** When work orders are under way, I want each one's planned budget beside what it actually cost and earned — per work order, per discipline and rolled up to the project — so I can see which ones make or lose money while there is still time to act. — *Where:* `/work-orders/:id` plan versus actual, project roll-up · *Tickets:* #2519, #2570 · *Today:* **partly** — cost, revenue, margin and the roll-up per work order are in production (v0.42.0); labour reaches a work order as hours, not money, until #2670, and profit per discipline waits on #2669.
- **CF-PM-4** When I take on a work order, I want to set its plan — direct and indirect budget, equipment hours, crews, revenue — so the actuals have something to be compared against. — *Where:* `/work-orders/:id` plan · *Tickets:* #2519 · *Today:* **walkable** — the plan and split editors are in production (v0.42.0).
- **CF-PM-5** When measured work moves toward an invoice, I want each billing stage with its checklist, attachments and age, so the invoice goes out complete and before the client's cut-off. — *Where:* project → Billing (claim stage plan, per-item reconciliation) · *Tickets:* #2522 · *Today:* **walkable** — stages, checklists, deadlines, retention and per-item reconciliation are in production (v0.42.0).
- **CF-PM-6** When a task belongs to a work order, I want it on that work order and unable to close without its photo or document, so "done" on site means there is evidence. — *Where:* `/my-tasks`, `/work-orders/:id`, `/incidents/:id` (issue → task) · *Tickets:* #2531, #2521 · *Today:* **partly** — a task names its work order with completion proof and issues carry photo, person in charge and escalation (v0.42.0); the page also shows issues and open tasks on `dev`.
- **CF-PM-7** When approved hours reach a work order, I want them costed at each person's rate, so a work order's manpower cost is in rupiah and idle time is money, not only hours. — *Where:* `/work-orders/:id` plan versus actual · *Tickets:* #2670, #2673 — labour reaches a work order as hours today, never as money · *Today:* **waiting**.
- **CF-PM-8** When I review a project, I want revenue next to cost per discipline, so I see which discipline makes or loses money. — *Where:* project roll-up · *Tickets:* #2669 (the cost per discipline exists today) · *Today:* **waiting**.
- **CF-PM-9** When a month starts, I want a revenue plan and a daily target per work order, so each day's revenue is read against what we aimed for, and the gap shows while there is time to act. — *Where:* `/work-orders/:id` · *Tickets:* #2671, #2672 · *Today:* **waiting**.
- **CF-PM-10** When a work order runs, I want to know if it is ahead or behind schedule and over or under cost, beside the S-curve, so I act early. — *Where:* `/work-orders/:id` · *Tickets:* #2597 · *Today:* **waiting**.
- **CF-PM-11** When a new work order is offered, I want an assessment checklist before I accept it, so we take only work we can deliver at a margin. — *Where:* candidate work order · *Tickets:* #2595 · *Today:* **waiting**.
- **CF-PM-12** When a work order is finished, I want a close-out checklist of certificates and material settlement, so it closes only when everything is done. — *Where:* `/work-orders/:id` · *Tickets:* #2593 · *Today:* **waiting**.
- **CF-PM-13** When I run many work orders, I want to group them by area and see each one's status colour, so I find the ones that need attention. — *Where:* work-order list · *Tickets:* #2668 · *Today:* **waiting**.

#### Site / field controller
- **CF-FC-1** When I finish a day on a work order, I want to enter what was done, who and what worked, what held us up and a photo of the paper form from my phone, so the day is validated the next day and its revenue is known without retyping. — *Where:* Daily site report (new phone screen) · *Tickets:* #1522 · *Today:* **walkable** — the daily site report with next-day validation by someone other than the author is in production (v0.42.0).
- **CF-FC-2** When my crew works a day, I want to tick its roster once, so each person's hours per work order exist without anyone retyping them into a timesheet. — *Where:* `/crews` roster tick · *Tickets:* #2528 · *Today:* **walkable** — crews and the once-a-day roster tick are in production (v0.42.0).
- **CF-FC-3** When something goes wrong on site, I want to raise it with a photo, name who must fix it and by when, be told when it is late and close it with proof, so site problems do not vanish into messages. — *Where:* `/incidents`, `/incidents/:id` · *Tickets:* #2521 · *Today:* **partly** — issues carry the work order, person in charge, photo and escalation (v0.42.0); the due time and the late warning are still missing.
- **CF-FC-4** When the site needs material for a work order, I want to request items, quantities and a needed-by date and have the right people approve in order, so stock moves to the work order without chasing approvals by message. — *Where:* `/material-requests`, `/material-requests/:id` · *Tickets:* #2524, #2571 · *Today:* **walkable** — the ordered approval chain with stand-ins and the cut-off is in production (v0.42.0); the fixes since the landing are on `dev`.
- **CF-FC-5** When plant or equipment worked today, I want to log its hours against the work order, so the cost lands on the right line. — *Where:* `/equipment` · *Tickets:* #2517 · *Today:* **walkable**.
- **CF-FC-6** When I have worked a week, I want to fill and submit my hours against the work order from my phone, so my approver has the week. — *Where:* `/timesheets` · *Tickets:* #2517 (attribution); the rest ships before the map · *Today:* **walkable**.
- **CF-FC-7** When a crew starts its day, I want each checkpoint recorded with a time and photo, so effective hours and lost time by cause are known and a missed start shows early. — *Where:* Daily site report · *Tickets:* #2594 · *Today:* **waiting**.
- **CF-FC-8** When the daily report is validated, I want the material it names to leave site stock, so stock and progress agree without a second entry. — *Where:* Daily site report, `/stock` · *Tickets:* #2676 · *Today:* **waiting**.
- **CF-FC-9** When something goes wrong on site, I want several tasks on one issue and the root cause recorded, and a closing-time report by department, so stalled issues are visible. — *Where:* `/incidents/:id` · *Tickets:* #2677, #2678 · *Today:* **waiting**.
- **CF-FC-10** When I run the day's safety checks before work, I want them recorded per work order and day, so there is proof they were done. — *Where:* Daily safety record · *Tickets:* #2596 · *Today:* **waiting**.
- **CF-FC-11** When material use nears a work order's plan, I want to be warned at two points, and told when a material request waits for my approval, so over-use is caught early. — *Where:* `/material-requests`, `/approvals` · *Tickets:* #2686, #2685 · *Today:* **waiting**.
- **CF-FC-12** When a worker is lent to another crew, I want them to follow the host crew's roster, and attendance against a target to show, so hours land on the right work order. — *Where:* `/crews` · *Tickets:* #2704, #2706 · *Today:* **waiting**.

#### Storekeeper
- **CF-SK-1** When a delivery arrives at the yard, I want to receive it into the yard or staging location and keep the delivery note with the document, so stock and its paper agree. — *Where:* `/stock/new/receive`, `/stock/documents/:id` · *Tickets:* #2523 · *Today:* **walkable** — yard and staging locations with document attachments are in production (v0.42.0).
- **CF-SK-2** When material moves warehouse → yard → work order, I want its picking slip or delivery note to travel with it, so the work order carries the right cost on issue. — *Where:* `/stock/new/transfer`, `/stock/new/issue` · *Tickets:* #2523 · *Today:* **walkable** — the delivery note travels as a document attachment and issues and transfers name the work order (v0.42.0).
- **CF-SK-3** When a client supplies material free of charge, I want it held at zero cost and to see what each work order holds, so I never bill it and never lose it. — *Where:* `/stock`, `/stock/ledger` · *Tickets:* #2523 · *Today:* **walkable** — zero-cost tags and the balance per work order are in production (v0.42.0).
- **CF-SK-4** When someone asks what happened to an item, I want its ledger, so I can answer from movements instead of memory. — *Where:* `/stock/ledger` · *Tickets:* none — shipped before the map · *Today:* **walkable**.
- **CF-SK-5** When stock is at or below its reorder level, I want to see it and act on a restock request. — *Where:* `/stock/reorder` · *Tickets:* none — shipped before the map · *Today:* **walkable**.
- **CF-SK-6** When I count the store, I want to record the difference, so the ledger matches what is on the shelf. — *Where:* `/stock/new/count`, `/stock/documents/:id/edit` · *Tickets:* none — shipped before the map · *Today:* **walkable**.
- **CF-SK-7** When material is sent and received, I want the receiver to recount and confirm it in PMO (name, time, count, photos; a person with no account signs on the account holder's phone), so shortfalls are recorded and nobody signs on trust. — *Where:* `/stock/new/transfer` · *Tickets:* #2690 · *Today:* **waiting**.
- **CF-SK-8** When approved material moves, I want a printed delivery note with signature blocks, and a daily list of movements still awaiting their signed paper, so paper and stock agree. — *Where:* `/material-requests/:id`, `/stock` · *Tickets:* #2687, #2689 · *Today:* **waiting**.
- **CF-SK-9** When stock is shared across work orders, I want to hold a quantity for one work order and see x free + y reserved, with borrowing from another work order going to approval, so planned material is there when needed. — *Where:* `/stock` · *Tickets:* #2693 · *Today:* **waiting**.
- **CF-SK-10** When leftover material moves from one work order to another, or goes out to a vendor and back, I want it recorded as one move, so both balances and the vendor location are right. — *Where:* `/stock/new/transfer` · *Tickets:* #2691, #2683 · *Today:* **waiting**.
- **CF-SK-11** When I add an item, I want a warning if a similar one exists, and a report of stock at risk against each location's cover, so the item master stays clean and exposed stock is seen. — *Where:* `/stock`, `/master-data/items` · *Tickets:* #2692, #2694 · *Today:* **waiting**.

#### Equipment manager
- **CF-EQ-1** When a machine is down or away, I want to mark its status each day with proof from my phone, so a broken machine is escalated and planned work does not assume it. — *Where:* `/equipment/availability` · *Tickets:* #2526 · *Today:* **walkable** — the daily status with the availability board is in production (v0.42.0).
- **CF-EQ-2** When I plan the week, I want each machine's availability and utilisation by day, week and month, so I can promise work against machines that exist. — *Where:* `/equipment/availability` · *Tickets:* #2526 · *Today:* **walkable** — availability and utilisation by day, week and month are in production (v0.42.0).
- **CF-EQ-3** When a rented machine stands idle, I want the downtime recorded and deducted when its invoice is checked, so we do not pay for time we did not have. — *Where:* `/equipment/availability` and the vendor bill · *Tickets:* #2526 · *Today:* **walkable** — status, availability and downtime off the rental bill are in production (v0.42.0).
- **CF-EQ-4** When equipment works or stands by, I want its hours on the asset and the work order, so cost and use are right. — *Where:* `/equipment` · *Tickets:* #2517 · *Today:* **walkable**.
- **CF-EQ-5** When a certificate or operator licence nears expiry, I want a warning with enough lead time, so no machine or operator works on an expired document. — *Where:* `/equipment/expiring`, `/equipment/assets/:assetId` · *Tickets:* #2527, #2542 · *Today:* **walkable** — expiring documents are added, edited and archived on the asset and person records (v0.42.0), and the warnings cover them.
- **CF-EQ-6** When I plan the month, I want an equipment and service plan that becomes rental orders, so nothing is ordered twice by hand. — *Where:* `/equipment` · *Tickets:* #2700 · *Today:* **waiting**.
- **CF-EQ-7** When a rented machine breaks, I want the vendor's response time, and the availability targets and escalation limit to be mine to set, so I can hold the vendor to it. — *Where:* `/equipment/availability` · *Tickets:* #2702, #2701 · *Today:* **waiting**.

#### Finance
- **CF-FIN-1** When a contract starts, I want its priced items in a catalogue — a rate per location variant, effective-dated, importable from a sheet — so every bill-of-quantities line is priced from one source. — *Where:* project → Billing → rate catalogue · *Tickets:* #2520 · *Today:* **walkable** — the rate catalogue with per-location variants and import is in production (v0.42.0).
- **CF-FIN-2** When a contract line is priced, I want the location's rate in force on the chosen date copied onto it, so a later amendment never rewrites history. — *Where:* contract-line (BOQ) form in project → Billing · *Tickets:* #2520 · *Today:* **walkable** — the rate in force on the chosen date copies onto the contract line (v0.42.0).
- **CF-FIN-3** When work is measured and billed, I want the stages, their documents, the retention and the per-item reconciliation on one screen, so I can raise the invoice and answer the client from the same place. — *Where:* project → Billing (claim staging, reconciliation) · *Tickets:* #2522 · *Today:* **walkable** — stages, their documents, retention and the per-item reconciliation are in production (v0.42.0).
- **CF-FIN-4** When a vendor bill arrives, I want it held until it matches the order and the receipt, with any exception approved with a reason by someone other than the person who entered it, so we never pay for goods we did not get. — *Where:* `/finance/payables` and the vendor-bill record · *Tickets:* #2525 · *Today:* **partly** — the gate and the SoD are in the database in production (v0.42.0); the switch, line entry and exception approval are on `dev` (#2622); the Admin setting for on or off and tolerance is #2634.
- **CF-FIN-5** When a site's expense claim or cash plan is approved, I want to reimburse the claim or top up the site and see what each site holds, so field spending keeps moving. — *Where:* `/expenses`, `/imprest` · *Tickets:* none — shipped before the map · *Today:* **walkable**.
- **CF-FIN-6** When the month closes, I want each work order's plan against actual and its margin after shared cost, so I can tell which work orders carry the contract. — *Where:* `/work-orders/:id`, project roll-up · *Tickets:* #2519, #2570, #2670 · *Today:* **partly** — plan vs actual with the shared-cost split is in production (v0.42.0); the manpower part is hours until #2670.
- **CF-FIN-7** When a claim moves through its steps, I want target days, an overdue warning, a template of steps per claim and one board of all claims by step and age, so I do not chase billing by message; a step waiting on me shows in my needs-you list. — *Where:* project → Billing, billing board · *Tickets:* #2592, #2680, #2681 · *Today:* **waiting**.
- **CF-FIN-8** When I plan the month's billing, I want candidates from progress not yet certified against a target, and the age of work done but not claimed, so I choose what to bill deliberately. — *Where:* project → Billing plan · *Tickets:* #2682, #2675 · *Today:* **waiting**.
- **CF-FIN-9** When I buy, I want a category and a needed-by date per line, a purchase type with a guided rental extension, a payment channel, and a printed order naming who may collect, so purchasing follows the right path. — *Where:* `/procurement` · *Tickets:* #2696, #2697, #2698, #2688 · *Today:* **waiting**.
- **CF-FIN-10** When requesters only request, I want them not to see prices, so pricing stays with purchasing and finance. — *Where:* organisation settings · *Tickets:* #2699 · *Today:* **waiting**.

#### HR / admin
- **CF-HR-1** When a badge, medical check or permit is about to lapse, I want the warning to reach the right people in time, so nobody works on an expired document. — *Where:* `/equipment/expiring` · *Tickets:* #2527, #2542 · *Today:* **walkable** — documents are added and edited on the person and asset records (v0.42.0) and the warnings cover them.
- **CF-HR-2** When I take someone on or renew a document, I want to add or edit it on the person's record with its attachment, so the warnings follow the real date. — *Where:* `/equipment/people/:personId` (new), `/equipment/assets/:assetId` · *Tickets:* #2542 · *Today:* **walkable** — the people register with add, edit, archive and attachments is in production (v0.42.0).
- **CF-HR-3** When I staff a work order, I want crews with people placed in them and a roster per work order, so attendance has names to record against. — *Where:* `/crews` · *Tickets:* #2528 · *Today:* **walkable** — crews, membership and the work-order roster are in production (v0.42.0).
- **CF-HR-4** When I set up a contract or site, I want Excel templates for rates, stock items, equipment, people and crews, with a file of the rows that failed, so I can load the master data without retyping. — *Where:* `/master-data/:kind`, project → Billing import · *Tickets:* #2530 (after #2520, #2526, #2528) · *Today:* **waiting**.
- **CF-HR-5** When the organisation calls a work order or client-supplied stock something else, I want to rename it once and have every screen, export and notification use our word in both languages. — *Where:* `/administration/terminology` · *Tickets:* #2529 · *Today:* **walkable** — the terminology screen renames terms across screens, exports and notifications in both languages (v0.42.0).
- **CF-HR-6** When someone joins or leaves, I want to add the person, give the role and remove access. — *Where:* `/administration` · *Tickets:* none — shipped before the map · *Today:* **walkable**.
- **CF-HR-7** When I set up a contractor, I want roles for the functions it has, in three levels, so each person sees and does what their job needs. — *Where:* `/administration` · *Tickets:* #2709 · *Today:* **waiting**.
- **CF-HR-8** When someone is being mobilised, I want a cleared-for-site checklist per person, so only cleared people go to site. — *Where:* `/equipment/people/:personId` · *Tickets:* #2707 · *Today:* **waiting**.
- **CF-HR-9** When someone cannot work, I want a leave or sick request with approval, so the roster follows; and I want former staff kept on record but out of the way. — *Where:* `/equipment/people` · *Tickets:* #2708, #2703 · *Today:* **waiting**.
- **CF-HR-10** When the organisation uses its own words, I want about twenty terms and every role name renameable, so every screen and notification uses them. — *Where:* `/administration/terminology` · *Tickets:* #2712 · *Today:* **waiting**.
- **CF-HR-11** When something needs me and I am not in the app, I want an email, and a scheduled report by email, and an icon on my phone's home screen, so I act without opening PMO to look. — *Where:* email, `/reports`, installable app · *Tickets:* #2711, #2714, #2713 · *Today:* **waiting**.

#### Approvers
- **CF-AP-1** When a material request reaches me, I want to see it against the plan and approve it in its order — with a stand-in named while I am away — so material moves without messages. — *Where:* `/approvals`, `/material-requests/:id` · *Tickets:* #2524 · *Today:* **walkable** — ordered approvals with a stand-in are in production (v0.42.0); pinning a step to a named person is on `dev` (#2598).
- **CF-AP-2** When I cannot approve, I want to send it back with a reason the requester sees. — *Where:* `/approvals`, `/material-requests/:id` · *Tickets:* #2524 (already the rule for purchases and claims) · *Today:* **walkable** — material requests return with a reason the requester sees (v0.42.0).
- **CF-AP-3** When a vendor bill does not match its order or receipt, I want to approve the exception with a reason, being someone other than the person who entered it, so the hold is deliberate and on record. — *Where:* `/finance/payables` and the vendor-bill record · *Tickets:* #2525 · *Today:* **partly** — the rule and the SoD are in production (v0.42.0); the exception panel is on `dev` (#2622).
- **CF-AP-4** When a crew's day is recorded, I want to approve those hours as the timesheet, so approved hours exist per person and work order. — *Where:* `/timesheets` · *Tickets:* #2528 · *Today:* **walkable** — the crew roster tick records the day and the week approves without retyping (v0.42.0).
- **CF-AP-5** When a field controller submits a daily report, I want to validate it — never my own — so the day's revenue counts only once checked. — *Where:* Daily site report queue · *Tickets:* #1522 · *Today:* **walkable** — the validation queue runs and the author cannot validate their own report (v0.42.0).
- **CF-AP-6** When things wait for my decision, I want one inbox where I can preview and approve or reject without drilling in. — *Where:* `/approvals` · *Tickets:* none — shipped before the map · *Today:* **walkable**.
- **CF-AP-7** When a purchase is approved, I want the approver chosen by amount tier as well as by budget position, so higher amounts reach more senior people. — *Where:* `/approvals` · *Tickets:* #2695 — routing is by budget position today, not by amount · *Today:* **waiting**.

#### Foreman (light account)
- **CF-FM-1** When I open PMO on my phone, I want one home screen with my own tasks, my crew's roster to tick, deliveries addressed to me and issues I reported, so I do my job without a full account. — *Where:* phone home screen · *Tickets:* #2710, #2709 · *Today:* **waiting**.
- **CF-FM-2** When I arrive at a work location, I want to clock in from my phone inside the work order's area and choose my crew, so attendance is recorded where the work is. — *Where:* phone home screen · *Tickets:* #2705 · *Today:* **waiting**.

#### Field user (light account)
- **CF-FU-1** When I am a worker, courier or receiver, I want my assigned tasks, clock-in where I am rostered, deliveries addressed to me to confirm with count and photo, and issues I reported, on one phone screen, so I see only what is mine. — *Where:* phone home screen · *Tickets:* #2710, #2690, #2705 · *Today:* **waiting**.

---

*Owner maintains the job priorities; the Director keeps the screen rows in sync as features ship. This is
the input every feature's intent check + the dual-substrate JTBD pass (gap doc §6b) grades against.*
