# Review-methodology gap: the user-intent / Jobs-to-Be-Done lens ("Lens D")

**Status:** GAP IDENTIFIED (2026-06-14, owner-flagged). To be **codified into the per-issue + design
workflow** and then run as a pass on `dev`. This doc is the charter for that work.

> **Why this matters now:** we build **feature-by-feature, continuously**. Every feature that ships
> without an intent check accumulates the exact class of defect below — defects that *pass* code review,
> security, and the design 3-lens, yet leave the app feeling wrong to a real user. This lens has to be
> a standing gate, not a one-off audit.

---

## 1. The gap, in one sentence

Our review cadence verifies that the app is **correctly built, secure, internally consistent, and
conventionally usable** — but **nothing verifies that a feature/screen/placement matches the *job the
user came to do* and their *mental model* of how it should work.** Intent-fit is currently no one's oracle.

## 2. What this discipline is called

The owner's "business logical flow from user intent" is the intersection of several established frames:

- **Jobs-to-Be-Done (JTBD)** — the strategic frame. A user "hires" a screen to get a job done
  (*"is this project on track and what do I do next?"*). You grade the screen against the **job**, not
  against the spec or internal consistency. The test oracle is a **job story**:
  *"When [situation], a [role] wants to [motivation] so they can [outcome]."*
- **Cognitive Walkthrough** — the evaluation *method*. For each action ask the 4 questions:
  (1) will the user try to do the right thing? (2) will they **notice** the control exists?
  (3) will they associate it with their goal? (4) after acting, will they **see** they progressed?
- **Norman's Gulf of Execution / Gulf of Evaluation** — the *theory*: the distance between the user's
  intent and the system's affordances (execution) / feedback (evaluation).
- **Information scent / foraging** — does an affordance *signal its job*? ("a calendar view that isn't
  clickable — what is it for?")
- **Insight→Action / decision-support** — does a data display drive a decision/next action? The
  *"so what / now what?"* test. (An S-curve that shows "behind plan" with no adjacent action fails it.)

Compact label for our use: **a "Jobs-to-Be-Done–driven product critique" — *Lens D: Product / Intent*.**

## 3. Anchor examples (the owner's, mapped to the frame)

These are the calibration cases — any future Lens-D prompt should still catch them:

| Observation | The frame it violates |
|---|---|
| Approvals & timesheets have a clickable **preview**; procurement does **not** (must drill in first). | **Mental-model inconsistency** — analogous objects must share one interaction model; the user *expects* "preview before drill-in" everywhere. (Gulf of Execution.) |
| **Calendar view on the project *list*** isn't clickable; why isn't a calendar in the **task detail** instead? | **Job + information scent** — the view has no clear job and sits in the wrong place in the PM's mental model. A calendar's job is schedule/deadlines → it belongs where dates are *actioned* (tasks), not as a passive list view. |
| **S-curve above the fold**, all record tabs below; what does a PM *do* with the S-curve? | **Priority-by-job + actionability** — above-the-fold must be what drives the role's decision; an S-curve with no adjacent action fails *"now what?"*. Ask: what does a PM expect to see first, where, and how do they act on it? |

Common thread: **all three pass consistency/IxD-naturalness checks and fail only against user intent.**

## 4. Why the current cadence misses it (the oracle problem)

Each reviewer grades against the wrong oracle for *intent*:

| Reviewer / lens | Oracle today | Catches intent-fit? |
|---|---|---|
| spec-reviewer | the spec/plan (conformance) | No |
| code-quality / security | code standards / OWASP-RLS | No |
| design **Lens A** (visual) | DESIGN.md tokens, AI-slop | No |
| design **Lens C** (IA/structure) | one-canonical-home, nav conventions | Partly (structure only) |
| design **Lens B** (IxD/task-flow) | "is the flow *natural/smooth*" (impeccable `critique`: Nielsen-10 + cognitive-load + 5-persona) | **Closest — but scoped to *naturalness*, not *job-fit*** |

Two root causes:
1. **No oracle artifact.** There is no document that states **what each role's jobs even are**, so
   "does this match intent" has nothing to grade against — it collapses into opinion. The intake grill
   captures terminology + `[OWNER-DECISION]`s, **not job stories**.
2. **Lens B is naturalness-scoped.** It asks "is this flow smooth and consistent," not "is this the
   *right thing, in the right place, for the user's job*, and can they *act* on it." The owner's three
   cases sail through a naturalness review.

The skills supply the craft (`impeccable critique`'s persona walkthrough + Nielsen #2 "match the real
world"; `ui-ux-pro-max` UX rules; `taste`), but **the JTBD oracle + the cognitive-walkthrough method as
the *primary* lens + the intent intake hook are net-new to our methodology.**

## 5. What to add — three pieces

### 5a. Foundation artifact — a Role × Jobs-to-Be-Done map (`docs/jtbd.md`)
A living doc: for each role (Executive / PM / Engineer / Finance / Admin), the **job stories** and, per
primary screen, the **top jobs the user came to do**. This is the **oracle** Lens D grades against and
the input every feature's intent check needs. Updated per feature (continuous).

### 5b. Lens D — "Product / Intent (JTBD Cognitive Walkthrough)"
A new review lens, run by `design-reviewer`, at **both** the mockup gate (round 1) and post-build
(round 2) — exactly like the existing 3-lens, making the FE battery a **4-lens** battery. For every
screen/feature it interrogates (graded against `docs/jtbd.md`):
1. **Job** — what job did the user come here to do? (state it as a job story.)
2. **Expectation** — does the user *expect* this feature/affordance *here*? Does it match their mental
   model + domain convention? (placement, naming, where-it-lives.)
3. **Priority/placement** — is information/affordance ordered by **decision-relevance** to the job
   (most-decision-relevant above the fold)?
4. **Actionability** — *"so what / now what?"* — can the user **act** on what they see, in one step?
   Is the next action adjacent to the insight?
5. **Mental-model consistency** — do analogous objects share one interaction model (preview, drill-in,
   create, advance)? (the procurement-preview class.)

Output + severity like the other lenses; findings route back to `ui-implementer`.

### 5c. Intake hook — capture the job story before spec
The `grill-with-docs` intake (and `feature-forge`) must capture the **job story** for each new feature
*before* spec, so the spec/plan are **intent-anchored**, not just behaviour-anchored. The job story
becomes a binding input to the mockup + Lens D.

## 6. Execution plan (post-compaction)

Run **(a) then (b)** — (b) needs (a)'s oracle to grade against:

**(a) Codify the methodology** (this is the durable, must-do part — we build feature-by-feature):
- Author `docs/jtbd.md` (role × job map; seed from the existing roles + screens).
- Add **Lens D** to `docs/design-workflow.md` §1a (mockup round 1) and §2.3 (post-build round 2) — the
  FE battery becomes **4-lens**, run **twice**.
- Update the `design-reviewer` agent (`.claude/agents/design-reviewer.md`, → regenerate `.codex`) with
  the Lens-D interrogation + the calibration anchors (§3 above).
- Add the **job-story step** to the grill / intake (`docs/director-playbook.md` §2 step 1, +
  `feature-forge`).
- Note it in `DESIGN.md` and `docs/product-expectations.md` (Part C) as a binding gate.
- Reference from `docs/backlog.md` + `docs/README.md`.

**(b) Run a dual-substrate JTBD cognitive-walkthrough pass** on the current `dev` app (Opus + gpt-5.4,
like the coherence audit) — surface the *full* list of intent mismatches beyond the three anchors;
feed the confirmed ones into the next build cycle, and the recurring ones become Lens-D anchors.

## 7. How it fits the continuous, feature-by-feature workflow

- `docs/jtbd.md` is a **living foundation artifact** — each new feature adds/updates its role's job
  stories during intake.
- Lens D is a **standing gate**, run at the mockup gate and post-build for **every FE issue** — so
  intent-fit is checked *before* code exists (cheap) and again on the built result (drift).
- Discovery → regression: confirmed Lens-D findings that are observable become e2e/component invariants
  at the lowest sufficient layer (per ADR-0010 / the design-workflow §3a discovery→regression rule),
  so an intent fix can't silently regress.

---

*Owner flagged this gap 2026-06-14 after the coherence wave; it is the one structural piece the
otherwise-rigorous cadence was missing. Codify (a) first, then run (b).*
