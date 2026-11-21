import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import i18next from 'i18next';
import stockEn from '@/public/locales/en/stock.json';
import stockId from '@/public/locales/id/stock.json';
import type { ProofStatusRow } from '@/src/lib/db/stockTransfers';

const h = vi.hoisted(() => ({
  timing: 'may_follow' as string, role: 'Admin' as string, keepers: [] as { user_id: string; warehouse_id: string }[],
  rows: undefined as ProofStatusRow[] | undefined, proofEnabled: [] as boolean[],
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'me', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));
vi.mock('@/src/hooks/useStock', () => ({ useStockKeepers: () => ({ data: h.keepers }) }));
vi.mock('@/src/hooks/useStockTransfers', () => ({
  useTransferSettings: () => ({ data: { mode: 'one_step', proofTiming: h.timing } }),
  useProofStatus: (_s: string, enabled: boolean) => { h.proofEnabled.push(enabled); return { data: enabled ? h.rows : undefined, dataUpdatedAt: Date.UTC(2026, 10, 21, 9, 14) }; },
}));

import { ProofChaseCard } from './ProofChaseCard';
import { daysWaiting } from './proofChase';

const row = (n: number, over: Partial<ProofStatusRow> = {}): ProofStatusRow => ({
  movementId: `m${n}`, number: `TRF-${String(n).padStart(3, '0')}`, mode: 'one_step', status: 'Posted', movementDate: `2026-11-${String(n).padStart(2, '0')}`,
  fromWarehouseId: 'w1', fromWarehouseName: 'Central', toWarehouseId: 'w2', toWarehouseName: 'Site A',
  tagRules: ['paper'], requiredProof: 'paper', hasPaper: false, hasConfirmation: false, proofStatus: 'outstanding', missing: 'paper', proofCompletedAt: null, ...over,
});
const renderCard = () => render(<MemoryRouter><ProofChaseCard /></MemoryRouter>);

beforeAll(() => { i18next.addResourceBundle('en', 'stock', stockEn, true, true); i18next.addResourceBundle('id', 'stock', stockId, true, true); });
beforeEach(() => { h.timing = 'may_follow'; h.role = 'Admin'; h.keepers = []; h.rows = [row(3), row(1)]; h.proofEnabled = []; });

describe('ProofChaseCard (#2689)', () => {
  it('AC-MAP-001 a keeper sees only movements at a location they keep, oldest first', () => {
    h.role = 'Project Manager'; h.keepers = [{ user_id: 'me', warehouse_id: 'w2' }, { user_id: 'other', warehouse_id: 'w9' }];
    h.rows = [row(5), row(2), row(4, { fromWarehouseId: 'w8', toWarehouseId: 'w9' })];
    renderCard();
    expect(screen.getByRole('heading', { name: 'Waiting for proof (2)' })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('TRF-002')).toBeInTheDocument();
    expect(within(items[1]).getByText('TRF-005')).toBeInTheDocument();
  });
  it('AC-MAP-002 before_posting renders nothing and does not request the read', () => {
    h.timing = 'before_posting';
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
    expect(h.proofEnabled.every((e) => e === false)).toBe(true);
  });
  it('AC-MAP-003 nothing outstanding renders nothing; a complete row is not listed', () => {
    h.rows = [row(1, { proofStatus: 'complete', missing: null })];
    expect(renderCard().container).toBeEmptyDOMElement();
  });
  it('AC-MAP-004 a role that is neither Admin nor keeper sees nothing and the read is off', () => {
    h.role = 'Project Manager'; h.keepers = [{ user_id: 'other', warehouse_id: 'w1' }];
    expect(renderCard().container).toBeEmptyDOMElement();
    expect(h.proofEnabled.every((e) => e === false)).toBe(true);
  });
  it('AC-MAP-005 days waiting counts calendar days and is never negative', () => {
    const today = new Date(2026, 10, 21, 15, 0);
    expect(daysWaiting('2026-11-15', today)).toBe(6);
    expect(daysWaiting('2026-11-21', today)).toBe(0);
    expect(daysWaiting('2026-11-30', today)).toBe(0);
  });
  it('AC-MAP-006 five rows show first, then all with a toggle', async () => {
    h.rows = [1, 2, 3, 4, 5, 6, 7].map((n) => row(n));
    renderCard();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
  it('AC-MAP-007 a two-step row links to the transfer, a one-step row to the document', () => {
    h.rows = [row(1, { mode: 'two_step', movementId: 'tt' }), row(2, { movementId: 'dd' })];
    renderCard();
    expect(screen.getByRole('link', { name: /TRF-001/ })).toHaveAttribute('href', '/stock/transfers/tt');
    expect(screen.getByRole('link', { name: /TRF-002/ })).toHaveAttribute('href', '/stock/documents/dd');
  });
  it('AC-MAP-008 the missing proof reads in words', () => {
    h.rows = [row(1, { missing: 'confirmation' }), row(2, { missing: 'either' }), row(3, { missing: 'paper,confirmation' })];
    renderCard();
    expect(screen.getByText('Missing: Confirmed in PMO')).toBeInTheDocument();
    expect(screen.getByText('Missing: Signed paper or confirmed in PMO')).toBeInTheDocument();
    expect(screen.getByText('Missing: Signed paper, Confirmed in PMO')).toBeInTheDocument();
  });
  it('AC-MAP-009 a read that has not produced data renders nothing', () => {
    h.rows = undefined;
    expect(renderCard().container).toBeEmptyDOMElement();
  });
  describe('Bahasa Indonesia', () => {
    beforeAll(async () => { await i18next.changeLanguage('id'); });
    afterAll(async () => { await i18next.changeLanguage('en'); });
    it('AC-MAP-010 the card is in Indonesian', () => {
      renderCard();
      expect(screen.getByRole('heading', { name: 'Menunggu bukti (2)' })).toBeInTheDocument();
      expect(screen.getAllByText(/^menunggu \d+ hari$/).length).toBe(2);
      expect(screen.getAllByText('Belum ada: Kertas bertanda tangan').length).toBe(2);
    });
  });
});
