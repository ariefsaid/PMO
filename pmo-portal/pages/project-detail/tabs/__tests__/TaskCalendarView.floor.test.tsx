import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import type { MilestoneWithProgress } from '@/src/lib/db/milestones';
import { TaskCalendarView } from '../TaskCalendarView';

// jsdom has no layout: lay the month cells out on a 7-column grid so chips land in day cells
// (same trick as WorkCalendar.test.tsx).
let rectSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
  rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const ms = this.dataset.ecDay;
    if (!ms) return new DOMRect(0, 0, 0, 0);
    const day = new Date(Number(ms));
    const idx = Math.round((day.getTime() - new Date(2026, 9, 25).getTime()) / 86_400_000);
    return new DOMRect((idx % 7) * 100, Math.floor(idx / 7) * 100, 100, 100);
  });
});
afterEach(() => { rectSpy.mockRestore(); vi.restoreAllMocks(); });

const task = {
  id: 't1', project_id: 'p1', name: 'Pour slab', status: 'To Do', assignee_id: null,
  start_date: null, end_date: '2026-11-12', org_id: 'org-1', created_at: '2026-01-01T00:00:00Z',
  dependencies: [],
} as unknown as TaskWithRefs;

const milestone = {
  id: 'm1', project_id: 'p1', name: 'Handover', sort_order: 0, target_date: '2026-11-30',
  weight: 1, input_pct: null, task_count: 0, calculated_pct: null, effective_pct: 0,
} as unknown as MilestoneWithProgress;

const renderView = (onOpenTask = vi.fn()) => {
  const onMove = vi.fn().mockResolvedValue(undefined);
  render(
    <TaskCalendarView
      projectId="p1"
      tasks={[task]}
      milestones={[milestone]}
      canEditTask={() => true}
      onMove={onMove}
      onMoveError={vi.fn()}
      onOpenTask={onOpenTask}
    />,
  );
  return { onOpenTask, onMove };
};

describe('TaskCalendarView floor', () => {
  it('floor: Task chip opens that task', async () => {
    const { onOpenTask } = renderView();
    await userEvent.click(screen.getByText('Pour slab').closest('button')!);
    // The chip hands the FULL task row back, so the drawer opens on the real record.
    expect(onOpenTask).toHaveBeenCalledWith(task);
  });

  it('floor: Phase chip performs no write and no navigation', async () => {
    const { onOpenTask, onMove } = renderView();
    await userEvent.click(screen.getByText('Handover').closest('button')!);
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
