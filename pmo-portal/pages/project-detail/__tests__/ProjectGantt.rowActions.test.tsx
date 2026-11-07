/**
 * #1980 — the tree row carries a visible, keyboard-reachable "Row actions" button that opens the
 * same items as right-click (the shared RowMenu primitive).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { TaskWithRefs } from '@/src/lib/db/tasks';
import ProjectGantt from '../ProjectGantt';

const A = {
  id: 'a', name: 'Pour slab', org_id: 'org-1', project_id: 'p1', status: 'To Do', assignee_id: null,
  milestone_id: null, created_by: null, parent_task_id: null, archived_at: null, assignee: null,
  dependencies: [], start_date: '2026-03-02', end_date: '2026-03-06',
} as unknown as TaskWithRefs;

describe('#1980 row actions button', () => {
  it('Tab reaches the button, Enter opens the same items as right-click', async () => {
    const onClick = vi.fn();
    render(
      <ProjectGantt
        tasks={[A]}
        milestones={[]}
        onSwitchView={vi.fn()}
        rowMenu={() => [{ label: 'Comments', onClick }, { label: 'Delete', onClick: vi.fn(), danger: true }]}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Row actions' });
    const user = userEvent.setup();
    for (let i = 0; i < 40 && document.activeElement !== btn; i++) await user.tab();
    expect(btn).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitem', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('no rowMenu, no button', () => {
    render(<ProjectGantt tasks={[A]} milestones={[]} onSwitchView={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Row actions' })).toBeNull();
  });
});
