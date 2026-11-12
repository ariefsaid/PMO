---
name: restructure
description: Use when composing or recomposing a PMO app screen, restructuring its information and actions, or responding to an owner's complaint about hierarchy, density or layout.
---

# Restructure

Compose the whole screen around the person's job, inside PMO's tokens, with the owner as judge.
A calm screen is information-rich: reduce reading and competing marks while preserving useful facts and actions.
Use “restructure” in design briefs so craft skills work inside the established visual world.

## Authority and scope

- Keep `DESIGN.md` tokens and shared controls; compose blocks, grouping, order and weight afresh because a reshuffle does not decide hierarchy.
- Apply `docs/ux/screen-rules.md` to screens; external examples supply craft and evidence, never a replacement identity.
- Freeze the feature floor before any edit; simplification cannot silently remove a figure, capability or safeguard.
- Treat new data, calculations, routes and shared-component changes as explicit scope decisions; a screenshot cannot authorize business logic.
- Follow the signed brief, current executor routing and release ceiling in `CLAUDE.md`; this skill grants no push, merge or deployment permission.

## Records and resumption

- Use the named screen's child issue under #806; create a missing child before intake so each screen has a durable record.
- Keep every grill round, recommendation, owner answer, approved brief, direction, pick and closing comment on the issue so a successor does not ask twice.
- Keep screenshots, reference evidence, Preserve and gate tables in `docs/private/restructure/<screen>/`; public issues contain roles and jobs only.
- Keep reference images, product names, URLs and comparisons private; tracked records say “competitor review” where needed because the repository is public.
- Before compaction or handoff, record mode, issue, owner words, frozen floor, source commits, current render, gates, unresolved items and next executable step in the private record.
- Resume by reading that record and the issue's full comments, then the actual code and render; a prior “passed” claim cannot prove a later commit.
- Add one line to Lessons for an owner catch the method missed; a run produces records, not a competing spec or standards document.

## Start from what exists

Use an isolated Orca worktree at the Director's named base (default `origin/dev`); preserve existing work on takeover.
Read the issue and all comments, `PRODUCT.md`, `DESIGN.md`, `docs/ux/screen-rules.md`, `docs/ux/UX-STANDARD.md`, and the route code.
Read the area's earlier-work and owner-design-comments files under `docs/private/restructure/_reference/` when present; request missing evidence rather than inventing its contents.
Run `bash scripts/prior-art.sh <screen-term>` before proposing work; reopen an earlier spec only when a binding decision or dependency points to it.
Render the current busiest useful state and walk its controls; code and screenshots together establish what must survive.

## Two entry modes

| Entry | Required input | Completion criterion |
|---|---|---|
| **With the owner** | Business grill below | Owner approves the brief before composition |
| **Director-run** | Existing owner direction or complaint, quoted verbatim in the brief | Director records scope and assumptions; the owner's words remain binding |

Director-run skips the grill; it does not infer consent to drop a feature or bypass the owner's final rendered judgement.
An ambiguity about business meaning, a drop or conflicting owner directions goes to the Director/owner before dependent edits.

## Run in this order

### 1. Job and job walk

Write one line: who arrives, what they need to do, and the observable finish; quote the owner's words beside it.
Walk from arrival to finish, recording pass/fail and visible evidence for each check:

1. The first step leads the eye and its primary control is reachable; competing chrome must not conceal the job.
2. Each decision has its evidence beside it; a person should not decide blind.
3. Every fact and action the job needs exists; a clean frame cannot compensate for missing work.
4. Labels, repeated values and totals agree; the screen must tell the truth.
5. Each reachable state permits progress or explains the remedy; a failed request must not become a dead end.
6. Text, contrast, keyboard and touch minimums hold; the intended person must be able to use it.

For each failure, name who does what and gets which wrong outcome; a preference is recorded as judgement.
**Done:** job, owner words, state/role inventory and six-check walk are in the brief.

#### With the owner: grill the business

Use `grilling`: rounds of 5–7 numbered questions, recommended answer first, about work rather than visual design.
Before recommending a figure or action, check that the data and permission exist in shipped code.
Cover role and situation, first five seconds, arrival path, frequency per area/role, phone job, what can move, primary action per state, restricted information, screenshot records and each floor decision.
Grill every tab and area now so composition does not reopen business scope after the pick.
Post each round's recommendations and answers on the issue as it finishes.
**Done:** owner approves a brief of ≤25 lines covering who/why, lead per role, areas, floor decisions, primary actions and screenshot set; link the detailed floor separately.

### 2. Feature floor = frozen Preserve list

Write the list item by item **before changing anything**; include figures and their meaning, charts, filters, search, actions, menus, drawers, history, scope/consequence/optional cues, exports and analytics behaviour.
Record `item | current home + evidence | keep / move / drop | after home + link | owner's exact words for a drop | proof`.
Keep the domain, token system, real data, permissions and outside-of-screen boundary at the top; these prevent reference-driven drift.
A moved item needs a working, discoverable link to its named home; if none exists, retain it lower on the screen.
A drop needs the owner's explicit words naming that item; a word budget or “simplify” is not permission.
**Done:** every existing item has a disposition; the before captures, source commit and floor are frozen together.

### 3. References and moves

Read [references/references-and-moves.md](references/references-and-moves.md) whole before choosing a direction.
Use the **SCREEN shelf**, `docs/private/references/<screen-kind>/`, for what an analogous business screen shows; collect three references first when the kind has fewer than three verified images.
Use the **CRAFT shelf**, stageshow's runnable examples, for how a part is built; it cannot answer what a dashboard, approval queue or invoice screen should contain.
Look at real images and renders, group structural directions, take ONE direction whole, and grade each claim: two products = precedent; one = example; none = “my opinion”.
Write at most five moves, each with the screens showing its exact decision; a longer fix list on one screen returns to whole-screen composition.
**Done:** chosen direction, rejected direction's reason, evidence grades and move table are saved; no claim relies on memory.

### 4. Compose the whole screen once

Read [references/compose.md](references/compose.md) and taste's `references/app-screens.md` whole now; its app run supplies composition, while PMO supplies tokens and business meaning.
Write the one question, one data finding, dominant answer, all first-screen blocks, one grid with arithmetic, and the data-truth contract before building.
Build the coherent composition in real code through an Orca `ui-implementer`; card-by-card patches cannot substitute for a whole-screen decision.
When directions must be explored, build real isolated branches with the same floor and data, then let the owner pick one; use captured app renders for comparison.
**Done:** the whole running screen answers the brief, every move is visible and every floor item has its after home.

### 5. Craft pass

Read [references/craft.md](references/craft.md) whole; inspect grouping, aligned columns, insets, optical balance and type steps because parts must read as one design.
Run the relevant CRAFT example and inspect its computed styles before borrowing a relation; adapt it through existing PMO primitives.
**Done:** each visible craft fault has a measured correction or a defended relation, including the bottom and corners.

### 6. States and phone are compositions

Compose 390 separately around the phone job: task/list and evidence first, summary figures below or disclosed, every action reachable.
Render 1440, 768 and 390; both themes and languages; top and restricted roles; busiest, new/empty, known-zero, unknown/partial, loading, error, permission and long-content states.
Walk every tab, drawer, form, menu, retry and return path; keep typed work and focus because stills do not prove interaction.
**Done:** a private route × role × state × width × theme × language matrix links each tested cell to a capture or journey result; untested cells are named, never marked passed.

### 7. Gates and losses

Read [references/gates.md](references/gates.md) whole and run its proof set; each gate names the failure it prevents and the limits of its measurement.
Builders run targeted checks; the Director runs the full unit-containing `npm run verify:locked` once on the integration branch at batch end to catch losses outside touched files.
Classify every red as stale look-pin, real loss to restore or evidenced flaky failure; restore behaviour before repairing an oracle and finish with no unresolved reds.
**Done:** floor reconciliation, honest-data proofs, local gates, inspector output and the batch losses check identify the tested commit and have no unexplained failure.

### 8. Director rendered judgement, then owner

Read [references/judging.md](references/judging.md) whole; the Director answers its critique questions against actual-size renders and thumbnails, not just before-shots or gate totals.
Use one Director review and one fix round; if the whole shape still fails, stop patching and return the composition decision to the Director.
At batch end, a blind fresh-eyes review is scored privately against a hidden list; authors' familiarity is not acceptance evidence.
Show the owner the before/after image, screenshot set and local URL with a short report claiming only visible changes; the owner judges and clicks through.
**Done:** the owner explicitly accepts the rendered result and the recorded floor; passing scripts alone never earns visual sign-off.

## Who does what

| Work | Executor |
|---|---|
| Whole-screen composition and rendered judgement | Design-grade model: Opus `ui-implementer` / `design-reviewer` |
| Reference collection for a screen kind, before composition (open public product pages, save screenshots and index) | Cheap model; the composer chooses the direction |
| Measured audits, class sweeps, test repair, copy and i18n | Cheapest model that can run the script and preserve its oracle |
| Money, dates and permissions | Terra or above; use the applicable subsystem and review gates |

A defect class found by eye gets an app-wide cheap read-only audit that day, then scoped repairs: fix the class, not the instance.
The Director supplies the full brief and role contract to every fresh Orca worker; a measured audit cannot substitute for design judgement.

## Ship and clean up

Follow current `CLAUDE.md` branch, batching and CI gates after owner acceptance; this skill does not override them.
Close the issue with evidence, the owner's pick and any explicit deferral; append Lessons before context is lost.
Archive final captures and gate tables privately, stop only your exact dev-server PID, delete only the local seed rows you logged, then remove working images and branches/worktree through the normal cleanup.
Keep Orca chat images because the conversation still renders them; verify cleanup rather than asserting it.
**Done:** accepted work has landed within the authorized ceiling and no run-owned server, seed row or disposable workspace remains.

## Gotchas

- The app scrolls in an inner pane; capture both the first viewport and the complete pane so a “full-page” shot does not hide lower content.
- Use an owned foreground server session and verify its URL before captures; a terminated server cannot prove the current code.
- Render restricted roles as well as the top role; a shared screen can fail only on one branch.
- Log screenshot seed rows before creating them; the local database is shared and cleanup must be exact.

## Lessons

- Fix tokens and basic controls, not the old page blocks; keeping “components” fixed once produced only a reshuffle.
- Craft passes must judge the current render; an older pass cannot clear later side stripes or equal-weight figures.
- Review intent as well as literal visibility; a prominent invitation to open hidden activity still interrupts the job.
- Project-wide activity belongs on the overview, not repeated on every tab.
- Right-size reviews; repeating a full reviewer battery for every small edit consumes time without deciding composition.
- Batched grill questions work; one question per turn made business intake too slow.
- Earlier runs combined options; the current run takes one direction whole and records a new owner direction explicitly.
- Earlier static bake-offs replaced expensive in-app variants; the current run uses real branches when exploration is needed.
- Grill every tab before the pick; staged discovery and serial rebuilding previously delayed the screen.
- Stacked quieting rules once produced a plain table with fewer features; information and actionability are the floor.
- Persist the whole grill on the issue; a chat-only answer disappears for the next Director.
- A shrinking word count is useful only with a reconciled Preserve list; preserve meaning before trimming copy.
- Compose the whole screen before polishing its cards; a better card can still leave an accidental dashboard.
- Batch losses need the integration suite and blind review; touched tests and familiarity cover different things.
