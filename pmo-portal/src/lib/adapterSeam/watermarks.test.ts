import { describe, it, expect, vi } from 'vitest';
import { upsertWatermark } from './watermarks.ts';

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

describe('AC-EAS-051 a watermark upsert is one row per (org, tier, domain)', () => {
  it('AC-EAS-051 uses the injected service-role client and the (org_id,external_tier,domain) conflict key', async () => {
    const { client, calls } = makeClient();
    await upsertWatermark(client, {
      orgId: 'org-1', externalTier: 'reference', domain: 'reference', cursor: 'cur-2',
    });
    expect(calls.table).toBe('external_sync_watermarks');
    expect(calls.rows).toMatchObject({
      org_id: 'org-1', external_tier: 'reference', domain: 'reference', watermark_cursor: 'cur-2',
    });
    expect(calls.options).toEqual({ onConflict: 'org_id,external_tier,domain' });
  });
});
