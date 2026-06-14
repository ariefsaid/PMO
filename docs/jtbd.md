# Jobs-to-Be-Done map — the Lens-D oracle (role × job)

**Status:** v0.1 seed (2026-06-14). The **oracle** that **Lens D — Product / Intent** grades every
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
| `/procurement` + `/:id` | PM / Finance | *When I manage procurement, I want to see each item's phase + what it's waiting on, and review evidence (quotes/GR/VI), so I can advance or approve spend.* | **Same preview paradigm as approvals/timesheets** — procurement objects must be **previewable before drill-in** (anchor #1, the calibration miss); advance-phase / approve-spend adjacent. |

### Master data (CRM)
| `/companies` + `/:id` | Finance / PM | *When I work an account, I want its record + related projects/contacts/opportunities, so I can act in context.* | Open → routable record (not a dead drawer); related objects clickable. |
| `/contacts` + `/:id` | PM | *When I follow up, I want the contact + activity history, so I can log the next touch.* | Log activity; jump to their company/opportunity. |
| `/incidents` + `/:id` | PM / Engineer | *When an incident is raised, I want its detail + status, so I can resolve and close it.* | Advance/resolve on the record — no dead-end (the routable-detail fix). |

### Admin / Reporting
| `/administration` | Admin | *When onboarding/offboarding, I want to manage users + roles, so access is correct.* | Create/edit user; assign role; archive. |
| `/reports` | Exec / Finance | *When I need to report out, I want to export/compose the numbers, so I can share them.* | Export (xlsx) / compose — *(placeholder today; job recorded for when built).* |

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

---

*Owner maintains the job priorities; the Director keeps the screen rows in sync as features ship. This is
the input every feature's intent check + the dual-substrate JTBD pass (gap doc §6b) grades against.*
