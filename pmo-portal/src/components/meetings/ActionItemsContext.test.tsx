import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { NoteBlock } from '@/src/lib/meetingNotes';

/**
 * #2106 AC-PERF-2106-3 — a minutes page's action items, counted at the repository seam.
 *
 * Before: each `actionItem` block ran its own `task.get(taskId)` — 10-20 requests (and 10-20 spinners) per minutes
 * open. After: ActionItemsProvider collects every id from the document and resolves them in ONE `.in('id', ids)`
 * read, seeding each task's own cache entry; blocks inside the batch perform no request of their own.
 */

const h = vi.hoisted(() => ({ listByIds: vi.fn(), get: vi.fn() }));

vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { listByIds: h.listByIds, get: h.get } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));

import { ActionItemsProvider, actionItemTaskIds } from './ActionItemsContext';
import { ActionItemView } from './ActionItemView';

const taskRow = (i: number) => ({
  id: `t${i}`, project_id: 'p1', name: `Action ${i}`, status: 'In Progress', end_date: '2026-12-01',
  assignee: { id: 'u2', full_name: 'Putri Peer' }, dependencies: [],
});
const actionBlock = (id: string | null): NoteBlock => ({ type: 'actionItem', props: { taskId: id ?? '' }, content: [], children: [] });
const paragraph: NoteBlock = { type: 'paragraph', content: [], children: [] };

const wrap = (blocks: NoteBlock[], client: QueryClient) =>
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/meetings/m1']}>
        <Routes>
          <Route path="/meetings/:meetingId" element={
            <ActionItemsProvider blocks={blocks}>
              <>{actionItemTaskIds(blocks).map((id) => <ActionItemView key={id} taskId={id} />)}</>
            </ActionItemsProvider>
          } />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('AC-PERF-2106-3 minutes action items resolve in one task read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.listByIds.mockImplementation(async (ids: string[]) => ids.map((id) => taskRow(Number(id.slice(1)))));
  });

  it('AC-PERF-2106-3 15 action items cost ONE task request (was 15)', async () => {
    const blocks = Array.from({ length: 15 }, (_, i) => actionBlock(`t${i}`));
    wrap(blocks, fresh());
    expect(await screen.findByText('Action 0')).toBeInTheDocument();
    await waitFor(() => expect(h.listByIds).toHaveBeenCalledTimes(1));
    expect(h.listByIds.mock.calls[0][0]).toHaveLength(15);
    expect(h.get).not.toHaveBeenCalled();
    expect(await screen.findByText('Action 14')).toBeInTheDocument();
  });

  it('AC-PERF-2106-3 each task is seeded into its own cache entry (later readers start from the same facts)', async () => {
    const client = fresh();
    wrap([actionBlock('t3'), actionBlock('t4')], client);
    expect(await screen.findByText('Action 3')).toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(['tasks', 'org-1', 'one', 't4'])).toMatchObject({ name: 'Action 4' }));
  });

  it('AC-PERF-2106-3 the document’s ids are collected once, nested and duplicated blocks included, blanks skipped', () => {
    const blocks: NoteBlock[] = [
      actionBlock('t1'),
      { ...paragraph, children: [actionBlock('t2'), actionBlock('t1')] },
      actionBlock(null),
      paragraph,
      actionBlock('t3'),
    ];
    expect(actionItemTaskIds(blocks)).toEqual(['t1', 't2', 't3']);
  });

  it('AC-PERF-2106-3 a block inserted since the minutes loaded still resolves on its own (never a tombstone)', async () => {
    // t9 is not in the document, so the batch does not cover it: that block keeps its single read.
    h.get.mockResolvedValue(taskRow(9));
    wrap([actionBlock('t1')], fresh());
    render(
      <QueryClientProvider client={fresh()}>
        <MemoryRouter initialEntries={['/meetings/m1']}>
          <Routes>
            <Route path="/meetings/:meetingId" element={
              <ActionItemsProvider blocks={[actionBlock('t1')]}><ActionItemView taskId="t9" /></ActionItemsProvider>
            } />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Action 9')).toBeInTheDocument();
    expect(h.get).toHaveBeenCalledWith('t9');
  });

  it('AC-PERF-2106-3 a task id the batch did not find is a tombstone, with no extra request', async () => {
    h.listByIds.mockResolvedValue([]);  // soft-deleted upstream: the id is simply absent
    wrap([actionBlock('gone')], fresh());
    expect(await screen.findByTestId('action-item-tombstone')).toBeInTheDocument();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('AC-PERF-2106-3 a failed batch reads as the block’s error state, not as tombstones', async () => {
    h.listByIds.mockRejectedValue(new Error('network'));
    wrap([actionBlock('t1'), actionBlock('t2')], fresh());
    await waitFor(() => expect(screen.getAllByTestId('action-item-error')).toHaveLength(2));
    expect(screen.queryAllByTestId('action-item-tombstone')).toHaveLength(0);
  });

  it('AC-PERF-2106-3 minutes with no action items send no task request at all', async () => {
    wrap([paragraph], fresh());
    await new Promise((r) => setTimeout(r, 20));
    expect(h.listByIds).not.toHaveBeenCalled();
    expect(h.get).not.toHaveBeenCalled();
  });
});
