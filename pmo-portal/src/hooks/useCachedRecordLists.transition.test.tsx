import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import React, { Suspense, startTransition, useState } from 'react';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1', id: 'u1', role: 'Project Manager' } }) }));

import { useCachedRecordLists } from './useCachedRecordLists';

// A navigation renders in a transition: the shell renders the NEW path while the committed shell still shows the old one.
// The record page then creates its queries (a cache event) and may still be loading. The shell's cache read must give each
// render its own stable answer; otherwise every cache event re-renders the committed shell at sync priority, which restarts
// the navigation, and the record page stays hidden until React forces the stalled transition (release run, 28 Nov 2026).
const never = new Promise<never>(() => {});
function Loading(): React.ReactElement { throw never; }

function Page({ id }: { id: string }) {
  useQuery({ queryKey: ['page-read', id], queryFn: () => never });
  return <Loading />;
}

describe('useCachedRecordLists under a navigation transition', () => {
  it('does not re-render the committed shell in a loop while the next page renders', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['projects', 'org-1'], [{ id: 'p1', name: 'Harbour' }]);
    // The navigation preload already holds the record's own read.
    qc.setQueryData(['project', 'org-1', 'p1'], { id: 'p1', name: 'Harbour' });
    let shellRenders = 0;
    let go: (path: string) => void = () => {};
    function Shell({ path }: { path: string }) {
      useCachedRecordLists(path);
      shellRenders += 1;
      return null;
    }
    function App() {
      const [path, setPath] = useState('/projects');
      go = setPath;
      return (
        <>
          <Shell path={path} />
          <Suspense fallback={null}>{path === '/projects' ? null : <Page id={path} />}</Suspense>
        </>
      );
    }
    render(<QueryClientProvider client={qc}><App /></QueryClientProvider>);
    // Content already shown stays shown while the next route suspends: the transition holds.
    await act(async () => { startTransition(() => go('/projects/p1')); });
    const before = shellRenders;
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(shellRenders - before).toBeLessThan(5);
  });
});
