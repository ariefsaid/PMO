/**
 * Pure mapping between PMO tasks/milestones and the ReUI gantt's resources + events (#1980).
 *
 * Dates are DATE columns, so the gantt runs in UTC and every task date is a UTC midnight: no
 * local-zone or DST drift between what is stored and what is dragged. The gantt's `end` is
 * exclusive, a task's `end_date` is inclusive, hence the one-day shift in each direction.
 */
import type { TaskPatch, TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import type { GanttEvent, GanttResource } from '@/src/components/reui/gantt/gantt-types';
import { buildRollups, type TaskRollup } from '@/src/lib/tasks/taskTree';

export const DAY_MS = 86_400_000;

export interface GanttTaskData {
  task: TaskWithRefs | null;
}

export interface ReuiGanttModel {
  resources: GanttResource[];
  events: GanttEvent<GanttTaskData>[];
  /** Tasks with neither date: listed in a footer, never plotted. */
  undated: { id: string; name: string }[];
  /** Roll-up of every task with a live child (#2807): the tree columns show it for parent rows. */
  rollups: Map<string, TaskRollup>;
  /** Summary-bar progress per parent row (a phase's own %, else done subtasks over subtasks). */
  summaryPct: Map<string, number>;
  /** Bars drawn (tasks only, not milestone diamonds). */
  barCount: number;
  edgeCount: number;
  hiddenEdgeCount: number;
  isEmpty: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  'To Do': 'var(--color-mark-neutral)',
  'In Progress': 'var(--color-primary)',
  Done: 'var(--color-success)',
  Blocked: 'var(--color-destructive)',
};

const parseDay = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const toDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * #2807: tasks nest to any depth. A task with subtasks is a parent row with no bar of its own: the gantt draws its
 * summary bar over its subtasks' bars (parentScheduling off), and its progress is done subtasks over subtasks.
 * Leaves carry the bars. Rows sit under their top task's place: a task group linked to a phase nests under that
 * phase, an unlinked group and each phase are top rows, then Ungrouped. Undated leaves (and parents with no dated
 * leaf) are listed in the footer, never plotted.
 */
export function buildReuiGanttModel(
  tasks: TaskWithRefs[],
  milestones: MilestoneWithProgress[],
  labels: { ungrouped: string; milestoneTarget: string; dependsOn: (names: string[]) => string },
  canReschedule: (task: TaskWithRefs) => boolean = () => false,
  opts: { allTasks?: TaskWithRefs[]; taskGroups?: { id: string; name: string; milestone_id: string | null }[] } = {},
): ReuiGanttModel {
  const visible = tasks.filter((t) => t.archived_at == null);
  const rollups = buildRollups(opts.allTasks ?? tasks);
  const present = new Set(visible.map((t) => t.id));
  const kids = new Map<string, TaskWithRefs[]>();
  const roots: TaskWithRefs[] = [];
  for (const t of visible) {
    if (t.parent_task_id && present.has(t.parent_task_id)) kids.set(t.parent_task_id, [...(kids.get(t.parent_task_id) ?? []), t]);
    else roots.push(t);
  }
  const isLeaf = (t: TaskWithRefs) => !kids.has(t.id) && !rollups.has(t.id);
  const dated = visible.filter((t) => isLeaf(t) && (t.start_date || t.end_date));
  const drawn = new Map(dated.map((t) => [t.id, t.name]));
  const undated: { id: string; name: string }[] = [];
  const summaryPct = new Map<string, number>();

  let edgeCount = 0;
  let hiddenEdgeCount = 0;
  const events: GanttEvent<GanttTaskData>[] = dated.map((t) => {
    const start = parseDay((t.start_date ?? t.end_date)!);
    // A reversed range (end before start) collapses to a zero-length bar, never a negative one.
    const end =
      t.start_date && t.end_date
        ? new Date(Math.max(start.getTime(), parseDay(t.end_date).getTime() + DAY_MS))
        : start;
    const dependencies: string[] = [];
    const names: string[] = [];
    for (const d of t.dependencies) {
      if (drawn.has(d.depends_on_id)) {
        dependencies.push(d.depends_on_id);
        names.push(drawn.get(d.depends_on_id)!);
        edgeCount += 1;
      } else hiddenEdgeCount += 1;
    }
    return {
      id: t.id,
      title: t.name,
      start,
      end,
      allDay: true,
      resourceId: t.id,
      color: STATUS_COLOR[t.status] ?? STATUS_COLOR['To Do'],
      progress: t.status === 'Done' ? 100 : undefined,
      readOnly: !canReschedule(t),
      dependencies: dependencies.length ? dependencies : undefined,
      // The relationship is never arrow-only: the bar's accessible name says it too (AC-GANTT-008).
      ariaSuffix: names.length ? labels.dependsOn(names) : undefined,
      data: { task: t },
    };
  });

  // One row per task: a dated leaf, or a parent with at least one plotted row under it.
  const node = (t: TaskWithRefs, seen: Set<string>): GanttResource | null => {
    if (seen.has(t.id)) return null; // defensive: a cycle in old data
    seen.add(t.id);
    if (kids.has(t.id)) {
      const children = (kids.get(t.id) ?? []).map((k) => node(k, seen)).filter((x): x is GanttResource => !!x);
      if (!children.length) { undated.push({ id: t.id, name: t.name }); return null; }
      const r = rollups.get(t.id);
      if (r) summaryPct.set(t.id, r.pct);
      return { id: t.id, title: t.name, scheduleMode: 'single', children };
    }
    if (!drawn.has(t.id)) { undated.push({ id: t.id, name: t.name }); return null; }
    return { id: t.id, title: t.name, scheduleMode: 'single' };
  };

  const groups = opts.taskGroups ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const sorted = [...milestones].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const milestoneIds = new Set(sorted.map((m) => m.id));
  const placeOf = (t: TaskWithRefs): string => {
    const g = (t as TaskWithRefs & { task_group_id?: string | null }).task_group_id;
    if (g && groupIds.has(g)) return `group:${g}`;
    return t.milestone_id && milestoneIds.has(t.milestone_id) ? `milestone:${t.milestone_id}` : 'milestone:none';
  };
  const byPlace = new Map<string, GanttResource[]>();
  for (const r of roots) {
    const n = node(r, new Set());
    if (n) byPlace.set(placeOf(r), [...(byPlace.get(placeOf(r)) ?? []), n]);
  }
  const groupRow = (g: { id: string; name: string }): GanttResource | null => {
    const children = byPlace.get(`group:${g.id}`) ?? [];
    return children.length ? { id: `group:${g.id}`, title: g.name, children } : null;
  };

  const resources: GanttResource[] = [];
  for (const m of sorted) {
    const children: GanttResource[] = [];
    if (m.target_date) {
      const id = `milestone-target:${m.id}`;
      children.push({ id, title: labels.milestoneTarget, scheduleMode: 'single' });
      const at = parseDay(m.target_date);
      events.push({
        id,
        title: m.name,
        start: at,
        end: at,
        allDay: true,
        resourceId: id,
        readOnly: true,
        color: 'var(--color-warning)',
        data: { task: null },
      });
    }
    for (const g of groups) if (g.milestone_id === m.id) { const row = groupRow(g); if (row) children.push(row); }
    children.push(...(byPlace.get(`milestone:${m.id}`) ?? []));
    if (children.length) {
      summaryPct.set(`milestone:${m.id}`, m.effective_pct);
      resources.push({ id: `milestone:${m.id}`, title: m.name, children });
    }
  }
  for (const g of groups) if (!g.milestone_id || !milestoneIds.has(g.milestone_id)) { const row = groupRow(g); if (row) resources.push(row); }
  const ungrouped = byPlace.get('milestone:none') ?? [];
  if (ungrouped.length) resources.push({ id: 'milestone:none', title: labels.ungrouped, children: ungrouped });

  return {
    resources,
    events,
    undated,
    rollups,
    summaryPct,
    barCount: dated.length,
    edgeCount,
    hiddenEdgeCount,
    isEmpty: events.length === 0,
  };
}

/**
 * The columns to save for a dropped/resized bar, or null when nothing changed.
 * A one-sided task stays one-sided (its only date moves); `end_date` never precedes `start_date`.
 */
export function taskPatchFromRange(task: TaskWithRefs, start: Date, end: Date): TaskPatch | null {
  const newStart = toDay(start);
  if (!task.start_date || !task.end_date) {
    const key = task.start_date ? 'start_date' : 'end_date';
    return newStart === task[key] ? null : { [key]: newStart };
  }
  let newEnd = toDay(new Date(end.getTime() - DAY_MS));
  if (newEnd < newStart) newEnd = newStart;
  const patch: TaskPatch = {};
  if (newStart !== task.start_date) patch.start_date = newStart;
  if (newEnd !== task.end_date) patch.end_date = newEnd;
  return Object.keys(patch).length ? patch : null;
}
