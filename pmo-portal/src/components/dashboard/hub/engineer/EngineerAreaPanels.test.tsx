import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { MyTask } from '@/src/hooks/useMyTasks';
import { EngineerTasksCard } from './EngineerAreaPanels';

const task = (overrides: Partial<MyTask> = {}): MyTask => ({
  id: 'task-1', name: 'Inspect roof installation', status: 'In Progress', assignee_id: 'engineer-1',
  project_id: 'project-1', project_name: 'Meridian Steelworks', start_date: null, end_date: '2026-11-12',
  priority: null, archived_at: null, ...overrides,
});

describe('Engineer task header findings', () => {
  it('AC-UX-SCREENS-A-W3 keeps both 44px count hit areas in the compact header', () => {
    render(
      <MemoryRouter>
        <EngineerTasksCard
          overdue={[task()]}
          dueThisWeek={[task({ id: 'today', end_date: '2026-11-14' })]}
          undated={[]}
          today="2026-11-14"
          dayError={false}
          loading={false}
          error={false}
          onRetry={vi.fn()}
        />
      </MemoryRouter>,
    );

    const overdue = screen.getByTestId('engineer-tasks-overdue');
    const dueToday = screen.getByTestId('engineer-tasks-due-today');
    expect(overdue).toHaveTextContent('1 overdue');
    expect(overdue).toHaveAttribute('href', '/my-tasks');
    expect(overdue).toHaveClass('touch-target', 'touch-target-overlay');
    expect(dueToday).toHaveTextContent('1 due today');
    expect(dueToday).toHaveAttribute('href', '/my-tasks');
    expect(dueToday).toHaveClass('touch-target', 'touch-target-overlay');
  });
});
