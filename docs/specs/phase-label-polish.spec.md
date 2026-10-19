# Phase/Fase label polish — #1018

Status: bounded implementation handoff, 2026-10-19; no implementation or runtime acceptance claimed.
Authority: signed `docs/specs/uxs-006-delivery-bahasa-batch-a.spec.md` (A2/A3/A4), DD-VOCAB-1 in `docs/decisions.md`, and the approved v024 polish P02. This document is self-contained; it extracts that approved residue without reopening alignment.
Plan: `docs/plans/2026-10-19-phase-label-polish.md`.
Deciding code: PRIMARY dev checkout at `3b3590ccd1ca5987f8cd34b3ba791aa41e8d03ef`; the reused planning checkout is older and is not the code baseline.

## Job and observed failure

When a project reader follows delivery work across charts, task assignment, History and progress recording, they want the same Phase/Fase noun and translated calendar controls so they can recognize the same delivery unit without mistaking it for a billing milestone. PMs opening the task form currently see Milestone while the phase strip says Phase; Bahasa readers see milestone/Tonggak and English calendar buttons alongside Fase. This is visible system-copy inconsistency under the signed vocabulary rule, not a failure of the progress calculation.

Issue #1018 remains OPEN when inspected. Its original work belongs to UXS-006, not a new workflow. The current sources below still contain the named residue, so closure-only is not supported. The planner/form/strip and project-first calendar phase chips already implement Phase/Fase; retain those shipped parts and their tests.

## Current source and reachable-state inventory

Paths are repository-relative. These are source observations, not deployed/browser proof.

| Deciding source | Reachable caller/state | Actual residue / invariant |
|---|---|---|
| `pmo-portal/pages/project-detail/ProjectGantt.tsx:177`, `:217`, `:574` | Tasks tab Timeline, desktop empty/populated, spoken summary and dated phase diamond | Empty guidance, singular/plural summary, diamond suffix still say milestone; preserve task/phase counts, connectors, target date, axis location and activation. Gantt is mounted by `tabs/TasksTab.tsx:518`, not OverviewTab. |
| `pmo-portal/pages/project-detail/ProjectSCurve.tsx:91`; `ProjectDetail.tsx:236` | Non-pipeline project Overview, settled empty curve | “No dated milestones yet” / “Belum ada milestone bertanggal”; preserve existing loading/error/ready branches, model and percentages. ProjectDetail mounts this sibling separately from OverviewTab. |
| `pmo-portal/pages/project-detail/tabs/TasksTab.tsx:957`, `:1139` | Existing writable create/edit form with at least one phase; grouped list with unassigned task | Milestone field, search text, `noun="milestone"` in shared Combobox announcements, and No milestone heading. Preserve selected `milestone_id`, raw status, grouping, permissions, and create/update calls. With zero phases the picker remains absent. |
| `pmo-portal/src/components/history/historyLabels.ts:62` | `/projects/:id/history`, task child change with `milestone_id` | Field map returns Milestone/Tonggak; preserve reference resolution and authored old/new names. |
| `pmo-portal/components/ProjectCalendarView.tsx:205`–`:227`; `pages/Projects.tsx:1234` | `/projects` calendar, desktop grid/phone agenda, empty month/navigation | Previous/Next/Go to today/Today and empty title are hardcoded English. Existing phase event text/aria and empty subtitle already use Phase/Fase and project-first identity. Keep month cursor/date helpers, events and `onOpenProject(id)`. |
| `pmo-portal/src/components/reports/RecordProgressModal.tsx:96`; `pages/ManagementPack.tsx:187` | `/reports`, existing permitted Record progress action, non-null delivery suggestion | “Milestone delivery” / “Progres milestone”; preserve suggestion-only rounded display, untouched entered percentage and month/save payload. Null suggestion remains absent. |

Both real catalogues under `pmo-portal/public/locales/{en,id}/common.json` contain these values. `test/bahasa.tsx` loads those real dictionaries with English fallback. The named Overview/Tasks `.bahasa` owning files from the signed spec do not exist in this inspected checkout; create only the residue contract in them, without claiming the whole A2/A3/A4 batch is accepted. Existing `RecordHistory.test.tsx` has no AC-UXA-014 owner title in its inspected contents; extend it while preserving all current formatting/reference tests.

## Requirements (EARS)

- **FR-001:** When any scoped system label renders in English or Bahasa, it shall use Phase/Fase with the exact copy table below while authored phase/project/task names remain verbatim.
- **FR-002:** When a Gantt has zero, one or multiple phases, its guidance, count summary and dated-diamond accessible suffix shall use the locale's phase noun without changing the interpolated task/phase/connector counts, target date or timeline geometry.
- **FR-003:** When a task phase picker/group renders, its label, search, unassigned heading and Combobox noun announcements shall use the same locale; selecting or clearing a phase shall continue to submit the existing ID or null and original status enum.
- **FR-004:** When History describes a milestone_id change, its field label shall say Phase/Fase while its resolved old/new values and lookup identities remain unchanged.
- **FR-005:** When calendar navigation or the month-empty title renders, the controls shall use the copy below; navigation and project activation shall retain their existing date/callback behavior.
- **FR-006:** While a progress modal has a delivery suggestion, its helper shall say Phase delivery/Progres fase and remain a suggestion; explicit save shall submit the user's existing percentage, month and note unchanged.
- **NFR-001:** The slice shall preserve component exports/props, keys and interpolator names, persisted milestone identifiers, enums, URLs, auth/repository/query behavior, money/date/progress calculations and zero-versus-unavailable semantics.
- **NFR-002:** The slice shall use static parser-visible common keys, matching English defaults and real en/id catalogues; no namespace, dependency, network or lockfile change is required.
- **NFR-003:** The slice shall retain DESIGN.md layout/tokens, 32px controls, focus/keyboard behavior and desktop-grid/phone-agenda branches. No redesign or shared Combobox rewrite is authorized.
- **NFR-004:** Every old test goal shall remain. Expected copy/selectors may change only for this deliberate label change; no skips, deleted cases, weaker assertions or timeout changes.
- **NFR-005:** V024 product/UI work may build/review/CI on a feature branch only. Dev merge remains held until Root verifies the owner's actual v023 dev→main release PR merge; an independent red-dev hold also blocks unrelated merges. This grants no main/production action.

## Exact system copy

All paths below are `common.json` leaves, not identifier renames. Existing placeholders remain byte-for-byte. English inline defaults equal the English values.

| Key | English | Bahasa Indonesia |
|---|---|---|
| `projectDetail.gantt.emptySub` | Add start/due dates to tasks or target dates to phases to see the timeline. | Tambahkan tanggal mulai/tenggat pada tugas atau tanggal target pada fase untuk melihat timeline. |
| `projectDetail.gantt.milestoneWord` | phase | fase |
| `projectDetail.gantt.summary.milestones_one` | {{count}} phase | {{count}} fase |
| `projectDetail.gantt.summary.milestones_other` | {{count}} phases | {{count}} fase |
| `projectDetail.scurve.emptyTitle` | No dated phases yet | Belum ada fase bertanggal |
| `projectDetail.tasks.form.milestone` | Phase | Fase |
| `projectDetail.tasks.form.searchMilestones` | Search phases… | Cari fase… |
| `projectDetail.tasks.form.phaseNoun` (new) | phase | fase |
| `projectDetail.tasks.noMilestone` | No phase | Tanpa fase |
| `history.field.milestone_id` | Phase | Fase |
| `managementPack.progressModal.pctHelper` | Phase delivery: {{pct}}% | Progres fase: {{pct}}% |
| `projects.calendar.previousMonth` (new) | Previous month | Bulan sebelumnya |
| `projects.calendar.nextMonth` (new) | Next month | Bulan berikutnya |
| `projects.calendar.goToToday` (new) | Go to today | Ke hari ini |
| `projects.calendar.today` (new) | Today | Hari ini |
| `projects.calendar.noEventsTitle` (new) | No events this month | Belum ada agenda bulan ini |

Keep `summary.head`'s `{{milestones}}` placeholder and the `milestones_*` machine key paths. Feed the new localized phaseNoun into the existing Combobox `noun` prop; do not alter generic plural templates. The already-localized S-curve empty subtitle and calendar event/empty-subtitle leaves are unchanged. Calendar month headings/weekdays, project start/end event copy and unrelated task/system labels are outside this residue; this slice does not claim full calendar localization.

## Acceptance and one lowest sufficient owner

Every test uses the real components and `BahasaProvider locale="en"|"id"`; mock only data/hooks/permissions and existing third-party chart sizing seams. Never replace the component under test or copy its algorithm.

| AC | Given / When / Then | Canonical owner |
|---|---|---|
| **AC-UXA-007** reused residue | Given empty S-curve and zero/one/two-phase Gantt fixtures, When both locales render, Then the exact guidance/empty/summary/diamond labels use Phase/Fase, authored names/target date/counts stay unchanged, and existing progress/geometry tests remain. | Unit: new `pmo-portal/pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx` (imports actual chart siblings; filename follows signed ownership). |
| **AC-UXA-010** reused residue | Given grouped tasks plus writable/read-only and zero-phase fixtures, When existing add/edit phase picker opens, searches, clears or saves, Then Phase/Fase and localized announcements appear; names remain verbatim and writes send identical milestone_id/null and raw status. | Unit: new `pmo-portal/pages/project-detail/__tests__/TasksTab.bahasa.test.tsx`. |
| **AC-UXA-014** reused residue | Given a task child History milestone_id change with resolved authored names, When rendered in en/id, Then the field label is Phase/Fase, both names remain verbatim and the same IDs are looked up. | Unit: existing `pmo-portal/src/components/history/__tests__/RecordHistory.test.tsx`. |
| **AC-V24P-010** retained | Given June 2026 and a dated synthetic phase, When en/id desktop/phone calendar renders and user selects next/previous/today or activates that phase, Then exact control/empty copy is localized, the same month cells/cursor move and only the original project ID is opened. | Unit: new `pmo-portal/components/__tests__/ProjectCalendarView.bahasa.test.tsx`. |
| **AC-V24P-018** retained | Given deliveryPct 42.4 or null, When en/id modal renders and user explicitly saves 45 for 2026-09, Then the helper is Phase delivery: 42% / Progres fase: 42% only for non-null; nothing auto-fills or saves and explicit save sends `{projectId:'p1',month:'2026-09-01',pctComplete:45,note:null}` once. | Unit: existing `pmo-portal/src/components/reports/RecordProgressModal.test.tsx`. |

These are residue additions under original owners, not replacement proof for every original UXS-006 state. No new pgTAP or label-only e2e owner is needed. The existing UXS-006 shell journey is supporting vocabulary regression only; it does not visit these residual surfaces.

## Rendered acceptance and boundaries

Root separately admits one finite Discover on rich synthetic data: `/projects` calendar, `/projects/:id/overview`, `/projects/:id/tasks`, `/projects/:id/history`, `/reports` progress modal. Sweep en/id × light/dark × 390×844/1440×900, accounting for Gantt's existing phone fallback and permitted/read-only tasks/progress actions. Check system labels, authored identity, wrapping, focus/keyboard and empty/populated distinctions without Save or business writes unless separately authorized. Findings graduate to a behavior test, affected route/oracle cell and DESIGN/decisions retention note before acceptance. No browser, DB, reset, environment read or fixture mutation is authorized by this planning artifact or builder brief.

Exclude phase model/form/strip redesign, integration/ClickUp changes, repositories, schema/RLS/RPCs, date formatting, math, money, statuses, routes and whole-batch localization. Recheck landed S21/task ownership and current catalogues before build. If an updated baseline already fixes a named residue, retain/reuse its evidence and omit duplicate product edits; Root decides eventual issue closure. No new owner decision is needed for this exact approved copy-only scope.
