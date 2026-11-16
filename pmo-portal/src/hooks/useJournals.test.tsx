import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const { journal } = vi.hoisted(() => ({
  journal: {
    list: vi.fn(), get: vi.fn(), ledgerSetup: vi.fn(), saveDraft: vi.fn(), submit: vi.fn(), approve: vi.fn(),
    returnToMaker: vi.fn(), requestReversal: vi.fn(), setDeskJournal: vi.fn(), post: vi.fn(),
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { journal } }));
let org: string | undefined = 'org-1';
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: org } }) }));

import { useJournals, useJournal, useJournalLedgerSetup, useApproveJournal, useSetDeskJournal } from './useJournals';

const wrap = (client: QueryClient) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
const fresh = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeEach(() => {
  org = 'org-1';
  for (const fn of Object.values(journal)) fn.mockReset().mockResolvedValue(null);
  journal.list.mockResolvedValue([]);
});

describe('journal hooks (#895)', () => {
  it('every query key carries the org id', async () => {
    const client = fresh();
    renderHook(() => { useJournals('2026-11-01', '2026-11-30'); useJournal('j1'); useJournalLedgerSetup(); }, { wrapper: wrap(client) });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const keys = client.getQueryCache().getAll().map((q) => JSON.stringify(q.queryKey)).sort();
    expect(keys).toEqual([
      ['journals', 'org-1', '2026-11-01', '2026-11-30'], ['journal', 'org-1', 'j1'], ['journal-ledger-setup', 'org-1'],
    ].map((k) => JSON.stringify(k)).sort());
  });

  it('nothing is fetched without an org id or a journal id', async () => {
    org = undefined;
    const client = fresh();
    renderHook(() => { useJournals('2026-11-01', '2026-11-30'); useJournalLedgerSetup(); }, { wrapper: wrap(client) });
    org = 'org-1';
    renderHook(() => { useJournal(null); }, { wrapper: wrap(client) });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(journal.list).not.toHaveBeenCalled();
    expect(journal.ledgerSetup).not.toHaveBeenCalled();
    expect(journal.get).not.toHaveBeenCalled();
  });

  it('a decision refreshes the list and the open journal', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useApproveJournal(), { wrapper: wrap(client) });
    await act(async () => { await result.current.mutateAsync('j1'); });
    expect(journal.approve).toHaveBeenCalledWith('j1');
    // #895: an approval sends the journal to the ledger, after the approval.
    expect(journal.post).toHaveBeenCalledWith('j1');
    expect(journal.approve.mock.invocationCallOrder[0]).toBeLessThan(journal.post.mock.invocationCallOrder[0]);
    const roots = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(roots).toEqual(expect.arrayContaining(['journals', 'journal']));
  });

  it('#895 a send that fails after the approval still refreshes the journal, so the approval shows', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    journal.post.mockRejectedValueOnce(new Error('ledger unreachable'));
    const { result } = renderHook(() => useApproveJournal(), { wrapper: wrap(client) });
    await act(async () => { await expect(result.current.mutateAsync('j2')).rejects.toThrow('ledger unreachable'); });
    const roots = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(roots).toEqual(expect.arrayContaining(['journals', 'journal']));
  });

  it('choosing the desk journal refreshes the Odoo setup and the journals setup notice', async () => {
    const client = fresh();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useSetDeskJournal(), { wrapper: wrap(client) });
    await act(async () => { await result.current.mutateAsync('7'); });
    expect(journal.setDeskJournal).toHaveBeenCalledWith('7');
    const roots = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(roots).toEqual(expect.arrayContaining(['odoo', 'journal-ledger-setup']));
  });
});
