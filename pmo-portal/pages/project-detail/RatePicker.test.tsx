import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ listItems: vi.fn(), listRates: vi.fn(), listVariants: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { rateCatalogue: api } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, fallback: string | { defaultValue: string }) => typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key }) }));
import RatePicker from './RatePicker';
it('ignores a previous project read that fails after the current catalogue loaded', async () => {
  let rejectPrevious!: (error: Error) => void;
  api.listItems.mockImplementationOnce(() => new Promise((_, reject) => { rejectPrevious = reject; })).mockResolvedValue([]);
  api.listVariants.mockResolvedValue([]);
  api.listRates.mockResolvedValue([]);
  const onChange = vi.fn();
  const view = render(<RatePicker projectId="old" today="2026-02-01" currency="USD" onChange={onChange} />);
  view.rerender(<RatePicker projectId="current" today="2026-02-01" currency="USD" onChange={onChange} />);
  expect(await screen.findByRole('combobox', { name: 'Catalogue item' })).toBeInTheDocument();
  await act(async () => { rejectPrevious(new Error('old request failed')); });
  expect(screen.getByRole('combobox', { name: 'Catalogue item' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('previews the project default location rate when a catalogue item is selected', async () => {
  api.listItems.mockResolvedValue([{ id: 'i', item_code: 'W1', description: 'Weld' }]);
  api.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
  api.listRates.mockResolvedValue([{ item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-01-01' }]);
  const onChange = vi.fn();
  render(<RatePicker projectId="p" today="2026-02-01" currency="USD" onChange={onChange} />);
  await userEvent.click(await screen.findByRole('combobox', { name: 'Catalogue item' }));
  await userEvent.click(await screen.findByText(/W1/));
  expect(await screen.findByText(/120/)).toBeInTheDocument();
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ itemId: 'i', variantId: 'v', asOf: '2026-02-01', rate: 120 }));
});
it('shows an unpriced state when no rate is effective', async () => {
  api.listItems.mockResolvedValue([{ id: 'i', item_code: 'W1', description: 'Weld' }]);
  api.listVariants.mockResolvedValue([{ id: 'v', name: 'Remote', is_default: true }]);
  api.listRates.mockResolvedValue([{ item_id: 'i', variant_id: 'v', rate: 120, effective_from: '2026-03-01' }]);
  const onChange = vi.fn();
  render(<RatePicker projectId="p" today="2026-02-01" currency="USD" onChange={onChange} />);
  await userEvent.click(await screen.findByRole('combobox', { name: 'Catalogue item' }));
  await userEvent.click(await screen.findByText(/W1/));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ rate: null }));
});
it('offers a retry when catalogue reads fail', async () => {
  api.listItems.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  api.listVariants.mockResolvedValue([]);
  api.listRates.mockResolvedValue([]);
  render(<RatePicker projectId="p" today="2026-02-01" currency="USD" onChange={vi.fn()} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('combobox', { name: 'Catalogue item' })).toBeInTheDocument();
});
