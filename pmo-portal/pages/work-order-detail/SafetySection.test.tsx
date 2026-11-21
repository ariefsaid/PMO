import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** #2596 AC-DSF-018 (off = invisible) and FR-DSF-008 (a day worked without a record is flagged on the work-order page). */
const h = vi.hoisted(() => ({ enabled: false, role: 'Engineer', days: [] as unknown[] }));
vi.mock('@/src/hooks/useSafetyDays', () => ({
  useSafetyEnabled: () => ({ data: h.enabled, isPending: false }),
  useSafetyWorkOrderDays: () => ({ data: h.days, isPending: false, isError: false, refetch: vi.fn() }),
  useSafetyMutations: () => ({ createDay: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProject: () => ({ data: { project_manager_id: 'pm1' } }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import { ToastProvider } from '@/src/components/ui';
import { SafetySection } from './SafetySection';

const renderIt = () => render(<ToastProvider><MemoryRouter><SafetySection workOrderId="w1" projectId="p1" status="Issued" /></MemoryRouter></ToastProvider>);
beforeEach(() => { h.enabled = false; h.role = 'Engineer'; h.days = []; });

describe('SafetySection', () => {
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
