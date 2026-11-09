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
 *   - while typing in task search, the column builder runs ZERO times on the urgent render
 *     (the recompute moves to the deferred commit, `useDeferredValue(searchText)`);
 *   - in the timeline, the Gantt model is not rebuilt on unrelated re-renders.
 *
 * Render counts come from module probes: `buildTaskRenderOrder` (the per-group walk the columns
 * memo runs), the grouped table's own renders, and `buildReuiGanttModel`. Profiler commit
 * durations are recorded for the 300-task typing interaction (before/after evidence).
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
  treeWalks: 0, // buildTaskRenderOrder invocations (the columns memo's per-group walk)
  ganttModels: 0, // buildReuiGanttModel invocations (ProjectGantt's model memo)
  mglRenders: 0, // MilestoneGroupedList function renders (bail-out = no increment)
  commits: [] as {
    phase: string;
    actualDuration: number;
    treeWalks: number;
    mglRenders: number;
  }[],
}));

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
    const treeBefore = probes.treeWalks;
    const mglBefore = probes.mglRenders;

    await toggleToolbarMenu(user);

    expect(probes.treeWalks - treeBefore).toBe(0);
    expect(probes.mglRenders - mglBefore).toBe(0);
  });

  it('typing in search: the urgent (keystroke) render runs zero column builds; the deferred commit applies the filter', async () => {
    tasksState.data = makeTasks();
    milestoneState.data = [M1];
    render$();
    const input = screen.getByPlaceholderText('Search tasks…');
    await settle();

    const treeBefore = probes.treeWalks;
    const mglBefore = probes.mglRenders;
    const commitsBefore = probes.commits.length;

    // One keystroke. The URGENT commit applies the input value only; useDeferredValue moves the
    // filtered recompute (and the grouped table's column rebuild) to the deferred commit.
    fireEvent.change(input, { target: { value: '25' } });
    await act(async () => {}); // flush the deferred commit

    const typingCommits = probes.commits.slice(commitsBefore);
    const urgent = typingCommits[0];
    const deferredTreeWalks = probes.treeWalks - (urgent?.treeWalks ?? treeBefore);
    const totalCommitMs = typingCommits.reduce((sum, c) => sum + c.actualDuration, 0);
    console.info(
      `[perf #2104] keystroke=1 urgentCommit: phase=${urgent?.phase} columnBuilds=+${(urgent?.treeWalks ?? treeBefore) - treeBefore} tableRenders=+${(urgent?.mglRenders ?? mglBefore) - mglBefore} urgentCommitMs=${(urgent?.actualDuration ?? 0).toFixed(2)} | deferred columnBuilds=+${deferredTreeWalks} | commits=${typingCommits.length} typingMs=${totalCommitMs.toFixed(2)}`,
    );

    // AC: the column builder runs ZERO times on the keystroke's urgent commit.
    expect(urgent).toBeDefined();
    expect(urgent.treeWalks).toBe(treeBefore);
    expect(urgent.mglRenders).toBe(mglBefore);
    // The deferred commit does the real work once.
    expect(deferredTreeWalks).toBeGreaterThanOrEqual(1);
    // Correctness: the filter applied — every task whose name/id contains "25" is listed, and a
    // non-matching neighbour is not.
    for (const name of ['Task 25', 'Task 125', 'Task 225', 'Subtask 25']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.queryByText('Task 26')).not.toBeInTheDocument();
    expect(screen.queryByText('Subtask 26')).not.toBeInTheDocument();
    expect(input).toHaveValue('25');
  });

  it('a five-keystroke burst: the table commits at most once per keystroke, and records its evidence (300-task project)', async () => {
    const user = userEvent.setup();
    tasksState.data = makeTasks();
    milestoneState.data = [M1];
    render$();
    const input = screen.getByPlaceholderText('Search tasks…');
    await settle();
    const treeBefore = probes.treeWalks;
    const mglBefore = probes.mglRenders;
    const commitsBefore = probes.commits.length;

    const keys = 'Subta';
    await user.type(input, keys);

    const typingCommits = probes.commits.slice(commitsBefore);
    const totalCommitMs = typingCommits.reduce((sum, c) => sum + c.actualDuration, 0);
    const mglRenders = probes.mglRenders - mglBefore;
    console.info(
      `[perf #2104] keystrokes=${keys.length} tableRenders=${mglRenders} columnBuilds=${probes.treeWalks - treeBefore} commits=${typingCommits.length} sumCommitMs=${totalCommitMs.toFixed(2)}`,
    );
    // No keystroke may cost the table more than ONE commit (its deferred one) — a double render
    // per keystroke (urgent + deferred) is the regression this guards.
    expect(mglRenders).toBeLessThanOrEqual(keys.length);
    expect(input).toHaveValue(keys);
    // The burst filtered to the subtasks only.
    expect(screen.getByText('Subtask 3')).toBeInTheDocument();
    expect(screen.queryByText('Task 3')).not.toBeInTheDocument();
  });

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
