import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BahasaProvider } from '@/test/bahasa';
import { formatCurrency, formatDateOnly } from '@/src/lib/format';

const { repo } = vi.hoisted(() => ({
  repo: {
    recordHistory: { list: vi.fn() },
    profile: { listOrgProfiles: vi.fn() },
    company: { list: vi.fn() },
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: repo }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { RecordHistory } from '../RecordHistory';

const ev = (n: number, over: Record<string, unknown> = {}) => ({
  id: `e${n}`, source: 'change', seq: n, entityType: 'project', entityId: 'p1', op: 'update', action: null,
  actorId: 'u1', changes: {}, detail: null, currency: 'USD', createdAt: new Date(Date.now() - n * 60_000).toISOString(),
  ...over,
});

const renderIt = (props: Partial<React.ComponentProps<typeof RecordHistory>> = {}, wrap = false) => {
  const ui = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecordHistory entityType="project" entityId="p1" {...props} />
    </QueryClientProvider>
  );
  return render(wrap ? <BahasaProvider>{ui}</BahasaProvider> : ui);
};

beforeEach(() => {
  vi.resetAllMocks();
  repo.profile.listOrgProfiles.mockResolvedValue([
    { id: 'u1', full_name: 'Dana PM' }, { id: 'u2', full_name: 'Sam Lead' },
  ]);
  repo.company.list.mockResolvedValue([{ id: 'c1', name: 'Acme Corp' }, { id: 'c2', name: 'Globex' }]);
});

describe('RecordHistory — formatting (AC-CHG-015)', () => {
  const events = [
    ev(6, { actorId: null, changes: { status: { old: 'Planning', new: 'Ongoing Project' } } }),
    ev(5, { actorId: 'ghost', op: 'insert', changes: {} }),
    ev(4, { entityType: 'contact', changes: { phone: { changed: true } } }),
    ev(3, {
      changes: {
        contract_value: { old: 1000, new: 2500 },
        end_date: { old: '2026-01-05', new: '2026-02-10' },
        client_id: { old: 'c1', new: 'c2' },
        project_manager_id: { old: 'u2', new: 'zzz' },
        subject_to_vat: { old: null, new: true },
      },
    }),
    ev(2, { changes: { archived_at: { old: null, new: '2026-10-06T00:00:00Z' } } }),
    ev(1, { changes: { archived_at: { old: '2026-10-06T00:00:00Z', new: null } } }),
  ];

  it('renders actor, Label: old → new per kind, flagged, created, archived/restored, system and unknown actors', async () => {
    repo.recordHistory.list.mockResolvedValue({ events, nextCursor: null });
    renderIt();
    const money = await screen.findByText(`${formatCurrency(1000, 'USD')} → ${formatCurrency(2500, 'USD')}`);
    expect(money.closest('li')).toHaveTextContent('Contract value');
    expect(money.closest('[data-testid="history-event"]')).toHaveTextContent('Dana PM');
    expect(screen.getByText(`${formatDateOnly('2026-01-05')} → ${formatDateOnly('2026-02-10')}`)).toBeInTheDocument();
    expect(screen.getByText('Acme Corp → Globex')).toBeInTheDocument();
    expect(screen.getByText('Sam Lead → Unavailable')).toBeInTheDocument();
    expect(screen.getByText('empty → Yes')).toBeInTheDocument();
    expect(screen.getByText('Planning → Ongoing Project')).toBeInTheDocument();
    expect(screen.getByText('Phone changed')).toBeInTheDocument();
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByText('Restored')).toBeInTheDocument();
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Unknown user')).toBeInTheDocument();
    // old/new conveyed as text, not colour alone: the arrow is part of the text node
    expect(screen.queryByText(/raw-uuid|c1|c2/)).toBeNull();
  });

  it('renders in Bahasa Indonesia with localized labels and fixed-copy names', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [events[0], events[1], events[3]], nextCursor: null });
    renderIt({}, true);
    expect(await screen.findByText('Sistem')).toBeInTheDocument();
    expect(screen.getByText('Pengguna tidak dikenal')).toBeInTheDocument();
    expect(screen.getByText('Dibuat')).toBeInTheDocument();
    const money = screen.getByText(`${formatCurrency(1000, 'USD')} → ${formatCurrency(2500, 'USD')}`);
    expect(money.closest('li')).toHaveTextContent('Nilai kontrak');
    expect(screen.getByText('Sam Lead → Tidak tersedia')).toBeInTheDocument();
  });

  it('never leaks a raw uuid or blank label for an unlabelled column', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(1, { changes: { some_new_column: { old: 'a', new: 'b' } } })], nextCursor: null,
    });
    renderIt();
    expect(await screen.findByText('a → b')).toBeInTheDocument();
    expect(screen.getByText('Some new column')).toBeInTheDocument();
  });

  it('renders an audit line as a "did X" line', async () => {
    repo.recordHistory.list.mockResolvedValue({
      events: [ev(0, { source: 'audit', seq: null, op: null, action: 'project_document.create', actorId: 'u2', changes: {} })],
      nextCursor: null,
    });
    renderIt();
    expect(await screen.findByText('project_document.create')).toBeInTheDocument();
    expect(screen.getByText('Sam Lead')).toBeInTheDocument();
  });
});

describe('RecordHistory — states (AC-CHG-016)', () => {
  it('shows a skeleton while loading', () => {
    repo.recordHistory.list.mockReturnValue(new Promise(() => {}));
    renderIt();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('empty copy says when history begins and that deletes and earlier edits are not shown', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [], nextCursor: null });
    renderIt();
    expect(await screen.findByText('No changes recorded yet')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`${formatDateOnly('2026-10-06')}.*deletions.*not shown`, 's'))).toBeInTheDocument();
  });

  it('error state offers retry that refetches', async () => {
    repo.recordHistory.list.mockRejectedValueOnce(new Error('boom'));
    repo.recordHistory.list.mockResolvedValueOnce({ events: [ev(1, { op: 'insert' })], nextCursor: null });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Created')).toBeInTheDocument();
  });

  it('"Load older" fetches the next page by the seq cursor and appends it', async () => {
    const cursor = { seq: 2, at: '2026-10-06T09:00:00Z' };
    repo.recordHistory.list
      .mockResolvedValueOnce({ events: [ev(3, { op: 'insert' })], nextCursor: cursor })
      .mockResolvedValueOnce({ events: [ev(2, { changes: { name: { old: 'A', new: 'B' } } })], nextCursor: null });
    renderIt();
    await userEvent.click(await screen.findByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('A → B')).toBeInTheDocument();
    expect(repo.recordHistory.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }));
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });
});

describe('RecordHistory — project kind filter (FR-CHG-012)', () => {
  it('requests children and narrows by the chosen kind', async () => {
    repo.recordHistory.list.mockResolvedValue({ events: [], nextCursor: null });
    renderIt({ includeChildren: true, kindFilters: true });
    await screen.findByText('No changes recorded yet');
    expect(repo.recordHistory.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeChildren: true, entityTypes: null }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    await waitFor(() =>
      expect(repo.recordHistory.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeChildren: true, entityTypes: ['task'] }),
      ),
    );
    expect(screen.getByRole('button', { name: 'Tasks' })).toHaveAttribute('aria-pressed', 'true');
    const group = screen.getByRole('group', { name: 'Filter by record kind' });
    expect(within(group).getAllByRole('button')).toHaveLength(6);
  });
});
