import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { UrgencyQueue, type QueueItem } from './ApprovalQueue';
import { OVERDUE_AFTER_DAYS } from '@/src/lib/selectors/approvalUrgency';

const NOW = new Date('2026-11-09T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const purchase = (id: string, title: string, createdAt: string): QueueItem => ({
  key: `procurement:${id}`,
  kind: 'procurement',
  row: { id, title, created_at: createdAt, total_value: 100, currency: 'IDR', requested_by: { full_name: 'Budi Santoso' }, project: null } as never,
});
const week = (id: string, owner: string, submittedAt: string): QueueItem => ({
  key: `timesheets:${id}`,
  kind: 'timesheets',
  row: { id, week_start_date: '2026-10-26', submitted_at: submittedAt, owner: { full_name: owner }, entries: [] } as never,
});

describe('UrgencyQueue', () => {
  // The row ages read the clock too: fix it so the groups and the ages agree.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => vi.useRealTimers());

  it('groups the queue into Overdue, Today and Later by how long each waited, oldest first, age on every row', async () => {
    const onSelect = vi.fn();
    render(
      <UrgencyQueue
        now={NOW}
        selectedKey={null}
        onSelect={onSelect}
        items={[
          purchase('fresh', 'Fresh request', daysAgo(0.2)),
          week('w1', 'Agus Wijaya', daysAgo(1)),
          purchase('edge', 'Just overdue', daysAgo(OVERDUE_AFTER_DAYS)),
          purchase('old', 'Oldest request', daysAgo(30)),
          purchase('two', 'Two days', daysAgo(2.5)),
        ]}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Overdue', 'Today', 'Later']);

    const rowsIn = (name: string) => within(screen.getByRole('region', { name })).getAllByRole('button');
    expect(rowsIn('Overdue').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Oldest request'),
      expect.stringContaining('Just overdue'),
    ]);
    expect(rowsIn('Overdue')[0]).toHaveTextContent('30 days waiting');
    expect(rowsIn('Today')).toHaveLength(1);
    expect(rowsIn('Today')[0]).toHaveTextContent(/Fresh request.*Today/);
    expect(rowsIn('Later').map((b) => b.textContent)).toEqual([
      expect.stringContaining('Two days'),
      expect.stringContaining('Agus Wijaya'),
    ]);
    expect(rowsIn('Later')[1]).toHaveTextContent('1 day waiting');

    await userEvent.click(rowsIn('Today')[0]);
    expect(onSelect).toHaveBeenCalledWith('procurement:fresh');
  });

  it('leaves out a group with nothing in it', () => {
    render(<UrgencyQueue now={NOW} selectedKey={null} onSelect={vi.fn()} items={[purchase('fresh', 'Fresh request', daysAgo(0.1))]} />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Today']);
  });
});
