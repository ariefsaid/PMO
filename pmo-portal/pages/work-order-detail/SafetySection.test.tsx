import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** #2596 AC-DSF-018 (off = invisible) and FR-DSF-008 (a day worked without a record is flagged on the work-order page). */
const h = vi.hoisted(() => ({ enabled: false, role: 'Engineer', days: [] as unknown[], args: [] as unknown[][] }));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.enabled, isPending: false }) }));
vi.mock('@/src/hooks/useSafetyDays', () => ({
  useSafetyWorkOrderDays: (...a: unknown[]) => ({ data: (h.args.push(a), h.days), isPending: false, isError: false, refetch: vi.fn() }),
  useSafetyMutations: () => ({ createDay: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { project_manager_id: 'pm1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { SafetySection, SafetyTodayLink } from './SafetySection';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
import { getActiveLocale, resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

const auth = { currentUser: { id: 'u1', org_id: 'o1' } } as never;
const renderIt = () => render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><ToastProvider><MemoryRouter>
    <SafetySection workOrderId="w1" projectId="p1" status="Issued" />
  </MemoryRouter></ToastProvider></AuthContext.Provider></QueryClientProvider>);
beforeEach(() => { h.enabled = false; h.role = 'Engineer'; h.days = []; h.args = []; });

describe('#1126 the day is the organisation\'s, not the browser\'s', () => {
  it('lists the last 30 days up to the organisation\'s today, and the today link asks for that day', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    h.enabled = true;
    try {
      renderIt();
      expect(h.args).toContainEqual(['w1', '2026-10-28', '2026-11-26', true]);
      h.args = [];
      render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><ToastProvider><MemoryRouter>
        <SafetyTodayLink workOrderId="w1" projectId="p1" status="Issued" /></MemoryRouter></ToastProvider></AuthContext.Provider></QueryClientProvider>);
      expect(h.args).toContainEqual(['w1', '2026-11-26', '2026-11-26', true]);
    } finally { resetActiveLocale(); vi.useRealTimers(); }
  });
});

describe('SafetySection', () => {
  it('is omitted when rendered outside the app providers (an isolated page test)', () => {
    h.enabled = true;
    render(<MemoryRouter><SafetySection workOrderId="w1" projectId="p1" status="Issued" /></MemoryRouter>);
    expect(screen.queryByTestId('safety-section')).toBeNull();
  });

  it('AC-DSF-018 renders nothing while the organisation has safety records off', () => {
    renderIt();
    expect(screen.queryByTestId('safety-section')).toBeNull();
    expect(screen.queryByText('Daily safety records')).toBeNull();
    expect(screen.queryByTestId('safety-days')).toBeNull();
  });

  it('FR-DSF-008 flags a day workers were present without a safety record, and a complete one', () => {
    h.enabled = true;
    h.days = [
      { work_date: '2026-03-12', day_id: null, status: null, version: null, workers_present: 3, missing: ['safety_record'], complete: false },
      { work_date: '2026-03-10', day_id: 'd1', status: 'locked', version: 1, workers_present: 2, missing: [], complete: true },
    ];
    renderIt();
    const rows = screen.getAllByTestId('safety-day-row');
    expect(rows[0]).toHaveTextContent('Worked without a safety record');
    expect(rows[0]).toHaveTextContent('3 present');
    expect(rows[1]).toHaveAttribute('data-complete', 'yes');
    expect(rows[1]).toHaveTextContent('Complete');
  });

  it('shows a locked day with what is missing', () => {
    h.enabled = true;
    h.days = [{ work_date: '2026-03-10', day_id: 'd1', status: 'locked', version: 1, workers_present: 2, missing: ['toolbox_talk_photo'], complete: false }];
    renderIt();
    expect(screen.getByTestId('safety-day-row')).toHaveTextContent('Missing: Toolbox talk photo');
  });

  it('offers recording only to a role that may enter', () => {
    h.enabled = true; h.role = 'Finance';
    renderIt();
    expect(screen.queryByTestId('safety-new-day')).toBeNull();
    h.role = 'Engineer';
    renderIt();
    expect(screen.getByTestId('safety-new-day')).toBeInTheDocument();
  });
});

describe('SafetyTodayLink', () => {
  const today = formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
  const renderLink = () => render(
    <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><ToastProvider><MemoryRouter>
      <SafetyTodayLink workOrderId="w1" projectId="p1" status="Issued" />
    </MemoryRouter></ToastProvider></AuthContext.Provider></QueryClientProvider>);

  it('AC-SD-003 puts today\'s safety record one tap from the work-order top, and omits it while safety is off', () => {
    renderLink();
    expect(screen.queryByTestId('safety-today')).toBeNull();
    h.enabled = true;
    h.days = [{ work_date: today, day_id: 'd9', status: 'draft', version: 1, workers_present: 0, missing: [], complete: false }];
    renderLink();
    expect(screen.getByTestId('safety-today')).toHaveTextContent("Today's safety record");
    expect(screen.getByTestId('safety-today-open')).toHaveTextContent('Open');
  });
});
