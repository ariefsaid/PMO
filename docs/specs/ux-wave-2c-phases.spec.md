# Spec — Phases: one visible noun, clear form guidance, project identity on calendar phases (UXS-034, UXS-035)

Source findings: `docs/reviews/2026-10-10-ux-discover-B.md` B-10, B-13. Vocabulary ruling: DD-VOCAB-1
(`docs/decisions.md`) — users see **Phase / Fase**; `project_milestones`, `milestone_id` and the code keep
"milestone" internally. Data model, progress maths (glossary: effective = input ?? calculated; weighted rollup),
ordering behaviour and routes are unchanged.

## Requirements (EARS)

- **FR-UXP-001 (ubiquitous):** The delivery work-chunk shall be named "Phase" (en) / "Fase" (id) in every visible
  label, heading, button, empty state, toast and accessible name on the planner, the strip/summary, the phase form
  and the project calendar.
- **FR-UXP-002 (ubiquitous):** The phase form shall show always-visible helper text for: relative weight (it sets
  the phase's share of project progress), position (it sets the phase's order), and progress — on edit, blank uses
  linked-task progress and a typed value overrides it; on create, progress comes from linked tasks.
- **FR-UXP-003 (event-driven):** When the calendar lists a phase, the system shall show the phase's project identity
  (project name or PMO number) on the entry itself, and include it in the entry's accessible name.
- **NFR-UXP-001:** No change to stored values, weights, ordering, progress computation or URLs.

## Acceptance criteria

- **AC-UXP-001** — Given a project with phases, When a PM opens the planner, strip and phase form in `en` and in
  `id`, Then every visible label/heading/button/empty state uses "Phase"/"Fase" and none says "Milestone"/"Tonggak".
  *Owning layer: unit (RTL) per component.*
- **AC-UXP-002** — Given the phase form, When it opens, Then helper text explains weight ("Relative weight"/"Bobot
  relatif") and position in the active locale; on **edit**, the progress override field carries "Leave blank to use
  linked-task progress." / "Kosongkan untuk menggunakan progres tugas terkait."; on **create** (no progress field) the
  form says progress comes from linked tasks and can be overridden after creation. *Unit.*
- **AC-UXP-003** — Given phases from two projects on the Projects Calendar, When the calendar renders, Then each
  phase entry shows its project identity before any click, and its accessible name contains it. *Unit.*
- **AC-UXP-004** — Given a phase with linked tasks and no typed progress, and one with a typed value, When progress
  renders, Then the effective values are exactly as before (calculated vs input). *Existing unit tests + the
  AC-DEL-022 journey stay green unchanged.*
