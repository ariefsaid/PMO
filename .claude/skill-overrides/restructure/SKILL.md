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

## The map

The whole-app order lives on the parent issue (#806) as a `wayfinder` map: one child issue per
screen, in the order the owner sets. A run takes the next open child, or the one the owner names.
A screen without a child issue gets one before step 1 (title `restructure(<screen>)`, label
`ux-owner`, linked under #806).

## Records

- **The issue** holds the approved brief, the owner's pick, and a closing comment with what
  changed and what was left. The repo is public: roles and jobs only — no client names, people,
  or real figures.
- **`docs/private/restructure/<screen>/`** (local-only) holds the screenshots, the gate tables
  and the owner's own screenshots.
- **Lessons** (below) gets one line per point the owner caught that the gate missed.
- No other docs: no rulings, standards or specs come out of a run.

## Clean slate

Run in a fresh session, in a new worktree off `origin/dev` (copy `pmo-portal/.env.local` in).
Read only `PRODUCT.md`, `DESIGN.md`, `docs/ux/UX-STANDARD.md`, the screen's issue and its route
code. Earlier rulings, specs, plans, mockups and `CLAUDE.md`'s process sections stay closed: the
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
A screen with tabs or areas: grill every one of them in this step, not after the pick.

**Done when** the owner approves a brief of ≤ 25 lines (who and why · what leads per role ·
areas in order · what's removed · main action by state · screenshot set), posted on the issue.

### 2. Bake-off: three options on one clickable page

Show the three options as a **bake-off: one HTML page** (HTML, CSS and a little JS) with the
`orca-native-chat:orca-chat-visuals` skill, so the owner flips between them in place — never
words alone, never images stacked down or side by side. The page has:

- a switcher for the option (segmented buttons or a dropdown), plus one for role and one for
  desktop / phone width;
- each option drawn in **PMO's own look**: copy the token variables from `pmo-portal/index.css`
  and use only those (no new colours, fonts, radii or shadows), with real block names and
  real-shaped sample figures from the seed records in the brief;
- beside it, 3–5 lines on the option: navigation model (tabs · one page with a jump menu · hub
  with drill-down pages), how the work divides, what leads per role, where the main action
  lives — and your one-line recommendation.

The options differ in structure only; one is the familiar category standard. Run the craft rules
(Block craft below) and impeccable's detector on the page before sending. The owner picks or
combines in one reply. Save the page as `docs/private/restructure/<screen>/options.html` and
record the pick on the issue. Only the pick gets built in the app.

### 3. Build the chosen option

Build the chosen structure as the real page (remove any option prototypes and switch). Split the
build by tab or area into parallel builders with disjoint files, never one after another. Delete
tests that pin the old look; keep and update behaviour, role, money and a11y tests; add
translations. Run **the full gate** once, the four reviewers on the screenshot set from the brief
(busiest record, top role and most restricted role, 1440 and 390). Every other state (empty,
loading, error, each tab, drawer and role, dark, status variants) gets a render plus the detector
and axe only; look at each yourself.

### 4. Owner clicks through, then ship and clean up

Give the local URL. Nothing merges until the owner has clicked through and said yes. Then:

1. Local gate, PR to `dev` that closes the issue, CI green, merge.
2. Closing comment on the issue; append to **Lessons**.
3. Cleanup, each step verified: stop the dev server you started (its exact PID); delete any
   rows you added to the local database for screenshots; copy the final shots and gate tables
   into `docs/private/restructure/<screen>/`, then delete every working image (`/tmp` shot
   folders, captures inside the worktree). Leave the images in the Orca chat folder: the chat
   still shows them, and Orca removes them with the chat. Then the post-merge cleanup in `CLAUDE.md` (worktree,
   local and remote branch).

**Done when** the issue is closed, the PR merged, and no server, seed row, working image,
worktree or branch from this run remains.

## The gate

Size the gate to the change, before anything reaches the owner:

- **Full gate** (all four steps below): the finished build in step 3, and any option the owner
  asked to see built.
- **Light check** for a small edit — moving, removing or rewording one element, or fixing a
  reported finding: re-render the touched state, run the detector and axe, and re-run only the
  one reviewer whose finding it answers, or none when the owner asked for the exact change. Say
  in one line what was checked. Escalate to the full gate when the edit changes what leads,
  how areas divide, or where actions live.

Full gate:

1. Read impeccable's `reference/craft-floor.md` and https://impeccable.style/slop/ before the
   first edit of the session.
2. Render the states in question and dispatch four **independent** reviewers in parallel, each
   loading its skill: impeccable **critique**, impeccable **audit** (with the detector and axe),
   **taste** (`.claude/skills/taste`), **ui-ux-pro-max**. Give each the approved brief's
   **intent** — who opens this, the job, what must lead, what must stay quiet until needed —
   alongside the screenshots and route. Reviewers given only rules check the letter of them.
   Hold source edits until all four report: they read the code.
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
- Every figure on the page comes from one shared calculation, so the attention list, the money
  block and the main action always agree.
- Whole currency units. Missing data is said once, with the link that fixes it, and its figures
  are left out. A figure claims only what the data proves (an overdue invoice with an unknown
  balance shows days overdue, never the full invoice as owed).
- Tight spacing inside a group, clearly larger between groups, from existing tokens.
- One filled primary action, chosen by the record's state and the viewer's role: what the data
  says matters most now (chase an overdue payment before raising a new invoice).
- Secondary things look secondary and sit where their subject lives: a quiet link on the screen
  they belong to, never a button beside the main navigation, never repeated on every tab.
- A role sees only the areas it can use.
- On phone, every tab and action stays reachable: check that nothing is clipped or covered by
  the bottom action bar.

## Gotchas

- The app scrolls inside an inner pane, so a full-page screenshot stops at the fold: size the
  viewport to the content height before capturing.
- A dev server started in the background dies at the tool's time limit: start it with the
  maximum timeout, and check it's alive before each round of shots.
- Render every role before sending: a missing translation hook crashed only the restricted
  role's view.
- Seed rows added for screenshots (comments, records) live in the shared local database: note
  each one as you add it, and delete them all in cleanup.

## Lessons

- Keeping "components" fixed got read as keeping the page's blocks; the options came back as a
  reshuffle. Scope above now separates basic controls from page blocks.
- Skill passes were skipped or run once on an older render; the owner caught slop (side-stripe
  cards, three equal hero figures). The gate now runs before every render.
- Reviewers checked "activity hidden until clicked" literally and passed a bordered button beside
  the tabs that invited the click. They now get the brief's intent.
- Project-wide activity was placed on every tab; it belongs on the overview only.
- Running all four reviewers on every small edit wasted tokens and time; small edits get the
  light check.
- One question at a time in the grill was too slow for the owner; batched rounds work.
- The owner combined two options (tabs for one-roof navigation + the hub's quiet activity);
  offer combinations when two options each win on a different axis.
- Building and gating three in-app options per screen took too long for the owner; options are
  now picked from a one-page HTML bake-off in PMO's tokens, and only the chosen one is built.
- Project detail took 2.5 hours: tabs were grilled after the pick and built one after another,
  then four reviewers checked every state. Grill all tabs first; build them in parallel.
