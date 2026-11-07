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

export const DAY_MS = 86_400_000;

export interface GanttTaskData {
  task: TaskWithRefs | null;
}

export interface ReuiGanttModel {
  resources: GanttResource[];
  events: GanttEvent<GanttTaskData>[];
  /** Tasks with neither date: listed in a footer, never plotted. */
  undated: { id: string; name: string }[];
  /** Bars drawn (tasks only, not milestone diamonds). */
  barCount: number;
  edgeCount: number;
  hiddenEdgeCount: number;
  isEmpty: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  'To Do': 'var(--color-muted-foreground)',
  'In Progress': 'var(--color-primary)',
  Done: 'var(--color-success)',
  Blocked: 'var(--color-destructive)',
};

const parseDay = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const toDay = (d: Date): string => d.toISOString().slice(0, 10);

export function buildReuiGanttModel(
  tasks: TaskWithRefs[],
  milestones: MilestoneWithProgress[],
  labels: { ungrouped: string; milestoneTarget: string; dependsOn: (names: string[]) => string },
  canReschedule: (task: TaskWithRefs) => boolean = () => false,
): ReuiGanttModel {
  // OD-INT-9: subtasks nest under their parent in the list view and never get a bar.
  const topLevel = tasks.filter((t) => t.parent_task_id == null && t.archived_at == null);
  const dated = topLevel.filter((t) => t.start_date || t.end_date);
  const undated = topLevel.filter((t) => !t.start_date && !t.end_date).map((t) => ({ id: t.id, name: t.name }));
  const drawn = new Map(dated.map((t) => [t.id, t.name]));

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

  const groups: GanttResource[] = [];
  const sorted = [...milestones].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const byMilestone = new Map<string | null, TaskWithRefs[]>();
  for (const t of dated) {
    const key = t.milestone_id != null && sorted.some((m) => m.id === t.milestone_id) ? t.milestone_id : null;
    byMilestone.set(key, [...(byMilestone.get(key) ?? []), t]);
  }
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
    for (const t of byMilestone.get(m.id) ?? []) children.push({ id: t.id, title: t.name, scheduleMode: 'single' });
    if (children.length) groups.push({ id: `milestone:${m.id}`, title: m.name, children });
  }
  const ungrouped = byMilestone.get(null) ?? [];
  if (ungrouped.length) {
    groups.push({
      id: 'milestone:none',
      title: labels.ungrouped,
      children: ungrouped.map((t) => ({ id: t.id, title: t.name, scheduleMode: 'single' as const })),
    });
  }

  return {
    resources: groups,
    events,
    undated,
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
