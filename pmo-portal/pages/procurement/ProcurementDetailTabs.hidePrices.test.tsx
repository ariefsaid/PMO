/** AC-009 (#2699) — the quotes tab shows each quotation without its price when the server hides prices. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { ToastProvider } from '@/src/components/ui';
import type { ProcurementDetail } from '@/src/lib/db/procurementLifecycle';
import { setPricesHidden } from '@/src/lib/priceReadPath';
import { ProcurementQuotesTab } from './ProcurementDetailTabs';
import { QueryClientTestProvider } from '@/test/QueryClientTestProvider';

vi.mock('@/src/hooks/useFkOptions', () => ({ useVendorOptions: () => ({ data: [] }) }));

const quote = (id: string, total: number) => ({ id, vendor_id: `v-${id}`, total_amount: total, currency: 'USD', valid_until: null, vq_number: `VQ-${id}`, files: [] });
const p = { id: 'p1', currency: 'USD', vendor_id: null, vendor: null, approved_total_value: null, quotations: [quote('a', 1200), quote('b', 1500)] } as unknown as ProcurementDetail;
const renderTab = () => render(<QueryClientTestProvider><ToastProvider><ProcurementQuotesTab p={p} selectedQuote={p.quotations[0] as never} vendorMap={{ 'v-a': 'Quote supplier' }}
  mutations={{ createQuotation: { isPending: false } } as never} crud={{ selectQuote: { isPending: false } } as never}
  canAddQuote={false} canSelectQuote={false} canManageFiles={false} currentUserId={null} onMutationError={vi.fn()} /></ToastProvider></QueryClientTestProvider>);
afterEach(() => act(() => setPricesHidden(false)));

describe('AC-009 quotes tab without prices', () => {
  it('shows each quotation price and the difference while prices are visible', () => {
    renderTab();
    expect(screen.getByText(/1,200/)).toBeInTheDocument();
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
  });
  it('does not add a second withheld notice inside the quotes tab', () => {
    act(() => setPricesHidden(true));
    renderTab();
    expect(screen.queryByText(/1,200/)).toBeNull();
    expect(screen.queryByText(/1,500/)).toBeNull();
    expect(screen.queryByText(/vs chosen/)).toBeNull();
    expect(screen.queryByText('Prices are hidden from requesters.')).toBeNull();
    expect(screen.queryByTestId('quotation-comparison-cards')).toBeNull();
  });
});
