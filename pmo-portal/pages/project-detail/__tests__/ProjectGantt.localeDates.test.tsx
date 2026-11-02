/**
 * OE07-004 (T-44): the Gantt task table's compact date cell must follow the SHARED,
 * configured date locale (`formatMonthDay`) instead of a hand-maintained English month
 * list — an Indonesian reader sees the Indonesian order ("1 Jan"), not hard-coded English.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import ProjectGantt from '../ProjectGantt';
import type { TaskWithRefs } from '@/src/lib/db/tasks';

function makeTask(overrides: Partial<TaskWithRefs> & { id: string; name: string }): TaskWithRefs {
  return {
    org_id: 'org-1',
    project_id: 'p1',
    status: 'To Do',
    assignee_id: null,
    milestone_id: null,
    created_at: '2026-01-01T00:00:00Z',
    completed_at: null,
    created_by: null,
    tombstoned_at: null,
    meeting_id: null,
    source_updated_at: null,
    description: null,
    priority: null,
    parent_task_id: null,
    archived_at: null,
    assignee: null,
    dependencies: [],
    start_date: null,
    end_date: null,
    ...overrides,
  };
}

describe('ProjectGantt task-table date rendering follows the configured date locale', () => {
  it('OE07-004: renders the compact range in the active locale (id: "1 Jan – 11 Jan")', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'UTC' });
    render(
      <ProjectGantt
        tasks={[makeTask({ id: 'a', name: 'Survey the site', start_date: '2026-01-01', end_date: '2026-01-11' })]}
        milestones={[]}
        onSwitchView={vi.fn()}
      />,
    );
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('1 Jan – 11 Jan')).toBeInTheDocument();
  });

  it('OE07-004: keeps the null handling — a missing date renders the em-dash placeholder', () => {
    render(
      <ProjectGantt
        tasks={[makeTask({ id: 'p', name: 'Point task', start_date: '2026-01-05', end_date: null })]}
        milestones={[]}
        onSwitchView={vi.fn()}
      />,
    );
    const grid = screen.getByRole('grid');
    expect(within(grid).getByText('Jan 5 – —')).toBeInTheDocument();
  });
});
