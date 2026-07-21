/**
 * Round-7 cross-family audit, finding B1(a) [Vitest unit] — the SI submit clearance must outlive the
 * submit it protects.
 *
 * The defect: migration 0113 gave the clearance a hand-picked FIVE-minute TTL, while an ERP submit can
 * legitimately stay in flight far longer. `erpnextRequest` retries an IDEMPOTENT request (a submit is a
 * `PUT`, and the post-submit re-fetch a `GET`) up to `ERP_DEFAULT_MAX_RETRIES` times with a
 * `ERP_REQUEST_TIMEOUT_MS` per-attempt deadline and up to `ERP_RETRY_AFTER_CAP_MS` between attempts —
 * and a submit dispatch issues several such requests. So the clearance could LAPSE while the submit was
 * still running, at which point the approver could call `claim_sales_invoice_author`, be appended to the
 * author set, rewrite the body, and have the still-running submit commit THEIR numbers under THEIR OWN
 * earlier approval. That is precisely the self-approval the two-person rule exists to forbid.
 *
 * The fix is not "pick a bigger number": the TTL is DERIVED from the client's own retry budget, and this
 * test asserts the relationship against the migration itself so the two cannot drift. Change the retry
 * budget without raising the TTL and this test fails.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ERP_DEFAULT_MAX_RETRIES,
  ERP_REQUEST_TIMEOUT_MS,
  ERP_RETRY_AFTER_CAP_MS,
  ERP_IDEMPOTENT_REQUEST_MAX_MS,
  ERP_SUBMIT_MAX_ERP_REQUESTS,
  ERP_SUBMIT_MAX_IN_FLIGHT_MS,
} from './client.ts';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../../supabase/migrations');

/** The `c_clearance_ttl constant interval := interval 'N unit'` the SI clearance gate is compiled with,
 *  read from the LATEST migration that declares it (migrations are applied in name order). */
function clearanceTtlMsFromMigrations(): number {
  const declaring = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8').includes('c_clearance_ttl constant interval'));
  expect(declaring.length, 'some migration must declare the clearance TTL').toBeGreaterThan(0);
  const sql = readFileSync(join(MIGRATIONS_DIR, declaring[declaring.length - 1]), 'utf8');
  const matches = [...sql.matchAll(/c_clearance_ttl constant interval\s*:=\s*interval\s*'(\d+)\s*(minutes?|seconds?|hours?)'/g)];
  expect(matches.length, 'the TTL must be a literal interval this test can read').toBeGreaterThan(0);
  const unitMs = { second: 1_000, seconds: 1_000, minute: 60_000, minutes: 60_000, hour: 3_600_000, hours: 3_600_000 };
  const values = matches.map((m) => Number(m[1]) * unitMs[m[2] as keyof typeof unitMs]);
  // Every declaration in the file must agree — a divergent copy is itself the drift this guards.
  expect(new Set(values).size, 'all clearance-TTL declarations must use the same value').toBe(1);
  return values[0];
}

describe('SI submit clearance TTL vs the ERP retry budget (B1a)', () => {
  it('the worst-case idempotent request budget is derived from the client constants, not hand-picked', () => {
    // (attempts × per-attempt deadline) + (retries × the capped inter-attempt wait).
    expect(ERP_IDEMPOTENT_REQUEST_MAX_MS).toBe(
      (ERP_DEFAULT_MAX_RETRIES + 1) * ERP_REQUEST_TIMEOUT_MS + ERP_DEFAULT_MAX_RETRIES * ERP_RETRY_AFTER_CAP_MS,
    );
    expect(ERP_SUBMIT_MAX_IN_FLIGHT_MS).toBe(ERP_SUBMIT_MAX_ERP_REQUESTS * ERP_IDEMPOTENT_REQUEST_MAX_MS);
  });

  it('the migration TTL covers the LONGEST a submit can still be in flight (no self-approval window)', () => {
    const ttlMs = clearanceTtlMsFromMigrations();
    expect(
      ttlMs,
      `the clearance TTL (${ttlMs}ms) must be at least the worst-case in-flight submit `
        + `(${ERP_SUBMIT_MAX_IN_FLIGHT_MS}ms) — otherwise the clearance lapses mid-submit and the approver `
        + 'can rewrite the body their own approval then commits',
    ).toBeGreaterThanOrEqual(ERP_SUBMIT_MAX_IN_FLIGHT_MS);
  });

  it('the five-minute TTL the audit flagged would NOT satisfy the relationship (the test really bites)', () => {
    expect(5 * 60_000).toBeLessThan(ERP_SUBMIT_MAX_IN_FLIGHT_MS);
  });
});
