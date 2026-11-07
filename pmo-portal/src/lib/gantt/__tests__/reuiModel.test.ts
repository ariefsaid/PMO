import { describe, expect, it } from 'vitest';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import { buildReuiGanttModel, taskPatchFromRange } from '../reuiModel';

const task = (o: Partial<TaskWithRefs> & { id: string; name: string }): TaskWithRefs =>
  ({
    status: 'To Do',
    milestone_id: null,
    parent_task_id: null,
    archived_at: null,
    dependencies: [],
    start_date: null,
    end_date: null,
    ...o,
  }) as TaskWithRefs;

const milestone = (o: Partial<MilestoneWithProgress> & { id: string; name: string }): MilestoneWithProgress =>
  ({ sort_order: 0, target_date: null, ...o }) as MilestoneWithProgress;

const labels = { ungrouped: 'Ungrouped', milestoneTarget: 'Target date', dependsOn: (n: string[]) => `depends on ${n.join(', ')}` };
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('buildReuiGanttModel', () => {
  it('maps a dated task to an event whose exclusive end is the day AFTER its end_date', () => {
    const m = buildReuiGanttModel([task({ id: 'a', name: 'A', start_date: '2026-01-01', end_date: '2026-01-10' })], [], labels);
    const ev = m.events.find((e) => e.id === 'a')!;
    expect(ev.start).toEqual(day('2026-01-01'));
    expect(ev.end).toEqual(day('2026-01-11'));
  });

  it('draws a one-sided date as a zero-length point and lists no-date tasks as undated', () => {
    const m = buildReuiGanttModel(
      [task({ id: 'p', name: 'P', end_date: '2026-02-03' }), task({ id: 'u', name: 'U' })],
      [],
      labels,
    );
    const ev = m.events.find((e) => e.id === 'p')!;
    expect(ev.start).toEqual(ev.end);
    expect(m.events.find((e) => e.id === 'u')).toBeUndefined();
    expect(m.undated).toEqual([{ id: 'u', name: 'U' }]);
  });

  it('excludes subtasks and archived tasks entirely', () => {
    const m = buildReuiGanttModel(
      [
        task({ id: 's', name: 'Sub', parent_task_id: 'a', start_date: '2026-01-01', end_date: '2026-01-02' }),
        task({ id: 'x', name: 'Arch', archived_at: '2026-01-01T00:00:00Z', start_date: '2026-01-01', end_date: '2026-01-02' }),
      ],
      [],
      labels,
    );
    expect(m.events).toHaveLength(0);
    expect(m.undated).toHaveLength(0);
    expect(m.isEmpty).toBe(true);
  });

  it('groups tasks under their milestone (sorted) and the rest under Ungrouped', () => {
    const m = buildReuiGanttModel(
      [
        task({ id: 'a', name: 'A', milestone_id: 'm2', start_date: '2026-01-01', end_date: '2026-01-02' }),
        task({ id: 'b', name: 'B', start_date: '2026-01-01', end_date: '2026-01-02' }),
      ],
      [milestone({ id: 'm2', name: 'Second', sort_order: 2 }), milestone({ id: 'm1', name: 'First', sort_order: 1, target_date: '2026-03-01' })],
      labels,
    );
    expect(m.resources.map((r) => r.title)).toEqual(['First', 'Second', 'Ungrouped']);
    expect(m.resources[1].children?.map((c) => c.id)).toEqual(['a']);
    const target = m.resources[0].children![0];
    expect(target.title).toBe('Target date');
    const diamond = m.events.find((e) => e.resourceId === target.id)!;
    expect(diamond.start).toEqual(day('2026-03-01'));
    expect(diamond.readOnly).toBe(true);
  });

  it('names dependencies only when both ends are drawn; counts the rest as hidden', () => {
    const m = buildReuiGanttModel(
      [
        task({ id: 'a', name: 'A', start_date: '2026-01-01', end_date: '2026-01-02' }),
        task({ id: 'b', name: 'B', start_date: '2026-01-03', end_date: '2026-01-04', dependencies: [{ depends_on_id: 'a' }, { depends_on_id: 'gone' }] }),
      ],
      [],
      labels,
    );
    expect(m.events.find((e) => e.id === 'b')!.dependencies).toEqual(['a']);
    expect(m.events.find((e) => e.id === 'b')!.ariaSuffix).toBe('depends on A');
    expect(m.events.find((e) => e.id === 'a')!.ariaSuffix).toBeUndefined();
    expect(m.edgeCount).toBe(1);
    expect(m.hiddenEdgeCount).toBe(1);
  });

  it('marks an event read-only when the caller says the task cannot be rescheduled', () => {
    const m = buildReuiGanttModel(
      [task({ id: 'a', name: 'A', start_date: '2026-01-01', end_date: '2026-01-02' })],
      [],
      labels,
      (t) => t.id !== 'a',
    );
    expect(m.events.find((e) => e.id === 'a')!.readOnly).toBe(true);
  });
});

describe('taskPatchFromRange', () => {
  const both = task({ id: 'a', name: 'A', start_date: '2026-01-01', end_date: '2026-01-10' });

  it('moves both dates, turning the exclusive end back into an inclusive end_date', () => {
    expect(taskPatchFromRange(both, day('2026-01-05'), day('2026-01-15'))).toEqual({
      start_date: '2026-01-05',
      end_date: '2026-01-14',
    });
  });

  it('sends only the side that changed on an edge resize', () => {
    expect(taskPatchFromRange(both, day('2026-01-01'), day('2026-01-13'))).toEqual({ end_date: '2026-01-12' });
  });

  it('keeps a one-sided task one-sided', () => {
    expect(taskPatchFromRange(task({ id: 'p', name: 'P', end_date: '2026-02-03' }), day('2026-02-07'), day('2026-02-07'))).toEqual({
      end_date: '2026-02-07',
    });
  });

  it('never lets end_date fall before start_date', () => {
    expect(taskPatchFromRange(both, day('2026-01-08'), day('2026-01-08'))).toEqual({ start_date: '2026-01-08', end_date: '2026-01-08' });
  });

  it('returns null when nothing changed', () => {
    expect(taskPatchFromRange(both, day('2026-01-01'), day('2026-01-11'))).toBeNull();
  });
});
