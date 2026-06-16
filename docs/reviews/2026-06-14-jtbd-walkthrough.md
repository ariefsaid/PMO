# Lens D (JTBD) cognitive-walkthrough pass — dual-substrate, on `dev`

> ⚑ SUPERSEDED by ADR-0030 (2026-06-16). This is the NARRATIVE JTBD-walkthrough method, retired in favour of the enumerated CENSUS (docs/reviews/2026-06-14-jtbd-census.md) + the Discover→Graduate→Cover portfolio (docs/qa-portfolio.md). Kept for history; do NOT use it as a review method.

**Status:** COMPLETE (2026-06-14). The first run of **Lens D — Product / Intent (JTBD Cognitive
Walkthrough)** (charter: [`2026-06-14-intent-lens-gap.md`](2026-06-14-intent-lens-gap.md); oracle:
[`../jtbd.md`](../jtbd.md)). This is **discovery** — a triaged backlog of intent gaps to feed the next
build cycle, **not** a remediation. Owner triages priority.

## Method
Both substrates walked the **live `dev` app** (localhost:3000, solar-seeded: 16 projects · 19
procurements · 14 quotations · 7 timesheets), logging in as each screen's **primary role**, and graded
every primary screen against its job story in `docs/jtbd.md` §2 using the Lens-D 5 questions, re-confirming
the 3 calibration anchors:

- **Opus / vision substrate** (Playwright MCP) — judged above-the-fold ordering + actionability visually.
  14 gaps (1 Crit / 7 Imp / 6 Min). Raw: `/tmp/jtbd/opus-findings.md` + 30 screenshots.
- **gpt-5.4 / pi substrate** (agent-browser, DOM/a11y-tree) — cross-family. 12 ranked gaps. Raw:
  `/tmp/jtbd/pi-findings.md` + 27 screenshots.

The two ran in parallel with independent browsers. **The dual-substrate cross-check is the verification:**
where they diverged, the comparison resolved it (see §4).

---

## 1. Anchor re-confirmation (the owner's three calibration cases)

| Anchor | Verdict | Synthesis |
|---|---|---|
| **(a) Procurement has no preview; approvals/timesheets do** | **HOLDS — Critical** | *Both substrates, unanimous.* Inside one screen: `/approvals` Timesheets tab expands inline (full week grid) with **Approve/Return adjacent**; the Procurement tab has **no inline preview/approve** — it literally says *"Open a request to see its full budget impact"* and a click routes away to `/procurement/:id`. The asymmetry is visible within a single inbox. **Highest-confidence gap in the pass.** |
| **(b) Calendar on the project LIST, not clickable** | **HOLDS** | *Both.* A Calendar view exists but still sits on the project **list** (oracle: a calendar's job is schedule/deadline *actioning* → belongs in task/milestone detail), and its entries are **StaticText, not links** — clicking the lone event stays on `/projects`. Contrast: Board cards *are* clickable. Three list views, inconsistent openability (Table ✔ / Board ✔ / Calendar ✘). |
| **(c) S-curve above the fold, no adjacent action** | **PARTIALLY RESOLVED + re-appears pre-win** | *Substrates diverged; adjudicated to Opus (vision).* On **delivery** project detail the recent delivery-UI redesign moved the **actionable phase-stepper (Overdue badges + Edit-progress) ABOVE the S-curve** — worst form fixed. **Residual:** the full-height S-curve still sits *between* the stepper and the record tabs (pushing real work below the fold) and has no adjacent lever. **And it fully re-appears on pre-win opportunity detail** — an empty delivery planner + empty S-curve sit above the sales levers (a net-new find). |

---

## 2. Confirmed intent gaps (ranked, with confidence)

Confidence: **◆◆ both substrates** · **◆ one substrate (Director-confirmed via screenshot)**. Severity per
the Lens-D scale (Critical = breaks/dead-ends the job · Important = slow/surprising · Minor = friction).

| # | Conf | Sev | Gap | Route | Q / anchor | Fix direction |
|---|---|---|---|---|---|---|
| 1 | ◆◆ | **Critical** | Procurement approvals force a full drill-in while timesheets preview-and-approve **inline in the same inbox** | `/approvals` | Q5 / anchor a | Give the procurement row the same expand-in-place preview (budget impact + line items) + **Approve/Reject adjacent** the timesheet row has. |
| 2 | ◆◆ | Important | Exec dashboard **"Budget vs Actual" project rows are dead** — the exec's most decision-relevant exceptions ($0-spend / off-budget) can't be opened in one click (KPI *tiles* drill in; the exception *rows* don't) | `/` | Q4/Q5 | Make each exception row a link to `/projects/:id`, like every other project surface. |
| 3 | ◆◆ | Important | **Pre-win opportunity detail leads with empty delivery planner + empty S-curve**; the sales levers (win-prob, Opportunity-journey stepper, Advance/Mark-lost) are below the fold | `/sales/:id` | Q2/Q3 / anchor-c class | For pre-win lifecycle, lead with the Opportunity-journey + Next-actions card; demote/hide the delivery planner + S-curve until won. |
| 4 | ◆◆ | Important | **Project-list Calendar entries not clickable** + calendar is in the wrong place | `/projects` (Calendar) | Q2/Q4 / anchor b | Make entries open the project/milestone, **or** move a calendar to where dates are actioned (task/milestone detail) and drop the passive list view. |
| 5 | ◆◆ | Important | Project-detail **full-height S-curve sits between the stepper and the record tabs** and has no adjacent lever | `/projects/:id` | Q3/Q4 / anchor c residual | Collapse/shrink the S-curve or move it to an Analytics view; surface the tabs higher; link an Overdue phase to its blocking tasks/procurement. |
| 6 | ◆◆ | Important | **Company detail has no related objects** (projects / procurement / contacts / activity) — can't "act in context"; a vendor used across procurement shows only Name + Type + "No contacts yet" | `/companies/:id` | Q3/Q4 | Surface related projects + procurement (for vendors) + contacts as clickable lists. |
| 7 | ◆◆ | Important | **My Tasks** lacks open-task / log-time action **and** urgency ordering — a Done task sits above a To-Do, overdue dates carry no flag; "log time" forces a separate `/timesheets` trip with no task linkage | `/my-tasks` | Q3/Q4 | Sort/badge by due date (flag overdue); add a "Log time" action that pre-fills the task's project. |
| 8 | ◆ | Minor | Incident **location names a project but isn't a link** to it | `/incidents/:id` | Q4 scent | Link location/project → `/projects/:id`. |
| 9 | ◆ | Minor | Exec **"1 at-risk" subtext is not a link** to the at-risk filter | `/` | Q4 | Link "1 at-risk" → `/projects?filter=At%20risk`. |

**Screens that PASSED Lens D cleanly** (both substrates): `/timesheets` (engineer log — exemplary),
`/approvals` *baseline* (timesheet side is the gold-standard preview paradigm), `/procurement/:id` detail
(budget impact + advance/approve adjacent — excellent), `/incidents` (routable, advance action, no
dead-end), `/administration` (role levers adjacent), `/sales` *list* (stage kanban + weighted forecast).
The app is **largely intent-coherent** — routable records, advance actions adjacent — the gaps cluster in
**dead analytic displays** and the **procurement-preview asymmetry**.

---

## 3. The structural theme

Most gaps are one of two recurring shapes — worth fixing as **classes**, not one-offs:

- **Dead display class** (#2, #4, #5, #8, #9): an informative element that *names a record / signals a
  problem* but **isn't a link / has no adjacent lever** — fails Q4 "now what?". The fix is uniform: every
  record-naming or exception-signaling element opens the record or carries the recovery action.
- **Preview-asymmetry class** (#1): analogous approvable objects using different interaction paradigms.
  The fix is the §3 record verb **"preview-before-drill-in"** applied to procurement.

---

## 4. Substrate divergences + how they were adjudicated (the verification record)

| Item | Opus (vision) | gpt-5.4 (DOM) | Adjudication |
|---|---|---|---|
| Anchor (c) degree | PARTIALLY RESOLVED (saw stepper moved above S-curve) | HOLDS | **Opus.** Vision correctly observed the delivery-UI redesign; DOM-only missed the visual re-ordering. Recorded as partially-resolved + residual. |
| `/contacts` empty | UNVERIFIABLE (seed) — not a defect | **Critical** defect | **Opus.** It's a **seed-data** gap, not an app defect → reclassified to §5 (enrich the demo seed); removed from the gap list. |
| Timesheet review "displaced" to `/approvals` | not a gap (approvals is the right home) | Important gap | **Opus / by-design.** Unified `/approvals` is the deliberate coherence-wave decision (CW-6). Not a defect; at most a discoverability note. |

This is exactly the cross-family value the dual-substrate method exists to produce.

---

## 5. Not gaps — by-design or seed (recorded so they aren't re-raised)

- **`/contacts` empty + company "No contacts yet"** — **seed-data**, not design. Action: enrich
  `seed-demo-solar.sql` with contacts + activity history so the follow-up job is demonstrable. (Also makes
  gap #6's "related contacts" visible.)
- **Admin "New user" disabled** — known-deferred (server-side invites). Flagged, not routed.
- **Sales "New project" nouning** — by-design (coherence-wave one-noun "Project", CW-1). Residual
  mental-model oddity only.
- **Timesheet review in `/approvals`** — by-design (CW-6 unified approvals).

---

## 6. Recommended next step

Bundle the high-confidence items into a small **"intent-fix wave"** for the next build cycle, sequenced by
the structural theme (§3) so they're fixed as classes:

1. **Procurement preview-in-place** (#1, the Critical) — the canonical paradigm fix; biggest job impact.
2. **Dead-display sweep** (#2, #4, #5, #8, #9) — one pattern: make record-naming/exception elements open
   the record or carry the recovery lever.
3. **Pre-win record layout** (#3) — lifecycle-aware detail (sales levers first pre-win; delivery after won).
4. **Company-detail related objects** (#6) + **My Tasks urgency/log-time** (#7).
5. **Seed enrichment** (§5) — contacts+activity, so CRM jobs are demonstrable.

Each item routes through the normal per-issue loop; being intent gaps, they're now **Lens-D regression
candidates** (design-workflow §3a) — the fix should leave a component/e2e invariant so it can't silently
regress.

---

*Run by the Director, 2026-06-14, dual-substrate (Opus + gpt-5.4). Raw substrate reports + screenshots
under `/tmp/jtbd/` (not committed — regenerable). This doc is the synthesized, owner-facing record.*
