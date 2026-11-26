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
  dn: true, confirmations: [] as unknown[], transfer: null as unknown, tags: [] as unknown[], items: [] as unknown[], timing: 'before_posting',
  receive: vi.fn(), upload: vi.fn(), resolve: vi.fn(), recall: vi.fn(), record: vi.fn(),
  waiting: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn(), calls: [] as unknown[][] },
}));
vi.mock('@/src/hooks/useOperationalWaitingRoute', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useOperationalWaitingRoute: (kind: string, recordId: string | undefined, enabled: boolean) => {
      h.waiting.calls.push([kind, recordId, enabled]);
      return h.waiting;
    },
  };
});
vi.mock('@/src/hooks/useStockTransfers', () => ({
  useStockTransfer: () => ({ isPending: false, isError: false, data: h.transfer, refetch: vi.fn() }),
  useTransferConfirmations: () => ({ data: h.confirmations }),
  useHandoverPhotoUrl: (path: string | null) => ({ data: path ? `https://signed/${path}` : undefined }),
  useProofStatus: () => ({ data: [] }),
  useTransferSettings: () => ({ data: { mode: 'two_step', proofTiming: h.timing } }),
  useTransferRefresh: () => async () => [],
}));
vi.mock('@/src/hooks/useMaterialRequests', () => ({ useDeliveryNoteSettings: () => ({ data: { enabled: h.dn, signatureBlocks: [] } }) }));
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
  h.waiting.data = undefined; h.waiting.isPending = false; h.waiting.isError = false; h.waiting.refetch.mockReset(); h.waiting.calls.length = 0;
  h.transfer = transfer(); h.confirmations = []; h.tags = []; h.timing = 'before_posting'; h.dn = true;
  h.items = [{ id: 'i1', code: 'PIPE', name: 'Pipe', tag_id: null, needs_quality_check: false }];
  h.receive.mockResolvedValue(undefined);
  h.upload.mockImplementation(async (_o: string, _t: string, _c: string, kind: string) => `org-1/t1/c1/${kind}.jpg`);
});
const renderPage = () => render(<ToastProvider><MemoryRouter initialEntries={['/stock/transfers/t1']}><Routes><Route path="/stock/transfers/:transferId" element={<StockTransferDetail />} /></Routes></MemoryRouter></ToastProvider>);
const photo = () => new File(['x'], 'p.jpg', { type: 'image/jpeg' });

describe('StockTransferDetail handover photos (F10)', () => {
  it('F10 each recorded confirmation shows the photos taken at it: goods, person, paper', async () => {
    h.transfer = transfer({ status: 'Received' });
    h.confirmations = [{ id: 'c1', transferId: 't1', stage: 'receive', proofType: 'in_app', signerKind: 'user', signerName: 'Dest Keeper', recordedBy: 'me', confirmedAt: '2026-11-20T09:00:00Z', goodsPhotoPath: 'o/t1/c1/goods.jpg', signerPhotoPath: 'o/t1/c1/person.jpg', paperPhotoPath: null }];
    renderPage();
    const photos = await screen.findByTestId('handover-photos');
    expect(photos.querySelectorAll('img')).toHaveLength(2);
    expect(screen.getByAltText('Photo of the goods')).toHaveAttribute('src', 'https://signed/o/t1/c1/goods.jpg');
    expect(screen.getByAltText('Photo of the person receiving')).toBeInTheDocument();
    expect(screen.queryByAltText('Photo of the signed paper')).toBeNull();
  });
  it('F10 a confirmation with no photo shows none', async () => {
    h.confirmations = [{ id: 'c1', transferId: 't1', stage: 'receive', proofType: 'paper', signerKind: 'user', signerName: 'Dest Keeper', recordedBy: 'me', confirmedAt: '2026-11-20T09:00:00Z', goodsPhotoPath: null, signerPhotoPath: null, paperPhotoPath: null }];
    renderPage();
    await screen.findAllByText('Dest Keeper');
    expect(screen.queryByTestId('handover-photos')).toBeNull();
  });
});

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

describe('StockTransferDetail print (#1122 item 7)', () => {
  it('JOB-1122-7 a transfer offers "Print delivery note" when delivery notes are on, and not when they are off', async () => {
    const view = renderPage();
    expect(await screen.findByRole('link', { name: 'Print delivery note' })).toHaveAttribute('href', '/stock/transfers/t1/print');
    view.unmount();
    h.dn = false;
    renderPage();
    await screen.findByText(/TST-1/);
    expect(screen.queryByRole('link', { name: 'Print delivery note' })).not.toBeInTheDocument();
  });
});

describe('StockTransferDetail sender (#1122 item 1)', () => {
  it('JOB-1122-1 the sender is not shown the receive form for their own shipment; they are told someone else counts it', async () => {
    h.transfer = transfer({ sentBy: 'me' });
    renderPage();
    expect(await screen.findByText(/someone else counts it on arrival/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Counted/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm receipt' })).not.toBeInTheDocument();
  });

  it('JOB-1122-1 the named receiver (not a keeper, not the sender) is shown the receive form', async () => {
    h.transfer = transfer({ toUserId: 'me', sentBy: 'someone' });
    renderPage();
    expect(await screen.findByLabelText(/^Counted/)).toBeInTheDocument();
  });
});

describe('StockTransferDetail who it is assigned to (#1122 Waiting 3, AC-WAIT-072/073)', () => {
  it('reads the receipt route only while the transfer is Sent', () => {
    renderPage();
    expect(h.waiting.calls.at(-1)).toEqual(['transfer_receipt', 't1', true]);
    h.transfer = transfer({ status: 'Received', receivedBy: 'me', receivedAt: '2026-11-20T10:00:00Z' });
    renderPage();
    expect(h.waiting.calls.at(-1)).toEqual(['transfer_receipt', 't1', false]);
  });

  it('an unassigned transfer names the destination keeper with their actual role, never every senior role', async () => {
    h.transfer = transfer({ sentBy: 'someone', toUserId: null });
    h.waiting.data = { approvers: [{ id: 'keeper', name: 'Keeper Kasim', role: 'Engineer' }], routeKind: 'transfer_receipt' };
    renderPage();
    const line = await screen.findByTestId('transfer-waiting');
    expect(line.textContent).toBe('Waiting for Keeper Kasim, Engineer');
    expect(line.textContent).not.toMatch(/Admin|Finance|Executive/);
  });

  it('uses every actual role when the assigned people hold different ones', async () => {
    h.transfer = transfer({ sentBy: 'someone', toUserId: null });
    h.waiting.data = {
      approvers: [
        { id: 'keeper', name: 'Keeper Kasim', role: 'Engineer' },
        { id: 'other', name: 'Tono Store', role: 'Finance' },
      ],
      routeKind: 'transfer_receipt',
    };
    renderPage();
    const line = await screen.findByTestId('transfer-waiting');
    expect(line.textContent).toBe('Waiting for Keeper Kasim or Tono Store, Engineer or Finance');
  });

  it('never repeats the addressed receiver: the summary already names them', async () => {
    h.transfer = transfer({ sentBy: 'someone', toUserId: 'me' });
    h.waiting.data = { approvers: [{ id: 'me', name: 'Dest Keeper', role: 'Engineer' }], routeKind: 'transfer_receipt' };
    renderPage();
    // The receiver fact names them once.
    expect(await screen.findByText('Receiver')).toBeInTheDocument();
    expect(screen.getAllByText('Dest Keeper')).toHaveLength(1);
    expect(screen.queryByTestId('transfer-waiting')).toBeNull();
  });

  it('renders exactly the people the server named; the sender is excluded by the route, not re-filtered here', async () => {
    h.transfer = transfer({ sentBy: 'me', toUserId: null });
    h.waiting.data = { approvers: [{ id: 'keeper', name: 'Keeper Kasim', role: 'Engineer' }], routeKind: 'transfer_receipt' };
    renderPage();
    const line = await screen.findByTestId('transfer-waiting');
    expect(line.textContent).toBe('Waiting for Keeper Kasim, Engineer');
    expect(line.textContent).not.toContain('me');
  });

  it('says nothing when nobody is assigned and no keeper is known', () => {
    h.transfer = transfer({ sentBy: 'me', toUserId: null });
    h.waiting.data = { approvers: [], routeKind: 'transfer_receipt' };
    renderPage();
    expect(screen.queryByTestId('transfer-waiting')).toBeNull();
  });

  it('says nothing while the route is still being read', () => {
    h.transfer = transfer({ sentBy: 'me', toUserId: null });
    h.waiting.isPending = true;
    renderPage();
    expect(screen.queryByTestId('transfer-waiting')).toBeNull();
  });

  it('offers a retry when the route could not be read, even when a receiver is addressed', async () => {
    h.transfer = transfer({ sentBy: 'me', toUserId: 'me' });
    h.waiting.isError = true;
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(h.waiting.refetch).toHaveBeenCalled();
  });
});

it('AC-SITE-009 an addressed receiver supplies quality even when master items are unavailable', async () => {
 h.items=[];
 h.transfer=transfer({toUserId:'me',fromWarehouseName:'Bound origin',toWarehouseName:'Bound site',lines:[line({itemName:'QC - Delivery goods',needsQualityCheck:true})]});
 renderPage();
 expect(screen.getByRole('rowheader',{name:'QC - Delivery goods'})).toBeVisible();
 expect(screen.getByText(/Bound origin/)).toBeVisible();
 expect(screen.getByText(/Bound site/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Confirm receipt'})).toBeDisabled();
 await userEvent.selectOptions(screen.getByRole('combobox',{name:/Quality check/}),'pass');
 await userEvent.click(screen.getByRole('button',{name:'Confirm receipt'}));
 await waitFor(()=>expect(h.receive).toHaveBeenCalledWith('t1',[{lineId:'l1',counted:'10.000',accepted:'10.000',rejectReason:'',qualityResult:'pass'}],null));
});
