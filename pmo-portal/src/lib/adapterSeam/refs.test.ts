import { describe, it, expect, vi } from 'vitest';
import { findPmoRecordIds, recordExternalRef } from './refs.ts';

const makeClient = () => {
  const calls = { table: '', rows: null as unknown, options: null as unknown };
  return {
    calls,
    client: {
      from(table: string) {
        calls.table = table;
        return {
          upsert: vi.fn(async (rows: unknown, options: unknown) => {
            calls.rows = rows;
            calls.options = options;
            return { error: null };
          }),
        };
      },
    },
  };
};

describe('refs.recordExternalRef (supports AC-EAS-042)', () => {
  it('upserts the mapping through the injected service-role client against (org_id,domain,pmo_record_id)', async () => {
    const { client, calls } = makeClient();
    await recordExternalRef(client, {
      orgId: 'org-1', domain: 'reference', pmoRecordId: 'pmo-1', externalTier: 'reference', externalRecordId: 'ext-1',
    });
    expect(calls.table).toBe('external_refs');
    expect(calls.rows).toMatchObject({
      org_id: 'org-1', domain: 'reference', pmo_record_id: 'pmo-1', external_tier: 'reference', external_record_id: 'ext-1',
    });
    expect(calls.options).toEqual({ onConflict: 'org_id,domain,pmo_record_id' });
  });
});

describe('#2119 refs.findPmoRecordIds', () => {
  function lookupClient(rows: Array<{ external_record_id: string; pmo_record_id: string }>) {
    const reads: Array<{ eq: Array<[string, string]>; inCol: string; ids: string[] }> = [];
    const client = {
      from(table: string) {
        expect(table).toBe('external_refs');
        return {
          select(cols: string) {
            expect(cols).toBe('external_record_id, pmo_record_id');
            const read = { eq: [] as Array<[string, string]>, inCol: '', ids: [] as string[] };
            reads.push(read);
            const b = {
              eq(c: string, v: string) { read.eq.push([c, v]); return b; },
              in: async (c: string, ids: string[]) => { read.inCol = c; read.ids = ids; return { data: rows.filter((r) => ids.includes(r.external_record_id)), error: null }; },
            };
            return b;
          },
        };
      },
    };
    return { client, reads };
  }

  it('#2119 reads the mappings of many ids in a few in (...) reads scoped to org and domain, not one per id', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `Supplier:S-${i}`);
    const { client, reads } = lookupClient([{ external_record_id: 'Supplier:S-7', pmo_record_id: 'pmo-7' }, { external_record_id: 'Supplier:S-201', pmo_record_id: 'pmo-201' }]);
    const found = await findPmoRecordIds(client, 'org-1', 'companies', ids);
    expect(found).toEqual(new Map([['Supplier:S-7', 'pmo-7'], ['Supplier:S-201', 'pmo-201']]));
    expect(reads).toHaveLength(3); // chunks of 100 keep the GET under URL limits
    for (const r of reads) {
      expect(r.eq).toEqual([['org_id', 'org-1'], ['domain', 'companies']]);
      expect(r.inCol).toBe('external_record_id');
    }
    expect(reads.flatMap((r) => r.ids)).toEqual(ids);
  });

  it('#2119 a failed read throws, never reads as "not mapped"', async () => {
    const client = { from: () => ({ select: () => { const b = { eq: () => b, in: async () => ({ data: null, error: { message: 'boom', code: 'XX000' } }) }; return b; } }) };
    await expect(findPmoRecordIds(client, 'org-1', 'companies', ['Supplier:S-1'])).rejects.toMatchObject({ message: 'boom', code: 'XX000' });
  });
});
