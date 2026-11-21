import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';

/**
 * #2706 — the Crews page offers the rate view only once an organisation sets a target (AC-ATR-001): an existing
 * organisation that never sets one sees the page exactly as it was. The view itself is proven in
 * `AttendanceRate.test.tsx`; the counting in `supabase/tests/attendance_rate.test.sql`.
 */
const h = vi.hoisted(() => ({ target: null as number | null, canRate: true }));

vi.mock('@/src/hooks/useAttendanceRate', () => ({ useAttendanceTarget: () => ({ data: h.target }) }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (action: string, entity: string) => entity === 'attendanceRate' && action === 'view' ? h.canRate : false,
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Admin' as const, effectiveRole: 'Admin' as const }),
}));
vi.mock('./CrewList', () => ({ CrewList: () => <div>crew master</div> }));
vi.mock('./WorkOrderRoster', () => ({ WorkOrderRoster: () => <div>roster view</div> }));
vi.mock('./AttendanceTick', () => ({ AttendanceTick: () => <div>attendance tick</div> }));
vi.mock('./CrewImports', () => ({ CrewImports: () => <div>crew imports</div> }));
vi.mock('./AttendanceRate', () => ({ default: () => <div>rate view</div> }));

import CrewsPage from './Crews';

const renderPage = (url = '/crews') => render(<MemoryRouter initialEntries={[url]}><CrewsPage /></MemoryRouter>);

beforeEach(() => {
  h.target = null;
  h.canRate = true;
});

describe('the Crews page and the rate view (#2706)', () => {
  it('AC-ATR-001 offers no Rate tab while the organisation has no target', () => {
    renderPage();
    expect(screen.getByRole('tab', { name: 'Crews' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Rate' })).toBeNull();
    expect(screen.getByText('crew master')).toBeInTheDocument();
  });

  it('AC-ATR-001 adds the Rate tab once a target is set, and the address opens it', async () => {
    h.target = 90;
    const user = userEvent.setup();
    renderPage();
    const tab = screen.getByRole('tab', { name: 'Rate' });
    await user.click(tab);
    expect(screen.getByText('rate view')).toBeInTheDocument();
  });

  it('falls back to the crew master when a rate link is opened without a target', () => {
    renderPage('/crews?view=rate');
    expect(screen.queryByText('rate view')).toBeNull();
    expect(screen.getByText('crew master')).toBeInTheDocument();
  });

  it('offers no Rate tab to a role that cannot read the report', () => {
    h.target = 90;
    h.canRate = false;
    renderPage();
    expect(screen.queryByRole('tab', { name: 'Rate' })).toBeNull();
  });
});
