import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ range: vi.fn(), ids: vi.fn(), rpc: vi.fn(), signedUrl: vi.fn(), upload: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => {
  const builder = { select: () => builder, gte: () => builder, lte: () => builder, eq: () => builder, in: (column: string, ids: string[]) => { h.ids(column, ids); return builder; }, order: () => builder, limit: () => h.range(0, 999), range: h.range };
  return { supabase: { from: () => builder, rpc: h.rpc, storage: { from: () => ({ createSignedUrl: h.signedUrl, upload: h.upload }) } } };
});
import { listStatusDays, listLatestStatusDays, listRentalTerms, listEquipmentProofs, rentalCheck, proofUrl, setStatus, setStatusBulk, addProof, uploadProof, getMetrics, listDowntimeFlags, setOwnership, saveRentalTerm, changeRentalRate, setWorkingHours } from './equipmentAvailability';

describe('status reads', () => {
  it('returns all pages when the server caps a response at 1000 rows', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ asset_id: String(i), status_date: '2026-09-01', status: 'ready', note: null }));
    const last = { asset_id: 'last', status_date: '2026-09-02', status: 'broken', note: null };
    h.range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [last], error: null });
    const result = await listStatusDays('2026-09-01', '2026-09-30');
    expect(result).toHaveLength(1001);
    expect(result[1000]).toEqual(last);
  });
  it('returns each machine’s most recent status even when it was before this month', async () => {
    h.range.mockReset();
    h.range.mockResolvedValueOnce({ data: [
      { asset_id: 'a', status_date: '2026-02-01', status: 'ready', note: null },
      { asset_id: 'a', status_date: '2026-01-31', status: 'broken', note: null },
      { asset_id: 'b', status_date: '2026-01-20', status: 'standby', note: null },
    ], error: null });
    expect(await listLatestStatusDays(['a', 'b'], '2026-02-02')).toEqual([
      expect.objectContaining({ asset_id: 'a', status: 'ready' }),
      expect.objectContaining({ asset_id: 'b', status: 'standby' }),
    ]);
  });

  it('returns rental history beyond the server page cap', async () => {
    const first = Array.from({ length: 1000 }, (_, i) => ({ id: String(i), rate: 1 }));
    const last = { id: 'last', rate: 2 };
    h.range.mockReset();
    h.range.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: [last], error: null });
    const rows = await listRentalTerms('a');
    expect(rows).toHaveLength(1001);
    expect(rows[1000]).toEqual(last);
  });

  it('limits the status read to the current equipment page', async () => {
    h.range.mockReset().mockResolvedValue({ data: [], error: null });
    h.ids.mockClear();
    await listStatusDays('2026-09-01', '2026-09-30', ['a', 'b']);
    expect(h.ids).toHaveBeenCalledWith('asset_id', ['a', 'b']);
  });

  it('requests proof status for the selected page and day', async () => {
    h.rpc.mockResolvedValueOnce({ data: [{ asset_id: 'a', proven: true }], error: null });
    expect(await listEquipmentProofs(['a'], '2026-09-10')).toEqual([{ asset_id: 'a', proven: true }]);
    expect(h.rpc).toHaveBeenCalledWith('list_equipment_proofs', { p_asset_ids: ['a'], p_on: '2026-09-10' });
  });

  it('passes the comparison inputs to the secured RPC and preserves its decimal response', async () => {
    h.rpc.mockResolvedValueOnce({ data: { rental_amount: '30000.00', expected_amount: '27000.00' }, error: null });
    const value = await rentalCheck('a', '2026-09-01', '2026-09-30', '27500.00');
    expect(h.rpc).toHaveBeenCalledWith('equipment_rental_check', { p_asset: 'a', p_from: '2026-09-01', p_to: '2026-09-30', p_invoice_amount: '27500.00', p_include_unproven_reason: null });
    expect(value.expected_amount).toBe('27000.00');
  });
  it('uses a short-lived private link for evidence and reports a signing error', async () => {
    h.signedUrl.mockResolvedValueOnce({ data: { signedUrl: 'https://example.test/signed' }, error: null });
    expect(await proofUrl('org/a/p/ticket.pdf')).toBe('https://example.test/signed');
    expect(h.signedUrl).toHaveBeenCalledWith('org/a/p/ticket.pdf', 60);
    h.signedUrl.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(proofUrl('org/a/p/ticket.pdf')).rejects.toThrow('denied');
  });

  it('sends status and proof writes through RPCs without client-supplied tenancy or actor', async () => {
    h.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
    await setStatus('a', '2026-01-01', 'ready', 'checked');
    await setStatusBulk('2026-01-01', [{ asset_id: 'a', status: 'broken' }]);
    await addProof('a', '2026-01-01', 'photo.jpg');
    expect(h.rpc.mock.calls).toEqual([
      ['set_equipment_status', { p_asset: 'a', p_date: '2026-01-01', p_status: 'ready', p_note: 'checked' }],
      ['set_equipment_status_bulk', { p_date: '2026-01-01', p_items: [{ asset_id: 'a', status: 'broken' }] }],
      ['add_equipment_downtime_proof', { p_asset: 'a', p_proof_date: '2026-01-01', p_file_name: 'photo.jpg', p_note: null }],
    ]);
    h.upload.mockResolvedValueOnce({ error: null });
    const file = new File(['x'], 'photo.jpg');
    await uploadProof('org/a/p/photo.jpg', file);
    expect(h.upload).toHaveBeenCalledWith('org/a/p/photo.jpg', file, { upsert: false });
  });
  it('uses scoped server RPCs for terms, settings, metrics and escalation', async () => {
    h.rpc.mockReset().mockResolvedValue({ data: [], error: null });
    const term = { asset_id: 'a', vendor_id: 'v', rate: '5', basis: 'day' as const, currency: 'IDR', rented_from: '2026-01-01' };
    await setOwnership('a', 'owned', null); await saveRentalTerm(term); await changeRentalRate('a', '2026-02-01', '6');
    await setWorkingHours('8'); await getMetrics(['a'], '2026-01-01', '2026-01-31', 'month'); await listDowntimeFlags();
    expect(h.rpc.mock.calls).toEqual([
      ['set_equipment_ownership', { p_asset: 'a', p_ownership: 'owned', p_in_service_on: null }],
      ['save_equipment_rental_term', { p_term: term }],
      ['change_equipment_rental_rate', { p_asset: 'a', p_effective_on: '2026-02-01', p_new_rate: '6' }],
      ['set_equipment_working_hours', { p_hours: '8' }],
      ['equipment_metrics', { p_asset_ids: ['a'], p_from: '2026-01-01', p_to: '2026-01-31', p_grain: 'month' }],
      ['list_equipment_downtime_flags', undefined],
    ]);

  });

});
