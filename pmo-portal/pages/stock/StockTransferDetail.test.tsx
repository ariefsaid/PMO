import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';
import stockId from '@/public/locales/id/stock.json';

const h = vi.hoisted(() => ({
  transfer: null as unknown, tags: [] as unknown[], items: [] as unknown[], timing: 'before_posting',
  receive: vi.fn(), upload: vi.fn(), resolve: vi.fn(), recall: vi.fn(), record: vi.fn(),
}));
vi.mock('@/src/hooks/useStockTransfers', () => ({
  useStockTransfer: () => ({ isPending: false, isError: false, data: h.transfer, refetch: vi.fn() }),
  useTransferConfirmations: () => ({ data: [] }),
  useProofStatus: () => ({ data: [] }),
  useTransferSettings: () => ({ data: { mode: 'two_step', proofTiming: h.timing } }),
  useTransferRefresh: () => async () => [],
}));
vi.mock('@/src/hooks/useStock', () => ({ useStockItems: () => ({ data: h.items }), useStockWarehouses: () => ({ data: [{ id: 'w1', name: 'Central store' }, { id: 'w2', name: 'Site one' }] }) }));
vi.mock('@/src/hooks/useStockSiteWork', () => ({ useStockTags: () => ({ data: h.tags }) }));
vi.mock('@/src/hooks/useTasks', () => ({ useAssignableProfiles: () => ({ data: [{ id: 'me', full_name: 'Dest Keeper' }] }) }));
vi.mock('@/src/lib/repositories/stockTransfers', () => ({
  stockTransfersRepository: { receive: h.receive, resolveShortfall: h.resolve, recall: h.recall, recordHandover: h.record, photos: { upload: h.upload } },
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1', full_name: 'Dest Keeper' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import StockTransferDetail from './StockTransferDetail';

const line = (extra: Record<string, unknown> = {}) => ({ id: 'l1', lineNo: 1, itemId: 'i1', qtySent: '10.000', qtyCounted: null, qtyAccepted: null, qtyRejected: null, rejectReason: null, qualityResult: null, shortResolution: null, shortReason: null, ...extra });
const transfer = (extra: Record<string, unknown> = {}) => ({ id: 't1', number: 'TST-1', fromWarehouseId: 'w1', toWarehouseId: 'w2', transitWarehouseId: 'w3', workOrderId: null, toUserId: null, note: null, status: 'Sent', sentBy: 'someone', sentAt: '2026-11-20T08:00:00Z', receivedBy: null, receivedAt: null, cancelReason: null, lines: [line()], ...extra });

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); });
beforeEach(() => {
  vi.clearAllMocks();
  h.transfer = transfer(); h.tags = []; h.timing = 'before_posting';
  h.items = [{ id: 'i1', code: 'PIPE', name: 'Pipe', tag_id: null, needs_quality_check: false }];
  h.receive.mockResolvedValue(undefined);
  h.upload.mockImplementation(async (_o: string, _t: string, _c: string, kind: string) => `org-1/t1/c1/${kind}.jpg`);
});
const renderPage = () => render(<ToastProvider><MemoryRouter initialEntries={['/stock/transfers/t1']}><Routes><Route path="/stock/transfers/:transferId" element={<StockTransferDetail />} /></Routes></MemoryRouter></ToastProvider>);
const photo = () => new File(['x'], 'p.jpg', { type: 'image/jpeg' });

describe('StockTransferDetail receive (AC-TST-024)', () => {
  it('AC-TST-024 counted and accepted start at the sent quantity, and an unflagged item has no quality choice', async () => {
    renderPage();
    expect(await screen.findByLabelText(/^Counted/)).toHaveValue('10.000');
    expect(screen.getByLabelText(/^Accepted/)).toHaveValue('10.000');
    expect(screen.queryByLabelText(/Quality check/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm receipt' })).toBeEnabled();
  });

  it('AC-TST-024 a short count says the shortfall stays in transit; rejecting part asks why; submit sends the count', async () => {
    renderPage();
    const counted = await screen.findByLabelText(/^Counted/);
    await userEvent.clear(counted); await userEvent.type(counted, '8');
    expect(screen.getByText(/2 short: it stays in transit/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Why is some rejected/)).not.toBeInTheDocument();
    const accepted = screen.getByLabelText(/^Accepted/);
    await userEvent.clear(accepted); await userEvent.type(accepted, '6');
    await userEvent.type(await screen.findByLabelText(/Why is some rejected/), 'dented');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    await waitFor(() => expect(h.receive).toHaveBeenCalledWith('t1', [{ lineId: 'l1', counted: '8', accepted: '6', rejectReason: 'dented', qualityResult: null }], null));
  });

  it('AC-TST-024 a flagged item needs a pass or fail, and a fail accepts nothing', async () => {
    h.items = [{ id: 'i1', code: 'PIPE', name: 'Pipe', tag_id: null, needs_quality_check: true }];
    renderPage();
    const submit = await screen.findByRole('button', { name: 'Confirm receipt' });
    expect(submit).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/Quality check/), 'fail');
    expect(screen.getByLabelText(/^Accepted/)).toHaveValue('0');
    await userEvent.type(await screen.findByLabelText(/Why is some rejected/), 'failed test');
    expect(submit).toBeEnabled();
  });

  it('AC-TST-025 a tag that needs a confirmation blocks receipt until both photos are taken, then sends the confirmation', async () => {
    h.tags = [{ id: 'g1', name: 'Client supplied', paper_required: false, proof_required: 'confirmation' }];
    h.items = [{ id: 'i1', code: 'PIPE', name: 'Pipe', tag_id: 'g1', needs_quality_check: false }];
    renderPage();
    const submit = await screen.findByRole('button', { name: 'Confirm receipt' });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Proof needed before receiving: Confirmed in PMO/)).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Photo of the goods'), photo());
    expect(submit).toBeDisabled();
    await userEvent.upload(screen.getByLabelText('Photo of the person receiving'), photo());
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    await waitFor(() => expect(h.receive).toHaveBeenCalled());
    const confirmation = h.receive.mock.calls[0][2];
    expect(confirmation).toMatchObject({ proof_type: 'in_app', signer_kind: 'account', stage: 'receive', goods_photo_path: 'org-1/t1/c1/goods.jpg', signer_photo_path: 'org-1/t1/c1/person.jpg' });
  });

  it('AC-TST-031 when proof may follow, receipt is not blocked and says the transfer stays proof outstanding', async () => {
    h.timing = 'may_follow';
    h.tags = [{ id: 'g1', name: 'Client supplied', paper_required: false, proof_required: 'confirmation' }];
    h.items = [{ id: 'i1', code: 'PIPE', name: 'Pipe', tag_id: 'g1', needs_quality_check: false }];
    renderPage();
    expect(await screen.findByRole('button', { name: 'Confirm receipt' })).toBeEnabled();
    expect(screen.getByText(/Proof may follow/)).toBeInTheDocument();
  });

  it('AC-TST-024 an open shortfall on a received transfer offers delivered and returned; write-off is for an Admin only', async () => {
    h.transfer = transfer({ status: 'Received', receivedBy: 'me', receivedAt: '2026-11-20T10:00:00Z', lines: [line({ qtyCounted: '7.000', qtyAccepted: '7.000', qtyRejected: '0.000' })] });
    renderPage();
    expect(await screen.findByRole('button', { name: 'It arrived' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send back' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write off' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await waitFor(() => expect(h.resolve).toHaveBeenCalledWith('l1', 'returned', ''));
  });

  it('AC-TST-024 quantities that arrive as JSON numbers (PostgREST numeric) render and submit as decimal strings', async () => {
    h.transfer = transfer({ lines: [line({ qtySent: 10 })] });
    renderPage();
    expect(await screen.findByLabelText(/^Counted/)).toHaveValue('10');
    await userEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    await waitFor(() => expect(h.receive).toHaveBeenCalledWith('t1', [{ lineId: 'l1', counted: '10', accepted: '10', rejectReason: '', qualityResult: null }], null));
  });

  it('AC-TST-024 a received transfer with numeric counts renders its lines', async () => {
    h.transfer = transfer({ status: 'Received', receivedBy: 'me', receivedAt: '2026-11-20T10:00:00Z', lines: [line({ qtySent: 10, qtyCounted: 7, qtyAccepted: 7, qtyRejected: 0 })] });
    renderPage();
    expect(await screen.findByRole('button', { name: 'It arrived' })).toBeInTheDocument();
    expect(screen.getByText(/3 short/)).toBeInTheDocument();
  });

  it('AC-TST-024 the receive screen reads in Bahasa Indonesia too', () => {
    expect(stockId.transfers.receiveAction).toBe('Konfirmasi penerimaan');
    expect(stockId.handover.guestToggle).toBe('Penanda tangan tidak punya akun');
    expect(stockId.proof.outstanding).toBe('Bukti belum lengkap');
  });
});
