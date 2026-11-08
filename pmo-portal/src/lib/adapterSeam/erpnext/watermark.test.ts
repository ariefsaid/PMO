import { describe, it, expect } from 'vitest';
import { readWm, advanceWm, ERPNEXT_TIER, type WatermarkServiceClient } from './watermark.ts';
import { AppError } from '../../appError.ts';

interface StoredRow {
  org_id: string;
  external_tier: string;
  domain: string;
  watermark_cursor: string;
}

function createFakeClient(initialRows: StoredRow[] = []) {
  const rows = [...initialRows];
  let updateError: { message: string; code?: string } | null = null;
  let upsertError: { message: string; code?: string } | null = null;
  let selectError: { message: string; code?: string } | null = null;

  const client: WatermarkServiceClient = {
    from: (_table: string) => ({
      select: (_cols: string) => {
        const filters: Record<string, unknown> = {};
        const builder = {
          eq: (col: string, val: string | number | boolean | null) => {
            filters[col] = val;
            return builder;
          },
          maybeSingle: async () => {
            if (selectError) return { data: null, error: selectError };
            const found = rows.find(
              (r) =>
                r.org_id === filters.org_id &&
                r.external_tier === filters.external_tier &&
                r.domain === filters.domain,
            );
            return { data: found ? { watermark_cursor: found.watermark_cursor } : null, error: null };
          },
        };
        return builder;
      },
      update: (values: Record<string, unknown>, _opts?: { count?: 'exact' }) => {
        const filters: Record<string, unknown> = {};
        let ltCursor: string | null = null;
        const builder = {
          eq: (col: string, val: string | number | boolean | null) => {
            filters[col] = val;
            return builder;
          },
          lt: (col: string, val: string) => {
            if (col === 'watermark_cursor') ltCursor = val;
            return builder;
          },
          then: <TResult1 = { count: number | null; error: { message: string; code?: string } | null }>(
            onfulfilled?: ((value: { count: number | null; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
          ) => {
            if (updateError) {
              return Promise.resolve(onfulfilled ? onfulfilled({ count: null, error: updateError }) : ({ count: null, error: updateError } as never));
            }
            let count = 0;
            for (const r of rows) {
              if (
                r.org_id === filters.org_id &&
                r.external_tier === filters.external_tier &&
                r.domain === filters.domain &&
                (ltCursor === null || r.watermark_cursor < ltCursor)
              ) {
                r.watermark_cursor = values.watermark_cursor as string;
                count++;
              }
            }
            const res = { count, error: null };
            return Promise.resolve(onfulfilled ? onfulfilled(res) : (res as never));
          },
        };
        return builder;
      },
      upsert: async (payload: unknown, _opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        if (upsertError) return { error: upsertError };
        const row = payload as StoredRow;
        const existing = rows.find(
          (r) =>
            r.org_id === row.org_id &&
            r.external_tier === row.external_tier &&
            r.domain === row.domain,
        );
        if (!existing) {
          rows.push({ ...row });
        }
        return { error: null };
      },
    }),
  };

  return {
    client,
    rows,
    setUpdateError: (err: { message: string; code?: string } | null) => { updateError = err; },
    setUpsertError: (err: { message: string; code?: string } | null) => { upsertError = err; },
    setSelectError: (err: { message: string; code?: string } | null) => { selectError = err; },
  };
}

describe('erpnext/watermark helpers', () => {
  const orgId = '00000000-0000-4000-8000-0000000000aa';
  const domain = 'ledger::GL Entry';

  it('readWm returns null when cursor does not exist', async () => {
    const fake = createFakeClient();
    const cursor = await readWm(fake.client, orgId, domain);
    expect(cursor).toBeNull();
  });

  it('readWm returns stored cursor', async () => {
    const fake = createFakeClient([
      { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: '2026-03-01 10:00:00' },
    ]);
    const cursor = await readWm(fake.client, orgId, domain);
    expect(cursor).toBe('2026-03-01 10:00:00');
  });

  it('readWm throws AppError on query failure', async () => {
    const fake = createFakeClient();
    fake.setSelectError({ message: 'connection dropped', code: '57P01' });
    await expect(readWm(fake.client, orgId, domain)).rejects.toThrow(AppError);
  });

  it('advanceWm returns null when both next and prev are null', async () => {
    const fake = createFakeClient();
    const result = await advanceWm(fake.client, orgId, domain, null, null);
    expect(result).toBeNull();
    expect(fake.rows).toHaveLength(0);
  });

  it('advanceWm inserts initial watermark cursor when no row exists', async () => {
    const fake = createFakeClient();
    const result = await advanceWm(fake.client, orgId, domain, '2026-01-01 00:00:00', null);
    expect(result).toBe('2026-01-01 00:00:00');
    expect(fake.rows).toEqual([
      { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: '2026-01-01 00:00:00' },
    ]);
  });

  it('advanceWm is strictly monotonic and does not rewind when next < prev', async () => {
    const fake = createFakeClient([
      { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: '2026-02-01 00:00:00' },
    ]);
    const result = await advanceWm(fake.client, orgId, domain, '2026-01-15 00:00:00', '2026-02-01 00:00:00');
    expect(result).toBe('2026-02-01 00:00:00');
    expect(fake.rows[0].watermark_cursor).toBe('2026-02-01 00:00:00');
  });

  it('advanceWm advances the cursor when next > prev', async () => {
    const fake = createFakeClient([
      { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: '2026-01-01 00:00:00' },
    ]);
    const result = await advanceWm(fake.client, orgId, domain, '2026-02-01 00:00:00', '2026-01-01 00:00:00');
    expect(result).toBe('2026-02-01 00:00:00');
    expect(fake.rows[0].watermark_cursor).toBe('2026-02-01 00:00:00');
  });

  it('advanceWm throws AppError if update fails', async () => {
    const fake = createFakeClient([
      { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: '2026-01-01 00:00:00' },
    ]);
    fake.setUpdateError({ message: 'update failed', code: '40001' });
    await expect(advanceWm(fake.client, orgId, domain, '2026-02-01 00:00:00', '2026-01-01 00:00:00')).rejects.toThrow(AppError);
  });

  it('advanceWm throws AppError if upsert fails when row was absent', async () => {
    const fake = createFakeClient();
    fake.setUpsertError({ message: 'upsert conflict', code: '23505' });
    await expect(advanceWm(fake.client, orgId, domain, '2026-02-01 00:00:00', null)).rejects.toThrow(AppError);
  });
});
