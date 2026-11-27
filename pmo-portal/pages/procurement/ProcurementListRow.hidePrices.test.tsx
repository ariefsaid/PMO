/** AC-009 (#2699) — a person who may not see prices gets the procurement row without the value; everyone else is unchanged. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { setPricesHidden, setHidePricesActive } from '@/src/lib/priceReadPath';
import { ProcurementListColumns, ProcurementListRow } from './ProcurementListRow';

vi.mock('@/src/components/procurement/DecisionSupportPanel', () => ({ DecisionSupportPanel: () => <div data-testid="decision-support" /> }));
vi.mock('@/src/hooks/useProcurementDetail', () => ({ useProcurementDetail: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }) }));

const row = {
  id: 'p1', code: 'PR-1', title: 'Lighting package', status: 'Quote Selected', total_value: 148000, currency: 'USD',
  project_id: 'project-1', requested_by_id: 'r1', vendor_id: 'v1', created_at: '2026-10-01T00:00:00.000Z',
  project: { name: 'Office fit-out', code: 'PRJ-1' }, vendor: { name: 'Bright Supply' }, requested_by: { full_name: 'Requester' },
} as ProcurementWithRefs;

const renderRow = () => render(<MemoryRouter><ProcurementListColumns /><ProcurementListRow row={row} /></MemoryRouter>);
beforeEach(() => { setHidePricesActive(false); setPricesHidden(false); });
afterEach(() => act(() => setPricesHidden(false)));

describe('AC-009 procurement list without prices', () => {
  it('renders the value cell and its column for a person who may see prices', () => {
    const { container } = renderRow();
    expect(container.querySelector('[data-procurement-value]')).not.toBeNull();
    expect(screen.getAllByText('Value').length).toBeGreaterThan(0);
  });
  it('renders no value cell and no Value column when the server hides prices', () => {
    act(() => setPricesHidden(true));
    const { container } = renderRow();
    expect(container.querySelector('[data-procurement-value]')).toBeNull();
    expect(screen.queryByText('Value')).toBeNull();
    expect(screen.queryByText(/Bright Supply/)).toBeNull();
    expect(screen.getByText('Lighting package')).toBeInTheDocument();
  });
});
