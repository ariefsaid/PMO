import { describe, it, expect, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { Suspense, useState, useTransition } from 'react';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'org-1' } }) }));

import { useCachedRecordLists } from './useCachedRecordLists';

/**
 * A navigation is a React transition: while the new route's code loads, the old screen stays committed and
 * the new one renders in the background. Cache events in that window (other queries settling) must not
 * re-render the screen on display, or every event restarts the navigation and the new page never paints
 * (the release run's project and work-order pages, held until React's transition expiry).
 */
describe('useCachedRecordLists during a pending navigation', () => {
  it('a cache event while the next route is still loading does not re-render the screen on display', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // The navigation prefetched the record, so the detail route's snapshot differs from the list's.
    qc.setQueryData(['project', 'org-1', 'p1'], { id: 'p1', name: 'Harbour Fit-Out' });
    const renders: string[] = [];
    let go: () => void = () => {};
    const never = new Promise<never>(() => {});
    const NextRoute: React.FC = () => { throw never; };

    const Shell: React.FC = () => {
      const [path, setPath] = useState('/projects');
      const [, startTransition] = useTransition();
      go = () => startTransition(() => setPath('/projects/p1'));
      useCachedRecordLists(path);
      renders.push(path);
      return path === '/projects' ? <p>list</p> : <NextRoute />;
    };

    render(
      <QueryClientProvider client={qc}>
        <Suspense fallback={<p>loading</p>}><Shell /></Suspense>
      </QueryClientProvider>,
    );
    await act(async () => { go(); });
    const before = renders.filter((p) => p === '/projects').length;

    for (let i = 0; i < 3; i += 1) {
      await act(async () => { qc.setQueryData(['unrelated', i], i); });
    }

    expect(renders.filter((p) => p === '/projects').length).toBe(before);
  });
});
