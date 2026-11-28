/**
 * Speed map #3014: the Approvals badge's reads start after the opening screen's data settled (or a ceiling), once for rail and phone bar
 * alike. Proof of gain without a trace: requests issued by the badge before the first data settles = 0, after = the same set as before.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';

const reads = vi.hoisted(() => ({ started: 0 }));
vi.mock('@/src/hooks/useWaitingForYou', () => ({
  // A mounted badge issues its reads in this hook; a mount here stands for "the badge's reads started".
  useWaitingForYou: () => {
    React.useEffect(() => { reads.started += 1; }, []);
    return { count: 3, entries: [], countFor: () => 0, pendingKinds: [], failedKinds: [], isPending: false, isError: false, refetch: vi.fn() };
  },
}));

import { AfterFirstData } from '../AfterFirstData';
import { ApprovalsNavCount } from '../ApprovalsNavCount';

const auth = { currentUser: { id: 'user-1', org_id: 'org-1' }, role: 'Admin' } as unknown as AuthContextValue;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

function mount(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={auth}>
        <ImpersonationProvider realRole="Admin" demoEligibility="eligible">
          <AfterFirstData>
            <ApprovalsNavCount />
            <ApprovalsNavCount badge />
          </AfterFirstData>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('Approvals badge starts after the first screen\'s data', () => {
  beforeEach(() => { vi.useFakeTimers(); reads.started = 0; });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('0 badge reads while the opening screen is still fetching; both badges start after it settles', async () => {
    const client = new QueryClient();
    let release!: () => void;
    void client.fetchQuery({ queryKey: ['page'], queryFn: () => new Promise<number>((r) => { release = () => r(1); }) });
    mount(client);
    await advance(1000);
    expect(reads.started).toBe(0);
    expect(screen.queryByText(/3 pending/)).not.toBeInTheDocument();
    release();
    await advance(10);
    expect(reads.started).toBe(2); // rail + phone bar mount together: one gate, the shared reads
    expect(screen.getAllByText(/3 pending/).length).toBe(2);
  });

  it('a screen that fetches nothing still gets its badge (idle)', async () => {
    mount(new QueryClient());
    expect(reads.started).toBe(0);
    await advance(400);
    expect(reads.started).toBe(2);
  });

  it('a screen that never goes quiet gets its badge at the ceiling', async () => {
    const client = new QueryClient();
    void client.fetchQuery({ queryKey: ['never'], queryFn: () => new Promise<number>(() => undefined) });
    mount(client);
    await advance(3900);
    expect(reads.started).toBe(0);
    await advance(200);
    expect(reads.started).toBe(2);
  });

  it('a bare render (no gate provider) is unchanged: reads start at once', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthContext.Provider value={auth}>
          <ImpersonationProvider realRole="Admin" demoEligibility="eligible"><ApprovalsNavCount /></ImpersonationProvider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
    expect(reads.started).toBe(1);
  });
});
