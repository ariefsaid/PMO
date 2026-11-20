import React from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ warnings: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { supplyRisk: { warnings: h.warnings } } }));
import { queryClient } from '@/src/lib/queryClient';
import { WorkOrderSupplyWarning } from './SupplyRiskWarning';
import { I18nextProvider } from 'react-i18next';
import { supplyRiskTestI18n, supplyRiskTestI18nReady } from '../../test/supplyRiskI18nTestInstance';

function renderWarning(workOrderId: string) {
  render(
    <I18nextProvider i18n={supplyRiskTestI18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><WorkOrderSupplyWarning workOrderId={workOrderId} projectId="p1" /></MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeAll(async () => { await supplyRiskTestI18nReady; });
beforeEach(() => { queryClient.clear(); h.warnings.mockReset(); });

describe('WorkOrderSupplyWarning (AC-VSR-013)', () => {
  it('names the supplier and its status on an exposed work order', async () => {
    h.warnings.mockResolvedValue([{ workOrderId: 'wo-1', supplierId: 's1', supplierName: 'Apex Supply', status: 'at_risk' }]);
    renderWarning('wo-1');
    const note = await screen.findByTestId('supply-risk-warning');
    expect(note).toHaveTextContent('Supplier warning: Apex Supply is at risk and has an open order on this work order.');
    expect(h.warnings).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('says inactive in words for an inactive supplier', async () => {
    h.warnings.mockResolvedValue([{ workOrderId: 'wo-1', supplierId: 's1', supplierName: 'Apex Supply', status: 'inactive' }]);
    renderWarning('wo-1');
    expect(await screen.findByText(/is inactive and has an open order/)).toBeInTheDocument();
  });

  it('shows nothing for a work order with no flagged supplier (active supplier, or another work order)', async () => {
    h.warnings.mockResolvedValue([{ workOrderId: 'wo-2', supplierId: 's1', supplierName: 'Apex Supply', status: 'at_risk' }]);
    renderWarning('wo-1');
    await vi.waitFor(() => expect(h.warnings).toHaveBeenCalled());
    expect(screen.queryByTestId('supply-risk-warning')).toBeNull();
  });

  it('shows nothing when the read fails (informational only, never blocks)', async () => {
    h.warnings.mockRejectedValue(new Error('boom'));
    renderWarning('wo-1');
    await vi.waitFor(() => expect(h.warnings).toHaveBeenCalled());
    expect(screen.queryByTestId('supply-risk-warning')).toBeNull();
  });
});
