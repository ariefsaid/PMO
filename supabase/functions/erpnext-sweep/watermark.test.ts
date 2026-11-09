import "../_shared/testing/publicErpDns.ts";
import { readWm, advanceWm, ERPNEXT_TIER, type WatermarkServiceClient } from "../../../pmo-portal/src/lib/adapterSeam/erpnext/watermark.ts";
import { AppError } from "../../../pmo-portal/src/lib/appError.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

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

Deno.test("watermark helpers: readWm returns cursor or null", async () => {
  const orgId = "00000000-0000-4000-8000-0000000000aa";
  const domain = "ledger::GL Entry";
  const fake = createFakeClient();

  const empty = await readWm(fake.client, orgId, domain);
  assert(empty === null, "should return null when absent");

  fake.rows.push({ org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: "2026-03-01 10:00:00" });
  const stored = await readWm(fake.client, orgId, domain);
  assert(stored === "2026-03-01 10:00:00", "should return stored cursor");
});

Deno.test("watermark helpers: advanceWm preserves monotonic invariant", async () => {
  const orgId = "00000000-0000-4000-8000-0000000000aa";
  const domain = "ledger::GL Entry";
  const fake = createFakeClient([
    { org_id: orgId, external_tier: ERPNEXT_TIER, domain, watermark_cursor: "2026-02-01 00:00:00" },
  ]);

  const older = await advanceWm(fake.client, orgId, domain, "2026-01-15 00:00:00", "2026-02-01 00:00:00");
  assert(older === "2026-02-01 00:00:00", "older cursor must not rewind stored value");

  const newer = await advanceWm(fake.client, orgId, domain, "2026-03-01 00:00:00", "2026-02-01 00:00:00");
  assert(newer === "2026-03-01 00:00:00", "newer cursor advances stored value");
});
