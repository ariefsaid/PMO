import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<{ op: string; arg?: unknown }>, result: { data: [{ id: 'd1' }] as unknown, error: null as unknown } }));
const chain: Record<string, unknown> = {};
for (const op of ['insert', 'update', 'select', 'eq', 'is', 'order']) {
  chain[op] = (arg?: unknown) => { h.calls.push({ op, arg }); return chain; };
}
chain.single = () => Promise.resolve({ data: { id: 'new' }, error: null });
chain.then = (res: (v: unknown) => unknown) => Promise.resolve(h.result).then(res);
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: () => chain, rpc: vi.fn(), storage: { from: vi.fn() } } }));
import { archiveExpiryDocument, attachmentExtension, createExpiryDocument, updateExpiryDocument } from '../documentExpiry';

const fields = { number: 'N1', issued_on: null, expires_on: '2027-01-01', location_note: null, medical_status: null };
describe('expiry document writes (#2542)', () => {
  beforeEach(() => { h.calls = []; h.result = { data: [{ id: 'd1' }], error: null }; });

  it('maps the subject to its column and never sends org_id or is_medical', async () => {
    await createExpiryDocument({ ...fields, subject_kind: 'equipment', subject_id: 'a1', type_id: 't1', attachment_path: null });
    const row = h.calls.find((c) => c.op === 'insert')?.arg as Record<string, unknown>;
    expect(row).toMatchObject({ subject_kind: 'equipment', asset_id: 'a1', person_id: null, type_id: 't1', expires_on: '2027-01-01' });
    expect(row).not.toHaveProperty('org_id');
    expect(row).not.toHaveProperty('is_medical');
    expect(row).not.toHaveProperty('subject_id');
  });

  it('updates only the editable columns', async () => {
    await updateExpiryDocument('d1', fields);
    expect(Object.keys(h.calls.find((c) => c.op === 'update')?.arg as object).sort()).toEqual(Object.keys(fields).sort());
  });

  it('reports a write RLS turned into zero rows', async () => {
    h.result = { data: [], error: null };
    await expect(archiveExpiryDocument('d1')).rejects.toMatchObject({ code: '42501' });
  });

  it('reads the file extension case-insensitively', () => {
    expect(attachmentExtension('Permit.PDF')).toBe('.pdf');
    expect(attachmentExtension('noext')).toBe('');
  });
});
