import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';

/** AC-SD-005: the day's checkpoints are on the work order, with no daily report needed. */
const seen = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
vi.mock('../siteReports/SiteCheckpoints', () => ({
  SiteCheckpoints: (p: Record<string, unknown>) => { seen.props = p; return <div data-testid="checkpoints-stub" />; },
}));
import { WorkOrderCheckpoints } from './WorkOrderCheckpoints';

const auth = { currentUser: { id: 'u1', org_id: 'o1' } } as never;
const view = (status: string) => render(
  <QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}>
    <WorkOrderCheckpoints workOrderId="w1" projectManagerId="pm1" status={status} />
  </AuthContext.Provider></QueryClientProvider>);

describe('WorkOrderCheckpoints', () => {
  it('shows today\'s checkpoints from the work order itself, recordable while the order is issued', () => {
    view('Issued');
    expect(screen.getByTestId('checkpoints-stub')).toBeInTheDocument();
    expect(seen.props).toMatchObject({ workOrderId: 'w1', canRecordDay: true });
    expect(String(seen.props?.workDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('is read-only once the order is no longer issued', () => {
    view('Closed');
    expect(seen.props).toMatchObject({ canRecordDay: false });
  });
  it('renders nothing outside the app providers', () => {
    render(<WorkOrderCheckpoints workOrderId="w1" projectManagerId={null} status="Issued" />);
    expect(screen.queryByTestId('checkpoints-stub')).toBeNull();
  });
});
