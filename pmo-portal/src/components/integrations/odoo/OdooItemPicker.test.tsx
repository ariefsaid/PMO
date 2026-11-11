import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ records: vi.fn() }));
vi.mock('@/src/hooks/useOdoo', () => ({ useMasterRecordsInfinite: (input: unknown, enabled?: boolean) => h.records(input, enabled) }));

import { OdooItemPicker } from './OdooItemPicker';

const rec = (n: number) => ({ id: `r${n}`, external_id: String(n), code: `C-${n}`, name: `Item ${n}`, parent_external_id: null, active: true, tombstoned_at: null, attrs: {}, as_of: '' });
const result = (rows: unknown[], extra: Record<string, unknown> = {}) => ({
  data: { pages: [{ rows, total: rows.length }] }, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch: vi.fn(), ...extra,
});
beforeEach(() => { vi.clearAllMocks(); h.records.mockReturnValue(result([rec(1), rec(2)])); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const open = () => fireEvent.click(screen.getByRole('combobox'));
const mount = (onChange = vi.fn(), purpose: 'purchase' | 'sale' = 'purchase') => render(<OdooItemPicker label="Item" purpose={purpose} value={null} onChange={onChange} />);

it('AC-ODC-040 the purchase picker asks only for purchasable items and never for inactive ones', () => {
  mount();
  open();
  const input = h.records.mock.calls.at(-1)![0];
  expect(input).toMatchObject({ kind: 'product', purpose: 'purchase' });
  expect(input.includeInactive).toBeUndefined();
});

it('AC-ODC-040 the sales picker asks only for sellable items', () => {
  mount(vi.fn(), 'sale');
  open();
  expect(h.records.mock.calls.at(-1)![0]).toMatchObject({ purpose: 'sale' });
});

it('AC-ODC-040 nothing is requested until the picker is opened', () => {
  mount();
  expect(h.records).toHaveBeenCalledWith(expect.anything(), false);
  expect(h.records).not.toHaveBeenCalledWith(expect.anything(), true);
});

it('AC-ODC-040 typing searches code and name after 300 ms', () => {
  vi.useFakeTimers();
  mount();
  open();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'semen, 50kg' } });
  act(() => { vi.advanceTimersByTime(299); });
  expect(h.records).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'semen, 50kg' }), true);
  act(() => { vi.advanceTimersByTime(2); });
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ search: 'semen, 50kg' }), true);
});

it('AC-ODC-040 Show more appears only while more pages exist and asks for the next page', () => {
  const fetchNextPage = vi.fn();
  h.records.mockReturnValue(result([rec(1), rec(2)], { hasNextPage: true, fetchNextPage }));
  mount();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(fetchNextPage).toHaveBeenCalledTimes(1);
  cleanup();
  h.records.mockReturnValue(result([rec(1), rec(2)]));
  mount();
  open();
  expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
});

it('AC-ODC-040 choosing an item reports the record and closes the list', () => {
  const onChange = vi.fn();
  mount(onChange);
  open();
  fireEvent.click(screen.getByRole('option', { name: /Item 2/ }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ external_id: '2', name: 'Item 2' }));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('AC-ODC-040 the keyboard operates the picker: ArrowDown moves the highlight, Enter picks, Escape closes and returns focus', () => {
  const onChange = vi.fn();
  mount(onChange);
  open();
  const search = screen.getByRole('searchbox');
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  const options = screen.getAllByRole('option');
  expect(search).toHaveAttribute('aria-activedescendant', options[1].id);
  fireEvent.keyDown(search, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ external_id: '2' }));
  open();
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveFocus();
});

it('AC-ODC-040 an empty result says so and a failed read offers a retry', () => {
  h.records.mockReturnValue(result([]));
  mount();
  open();
  expect(screen.getByText(/No item matches/)).toBeInTheDocument();
  cleanup();
  const refetch = vi.fn();
  h.records.mockReturnValue({ data: undefined, isPending: false, isError: true, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: vi.fn(), refetch });
  mount();
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(refetch).toHaveBeenCalled();
});
