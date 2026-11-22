import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
const api = vi.hoisted(() => ({ listItems: vi.fn(), listRates: vi.fn(), listVariants: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { rateCatalogue: api } }));
vi.mock('@/src/hooks/useErpItemOptions', () => ({ useErpItemOptions: () => ({ connected: false, loadOptions: vi.fn() }) }));
import BoqItemFormModal from './BoqItemFormModal';
it('saves the selected catalogue rate and location with the line', async () => {
  api.listItems.mockResolvedValue([{ id: 'i', item_code: 'W1', description: 'Weld', unit: 'm' }]);
  api.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
  api.listRates.mockResolvedValue([{ item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-01-01' }]);
  const save = vi.fn().mockResolvedValue(undefined), user = userEvent.setup();
  render(<ToastProvider><BoqItemFormModal item={null} projectId="p" today="2026-02-01" currency="USD" currencySymbolPrefix="$" onSave={save} onClose={vi.fn()} onError={vi.fn()} /></ToastProvider>);
  await user.click(await screen.findByRole('combobox', { name: 'Catalogue item' }));
  await user.click(await screen.findByText(/W1/));
  // fix-billing item 5: code, description and unit arrive from the catalogue item; only the quantity is typed.
  await user.type(screen.getByLabelText(/^Quantity/), '2');
  await user.click(screen.getByRole('button', { name: 'Save line' }));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ itemCode: 'W1', description: 'Weld', unit: 'm', rate: 120 }), expect.objectContaining({ itemId: 'i', variantId: 'v', asOf: '2026-02-01', rate: 120 }));
});
it('clears the prior preview when the chosen date has no rate', async () => {
  api.listItems.mockResolvedValue([{ id: 'i', item_code: 'W1', description: 'Weld' }]);
  api.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
  api.listRates.mockResolvedValue([{ item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-01-01' }]);
  const user = userEvent.setup();
  render(<ToastProvider><BoqItemFormModal item={null} projectId="p" today="2026-02-01" currency="USD" currencySymbolPrefix="$" onSave={vi.fn()} onClose={vi.fn()} onError={vi.fn()} /></ToastProvider>);
  await user.click(await screen.findByRole('combobox', { name: 'Catalogue item' }));
  await user.click(await screen.findByText(/W1/));
  expect(screen.getByLabelText(/Rate \(excl/)).toHaveValue('120');
  const date = screen.getByLabelText('Pricing date');
  await user.clear(date);
  await user.type(date, '2025-01-01');
  await user.tab();
  expect(await screen.findByText('Unpriced')).toBeInTheDocument();
  expect(screen.getByLabelText(/Rate \(excl/)).toHaveValue('');
});
