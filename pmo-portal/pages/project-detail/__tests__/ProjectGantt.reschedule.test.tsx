import '@/test/stubGetAnimations';
/**
 * #1980 — dragging / edge-resizing a Gantt bar saves the new dates through `onReschedule`
 * (TasksTab → the task repository), with the same per-task gate as editing the task.
 *
 * jsdom has no layout, so a real pointer drag cannot resolve a date. The gantt is wrapped to
 * capture its props, and the commit gate (`onEventUpdate`, the call ReUI makes when a drag or
 * resize is released) is invoked exactly as the gantt invokes it. The pointer path itself is
 * proven in the browser (scripts/ux-proof.sh + the Timeline e2e).
 */
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { GanttProps } from '@/src/components/reui/gantt/gantt';
import type { GanttProposedUpdate } from '@/src/components/reui/gantt/gantt-types';

let captured: GanttProps<any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock('@/src/components/reui/gantt/gantt', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/src/components/reui/gantt/gantt')>();
  return {
    ...mod,
    Gantt: (props: GanttProps<any>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      captured = props;
      return <mod.Gantt {...props} />;
    },
  };
});

import ProjectGantt from '../ProjectGantt';

const task = (o: Partial<TaskWithRefs> & { id: string; name: string }): TaskWithRefs =>
  ({
    org_id: 'org-1', project_id: 'p1', status: 'To Do', assignee_id: null, milestone_id: null,
    created_by: null, parent_task_id: null, archived_at: null, assignee: null, dependencies: [],
    start_date: null, end_date: null, ...o,
  }) as TaskWithRefs;

const A = task({ id: 'a', name: 'Pour slab', start_date: '2026-03-02', end_date: '2026-03-06' });
const B = task({ id: 'b', name: 'Cure slab', start_date: '2026-03-09', end_date: '2026-03-13' });
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

function update(t: TaskWithRefs, start: string, end: string, source: GanttProposedUpdate['source'] = 'drag') {
  const event = captured!.events!.find((e) => e.id === t.id)!;
  return { event, occurrence: null, start: day(start), end: day(end), allDay: true, source } as GanttProposedUpdate;
}

function setup(over: Partial<React.ComponentProps<typeof ProjectGantt>> = {}) {
  const onReschedule = vi.fn().mockResolvedValue(true);
  const utils = render(
    <ProjectGantt
      tasks={[A, B]}
      milestones={[]}
      onSwitchView={vi.fn()}
      canReschedule={() => true}
      onReschedule={onReschedule}
      {...over}
    />,
  );
  return { onReschedule, ...utils };
}

describe('#1980 drag / resize saves dates', () => {
  it('a move saves both dates (the gantt end is exclusive, end_date inclusive)', async () => {
    const { onReschedule } = setup();
    let result: unknown;
    await act(async () => { result = captured!.onEventUpdate!(update(A, '2026-03-09', '2026-03-14')); });
    expect(result).not.toBe(false);
    expect(onReschedule).toHaveBeenCalledWith(A, { start_date: '2026-03-09', end_date: '2026-03-13' });
  });

  it('an edge resize saves only the edge that moved', async () => {
    const { onReschedule } = setup();
    await act(async () => { captured!.onEventUpdate!(update(A, '2026-03-02', '2026-03-12', 'resize-end')); });
    expect(onReschedule).toHaveBeenCalledWith(A, { end_date: '2026-03-11' });
  });

  it('the bar moves at once, before the save resolves', async () => {
    let finish!: (ok: boolean) => void;
    const onReschedule = vi.fn(() => new Promise<boolean>((r) => { finish = r; }));
    setup({ onReschedule });
    await act(async () => { captured!.onEventUpdate!(update(A, '2026-03-09', '2026-03-14')); });
    expect(captured!.events!.find((e) => e.id === 'a')!.start).toEqual(day('2026-03-09'));
    await act(async () => { finish(true); });
  });

  it('rolls the bar back when the save fails', async () => {
    const { onReschedule } = setup({ onReschedule: vi.fn().mockResolvedValue(false) });
    void onReschedule;
    await act(async () => { captured!.onEventUpdate!(update(A, '2026-03-09', '2026-03-14')); });
    expect(captured!.events!.find((e) => e.id === 'a')!.start).toEqual(day('2026-03-02'));
  });

  it('rolls the bar back when the save rejects', async () => {
    setup({ onReschedule: vi.fn().mockRejectedValue(new Error('boom')) });
    await act(async () => { captured!.onEventUpdate!(update(A, '2026-03-09', '2026-03-14')); });
    expect(captured!.events!.find((e) => e.id === 'a')!.start).toEqual(day('2026-03-02'));
  });

  it('a failed first save does not undo a newer drag on the same task', async () => {
    let failFirst!: (ok: boolean) => void;
    const onReschedule = vi
      .fn()
      .mockImplementationOnce(() => new Promise<boolean>((r) => { failFirst = r; }))
      .mockResolvedValue(true);
    setup({ onReschedule });
    await act(async () => { captured!.onEventUpdate!(update(A, '2026-03-09', '2026-03-14')); });
    await act(async () => { captured!.onEventUpdate!(update(A, '2026-03-16', '2026-03-21')); });
    await act(async () => { failFirst(false); });
    expect(captured!.events!.find((e) => e.id === 'a')!.start).toEqual(day('2026-03-16'));
  });

  it('a drop on the same dates is rejected without a write', async () => {
    const { onReschedule } = setup();
    let result: unknown;
    await act(async () => { result = captured!.onEventUpdate!(update(A, '2026-03-02', '2026-03-07')); });
    expect(result).toBe(false);
    expect(onReschedule).not.toHaveBeenCalled();
  });
});

describe('#1980 read-only roles cannot drag', () => {
  it('without a reschedule handler the gantt turns off drag and resize', () => {
    setup({ canReschedule: undefined, onReschedule: undefined });
    expect(captured!.interactions).toMatchObject({ drag: false, resize: false });
    expect(captured!.events!.every((e) => e.readOnly)).toBe(true);
  });

  it('a task the viewer may not edit is read-only and its update is refused', async () => {
    const { onReschedule } = setup({ canReschedule: (t) => t.id === 'b' });
    expect(captured!.events!.find((e) => e.id === 'a')!.readOnly).toBe(true);
    expect(captured!.events!.find((e) => e.id === 'b')!.readOnly).toBe(false);
    let result: unknown;
    await act(async () => { result = captured!.onEventUpdate!(update(A, '2026-03-09', '2026-03-14')); });
    expect(result).toBe(false);
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it('an editable viewer gets drag and resize on', () => {
    setup();
    expect(captured!.interactions).toMatchObject({ drag: true, resize: true });
    expect(screen.getByRole('figure')).toBeInTheDocument();
  });
});
