# Phase/Fase Label Polish Implementation Plan — #1018

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the assigned fresh bounded builder. Follow the selected executor and do not spawn workers. Steps use checkbox syntax for tracking.

**Goal:** Finish the approved Phase/Fase and calendar-control copy residue while every underlying delivery/data/write behavior stays unchanged.

**Architecture:** Update six existing presentation hosts plus exact common catalogue leaves. Use real-catalogue RTL at the already-signed canonical ownership paths; preserve existing hooks/repositories, component APIs, chart/date helpers and generic Combobox implementation.

**Tech Stack:** React 19, TypeScript, react-i18next, Vitest/RTL, Node 22.22+; no dependencies.

**Spec:** `docs/specs/phase-label-polish.spec.md` (full exact copy and scope). This plan implements existing signed UXS-006 A2/A3/A4 residue and retained AC-V24P-010/018; no unpublished parent document is required to execute it.

## Global constraints

- Deciding PRIMARY code was dev `3b3590ccd1ca5987f8cd34b3ba791aa41e8d03ef`; the planning checkout at `9e809b7742b4a9eba8b46882ce85be9d5e2d0035` is stale code. Root assigns a fresh isolated build worktree from current origin/dev, checks TasksTab/S21/catalogue ownership, and copies/adopts these two exact docs. Never build in PRIMARY or the reused planning tree.
- Fresh native `gpt-6-luna`, xhigh, implementing this entire bounded slice; current owner routing overrides the older factory default. Read assigned AGENTS/CLAUDE, current PRIMARY private HANDOFF, DESIGN.md and product expectations. No new owner interview, mockup, domain decision, delegation or namespace migration.
- Only the six hosts, catalogue leaves and test files inventoried below. No repository/DAL/hook/auth/schema/RPC/API/route/date/progress/money calculation, dependency, lockfile, shared Combobox or integration changes.
- Retain internal milestone key/prop/ID names and interpolation placeholders. Preserve authored names, enums, null/zero distinctions, keyboard/focus, existing 32px controls, responsive branches and all tests/goals/timeouts. Minimal expected-label/selectors updates are the deliberate UX change, not permission to weaken tests.
- Heavy gates run under `PMO_TEST_LOCK_SLOTS=2 scripts/with-test-lock.sh`, Vitest `--maxWorkers=2`; max two heavy Mac jobs globally, statements/RIS priority. Root schedules capacity. No DB/reset/browser/runtime/environment read/fixture mutation is delegated. Runtime gets a separate finite Root admission.
- No commit/push/PR from builder. Root owns review, any one bounded fix round, normal commit and publication. V024 B branch BUILD/REVIEW/CI ONLY: HOLD dev until Root verifies actual owner-merged v023 dev→main release PR; red-dev hold independently blocks unrelated merges. No main/prod authority.

## File structure and ownership

Modify production only:

1. `pmo-portal/pages/project-detail/ProjectGantt.tsx`: guidance, count defaults, diamond noun.
2. `pmo-portal/pages/project-detail/ProjectSCurve.tsx`: empty-title default.
3. `pmo-portal/pages/project-detail/tabs/TasksTab.tsx`: phase picker/group copy and localized noun prop.
4. `pmo-portal/src/components/history/historyLabels.ts`: milestone_id field default.
5. `pmo-portal/components/ProjectCalendarView.tsx`: five static control/empty-title translations; remove only their obsolete exemption comments.
6. `pmo-portal/src/components/reports/RecordProgressModal.tsx`: suggestion helper default.
7. `pmo-portal/public/locales/en/common.json`, `pmo-portal/public/locales/id/common.json`: exactly the spec's sixteen leaves. Keep all unrelated translations and machine paths; no broad JSON reformatting.

Create canonical tests `pmo-portal/pages/project-detail/__tests__/{OverviewTab,TasksTab}.bahasa.test.tsx` and `pmo-portal/components/__tests__/ProjectCalendarView.bahasa.test.tsx`. Extend `pmo-portal/src/components/history/__tests__/RecordHistory.test.tsx` and `pmo-portal/src/components/reports/RecordProgressModal.test.tsx`. Deliberate copy-selector expectation updates only in existing `pmo-portal/pages/project-detail/__tests__/ProjectGantt.test.tsx`, `ProjectSCurve.test.tsx`, `TasksTab.addInGroup.test.tsx` (preserve their complete goals). If changed-imports finds another exact old-label expectation, show Root its causal failure and narrow it before touching another file.

## Test seams and review focus

Use `BahasaProvider` from `@/test/bahasa` with explicit en/id and fresh mounts. It loads shipped common catalogues and fallback; no test-only translation map, mocked t or copied component. Existing hooks/permission/mock setup in the named suites are the seams; no new exported production helpers.

1. Zero/one/two phases exercise plural defaults without changing counts (Task 1).
2. User-authored names containing “Milestone”/“Tonggak” stay verbatim, so never use a global banned-word scan over data (Tasks 1–4).
3. No-phase/read-only task states retain their current picker/action absence and raw payloads; clearing sends null (Task 3).
4. Desktop grid and phone agenda navigate the same month and open the same project; unchanged English month/weekdays are outside this residue (Task 5).
5. A null suggestion stays absent, 0 stays known zero, and 42.4 displays 42 without pre-filling or auto-saving (Task 6).

## Command contract

From the **assigned build worktree** root, in the same shell before any node/npm/npx:

```bash
export PATH="/Users/ariefsaid/.nvm/versions/node/v22.23.2/bin:$PATH"
node --version
cd pmo-portal
U() { PMO_TEST_LOCK_SLOTS=2 ../scripts/with-test-lock.sh npx vitest run --maxWorkers=2 "$@"; }
```

Require actual v22.23.2. Commands below assume this shell and app cwd. Capture complete stdout/stderr and actual status into Root's private run directory; test import/setup errors are not product RED. Every checkbox is a 2–5 minute edit/check step; command wait time is additional. Stop at the named seam if it grows; do not invent another issue.

## Traceability

| Task | Requirements | One canonical owner |
|---|---|---|
| 1–2 | FR-001/002, NFR-001 | AC-UXA-007, OverviewTab.bahasa.test.tsx (residue only) |
| 3 | FR-001/003, NFR-001/004 | AC-UXA-010, TasksTab.bahasa.test.tsx (residue only) |
| 4 | FR-001/004 | AC-UXA-014, RecordHistory.test.tsx (residue only) |
| 5 | FR-005, NFR-003 | AC-V24P-010, ProjectCalendarView.bahasa.test.tsx |
| 6 | FR-006, NFR-001 | AC-V24P-018, RecordProgressModal.test.tsx |
| 7 | All NFRs | Same tests + final gates; no duplicate owners |

### Task 1: Pin and replace Gantt phase copy

**Files:** ProjectGantt.tsx, exact gantt catalogue leaves, new OverviewTab.bahasa.test.tsx; ProjectGantt.test.tsx label selector only.
**Interfaces:** unchanged `ProjectGanttProps {tasks:TaskWithRefs[];milestones:MilestoneWithProgress[];onActivateTask?;onSwitchView?}`. This real child is hosted by TasksTab Timeline; the signed test filename does not imply OverviewTab hosts it.

- [ ] Add one canonical `it('AC-UXA-007: residual phase chart labels use real en/id while authored facts remain')` with fixture loop/render helper in the new file. Use actual ProjectGantt, desktop hook seam from its existing tests and existing typed makeTask/makeMilestone shapes. Empty state must contain exact spec guidance. With a dated task and zero phases, summary contains `0 phases` / `0 fase`. One phase named `Milestone Alpha` at `2026-01-06` with task span `2026-01-01`–`2026-01-11` must have diamond name `Milestone Alpha phase — target 2026-01-06` / `Milestone Alpha fase — target 2026-01-06`; summary contains `1 phase` / `1 fase`. Add second phase `Tonggak Beta`: summary contains `2 phases` / `2 fase`; authored names/date and 2 tasks remain. Assert separators/connector count still appear using current real summary structure, not a reimplemented model.
- [ ] Run `U pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx` and record specific old-noun/guidance RED. Existing chart shape/data errors must be fixed in the new fixture first.
- [ ] Update only spec gantt leaves and English inline defaults: emptySub, milestoneWord, summary milestones one/other. Preserve `{{milestones}}` in head, count inputs, builder, models, classes and IDs. Update existing AC-GANTT-014 diamond selector from `phase 1 milestone` to `phase 1 phase`; keep exact position/target-date assertions.
- [ ] Run `U pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx pages/project-detail/__tests__/ProjectGantt.test.tsx pages/project-detail/__tests__/ProjectGantt.activate.test.tsx pages/project-detail/__tests__/ProjectGantt.undatedActivate.test.tsx pages/project-detail/__tests__/ProjectGantt.tombstones.test.tsx`; require all original geometry/activation/plural/spacing goals GREEN.

### Task 2: Pin and replace S-curve empty label

**Files:** ProjectSCurve.tsx, scurve.emptyTitle en/id, same canonical OverviewTab.bahasa.test.tsx; ProjectSCurve.test.tsx copy expectation only.
**Interfaces:** unchanged `ProjectSCurveProps {projectId:string}` and useMilestones/useTasks results; ProjectDetail mounts it in non-pipeline Overview separately from OverviewTab.

- [ ] Extend the same AC-UXA-007 owning test/helper with actual ProjectSCurve and empty hook data; expect `No dated phases yet` / `Belum ada fase bertanggal`. Add ready dated 0%-and-100% fixture support with names unchanged, and loading/error/retry support checks using existing ChartFrame text so changing the title cannot collapse those states. Reuse current ResponsiveContainer sizing seam if necessary; never fake ProjectSCurve or its buildSCurve algorithm.
- [ ] Run `U pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx` → old empty-title RED; update only emptyTitle default/catalogue. Update old AC-SC-006 expected title in ProjectSCurve.test.tsx and retain its no-chart assertion.
- [ ] Run `U pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx pages/project-detail/__tests__/ProjectSCurve.test.tsx`; require existing hybrid progress/date/series/format assertions GREEN.

### Task 3: Localize task phase picker and retain actual writes

**Files:** TasksTab.tsx, task leaves in spec, new TasksTab.bahasa.test.tsx, TasksTab.addInGroup.test.tsx expected field selector only.
**Interfaces:** actual TasksTab default export, unchanged hook create/update mutations; task form stays private. Do not export it for tests. Use existing PMO-owned task, role/query/router/ToastProvider fixtures from TasksTab.addInGroup.test.tsx and TasksTab.test.tsx, with create/update spies.

- [ ] Add one `it('AC-UXA-010: residual phase picker labels keep raw task assignments in en/id')` using real TasksTab/Combobox and both catalogues. Set phase `m1` named `Milestone Alpha`, an unassigned task and a PMO-owned `In Progress` task. In grouped list assert `No phase`/`Tanpa fase`; open Add task from that phase group and assert combobox `Phase`/`Fase` contains authored name. Open picker, assert exact search placeholder `Search phases…` / `Cari fase…` and accessible search label `Search phases` / `Cari fase`; type `missing` and assert `No phase matches "missing".` / `Tidak ada fase yang cocok dengan "missing".`. Clear selection via `Clear phase` / `Hapus fase` and explicitly submit a valid synthetic task: spy receives milestone_id:null and status:'To Do'. Edit the assigned task, preserve m1 and In Progress, save: update spy receives same task ID and milestone_id:'m1', status:'In Progress'. Assert no write on opening/searching/clearing before deliberate submit.
- [ ] Add support branches to that owner: zero phases leaves picker absent; existing read-only fixture leaves create/edit absent. Do not invent permissions or change policy. Run `U pages/project-detail/__tests__/TasksTab.bahasa.test.tsx` → causal old-copy/noun RED.
- [ ] Set field/search/ungrouped defaults and en/id catalogue leaves to spec values. Replace only `noun="milestone"` with `noun={t('projectDetail.tasks.form.phaseNoun', 'phase')}`. No generic Combobox template edit, task grouping/model/payload/enum change. Update AC-DEL-011 field-name selector to `/phase/i`, retaining selected group identity.
- [ ] Run `U pages/project-detail/__tests__/TasksTab.bahasa.test.tsx pages/project-detail/__tests__/TasksTab.addInGroup.test.tsx pages/project-detail/__tests__/TasksTab.grouping.test.tsx pages/project-detail/__tests__/TasksTab.test.tsx`; require GREEN with all old create/edit/grouping goals intact.

### Task 4: History label with authored values intact

**Files:** historyLabels.ts, history.field.milestone_id en/id, RecordHistory.test.tsx.
**Interfaces:** preserve `fieldLabels(t:TFunction): Record<string,string>` and existing `RecordHistory`/repository queries; no lookup change.

- [ ] Add one `it('AC-UXA-014: phase field labels localize while authored History values remain verbatim')` using existing ev/renderIt seams under explicit real en/id providers. Task child change uses milestone_id old m1/new m2; project phase lookup returns `Milestone Alpha` and `Tonggak Beta`. Assert localized field label `Phase`/`Fase`, exact authored transition `Milestone Alpha → Tonggak Beta`, unchanged lookup/list IDs and no mutation. Add a separate event with `changes:{milestone_id:{changed:true}}`: its value-free description is `Phase changed` / `Fase diubah`. Keep existing unresolved-reference, loading/error/empty/filter tests untouched; do not change how missing references resolve.
- [ ] Run `U src/components/history/__tests__/RecordHistory.test.tsx` → label RED; change only default/catalogue leaf. Run same full suite GREEN. Do not rewrite the History renderer or normalize authored names.

### Task 5: Calendar controls in both rendered layouts

**Files:** ProjectCalendarView.tsx, five new projects.calendar leaves, new ProjectCalendarView.bahasa.test.tsx.
**Interfaces:** unchanged projects/milestoneDates/onOpenProject/initialCursor. Existing useIsDesktop hook seam controls desktop/phone; existing calendar helpers decide dates.

- [ ] Add one `it('AC-V24P-010: calendar controls localize without changing month movement or project identity')` using actual calendar, both locales and desktop/phone fixture loop. Freeze date `2026-06-15T12:00:00Z` with `vi.useFakeTimers({toFake:['Date']})` and `vi.setSystemTime(...)`, leaving userEvent's timers real; initial cursor June 2026. Assert exact previous/next/today accessible names and visible Today/Hari ini; July after Next, June after Previous and June after Today from July. Empty branch title equals spec; existing subtitle remains. Mount event branch with phase m1/date 2026-06-10, project p1 name `Project Alpha`, authored phase `Milestone Alpha`; assert project-first button text and locale Phase/Fase aria label. Activate via keyboard/Enter; onOpenProject called once with p1. No changes to date helper formatting expectations.
- [ ] Run `U components/__tests__/ProjectCalendarView.bahasa.test.tsx` → English-only controls/title RED. Replace those hardcoded values with exact static projects.calendar keys/defaults; remove only matching exemption comments. Preserve nav callbacks, grid/agenda, existing phase chip translations and classes.
- [ ] Run `U components/__tests__/ProjectCalendarView.bahasa.test.tsx components/__tests__/ProjectCalendarView.nav.test.tsx components/__tests__/ProjectCalendarView.states.test.tsx components/__tests__/ProjectCalendarView.events.test.tsx components/__tests__/ProjectCalendarView.milestoneLink.test.tsx components/__tests__/ProjectCalendarView.responsive.test.tsx`; require all old event/link/date/identity goals GREEN. Restore real time after tests.

### Task 6: Progress suggestion copy, same explicit save

**Files:** RecordProgressModal.tsx, pctHelper en/id, RecordProgressModal.test.tsx.
**Interfaces:** unchanged RecordProgressModal props/useRecordProjectProgress mutation/parsePercentComplete.

- [ ] Add one `it('AC-V24P-018: phase suggestion localizes and explicit progress save keeps the entered payload')` under real en/id + existing ToastProvider/hook spy. Render 42.4: assert exact Phase delivery: 42% / Progres fase: 42%, percent input still empty, mutation untouched. Type 45 and explicitly save; assert exact `{projectId:'p1',month:'2026-09-01',pctComplete:45,note:null}` once. Support null helper absence and 0 known helper `0%` without auto-fill/save. Keep all AC-MMP-014 validation and explicit-save cases.
- [ ] Run `U src/components/reports/RecordProgressModal.test.tsx` → helper RED. Change only pctHelper default/catalogue and old exact English helper expectation. Rerun full file GREEN; keep range/two-decimal/month/close goals unchanged.

### Task 7: Final scoped evidence and handoff

**Files:** no additional product files. Evidence lives in Root-assigned private run directory.
**Interfaces:** earlier owning suites and unchanged public props/payloads; Root's reviewers/Discover/CI consume evidence, not a summary-only success claim.

- [ ] Run real catalogues: `npm run check:i18n`. No baseline deletion or unchecked catalogue change to force green. Launch manifest already covers the six hosts (project-detail sibling glob, task tab, historyLabels, calendar, reports); no new manifest entry is required. If an inherited mismatch appears, show exact diagnostic to Root rather than burn down another issue.
- [ ] Run `PMO_TEST_LOCK_SLOTS=2 ../scripts/with-test-lock.sh npm run typecheck`; require zero errors. Run the exact zero-warning scoped lint below; no whole-app lint or new lint policy.

```bash
npx eslint --max-warnings=0 pages/project-detail/ProjectGantt.tsx pages/project-detail/ProjectSCurve.tsx pages/project-detail/tabs/TasksTab.tsx src/components/history/historyLabels.ts components/ProjectCalendarView.tsx src/components/reports/RecordProgressModal.tsx pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx pages/project-detail/__tests__/TasksTab.bahasa.test.tsx src/components/history/__tests__/RecordHistory.test.tsx components/__tests__/ProjectCalendarView.bahasa.test.tsx src/components/reports/RecordProgressModal.test.tsx pages/project-detail/__tests__/ProjectGantt.test.tsx pages/project-detail/__tests__/ProjectSCurve.test.tsx pages/project-detail/__tests__/TasksTab.addInGroup.test.tsx
```
- [ ] Run `U --changed origin/dev`. Capture actual selected count/body; zero selected is reported honestly, not equivalent to targeted proof. Keep max two workers. No full suite on this shared Mac.
- [ ] Run all five owning files once with `U --coverage --coverage.reporter=json pages/project-detail/__tests__/OverviewTab.bahasa.test.tsx pages/project-detail/__tests__/TasksTab.bahasa.test.tsx src/components/history/__tests__/RecordHistory.test.tsx components/__tests__/ProjectCalendarView.bahasa.test.tsx src/components/reports/RecordProgressModal.test.tsx`. From root score the **working-tree diff**, including uncommitted changes, using the actual gate exports as below; require ≥80% executable changed-line coverage and report numerator/denominator. No copied coverage algorithm. If an affected executable host lacks any coverage report entry, fail/report it rather than accepting the scorer's skip.

```bash
cd ..
node --input-type=module <<'NODE'
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { collectChangedFromDiff, computeChangedLinesCoverage } from './scripts/changed-lines-coverage.mjs';
const root = process.cwd();
const coverage = JSON.parse(fs.readFileSync('pmo-portal/coverage/coverage-final.json', 'utf8'));
const changedLinesByFile = collectChangedFromDiff(execFileSync('git', ['diff', '--unified=0', 'origin/dev', '--', 'pmo-portal'], { encoding:'utf8' }));
for (const file of changedLinesByFile.keys()) {
  if (/\.[jt]sx?$/.test(file) && !Object.keys(coverage).some(key => key === `${root}/${file}`)) throw new Error(`Missing coverage: ${file}`);
}
const result = computeChangedLinesCoverage({changedLinesByFile,coverage,min:80,root});
console.log(JSON.stringify(result,null,2));
if (!result.ok) process.exit(1);
NODE
```

- [ ] Audit full diff: no deleted/skipped/weakened test, math/enum/payload/date/model/repository/auth/route/style change, unrelated key rewrite or lockfile diff. Capture SHA256 for every owned changed file and actual gate outputs. Return review-ready WIP to Root; no commit/push.
- [ ] Root, outside builder scope: consolidate spec/quality/security review; quick-confirm no authority/backend change, one bounded fix round then verify exact patch. Separately admit rendered Discover across spec route/locale/theme/viewport cells, preserving protected runtime data and existing DB→test lock order; no reset. Graduate real findings before merge. Root schedules existing `scripts/e2e-local.sh UXS-006-shell-vocabulary-bahasa` only under finite runtime admission; it supports shell vocabulary and is not acceptance for these residual labels. No new e2e spec/pgTAP is justified for copy alone.
- [ ] Root rebases/merges current catalogue changes immediately before eventual PR (#1070 coordination), verifies exact owned leaves survived and fresh CI's four unit shards + pgTAP + verify. Closing/browser cadence through the logged shared wrapper is Root-owned within current caps. Maintain both v024-B release hold and independent red-dev hold; one issue per code PR, dev ceiling, no main/prod. Closure requires actual code + owning test/Discover/CI evidence, not this plan or an open-issue label alone.

Self-review: all six FRs map to Tasks 1–6; all NFRs to global constraints/Task 7. Existing canonical AC ownership is retained; original full A2/A3/A4 acceptance is not overstated. No architecture decision or owner scope choice remains for this bounded residue.
