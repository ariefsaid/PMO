---
name: restructure
description: Restructure one screen with the owner — what it shows, how it's organised, how people move through it, and how it looks within PMO's tokens — aiming at an information-rich, enterprise-grade ERP surface.
disable-model-invocation: true
---

# Restructure

One screen at a time, with the owner as the judge and the design skills as the craft.
**Restructure** means the screen's structure and its visual design are redone *within PMO's
tokens*: same colours, type, radii and controls, but the composition — cards, figure rows,
progress bars, steppers, timelines, charts, tinted status — is designed fresh with impeccable
(craft) and taste. Use the word *restructure* in every prompt to a skill: impeccable reads
*redesign* as "replace the visual world" and answers with new palettes; this is a surface
**inside the established world** (`new-work.md` §3).

**The aim** is `DESIGN.md`'s ERP-UX Aspiration: cohesive, enterprise-grade, information-rich,
strong visual hierarchy. Density means *information and actionability per screen*, not
compression. Minimal means no noise, never bare: a plain table with no features is a failure.

## Scope

- **Fixed:** `DESIGN.md` tokens (colour, type, radii, motion) and the basic controls.
- **Open — this is the work:** which blocks exist, what each says, their order, grouping and
  visual weight, the figures and their meaning, where actions live, how you move between areas,
  what a role sees. Moving the old blocks into a new frame is a **reshuffle**, not a restructure.
- **Floor:** everything the page can do today (The Feature-Floor Rule in `DESIGN.md`). Moving a
  feature behind a link or into a drawer is fine; dropping one needs the owner's word in the grill.

## The map

The whole-app order lives on the parent issue (#806) as a `wayfinder` map: one child issue per
screen, in the order the owner sets. A run takes the next open child, or the one the owner names.
A screen without a child issue gets one before step 1 (title `restructure(<screen>)`, label
`ux-owner`, linked under #806).

## Records

- **The issue** holds the **whole grill** — every question, the recommended answer and the
  owner's answer, one comment per round — then the approved brief, the owner's pick, and a
  closing comment. A later session reads the issue and never asks the owner the same question
  twice. The repo is public: roles and jobs only — no client names, people, or real figures.
- **`docs/private/restructure/<screen>/`** (local-only) holds the screenshots, the gate tables
  and the owner's own screenshots.
- **Lessons** (below) gets one line per point the owner caught that the gate missed.
- No other docs: no rulings, standards or specs come out of a run.

## Start from what exists

Run in a fresh session, in a new worktree off `origin/dev` (copy `pmo-portal/.env.local` in).
Read, in this order: the screen's issue (all comments — earlier grill answers are binding),
`PRODUCT.md`, `DESIGN.md` (the ERP-UX Aspiration and Feature-Floor Rule first),
`docs/ux/UX-STANDARD.md`, `docs/private/restructure/_reference/earlier-work.md` (your area),
the earlier portal's design spec `/Users/ariefsaid/Coding/RIS-portal-2/ref/design.md` (§0, §1,
§4.7, and your surface in §5), and the route code. Then write the **feature floor**: every
figure, filter, action, drawer and history the current page offers, plus what the earlier work
marks "take". Earlier PMO rulings, specs and mockups stay closed.

## Steps

### 1. Grill the business

Use the `grilling` skill, about the business, never about design: the owner is not a designer.
Rounds of 5–7 numbered questions, each with **your recommended answer first** so the owner
confirms or corrects. Before recommending anything that needs data, check the code that the data
exists. Cover: who opens the screen and in what situation; what each role needs in the first
five seconds; how people arrive (routine review, a link to one thing, a periodic run); how often
each area is used, per role; the phone job; what can leave the screen; the one main action per
state and role; what each role must not see; which seed records the screenshots use; and the
feature floor, item by item: keep, move, or drop.
A screen with tabs or areas: grill every one of them in this step, not after the pick.

Post each round's questions and the owner's answers on the issue as you go.

**Done when** the owner approves a brief of ≤ 25 lines (who and why · what leads per role ·
areas in order · feature floor decisions · main action by state · screenshot set), posted on the
issue.

### 2. Bake-off: three options on one clickable page

Show the three options as a **bake-off: one HTML page** (HTML, CSS and a little JS) with the
`orca-native-chat:orca-chat-visuals` skill, so the owner flips between them in place — never
words alone, never images stacked down or side by side. The page has:

- a switcher for the option (segmented buttons or a dropdown), plus one for role and one for
  desktop / phone width;
- each option **designed with impeccable (craft) and taste** in PMO's own look: copy the token
  variables from `pmo-portal/index.css` and use only those, inside a mock of the app frame
  (sidebar, header) at real width, with real block names and figures shaped like the seed
  records in the brief. Every option carries the full feature floor and the aspiration's
  affordances (tooltips, row drawer, `⋯` menu, figures with meaning, inline metadata);
- beside it, 3–5 lines on the option: navigation model (tabs · one page with a jump menu · hub
  with drill-down pages), how the work divides, what leads per role, where the main action
  lives — and your one-line recommendation.

The options differ in structure; one is the familiar category standard. One design pass, no
review rounds: send it within about 45 minutes, so a bad design shows up straight away. The owner
picks or combines in one reply. Save the page as `docs/private/restructure/<screen>/options.html`
and record the pick on the issue. Only the pick gets built in the app.

### 3. Build the chosen option

Build the chosen structure as the real page, matching the bake-off the owner picked. Builders
load impeccable (craft) and taste and work from the picked `options.html`. Split the build by tab
or area into parallel builders with disjoint files, never one after another. Delete tests that
pin the old look; keep and update behaviour, role, money and a11y tests; add translations. Then
run **the check** (below) once and show the owner.

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

## The check

One pass, no review-and-fix rounds before the owner sees it:

1. Render the brief's screenshot set (busiest record, top role and most restricted role, 1440
   and 390) and every other state once (empty, loading, error, each tab, drawer, role, dark).
2. Run impeccable's detector and axe; fix what they flag.
3. Tick the feature floor and the aspiration's affordances (a)–(f) against the render; fix gaps.
4. Send the owner the URL and the screenshot set, with one line on what was checked.

The owner may ask for a review by impeccable critique, taste or ui-ux-pro-max on a specific
point; run only that one, as an Orca worker, and fix what the owner agrees with.

## Block craft

Each block answers one question for its reader, and carries what's needed to act on it:

- The answer comes first and largest; its meaning sits beside it (variance, reason, trend, owner).
- Every figure on the page comes from one shared calculation, so the attention list, the money
  block and the main action always agree. Units, currency and tax basis stated in the heading.
- Whole currency units. Missing data is said once, with the link that fixes it. A figure claims
  only what the data proves (an overdue invoice with an unknown balance shows days overdue).
- Use the full vocabulary where it helps: cards that group a job, figure rows, threshold-coloured
  progress bars, stage steppers, timelines, small charts, tinted status pills, avatar chips.
- One filled primary action, chosen by the record's state and the viewer's role. Rare actions in
  row `⋯` menus or the record's menu, not deleted.
- A role sees only the areas it can use.
- On phone, every tab and action stays reachable: nothing clipped or covered by the action bar.

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
  cards, three equal hero figures).
- Reviewers checked "activity hidden until clicked" literally and passed a bordered button beside
  the tabs that invited the click. They now get the brief's intent.
- Project-wide activity was placed on every tab; it belongs on the overview only.
- Running all four reviewers on every small edit wasted tokens and time.
- One question at a time in the grill was too slow for the owner; batched rounds work.
- The owner combined two options (tabs for one-roof navigation + the hub's quiet activity);
  offer combinations when two options each win on a different axis.
- Building and gating three in-app options per screen took too long for the owner; options are
  now picked from a one-page HTML bake-off in PMO's tokens, and only the chosen one is built.
- Project detail took 2.5 hours: tabs were grilled after the pick and built one after another,
  then four reviewers checked every state. Grill all tabs first; build them in parallel.
- 2026-10-27: the stacked limits — "look stays", a quiet monochrome north star, ban lists in
  briefs, simplify passes and four reviewers' fix rounds — produced a plain table with fewer
  features than the page it replaced, after 3–4 hours. The skills now design the look within the
  tokens, the feature floor protects what exists, and the owner sees one pass, not review rounds.
- The grill lived only in the chat; a later session would have re-asked it. Every round now goes
  on the issue.
