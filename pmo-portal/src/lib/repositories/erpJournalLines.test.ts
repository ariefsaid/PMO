/** FR-JEC-001/013/014, NFR-JEC-002 — the journal-line read pages past max_rows and maps rows; attach/detach go only through the RPCs. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), range: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { attachErpJournalLines, detachErpJournalLine, erpJournalLinesRepository, listProjectJournalLines } from './erpJournalLines';

const raw = (over: Record<string, unknown> = {}) => ({
  erp_doctype: 'Journal Entry', voucher_no: 'JV-1', project_id: 'p1', account: 'Sub - X', category: 'Subcontractors',
  posting_date: '2026-03-01', amount: '60.00', currency: 'IDR', remarks: 'Vendor Lab inv 7', party: null, is_cancelled: false,
  erp_url: 'https://erp.example.test/app/journal-entry/JV-1', link_id: null, procurement_id: null, procurement_title: null, ...over,
});

beforeEach(() => {
  h.rpc.mockReset(); h.range.mockReset();
  h.rpc.mockImplementation((name: string, args: unknown) => (name === 'project_erp_journal_lines'
    ? { range: (a: number, b: number) => h.range(args, a, b) }
    : Promise.resolve({ data: null, error: null })));
});

describe('erpJournalLines repository', () => {
  it('FR-JEC-001: maps a line to camelCase with a numeric amount', async () => {
    h.range.mockResolvedValueOnce({ data: [raw()], error: null });
    const [line] = await listProjectJournalLines('p1');
    expect(line).toMatchObject({ voucherNo: 'JV-1', amount: 60, category: 'Subcontractors', remarks: 'Vendor Lab inv 7', isCancelled: false, linkId: null });
    expect(h.range).toHaveBeenCalledWith({ p_project_id: 'p1' }, 0, 999);
  });

  it('NFR-JEC-002: reads every page, not just the first 1000 rows', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => raw({ voucher_no: `JV-${i}` }));
    h.range.mockResolvedValueOnce({ data: full, error: null }).mockResolvedValueOnce({ data: [raw({ voucher_no: 'JV-last' })], error: null });
    const lines = await listProjectJournalLines('p1');
    expect(lines).toHaveLength(1001);
    expect(h.range).toHaveBeenNthCalledWith(2, { p_project_id: 'p1' }, 1000, 1999);
  });

  it('a read error surfaces as an AppError', async () => {
    h.range.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(erpJournalLinesRepository.listProject('p1')).rejects.toMatchObject({ code: '42501' });
  });

  it('listForPurchase keeps only that purchase\'s lines', async () => {
    h.range.mockResolvedValueOnce({ data: [raw({ procurement_id: 'a' }), raw({ voucher_no: 'JV-2', procurement_id: 'b' }), raw({ voucher_no: 'JV-3' })], error: null });
    const lines = await erpJournalLinesRepository.listForPurchase('a', 'p1');
    expect(lines.map((l) => l.voucherNo)).toEqual(['JV-1']);
  });

  it('FR-JEC-013: attach sends rows and the dry-run flag to the RPC', async () => {
    h.rpc.mockResolvedValueOnce({ data: { dry_run: true, results: [] }, error: null });
    const rows = [{ voucher_no: 'JV-1', project_id: 'p1', account: 'A', procurement_id: 'x' }];
    await attachErpJournalLines(rows, true);
    expect(h.rpc).toHaveBeenCalledWith('attach_erp_journal_lines', { p_rows: rows, p_dry_run: true });
  });

  it('FR-JEC-014: detach calls the RPC with the link id', async () => {
    await detachErpJournalLine('l1');
    expect(h.rpc).toHaveBeenCalledWith('detach_erp_journal_line', { p_link_id: 'l1' });
  });
});
