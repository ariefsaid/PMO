/**
 * ⚑ Audit round 9 (MED-1). `pagedRead`'s loops stop on a SHORT page, which is sound ONLY while
 * `PAGE_SCAN_SIZE <= db-max-rows`. Below that, every page returns short, every scan stops after page
 * one, and every paged MONEY read silently truncates — and no unit test would notice, because the
 * fakes cap at whatever number the tests hard-code.
 *
 * The dependency is real and deliberate (stopping on an EMPTY page instead would cost a needless
 * round trip on every scan, and `pagedRead.test.ts` pins the no-needless-round-trips behaviour). So it
 * is pinned HERE against the config that actually declares the cap: lowering `max_rows` without
 * revisiting `PAGE_SCAN_SIZE` fails the build instead of quietly understating money in production.
 *
 * ⚑ THE RESIDUAL GAP THIS GUARD CANNOT SEE (audit round 10, LOW-1). `supabase/config.toml` configures
 * the LOCAL Docker PostgREST. Production is a Supabase Cloud project whose "Max rows" lives in the
 * dashboard and appears NOWHERE in this repo, and nothing keeps the two in sync. So the guard is
 * asymmetric on purpose to know about:
 *   • DOWNWARD (someone lowers `max_rows`) — caught, which is the failure mode it was built for.
 *   • UPWARD (someone raises `PAGE_SCAN_SIZE` to 2000 and bumps `config.toml` to match) — NOT caught:
 *     CI goes green while Cloud still caps at its own value, every page comes back short, and every
 *     paged money scan truncates silently in production only.
 * Closing that would mean plumbing the deployed project's setting into CI, which is out of proportion
 * to the risk (nobody has a reason to raise the constant). It is stated here so the next person to
 * consider raising `PAGE_SCAN_SIZE` knows this test is not the authority they think it is: check the
 * Cloud project's "Max rows" FIRST.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGE_SCAN_SIZE } from './pagedRead.ts';

describe('pagedRead — PAGE_SCAN_SIZE must not exceed PostgREST db-max-rows', () => {
  it('reads the configured cap from supabase/config.toml and holds the invariant', () => {
    const cfg = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../supabase/config.toml'),
      'utf8',
    );
    const m = /^\s*max_rows\s*=\s*(\d+)/m.exec(cfg);
    expect(m, 'supabase/config.toml no longer declares [api] max_rows — the cap this module depends on').not.toBeNull();
    const maxRows = Number(m![1]);
    expect(maxRows).toBeGreaterThan(0);
    expect(
      PAGE_SCAN_SIZE,
      `PAGE_SCAN_SIZE (${PAGE_SCAN_SIZE}) exceeds db-max-rows (${maxRows}): every page would come back ` +
      'short, every paged money scan would stop after page 1, and the truncation would be silent.',
    ).toBeLessThanOrEqual(maxRows);
  });
});
