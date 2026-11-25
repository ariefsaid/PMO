import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string, ready: true,
  rows: [] as unknown[], pending: false,
}));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/hooks/useVendorResponse', () => ({
  useVendorResponseReady: () => h.ready,
  useVendorNames: () => (id: string) => id === 'v1' ? 'Acme Rental' : id,
  formatDuration: (_t: unknown, m: number | null) => (m == null ? '—' : m === 90 ? '1 h 30 min' : `${m} min`),
  useBreakdowns: () => ({ data: h.rows, isPending: h.pending, isError: false }),
  useRecordVendorResponse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearVendorResponse: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2024-06-01' }));

import { VendorResponsePanel } from './VendorResponsePanel';
import { VendorResponseSummaryCard } from './VendorResponseSummary';

const row = (over: Record<string, unknown> = {}) => ({
  asset_id: 'a1', period_start: '2024-03-04', period_end: '2024-03-07', vendor_id: 'v1', reported_at: '2024-03-04T00:00:00Z',
  responded_at: null, response_minutes: null, note: null, ...over,
});
const ui = (asset: { id: string; ownership?: string | null }) => render(<ToastProvider><VendorResponsePanel asset={asset} today="2024-06-01" /></ToastProvider>);

describe('VendorResponsePanel (#2702)', () => {
  beforeEach(() => { h.role = 'Project Manager'; h.ready = true; h.rows = [row()]; h.pending = false; });

  it('AC-EVR-011 renders nothing outside the app providers or for an owned asset', () => {
    h.ready = false;
    ui({ id: 'a1', ownership: 'rented' });
    expect(screen.queryByText('Vendor response to breakdowns')).toBeNull();
    h.ready = true;
    ui({ id: 'a1', ownership: 'owned' });
    ui({ id: 'a1' });
    expect(screen.queryByText('Vendor response to breakdowns')).toBeNull();
  });
  it('AC-EVR-011 renders nothing while the machine has no breakdowns', () => {
    h.rows = [];
    ui({ id: 'a1', ownership: 'rented' });
    expect(screen.queryByText('Vendor response to breakdowns')).toBeNull();
  });
  it('#2890 the card shows its heading', () => {
    ui({ id: 'a1', ownership: 'rented' });
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Vendor response to breakdowns'); // drawn text, not a title attribute
  });
  it('shows an awaiting breakdown with the record action for a status role', () => {
    ui({ id: 'a1', ownership: 'rented' });
    expect(screen.getByText('Awaiting response')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record response' })).toBeInTheDocument();
  });
  it('shows the response time but no action to Finance', () => {
    h.role = 'Finance';
    h.rows = [row({ responded_at: '2024-03-04T01:30:00Z', response_minutes: 90 })];
    ui({ id: 'a1', ownership: 'rented' });
    expect(screen.getAllByText('1 h 30 min').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Record response' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
  it('#2890 the register summary card shows its heading', () => {
    h.rows = [row({ responded_at: '2024-03-04T01:30:00Z', response_minutes: 90 })];
    render(<VendorResponseSummaryCard assets={[{ id: 'a1', ownership: 'rented' }]} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Vendor response time, last 12 months');
  });
  it('the register summary renders nothing without a rented asset', () => {
    const { container } = render(<VendorResponseSummaryCard assets={[{ id: 'a1', ownership: 'owned' }]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
