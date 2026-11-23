import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));
const read = vi.fn();
const write = vi.fn();
vi.mock('@/src/lib/repositories/orgSwitches', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/repositories/orgSwitches')>()),
  orgSwitchRepository: { read: (k: string) => read(k), write: (k: string, on: boolean) => write(k, on) },
}));

import { useOrgSwitch, useSetOrgSwitch } from './useOrgSwitch';

const wrapper = (qc: QueryClient) => ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Reader() { const q = useOrgSwitch('crewLoans'); return <p>{q.data === undefined ? 'loading' : q.data ? 'on' : 'off'}</p>; }

describe('useOrgSwitch (#2746)', () => {
  beforeEach(() => { read.mockReset(); write.mockReset(); });

  it('AC-OSM-001 two readers of one switch share one server read', async () => {
    read.mockResolvedValue(true);
    const qc = client();
    render(<QueryClientProvider client={qc}><Reader /><Reader /></QueryClientProvider>);
    await waitFor(() => expect(screen.getAllByText('on')).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('AC-OSM-002 a mounted switch re-reads when the window regains focus', async () => {
    read.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const qc = client();
    render(<QueryClientProvider client={qc}><Reader /></QueryClientProvider>);
    await screen.findByText('off');
    // staleTime is 5 minutes: make the cached value stale, then focus.
    act(() => { qc.getQueryCache().findAll().forEach((q) => q.setState({ dataUpdatedAt: 0 })); });
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    await screen.findByText('on');
  });

  it('AC-OSM-003 a change writes once, re-reads the switch and refreshes its dependent queries', async () => {
    read.mockResolvedValue(false);
    write.mockResolvedValue(undefined);
    const qc = client();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useSetOrgSwitch('clearance'), { wrapper: wrapper(qc) });
    await act(() => result.current.mutateAsync(true));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('clearance', true);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['org-setting', 'org-1', 'clearance'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['clearance'] });
  });
});
