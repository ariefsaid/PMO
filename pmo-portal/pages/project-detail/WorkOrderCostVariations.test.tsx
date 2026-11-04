import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import enProcurement from '@/public/locales/en/procurement.json';
import idProcurement from '@/public/locales/id/procurement.json';

const h = vi.hoisted(() => ({ query: { data: [] as unknown[] | undefined, isPending: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useSubcontract', () => ({ useWorkOrderCostVariations: () => h.query }));

import { WorkOrderCostVariations } from './WorkOrderCostVariations';

function renderLine() {
  const i18n = createInstance();
  void i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['procurement'], defaultNS: 'procurement', interpolation: { escapeValue: false },
    resources: { en: { procurement: enProcurement }, id: { procurement: idProcurement } } });
  return render(<I18nextProvider i18n={i18n}><WorkOrderCostVariations workOrderId="wo1" currency="IDR" /></I18nextProvider>);
}

beforeEach(() => { h.query = { data: [], isPending: false, isError: false, refetch: vi.fn() }; });

describe('WorkOrderCostVariations', () => {
  it('FR-SCA-041 renders a linked variation read-only on its work order', async () => {
    h.query = { data: [{ id: 'var-1', number: 'VAR-8', po_id: 'po1', amount: 2000000, status: 'Revised' }], isPending: false, isError: false, refetch: vi.fn() };
    renderLine();
    const line = await screen.findByRole('region', { name: /cost variations/i });
    expect(line).toHaveTextContent('VAR-8');
    expect(line).toHaveTextContent('Revised');
    expect(line).toHaveTextContent('IDR');
    expect(line.querySelector('button')).toBeNull();
  });

  it('renders loading, empty and retryable error states', async () => {
    h.query = { data: undefined, isPending: true, isError: false, refetch: vi.fn() };
    const loading = renderLine();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    loading.unmount();
    h.query = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    const empty = renderLine();
    expect(await screen.findByText(/no linked cost variations/i)).toBeInTheDocument();
    empty.unmount();
    const refetch = vi.fn();
    h.query = { data: undefined, isPending: false, isError: true, refetch };
    renderLine();
    screen.getByRole('button', { name: /retry/i }).click();
    expect(refetch).toHaveBeenCalled();
  });
});
