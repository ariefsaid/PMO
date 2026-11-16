# Jobs-to-Be-Done map — the Lens-D oracle (role × job)

**Status:** v0.2 (2026-11-16: §6 jobs by function added; §2 screen rows are the June seed and predate Stock, billing claims, expenses and site cash). First written 2026-06-14. The **oracle** that **Lens D — Product / Intent** grades every
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

---

*Owner maintains the job priorities; the Director keeps the screen rows in sync as features ship. This is
the input every feature's intent check + the dual-substrate JTBD pass (gap doc §6b) grades against.*
