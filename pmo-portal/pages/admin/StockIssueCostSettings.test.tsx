import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StockIssueCostSettings from './StockIssueCostSettings';
const h = vi.hoisted(() => ({ date: null as string | null, save: vi.fn(), may: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.may }));
vi.mock('@/src/hooks/useStockIssueCostSettings', () => ({
  useStockIssueCostSettings: () => ({ data: { effectiveOn: h.date }, isLoading: false, isError: false, refetch: vi.fn() }),
  useSetStockIssueCostSettings: () => ({ mutateAsync: h.save, isPending: false }),
}));
vi.mock('@/src/components/ui', async () => ({ ...(await vi.importActual<object>('@/src/components/ui')), useToast: () => ({ toast: vi.fn() }) }));
beforeEach(() => { h.date = null; h.may = true; h.save.mockReset().mockResolvedValue(undefined); });
async function enable() {
  await userEvent.click(screen.getByRole('checkbox', { name: 'Count stock issues as cost' }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Effective date' }), '2026-11-16');
  await userEvent.tab();
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
}
describe('Stock issue costing', () => {
  it('AC-ISC-007 enables with the chosen date', async () => {
    render(<StockIssueCostSettings />); await enable();
    await waitFor(() => expect(h.save).toHaveBeenCalledWith('2026-11-16'));
  });
  it('AC-ISC-007 reads the saved state and switches off', async () => {
    h.date = '2026-11-16'; render(<StockIssueCostSettings />);
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('textbox', { name: 'Effective date' })).not.toHaveValue('');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.save).toHaveBeenCalledWith(null));
  });
  it.each([
    ['this organisation needs a stock-cost migration first', 'Migrate existing stock costs before enabling this setting.'],
    ['stock issue costing requires the PMO-paid basis', 'This setting is available for organisations using PMO-paid costs.'],
  ])('AC-ISC-007 shows a plain refusal: %s', async (message, expected) => {
    h.save.mockRejectedValue(new Error(message)); render(<StockIssueCostSettings />); await enable();
    expect(await screen.findByRole('alert')).toHaveTextContent(expected);
  });
  it('AC-ISC-007 offers no edit to a non-Admin', () => { h.may = false; expect(render(<StockIssueCostSettings />).container).toBeEmptyDOMElement(); });
  it('AC-ISC-007 requires a date when enabled', async () => {
    render(<StockIssueCostSettings />); await userEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
