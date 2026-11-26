import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import en from '@/public/locales/en/stock.json';
import type { ReceiptCount } from '@/src/lib/db/orderReceiving';
import { tableCell } from '@/src/test/tableCell';

const h = vi.hoisted(() => ({
  purchaser: false, pending: false, failed: false, flagged: false, requests: [] as ReceiptCount[],
  role: 'Engineer' as 'Engineer' | 'Admin',
  receive: vi.fn(), map: vi.fn(), approve: vi.fn(), reverse: vi.fn(), retry: vi.fn(), setEnabled: vi.fn(),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/lib/refusals', () => ({ useRefusalLine: () => (e: unknown) => e instanceof Error ? e.message : 'Failed' }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-11-24' }) }));
vi.mock('@/src/hooks/useStock', () => ({
  useStockWarehouses: () => ({ data: [{ id: 'wh', name: 'Warehouse A' }], isPending: false, isError: false, refetch: h.retry }),
  useStockKeepers: () => ({ data: [{ warehouse_id: 'wh', user_id: 'me' }], isPending: false, isError: false, refetch: h.retry }),
}));
vi.mock('@/src/hooks/useOrderReceiving', () => ({
  useOrderReceivingEnabled: () => ({ data: true, isPending: false, isError: false }),
  useReceivingOrders: () => ({ data: [{ id: 'po', number: 'PO-1' }], isPending: h.pending, isError: h.failed, refetch: h.retry }),
  useOrderReceiving: () => ({ data: { purchaser: h.purchaser, lines: [{ id: 'line', name: 'Goods', stock_name: 'Goods', unit: 'pc', stock_item_id: 'stock', needs_quality_check: h.flagged, ...(h.purchaser ? { ordered: '10', received: '4', outstanding: '6', status: 'partly_received' } : {}) }], requests: h.requests }, isPending: false, isError: false, refetch: h.retry }),
}));
vi.mock('@/src/components/stock/ItemPicker', () => ({ ItemPicker: ({ onChange }: { onChange: (id: string) => void }) => <button onClick={() => onChange('stock-new')}>Map stock</button> }));
vi.mock('@/src/lib/repositories/orderReceiving', () => ({ orderReceivingRepository: { receive: h.receive, map: h.map, approve: h.approve, reverse: h.reverse, setEnabled: h.setEnabled } }));
import OrderReceiving from './OrderReceiving';

async function mount() {
  const instance = i18next.createInstance();
  await instance.init({ lng: 'en', resources: { en: { stock: en } }, defaultNS: 'stock' });
  render(<MemoryRouter initialEntries={['/stock/new/receive?order=po']}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><I18nextProvider i18n={instance}><OrderReceiving /></I18nextProvider></QueryClientProvider></MemoryRouter>);
  return userEvent.setup();
}
beforeEach(() => {
  vi.clearAllMocks(); h.flagged = false; h.purchaser = false; h.pending = false; h.failed = false; h.requests = []; h.role = 'Engineer';
  h.receive.mockResolvedValue({ id: 'count', status: 'posted', document_id: 'doc' }); h.map.mockResolvedValue(undefined); h.approve.mockResolvedValue(undefined);
  h.setEnabled.mockResolvedValue(undefined);
});
describe('receive against order workflow', () => {
  it('records only the count after confirmation, without a price or mapping control for the receiver', async () => {
    const user = await mount();
    expect(screen.queryByText('Map stock')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ordered 10/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Warehouse'), 'wh');
    await user.type(screen.getByLabelText('Counted quantity · Goods (pc)'), '4');
    await user.click(screen.getByRole('button', { name: 'Record receipt' }));
    expect(h.receive).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record receipt' }));
    expect(h.receive).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'po', warehouseId: 'wh', lines: [{ item_id: 'line', quantity: '4' }] }));
    expect(await screen.findByText('Receipt posted')).toBeInTheDocument();
  });
  it('D4 a line whose item needs a quality check asks how many passed and were rejected before it records, and sends the check with the count', async () => {
    h.flagged = true;
    const user = await mount();
    await user.selectOptions(screen.getByLabelText('Warehouse'), 'wh');
    expect(screen.queryByLabelText(/^Passed/)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Counted quantity · Goods (pc)'), '6');
    await user.click(screen.getByRole('button', { name: 'Record receipt' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Enter a number, zero or more (3 decimals at most).')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Passed/), '5');
    await user.type(screen.getByLabelText(/^Rejected/), '1');
    await user.click(screen.getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByText('Say why some is rejected.')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Why is some rejected/), 'wet');
    await user.click(screen.getByRole('button', { name: 'Record receipt' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record receipt' }));
    expect(h.receive).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ item_id: 'line', quantity: '6', rejected: '1', reject_note: 'wet' }] }));
  });
  it('D4 a receipt on record shows what was rejected and why', async () => {
    h.requests = [{ id: 'r', receiver_id: 'me', warehouse_id: 'wh', date: '2026-11-24', lines: [{ item_id: 'line', quantity: '6', rejected: '1', reject_note: 'wet' }], approved: false, document_id: 'doc', reversed: false }];
    await mount();
    expect(tableCell('Receipts', 'Goods', 'Received')).toHaveTextContent('6 pc');
    expect(tableCell('Receipts', 'Goods', 'Rejected')).toHaveTextContent('1wet');
  });
  it('shows a pending excess outcome instead of claiming stock posted', async () => {
    h.requests = [{ id: 'r', receiver_id: 'me', warehouse_id: 'wh', date: '2026-11-24', lines: [{ item_id: 'line', quantity: '7' }], approved: true, document_id: null, reversed: false }];
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Post approved count' }));
    expect(h.receive).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r', lines: [{ item_id: 'line', quantity: '7' }] }));
  });
  it('accepts a decimal comma count and sends an exact decimal string', async () => {
    const user = await mount();
    await user.selectOptions(screen.getByLabelText('Warehouse'), 'wh');
    await user.type(screen.getByLabelText('Counted quantity · Goods (pc)'), '1,5');
    expect(screen.getByRole('button', { name: 'Record receipt' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Record receipt' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record receipt' }));
    expect(h.receive).toHaveBeenCalledWith(expect.objectContaining({ lines: [{ item_id: 'line', quantity: '1.5' }] }));
  });
  it('gives purchasing progress and the stock mapping control', async () => {
    h.purchaser = true; const user = await mount();
    expect(tableCell('Order lines', 'Goods', 'Ordered')).toHaveTextContent('10 pc');
    expect(tableCell('Order lines', 'Goods', 'Received')).toHaveTextContent('4 pc');
    expect(tableCell('Order lines', 'Goods', 'Outstanding')).toHaveTextContent('6 pc');
    await user.click(screen.getByText('Map stock'));
    expect(h.map).toHaveBeenCalledWith('line', 'stock-new');
  });
  it('lets a different purchaser approve the exact pending count with a reason', async () => {
    h.purchaser = true;
    h.requests = [{ id: 'r', receiver_id: 'someone-else', warehouse_id: 'wh', date: '2026-11-24', lines: [{ item_id: 'line', quantity: '7' }], approved: false, document_id: null, reversed: false }];
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Approve excess' }));
    await user.type(screen.getByLabelText('Reason'), 'Extra goods accepted');
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(h.approve).toHaveBeenCalledWith('r', 'Extra goods accepted');
  });
  it('keeps loading and failure states actionable', async () => {
    h.failed = true; const user = await mount();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load receiving.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.retry).toHaveBeenCalled();
  });
  it('confirms an organisation-wide mode change before discarding the current form', async () => {
    h.role = 'Admin'; const user = await mount();
    await user.click(screen.getByRole('checkbox', { name: 'Receive goods against orders' }));
    expect(h.setEnabled).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Confirm' }));
    expect(h.setEnabled).toHaveBeenCalledWith(false);
  });
});
