/** #2614 — document types and warning days DAL: the writes carry only the columns the 0970 grants allow. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as { table?: string; op: string; arg?: unknown }[], result: { data: [{ id: 't1' }] as unknown, error: null as unknown }, rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => {
  const chain = (table: string): Record<string, unknown> => {
    const q: Record<string, unknown> = {};
    for (const op of ['select', 'insert', 'update', 'eq', 'is', 'order', 'limit', 'single']) {
      q[op] = (arg?: unknown) => { h.calls.push({ table, op, arg }); return q; };
    }
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(h.result).then(res);
    return q;
  };
  return { supabase: { from: (t: string) => chain(t), rpc: h.rpc } };
});
import {
  createDocumentType, updateDocumentType, archiveDocumentType, getDocumentWarningDays, setDocumentWarningDays, DEFAULT_WARNING_DAYS, recordDocumentRenewal,
} from './documentExpiry';

beforeEach(() => { h.calls = []; h.result = { data: [{ id: 't1' }], error: null }; h.rpc.mockReset().mockResolvedValue({ error: null }); });

describe('document type writes (#2614)', () => {
  it('create never sends org_id or archived_at', async () => {
    h.result = { data: { id: 't1' }, error: null };
    await createDocumentType({ name: ' Passport ', applies_to: 'person', is_medical: false, notify_roles: [], notify_person: false });
    expect(h.calls.find((c) => c.op === 'insert')?.arg).toEqual({ name: 'Passport', applies_to: 'person', is_medical: false, notify_roles: [], notify_person: false });
  });
  it('update sends only name and roles', async () => {
    await updateDocumentType('t1', { name: 'X', notify_roles: ['Admin'], notify_person: false });
    expect(h.calls.find((c) => c.op === 'update')?.arg).toEqual({ name: 'X', notify_roles: ['Admin'], notify_person: false });
  });
  it('archive stamps archived_at and fails loudly when no row changed', async () => {
    await archiveDocumentType('t1');
    expect(Object.keys(h.calls.find((c) => c.op === 'update')?.arg as object)).toEqual(['archived_at']);
    h.result = { data: [], error: null };
    await expect(archiveDocumentType('t1')).rejects.toThrow();
  });
});

describe('warning days (#2614)', () => {
  it('reads the stored days, falling back to the default', async () => {
    h.result = { data: [{ document_warning_days: [45, 10] }], error: null };
    await expect(getDocumentWarningDays()).resolves.toEqual([45, 10]);
    h.result = { data: [], error: null };
    await expect(getDocumentWarningDays()).resolves.toEqual(DEFAULT_WARNING_DAYS);
  });
  it('calls the setter RPC with the days', async () => {
    await setDocumentWarningDays([30, 7]);
    expect(h.rpc).toHaveBeenCalledWith('set_document_warning_days', { p_days: [30, 7] });
  });
  it.each([[[]], [[1, 2, 3, 4, 5, 6]], [[0]], [[366]], [[1.5]]])('refuses %j before calling the server', async (days) => {
    await expect(setDocumentWarningDays(days)).rejects.toThrow();
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe('record a renewal (expiry-to-manager)', () => {
  it('AC-EXM-004 calls the renewal RPC with the document and the new date only', async () => {
    await recordDocumentRenewal('d1', '2027-02-10');
    expect(h.rpc).toHaveBeenCalledWith('record_document_renewal', { p_document: 'd1', p_expires_on: '2027-02-10' });
  });
  it('AC-EXM-004 surfaces the database refusal', async () => {
    h.rpc.mockResolvedValue({ error: { message: 'DXR_NOT_YOUR_PERSON: no', code: '42501' } });
    await expect(recordDocumentRenewal('d1', '2027-02-10')).rejects.toThrow('DXR_NOT_YOUR_PERSON');
  });
});
