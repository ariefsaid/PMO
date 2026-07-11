import { describe, it, expect, vi } from 'vitest';
import { recordExternalRef } from './refs.ts';

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
