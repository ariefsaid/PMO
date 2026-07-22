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
