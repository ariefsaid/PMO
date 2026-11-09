import '@/test/stubGetAnimations';
/**
 * #2104 perf(rbp) — unstable props defeat memoised tables (tasks lane).
 *
 * The column factory `useProjectTaskColumns(deps)` receives a FRESH deps object per TasksTab
 * render (inline `canSetStatus`/`onStatusChange`, and `rowMenu`/`canEditTask` closures are new
 * per render too), so `MilestoneGroupedList`'s `columns` memo and `ProjectGantt`'s model/events
 * memos rebuild on EVERY TasksTab render — including the urgent (keystroke) render while typing
 * in search. These tests pin the AC:
 *   - an unrelated TasksTab re-render runs ZERO column builds and ZERO grouped-table renders
 *     (stable props keep the memoised table bailed out);
 *   - while typing in task search, the column builder runs ZERO times on the keystroke's URGENT
 *     commit; the rebuild happens once per committed filter value in the interruptible deferred
 *     commit (`useDeferredValue(searchText)`);
 *   - in the timeline, the Gantt model is not rebuilt on unrelated re-renders.
 *
 * AC-1 restated (review finding 1, option b — what these tests actually prove). The original AC
 * read "the column builder runs zero times per keystroke". Measured here: per-keystroke column
 * builds are UNCHANGED from pre-fix (one per typed value, in the deferred commit); what changed is
 * that the input-blocking urgent commit now does ZERO of them and is ~3.5× cheaper. The deferral
 * does not coalesce bursts in jsdom (five keys → five deferred commits), so a total "zero per
 * keystroke" is not achievable without making the depth map filter-independent — which changes the
 * filtered-list indentation (a filtered-out parent's child would stay indented with no visible
 * parent), a deliberate product call this lane does not make.
 *
 * Measurement conditions (also review finding 1): timings below are jsdom, UNTHROTTLED. The AC's
 * "≥3× shorter under 4× CPU" condition is not measured here — jsdom cannot be CPU-throttled; the
 * equivalent harness is Playwright + CDP `Emulation.setCPUThrottlingRate: 4` on a seeded 300-task
 * project. The work on the urgent path is pure CPU (no I/O), so the recorded ratio carries over,
 * but that is an inference, not the AC's measurement protocol.
 *
 * Probes are module counters:
 *   - `columnBuilds` — invocations of the column factory `buildColumns(depths)` itself (attributable
 *     to the column builder, unlike `treeWalks`, which also counts the grouping memo's hierarchy
 *     walks; both are reported so the numbers are honest about what they count);
 *   - `mglRenders` — MilestoneGroupedList function renders (bail-out = no increment);
 *   - `ganttModels` — buildReuiGanttModel invocations.
 * Profiler commit durations are recorded for the 300-task typing interaction (before/after evidence).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';

// ── Probes (module-level counters, read by the tests) ────────────────────────
const probes = vi.hoisted(() => ({
  columnBuilds: 0, // buildColumns(depths) invocations — the column builder itself
  treeWalks: 0, // buildTaskRenderOrder invocations (grouping memo AND the column depth walk)
  ganttModels: 0, // buildReuiGanttModel invocations (ProjectGantt's model memo)
  mglRenders: 0, // MilestoneGroupedList function renders (bail-out = no increment)
  commits: [] as {
    phase: string;
    actualDuration: number;
    columnBuilds: number;
    treeWalks: number;
    mglRenders: number;
  }[],
}));

// Count the column factory itself. Wrapping the SHIPPED hook (rather than replacing it) keeps the
// real columns — and the real memo contract — under test; only the call count is new.
vi.mock('../tabs/TaskList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabs/TaskList')>();
  const { useCallback } = await import('react');
  return {
    ...actual,
    useProjectTaskColumns: (deps: Parameters<typeof actual.useProjectTaskColumns>[0]) => {
      const build = actual.useProjectTaskColumns(deps);
      return useCallback((depths: Parameters<typeof build>[0]) => {
        probes.columnBuilds += 1;
        return build(depths);
      }, [build]);
    },
  };
});

vi.mock('@/src/lib/tasks/taskTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/tasks/taskTree')>();
  return {
    ...actual,
    buildTaskRenderOrder: (tasks: Parameters<typeof actual.buildTaskRenderOrder>[0]) => {
      probes.treeWalks += 1;
      return actual.buildTaskRenderOrder(tasks);
    },
  };
});

vi.mock('@/src/lib/gantt/reuiModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/gantt/reuiModel')>();
  return {
    ...actual,
    buildReuiGanttModel: (...args: Parameters<typeof actual.buildReuiGanttModel>) => {
      probes.ganttModels += 1;
      return actual.buildReuiGanttModel(...args);
    },
  };
});

vi.mock('../tabs/MilestoneGroupedList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tabs/MilestoneGroupedList')>();
  // The probe is itself memo'd with the same shallow prop comparison the real component uses,
  // so its render count measures the REAL bail-out behaviour (an unmemo'd wrapper would defeat
  // the memo it is supposed to observe).
  const Probe = React.memo((props: React.ComponentProps<typeof actual.default>) => {
    probes.mglRenders += 1;
    const Real = actual.default;
    return <Real {...props} />;
  });
  return { default: Probe };
});

// ── Standard TasksTab harness (mirrors TasksTab.grouping.test.tsx) ──────────
const milestoneState = {
  data: [] as MilestoneWithProgress[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => milestoneState,
  useMilestoneMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setTaskMilestone: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useFxOrgDay', () => ({
  useFxOrgDay: () => ({ day: '2026-06-22', isPending: false, isError: false, retry: vi.fn() }),
}));

const tasksState = {
  data: [] as unknown[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

// The real hook hands back STABLE references: `pendingPushByTask` is state (one object while
// nothing is pending) and react-query keeps each `mutateAsync` stable across renders. A mock that
// minted fresh objects per call would fail every downstream memo on identity alone and measure the
// mock instead of the app — so the mutation bag is created once, above the hoisted factory.
const taskMutations = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  updateStatus: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
  archive: { mutateAsync: vi.fn(), isPending: false },
  addDependency: { mutateAsync: vi.fn(), isPending: false },
  removeDependency: { mutateAsync: vi.fn(), isPending: false },
  pendingPushByTask: {} as Record<string, never>,
}));

vi.mock('@/src/hooks/useTasks', () => ({
  useTasks: () => tasksState,
  useAssignableProfiles: () => ({ data: [], isPending: false, isError: false }),
  useTaskMutations: () => taskMutations,
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/components/comments/CommentsSection', () => ({ CommentsSection: () => null }));
vi.mock('@/src/components/history/RecordHistory', () => ({ RecordHistory: () => null }));

import TasksTab from '../tabs/TasksTab';
import { clearOwnershipCache, setTaskOwnership, setProjectBindings } from '@/src/lib/adapterSeam/ownershipCache';

// ── Fixtures: a 300-task project (240 top-level + 60 subtasks) ──────────────
function makeTasks(topLevel = 240, subtasks = 60): Record<string, unknown>[] {
  const tasks: Record<string, unknown>[] = [];
  for (let i = 0; i < topLevel; i += 1) {
    tasks.push({
      id: `t-${i}`, project_id: 'p1', milestone_id: i % 2 === 0 ? 'm1' : null,
      name: `Task ${i}`, status: 'To Do', assignee_id: null, start_date: null,
      end_date: '2026-07-01', created_at: '2026-06-01T00:00:00Z', assignee: null,
      dependencies: [], parent_task_id: null, archived_at: null, created_by: 'pm-1',
      description: null, priority: null, tombstoned_at: null,
    });
  }
  for (let j = 0; j < subtasks; j += 1) {
    tasks.push({
      id: `sub-${j}`, project_id: 'p1', milestone_id: j % 2 === 0 ? 'm1' : null,
      name: `Subtask ${j}`, status: 'To Do', assignee_id: null, start_date: null,
      end_date: '2026-07-02', created_at: '2026-06-01T00:00:00Z', assignee: null,
      dependencies: [], parent_task_id: `t-${j}`, archived_at: null, created_by: 'pm-1',
      description: null, priority: null, tombstoned_at: null,
    });
  }
  return tasks;
}

const M1: MilestoneWithProgress = {
  id: 'm1', project_id: 'p1', name: 'Phase one', sort_order: 0,
  target_date: null, weight: 1, input_pct: null, task_count: 150,
  calculated_pct: 0, effective_pct: 0,
};

function render$(initialEntry = '/projects/p1/tasks') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ToastProvider>
          <React.Profiler
            id="tasks-tab"
            onRender={(_id, phase, actualDuration) => {
              probes.commits.push({
                phase,
                actualDuration,
                columnBuilds: probes.columnBuilds,
                treeWalks: probes.treeWalks,
                mglRenders: probes.mglRenders,
              });
            }}
          >
            <TasksTab projectId="p1" />
          </React.Profiler>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Flush mount-settling work (effects + the selection sync DataTable performs on mount) so the
 *  baseline below counts only what the interaction itself causes. */
async function settle() {
  for (let i = 0; i < 3; i += 1) await act(async () => {});
}

async function toggleToolbarMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'More task options' }));
  await user.click(screen.getByRole('button', { name: 'More task options' }));
}

beforeEach(() => {
  clearOwnershipCache();
  setTaskOwnership([]);
  setProjectBindings([]);
  vi.clearAllMocks();
  tasksState.isPending = false;
  tasksState.isError = false;
  probes.columnBuilds = 0;
  probes.treeWalks = 0;
  probes.ganttModels = 0;
  probes.mglRenders = 0;
  probes.commits = [];
});

describe('#2104 tasks lane — stable props keep the memoised table quiet', () => {
  it('an unrelated TasksTab re-render (toolbar menu) runs zero column builds and zero grouped-table renders', async () => {
    const user = userEvent.setup();
    tasksState.data = makeTasks();
    milestoneState.data = [M1];
    render$();
    const colsBefore = probes.columnBuilds;
    const mglBefore = probes.mglRenders;

    await toggleToolbarMenu(user);

    expect(probes.columnBuilds - colsBefore).toBe(0);
    expect(probes.mglRenders - mglBefore).toBe(0);
    // 300-task fixture + two userEvent clicks: the assertion is instant, the fixture renders are not.
    // A loaded shared machine can exceed the global 15s without any behaviour change.
  }, 40_000);

  it('typing in search: the urgent (keystroke) render runs zero column builds; the deferred commit applies the filter', async () => {
    tasksState.data = makeTasks();
    milestoneState.data = [M1];
    render$();
    const input = screen.getByPlaceholderText('Search tasks…');
    await settle();

    const colsBefore = probes.columnBuilds;
    const treeBefore = probes.treeWalks;
    const mglBefore = probes.mglRenders;
    const commitsBefore = probes.commits.length;

    // One keystroke. The URGENT commit applies the input value only; useDeferredValue moves the
    // filtered recompute (and the grouped table's column rebuild) to the deferred commit.
    fireEvent.change(input, { target: { value: '25' } });
    await act(async () => {}); // flush the deferred commit

    const typingCommits = probes.commits.slice(commitsBefore);
    const urgent = typingCommits[0];
    const deferredColumnBuilds = probes.columnBuilds - (urgent?.columnBuilds ?? colsBefore);
    const totalCommitMs = typingCommits.reduce((sum, c) => sum + c.actualDuration, 0);
    console.info(
      `[perf #2104] keystroke=1 urgentCommit: phase=${urgent?.phase} columnBuilds=+${(urgent?.columnBuilds ?? colsBefore) - colsBefore} tableRenders=+${(urgent?.mglRenders ?? mglBefore) - mglBefore} hierarchyWalks=+${(urgent?.treeWalks ?? treeBefore) - treeBefore} urgentCommitMs=${(urgent?.actualDuration ?? 0).toFixed(2)} | deferred columnBuilds=+${deferredColumnBuilds} | commits=${typingCommits.length} typingMs=${totalCommitMs.toFixed(2)}`,
    );

    // AC-1 (restated): the column builder runs ZERO times on the keystroke's urgent commit.
    expect(urgent).toBeDefined();
    expect(urgent.columnBuilds).toBe(colsBefore);
    expect(urgent.mglRenders).toBe(mglBefore);
    // The deferred (interruptible) commit does the real work.
    expect(deferredColumnBuilds).toBeGreaterThanOrEqual(1);
    // Correctness: the filter applied — every task whose name/id contains "25" is listed, and a
    // non-matching neighbour is not.
    for (const name of ['Task 25', 'Task 125', 'Task 225', 'Subtask 25']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('Task 26')).not.toBeInTheDocument();
    expect(screen.queryByText('Subtask 26')).not.toBeInTheDocument();
    expect(input).toHaveValue('25');
  }, 40_000); // 300-task fixture: fixture cost, not assertion relief (see the first test).

  it('a five-keystroke burst (300-task project): no keystroke\'s urgent commit builds columns or renders the table', async () => {
    const user = userEvent.setup();
    tasksState.data = makeTasks();
    milestoneState.data = [M1];
    render$();
    const input = screen.getByPlaceholderText('Search tasks…');
    await settle();
    // Focus first, so every keystroke's window below starts at a change commit rather than at the
    // focus interaction (which would mislabel the first key's urgent commit).
    await user.click(input);
    await act(async () => {});

    const colsBefore = probes.columnBuilds;
    const treeBefore = probes.treeWalks;
    const mglBefore = probes.mglRenders;
    const commitsBefore = probes.commits.length;

    // Typed one key at a time so each keystroke's commits can be attributed: the FIRST commit after
    // a key is its urgent one, the rest are the deferred flush. Pre-fix every urgent commit rebuilt
    // the columns (and re-rendered the table), so this is the property the fix creates.
    const keys = 'Subta';
    const perKeystroke: { columnBuilds: number; tableRenders: number; commits: number }[] = [];
    for (const key of keys) {
      const before = {
        columnBuilds: probes.columnBuilds,
        mglRenders: probes.mglRenders,
        commits: probes.commits.length,
      };
      await user.type(input, key);
      const typingCommits = probes.commits.slice(before.commits);
      const urgent = typingCommits[0];
      perKeystroke.push({
        columnBuilds: (urgent?.columnBuilds ?? before.columnBuilds) - before.columnBuilds,
        tableRenders: (urgent?.mglRenders ?? before.mglRenders) - before.mglRenders,
        commits: typingCommits.length,
      });
    }

    const typingCommits = probes.commits.slice(commitsBefore);
    const totalCommitMs = typingCommits.reduce((sum, c) => sum + c.actualDuration, 0);
    console.info(
      `[perf #2104] keystrokes=${keys.length} urgentColumnBuilds=[${perKeystroke.map((k) => k.columnBuilds).join(',')}] urgentTableRenders=[${perKeystroke.map((k) => k.tableRenders).join(',')}] commitsPerKeystroke=[${perKeystroke.map((k) => k.commits).join(',')}] totalColumnBuilds=${probes.columnBuilds - colsBefore} totalTableRenders=${probes.mglRenders - mglBefore} hierarchyWalks=${probes.treeWalks - treeBefore} commits=${typingCommits.length} sumCommitMs=${totalCommitMs.toFixed(2)}`,
    );

    // AC-1 (restated): the column builder and the table run ZERO times on ANY keystroke's urgent
    // commit — the input stays responsive; their recompute lands in the deferred commit.
    for (const keystroke of perKeystroke) {
      expect(keystroke.columnBuilds).toBe(0);
      expect(keystroke.tableRenders).toBe(0);
    }
    // The columns are still rebuilt for each committed filter value, in the deferred commit.
    expect(probes.columnBuilds - colsBefore).toBe(keys.length);
    expect(input).toHaveValue(keys);
    // The burst filtered to the subtasks only.
    expect(screen.getByText('Subtask 3')).toBeInTheDocument();
    expect(screen.queryByText('Task 3')).not.toBeInTheDocument();
  }, 40_000); // 300-task fixture: fixture cost, not assertion relief (see the first test).

  it('in the timeline view, an unrelated TasksTab re-render does not rebuild the Gantt model', async () => {
    const user = userEvent.setup();
    tasksState.data = makeTasks(10, 2);
    milestoneState.data = [M1];
    render$('/projects/p1/tasks?view=timeline');
    const modelsBefore = probes.ganttModels;

    await toggleToolbarMenu(user);

    expect(probes.ganttModels - modelsBefore).toBe(0);
  });
});
