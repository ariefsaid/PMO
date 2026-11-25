import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const h = vi.hoisted(() => ({ args: [] as unknown[][] }));
vi.mock('@/src/hooks/useCrews', () => ({
  useWorkOrderRoster: (...a: unknown[]) => { h.args.push(a); return { data: [], isPending: false, isError: false, refetch: vi.fn() }; },
}));

import { WorkOrderCrewLink } from './WorkOrderCrewLink';

describe('WorkOrderCrewLink', () => {
  it('#1126 "today" is the organisation\'s day, not the browser\'s', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    try {
      render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{ currentUser: { id: 'u1' } } as never}><MemoryRouter>
        <WorkOrderCrewLink workOrderId="w1" /></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
      expect(h.args).toContainEqual(['w1', '2026-11-26']);
    } finally { resetActiveLocale(); vi.useRealTimers(); }
  });
});
