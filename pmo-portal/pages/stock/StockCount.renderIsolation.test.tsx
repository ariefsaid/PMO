import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import stockEn from '@/public/locales/en/stock.json';

/**
 * #2103 AC: "Given a 500-line stock count, when typing in one quantity, then only that line re-renders."
 * Each line card renders one ItemPicker, so counting ItemPicker renders counts line-card renders exactly.
 */
const { master, documents, reports } = vi.hoisted(() => ({
  master: { listUnits: vi.fn(), listItems: vi.fn(), listWarehouses: vi.fn(), listKeepers: vi.fn() },
  documents: { create: vi.fn(), saveDraft: vi.fn(), post: vi.fn(), get: vi.fn(), costs: vi.fn() },
  reports: { onHand: vi.fn() },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master, documents, reports } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));
const rendered = { total: 0, lines: [] as string[] };
vi.mock('@/src/components/stock/ItemPicker', () => ({
  ItemPicker: ({ label, value }: { label: string; value: string | null }) => {
    rendered.total += 1;
    rendered.lines.push(label);
    return <span data-testid={`picker-${label}`} data-value={value ?? ''} />;
  },
}));
// The measured path is the line card's reuse; the field primitives are exercised by StockCount.test.tsx.
vi.mock('@/src/components/ui', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui')>();
  return {
    ...real,
    TextField: ({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) =>
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />,
    SelectField: ({ label, value, onChange, options }: { label: string; value: string; onChange: (next: string) => void; options: { value: string; label: string }[] }) =>
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>,
  };
});

import StockCount from './StockCount';

const LINES = 500;

const lines = Array.from({ length: LINES }, (_, i) => ({
  id: `l${i + 1}`, line_no: i + 1, item_id: `i${i}`, quantity: null, counted_quantity: '10',
  expected_quantity: null, direction: null, boq_item_id: null, source_line_id: null,
  item: { code: `IT${i}`, name: `Item ${i}`, unit: { code: 'bag', whole_only: true } },
}));
const draft = {
  id: 'd1', number: 'CNT-1', kind: 'count', status: 'Draft', revision: 1, warehouse_id: 'w1', to_warehouse_id: null,
  project_id: null, procurement_id: null, reason: null, note: null, occurred_on: '2026-10-30', created_by: 'me',
  created_at: 't', posted_by: null, posted_at: null, cancelled_at: null, warehouse: { code: 'SITE-A', name: 'Site A' },
  to_warehouse: null, project: null, author: { full_name: 'Me' }, lines,
};

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  rendered.total = 0;
  rendered.lines = [];
  master.listUnits.mockResolvedValue([{ id: 'u1', code: 'bag', name: 'Bag', whole_only: true, archived_at: null }]);
  master.listItems.mockResolvedValue(Array.from({ length: LINES }, (_, i) => ({ id: `i${i}`, code: `IT${i}`, name: `Item ${i}`, unit_id: 'u1', archived_at: null })));
  master.listWarehouses.mockResolvedValue([{ id: 'w1', code: 'SITE-A', name: 'SITE-A store', kind: 'site', project_id: null, archived_at: null }]);
  master.listKeepers.mockResolvedValue([{ warehouse_id: 'w1', user_id: 'me', org_id: 'org-1' }]);
  reports.onHand.mockResolvedValue(Array.from({ length: LINES }, (_, i) => ({
    itemId: `i${i}`, itemCode: `IT${i}`, itemName: `Item ${i}`, unitCode: 'bag', wholeOnly: true,
    warehouseId: 'w1', warehouseCode: 'SITE-A', warehouseName: 'Site A', warehouseKind: 'site', qtyOnHand: '100',
  })));
  documents.get.mockResolvedValue(draft);
  documents.costs.mockResolvedValue([]);
});

const renderDraft = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/stock/documents/d1/edit']}>
          <Routes>
            <Route path="/stock/documents/:documentId/edit" element={<StockCount />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

describe('#2103 stock count line render isolation', () => {
  it('re-renders only the line whose quantity was typed into', async () => {
    renderDraft();
    expect(await screen.findByTestId('system-1')).toHaveTextContent('100');
    expect(rendered.total).toBe(LINES);

    rendered.total = 0;
    rendered.lines = [];
    fireEvent.change(screen.getByLabelText('Counted 3'), { target: { value: '11' } });

    expect(rendered.lines).toEqual(['Item 3']);
    expect(rendered.total).toBe(1);
    // The touched line still recomputes its own system quantity and variance.
    expect(screen.getByTestId('variance-3')).toHaveTextContent('-89 bag');
    expect(screen.getByTestId('variance-4')).toHaveTextContent('-90 bag');
  });

  it('renders only the new card when a line is added', async () => {
    renderDraft();
    await screen.findByTestId('system-1');
    rendered.total = 0;
    rendered.lines = [];
    fireEvent.click(screen.getByRole('button', { name: 'Add another line' }));
    // Existing cards keep identical props (their row numbers did not shift), so only the new card renders.
    expect(rendered.lines).toEqual([`Item ${LINES + 1}`]);
  });
});
