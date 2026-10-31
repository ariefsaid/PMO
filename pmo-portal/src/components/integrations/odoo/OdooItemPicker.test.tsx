import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ records: vi.fn() }));
vi.mock('@/src/hooks/useOdoo', () => ({ useMasterRecords: (input: unknown, enabled?: boolean) => h.records(input, enabled) }));

import { OdooItemPicker } from './OdooItemPicker';

const rec = (n: number) => ({ id: `r${n}`, external_id: String(n), code: `C-${n}`, name: `Item ${n}`, parent_external_id: null, active: true, tombstoned_at: null, attrs: {}, as_of: '' });
const result = (rows: unknown[], total = rows.length) => ({ data: { rows, total }, isPending: false, isError: false, isFetching: false });
beforeEach(() => { vi.clearAllMocks(); h.records.mockReturnValue(result([rec(1), rec(2)], 2)); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const open = () => fireEvent.click(screen.getByRole('combobox'));

it('AC-ODC-040 the purchase picker asks only for purchasable items and never for inactive ones', () => {
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  open();
  const input = h.records.mock.calls.at(-1)![0];
  expect(input).toMatchObject({ kind: 'product', purpose: 'purchase', page: 1 });
  expect(input.includeInactive).toBeUndefined();
});

it('AC-ODC-040 the sales picker asks only for sellable items', () => {
  render(<OdooItemPicker label="Item" purpose="sale" value={null} onChange={vi.fn()} />);
  open();
  expect(h.records.mock.calls.at(-1)![0]).toMatchObject({ purpose: 'sale' });
});

it('AC-ODC-040 nothing is requested until the picker is opened', () => {
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  expect(h.records).toHaveBeenCalledWith(expect.anything(), false);
});

it('AC-ODC-040 typing searches code and name after 300 ms', () => {
  vi.useFakeTimers();
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  open();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'semen' } });
  act(() => { vi.advanceTimersByTime(299); });
  expect(h.records).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'semen' }), true);
  act(() => { vi.advanceTimersByTime(2); });
  expect(h.records).toHaveBeenCalledWith(expect.objectContaining({ search: 'semen' }), true);
});

it('AC-ODC-040 reaching the end of a long list loads more, and only then', () => {
  h.records.mockReturnValue(result([rec(1), rec(2)], 90));
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  open();
  const first = h.records.mock.calls.at(-1)![0];
  fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
  expect(h.records.mock.calls.at(-1)![0].pageSize).toBeGreaterThan(first.pageSize);
  cleanup();
  h.records.mockReturnValue(result([rec(1), rec(2)], 2));
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  open();
  expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
});

it('AC-ODC-040 choosing an item reports the record and closes the list', () => {
  const onChange = vi.fn();
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={onChange} />);
  open();
  fireEvent.click(screen.getByRole('option', { name: /Item 2/ }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ external_id: '2', name: 'Item 2' }));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

it('AC-ODC-040 an empty result says so and a failed read offers a retry', () => {
  h.records.mockReturnValue(result([], 0));
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  open();
  expect(screen.getByText('No items match')).toBeInTheDocument();
  cleanup();
  const refetch = vi.fn();
  h.records.mockReturnValue({ data: undefined, isPending: false, isError: true, isFetching: false, refetch });
  render(<OdooItemPicker label="Item" purpose="purchase" value={null} onChange={vi.fn()} />);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(refetch).toHaveBeenCalled();
});
