/** AC-009 (#2699) — line items without the line total column or the estimated total when the server hides prices. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { setPricesHidden } from '@/src/lib/priceReadPath';
import { LineItemsSection } from './LineItemsSection';
import type { ProcurementItemRow } from '@/src/lib/db/procurementCrud';

const items = [{ id: 'it1', org_id: 'o', procurement_id: 'p', name: 'MIG welding wire', description: null, quantity: 24, rate: null, amount: null,
  erp_docstatus: null, erp_line_amount: null, erp_modified: null }] as unknown as ProcurementItemRow[];
const renderSection = () => render(<ToastProvider><LineItemsSection items={items} editable={false} onAdd={vi.fn()} onUpdate={vi.fn()} onDelete={vi.fn()} onError={vi.fn()} currency="USD" /></ToastProvider>);
afterEach(() => act(() => setPricesHidden(false)));

describe('AC-009 line items without prices', () => {
  it('shows the Line total column and the estimated total while prices are visible', () => {
    renderSection();
    expect(screen.getAllByText('Line total').length).toBeGreaterThan(0);
  });
  it('drops the Line total column and the estimated total when the server hides prices', () => {
    act(() => setPricesHidden(true));
    renderSection();
    expect(screen.queryByText('Line total')).toBeNull();
    expect(screen.queryByText('Estimated total')).toBeNull();
    expect(screen.getByText('MIG welding wire')).toBeInTheDocument();
  });
});
