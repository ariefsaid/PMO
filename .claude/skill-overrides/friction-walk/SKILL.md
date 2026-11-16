---
name: friction-walk
description: Use when walking the running app as a first-time person to find friction — before a release or a client demo, when the owner reports a friction, or to judge whether a role can finish a job from docs/jtbd.md §6.
---

# Friction walk

Walk one job as the person who does it and report every moment that person would stop and think.
**Friction** is the gap between what a person expects and what the app makes them do. Nothing has to be
broken: a job that finishes after a wrong turn, a retyped field or a cut-off drawer has friction.

The owner and real users are the reference. A walk pre-cleans the obvious; five real people doing the
jobs while thinking aloud is the real measure, and the walk never replaces it.

## Steps

1. **Pick the jobs.** Take the function's jobs from `docs/jtbd.md` §6, or the one job the owner named.
   A job that is not in §6 is added there first, with its "done when".
   *Done when* every job to walk has an id and a done-when.
2. **Stand the app up as that person meets it.** The build being released; an organisation shaped like
   the client's (ERP or none, currency, language); a real sign-in as a user with that role; fictional
   names only. Setup may use the repository: [`references/setup.md`](references/setup.md).
   *Done when* you are signed in as the role and the data the jobs need exists; write how you got there.
3. **Go blind.** From here you are a first-time person: use only what is rendered. Reach every screen by
   the menu and links that person has. Find controls by looking, the way they would.
   Measurements (contrast, target size, timings) are taken after a step, from the page.
4. **Walk each job**, phone (390) before desktop (1440), the client's language before the other.
   1. Before touching anything, write who you are today (role, device, hurry, what you know and what you
      have never seen) and the three steps you expect the job to take.
   2. On each new screen, first glance before reading: what you noticed first, second and third, and what
      you think the screen is for. Screenshot at actual size.
   3. At each step answer the **two questions**: *will this person know what to do here?* and *after
      doing it, will they know it was right and that they are closer?* A "no" is a friction: name its type.
   4. Open every drawer, dialog, menu and tab on the path. A screen one click deep counts.
   5. Count as you go: actions, screens, wrong turns, fields typed that the app already knew, things
      carried from one screen to another, seconds before each response.

   *Done when* the job reaches its done-when or is STOPPED, and it has a verdict:
   DONE CLEAN · DONE WITH FRICTION · STOPPED.
5. **Rank.** Give every friction a severity from 0 to 4 and sort by it. Money and data risk outrank
   convenience; a daily job outranks a yearly one.
6. **Report.** One table per function: job id, verdict, counts, each friction with type, severity,
   where, screenshot, and what the person expected instead. For every friction of severity 3 or 4, a
   ticket draft: job story, what happens today, what done looks like. List good friction separately.
   Report everything found; the reader ranks, the walker never trims to a top ten.
   *Done when* every job walked has a row and every friction has a type, a severity and a screenshot.
7. **Hand over.** The walker changes no code. Severity 3 and 4 become tickets with their job story under
   the right map; a finished job becomes a journey test named by its job id, written by the builder
   who fixes or owns that surface.

## Friction types

Name each friction by the thought the person has.

| Type | The person thinks | Count or measure |
|---|---|---|
| HESITATE | "Which one? What does this word mean?" | choices on screen; words read before acting |
| HUNT | "Where is it?" | scrolls, menus opened, searches before finding it |
| GUESS | "What will this do?" | actions taken without knowing the result |
| REPEAT | "Again?" | fields typed that the app already knew; steps redone |
| BACKTRACK | "Why am I here?" | unexpected landings; steps to get back |
| WAIT OR WONDER | "Did it work? Who has it now?" | seconds to feedback; missing confirmation |
| STOPPED | "Why can't I?" | the step that cannot be passed, and what the app said |
| DOUBT | "That number can't be right." | the two figures that disagree, and where each shows |
| STRAIN | "I can't see it properly." | cut-off or overlapping content; too much on one screen |
| ASK SOMEONE | "I'll just message him." | what the person would have to ask, and whom |
| CARRY | "Let me write that down." | items remembered or copied between screens (4 is the limit) |
| TRAP | "It let me do that?" | the mistake the app allowed; whether it can be undone |
| HABIT | "Every other app does this differently." | name the app or the other screen that set the habit |
| FIELD | "Not with one hand, in the sun." | targets under 44 px; contrast; does a half-filled form survive leaving |
| CONTROL | "How do I get out? Can I take it back?" | missing way out; unclear whether it is reversible or saved |
| GOOD FRICTION | "Good that it asked." | report apart: a confirm missing before money moves or something is destroyed, and a confirm that guards nothing |

When you say a habit is broken, name the everyday app that set it. If it is your own judgement with no
precedent, write "my opinion".

## Severity

| | Meaning | Typical type |
|---|---|---|
| 4 | The job cannot be finished, or money or data can go wrong silently | STOPPED, TRAP on money |
| 3 | Finishes only with help, a workaround or repeated wrong turns | ASK SOMEONE, BACKTRACK, CARRY |
| 2 | The person recovers alone after a pause | HUNT, GUESS, REPEAT, DOUBT |
| 1 | Noticed, costs nothing | cosmetic STRAIN |
| 0 | Not a problem for this person | |

Raise by one when the job is done daily; lower by one when it bites only the first time.

## What a walker cannot feel

A walker reads a whole screen at once, never tires and has no job at stake, so it under-notices exactly
the hunting and reading that wear a person down. Measure the proxy.

| The person feels | Measure |
|---|---|
| Frustration at lost work | characters and choices destroyed by an error, a reset or leaving the page |
| Fear of a mistake | whether the action shows what it will do, can be undone, and confirms before money moves |
| Tired eyes, sunlight | text contrast; amount of text read before the first action |
| Clumsy fingers | target size and spacing at 390 |
| Interruptions | whether a half-filled form survives leaving and coming back |
| Being lost | wrong turns and repeat visits to the same screen |

A walker also invents frictions a person would shrug off, and misses whether a trade term sounds right
to someone in that trade. Mark the first kind "my opinion"; leave the second to the owner.

Sources for every type, the severity scale and the two questions:
`docs/research/2026-11-16-human-friction-taxonomy.md`.
