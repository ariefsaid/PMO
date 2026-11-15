/**
 * #2058 — the Approvals queue groups its cards into Overdue / Today / Later (the age buckets in
 * `approvalUrgency`) and every card says how long it has waited.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { QueueGroup, type QueueItem } from '../ApprovalQueue';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function purchase(id: string, title: string, createdAt: string): QueueItem {
  const row = {
    id, title, code: id.toUpperCase(), created_at: createdAt, total_value: 1000, currency: 'IDR',
    requested_by: { full_name: 'Rina' }, project: { name: 'Alpha' },
  } as unknown as ProcurementWithRefs;
  return { key: `procurement:${id}`, kind: 'procurement', row };
}

function sheet(id: string, owner: string, submittedAt: string | null): QueueItem {
  const row = {
    id, week_start_date: '2026-11-02', submitted_at: submittedAt, owner: { full_name: owner, manager_id: null },
    entries: [{ hours: 8, project: { name: 'Alpha' } }],
  } as unknown as TimesheetAwaitingApproval;
  return { key: `timesheets:${id}`, kind: 'timesheets', row };
}

/** The group's visible heading, which also names it for assistive tech. */
function groupName(group: HTMLElement): string {
  const heading = within(group).getByRole('heading');
  expect(group).toHaveAccessibleName(heading.textContent ?? '');
  return heading.textContent ?? '';
}

function renderGroup(items: QueueItem[]) {
  return render(
    <QueueGroup
      title="Procurement cases"
      count={items.length}
      items={items}
      selectedKey={null}
      onSelect={vi.fn()}
      isPending={false}
      isError={false}
      onRetry={vi.fn()}
      emptyTitle="Nothing waiting"
    />,
  );
}

describe('#2058 approvals queue urgency groups', () => {
  it('groups cards under Overdue, Today and Later, in that order, oldest first', () => {
    renderGroup([
      purchase('p-new', 'Fresh request', ago(0.2)),
      purchase('p-old', 'Old request', ago(9)),
      purchase('p-mid', 'Two day request', ago(2)),
      purchase('p-older', 'Five day request', ago(5)),
    ]);
    const groups = screen.getAllByRole('group');
    expect(groups.map(groupName)).toEqual(['Overdue', 'Today', 'Later']);
    expect(within(groups[0]).getAllByRole('button').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Old request'),
      expect.stringContaining('Five day request'),
    ]);
    expect(within(groups[1]).getByRole('button')).toHaveTextContent('Two day request');
    expect(within(groups[2]).getByRole('button')).toHaveTextContent('Fresh request');
  });

  it('leaves out an urgency group with no cards', () => {
    renderGroup([purchase('p-new', 'Fresh request', ago(0.2))]);
    expect(screen.getAllByRole('group').map(groupName)).toEqual(['Later']);
  });

  it('shows the age on every card, timesheets included, and under a day when fresh', () => {
    renderGroup([
      purchase('p-old', 'Old request', ago(4)),
      purchase('p-new', 'Fresh request', ago(0.2)),
      sheet('t-1', 'Budi', ago(1)),
    ]);
    expect(screen.getByRole('button', { name: /Old request/ })).toHaveTextContent('4 days waiting');
    expect(screen.getByRole('button', { name: /Fresh request/ })).toHaveTextContent('Under a day waiting');
    expect(screen.getByRole('button', { name: /Budi/ })).toHaveTextContent('1 day waiting');
  });

  it('ages a timesheet from its submission, not its week', () => {
    renderGroup([sheet('t-1', 'Budi', ago(0.1))]);
    expect(screen.getByRole('group', { name: 'Later' })).toHaveTextContent('Budi');
  });
});
