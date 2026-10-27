---
name: restructure
description: Restructure one screen's UX, IA and IxD with the owner — what it shows, how it's organised, how people move through it — in the current look.
disable-model-invocation: true
---

# Restructure

One screen at a time, with the owner as the judge and the design skills as the craft.
**Restructure** means the screen's structure changes and its look stays: same colours, type,
radii and basic controls. Use the word *restructure* in every prompt to a skill or reviewer.
impeccable reads *redesign* as "replace the visual world" and answers with new palettes and
styles; for impeccable this is a surface **inside the established world** (`new-work.md` §3).

## Scope

- **Fixed:** `DESIGN.md` tokens (colour, type, radii) and the basic controls — button, input,
  select, tabs, table, card, dialog, drawer, the comment box control.
- **Open — this is the work:** everything the page composes from them. Which blocks exist, what
  each one says, their order and grouping, emphasis through existing spacing and size tokens,
  where actions live, how you move between areas, what a role sees. The page's own blocks
  (money summaries, attention lists, headers, activity) get recomposed from scratch; moving the
  old blocks into a new frame is a **reshuffle**, and a reshuffle is not a restructure.

## Clean slate

Run in a fresh session, in a new worktree off `origin/dev` (copy `pmo-portal/.env.local` in).
Read only `PRODUCT.md`, `DESIGN.md`, `docs/ux/UX-STANDARD.md` and the screen's route code.
Earlier rulings, specs, plans, mockups and `CLAUDE.md`'s process sections stay closed: the
current screen is **evidence** of what the data and jobs are, never a template for the answer.
Do the design thinking in this session; reviewers critique, they never decide.

## Steps

### 1. Grill the business

Use the `grilling` skill, about the business, never about design: the owner is not a designer.
Rounds of 5–7 numbered questions, each with **your recommended answer first** so the owner
confirms or corrects. Before recommending anything that needs data, check the code that the data
exists. Cover: who opens the screen and in what situation; what each role needs in the first
five seconds; how people arrive (routine review, a link to one thing, a periodic run); how often
each area is used, per role; the phone job; what can leave the screen; the one main action per
state and role; what each role must not see; which seed records the screenshots use.

**Done when** the owner approves a brief of ≤ 25 lines: who and why · what leads per role ·
areas in order · what's removed · main action by state · screenshot set.

### 2. Three structural options

Build three options **in the real app** behind `?layout=a|b|c` (`?layout=off` = today's screen),
from the same recomposed blocks, on real-shaped seed data. They differ in structure only:
navigation model (tabs · one page with a jump menu · hub with drill-down pages), how the work
divides, what leads per role, where actions live. One of them is the familiar category standard.
Put shared figures behind one calculation so no two blocks can disagree.

Run **the full gate**. Then send the picking set — the busiest record as the top role and the most
restricted role, at 1440 and 390 (4 shots per option) — with your recommendation in two lines.
The owner may pick, or combine; a combination goes through the gate again.

### 3. Build the chosen option

Make it the real page; remove the other layouts and the switch. Delete tests that pin the old
look; keep and update behaviour, role, money and a11y tests; add translations. Run **the full
gate** once on every state: empty, loading, error, each tab or area, each drawer, each role, both widths,
light and dark, plus the pipeline/other status variants the screen has.

### 4. Owner clicks through

Give the local URL. Nothing merges until the owner has clicked through and said yes. Then the
normal PR to `dev` with the local gate. Last, append to **Lessons** below every point the owner
caught that the gate missed — one line each.

## The gate

Size the gate to the change, before anything reaches the owner:

- **Full gate** (all four steps below): a new set of options, a combination of options, and the
  finished build in step 3.
- **Light check** for a small edit — moving, removing or rewording one element, or fixing a
  reported finding: re-render the touched state, run the detector and axe, and re-run only the
  one reviewer whose finding it answers, or none when the owner asked for the exact change. Say
  in one line what was checked. Escalate to the full gate when the edit changes what leads,
  how areas divide, or where actions live.

1. Read impeccable's `reference/craft-floor.md` and https://impeccable.style/slop/ before the
   first edit of the session.
2. Render the states in question and dispatch four **independent** reviewers in parallel, each
   loading its skill: impeccable **critique**, impeccable **audit** (with the detector and axe),
   **taste** (`.claude/skills/taste`), **ui-ux-pro-max**. Give each the approved brief's
   **intent** — who opens this, the job, what must lead, what must stay quiet until needed —
   alongside the screenshots and route. Reviewers given only rules check the letter of them.
3. Apply impeccable **distill** and **clarify** yourself to the combined findings; fix every P0
   and P1, and each P2 that fits. Re-render; re-run the detector and axe.
4. Send the shots with one table per skill — *finding → what changed* — and a short list of what
   you left, each with its reason.

**Done when** a full-gate message carries all four tables, or a light-check message names what
was checked.

## Block craft

Each block answers one question for its reader:

- The answer comes first and largest; labels small and muted, values larger.
- Each figure appears once on the page; units, currency and tax basis once, in the block heading.
- Whole currency units. Missing data is said once, with the link that fixes it, and its figures
  are left out.
- Tight spacing inside a group, clearly larger between groups, from existing tokens.
- One filled primary action, chosen by the record's state and the viewer's role.
- Secondary things look secondary and sit where they're relevant: a quiet link on the screen
  they belong to, never a button beside the main navigation.
- A role sees only the areas it can use.

## Lessons

- Keeping "components" fixed got read as keeping the page's blocks; the options came back as a
  reshuffle. Scope above now separates basic controls from page blocks.
- Skill passes were skipped or run once on an older render; the owner caught slop (side-stripe
  cards, three equal hero figures). The gate now runs before every render.
- Reviewers checked "activity hidden until clicked" literally and passed a bordered button beside
  the tabs that invited the click. They now get the brief's intent.
- Project-wide activity was placed on every tab; it belongs on the overview only. Place a thing
  where its subject lives.
- Running all four reviewers on every small edit wasted tokens and time; small edits get the light
  check.
