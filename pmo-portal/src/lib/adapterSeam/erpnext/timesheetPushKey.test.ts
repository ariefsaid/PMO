/**
 * timesheetPushKey.test.ts — P3b, the DETERMINISTIC approval key (FR-TSP-041, ADR-0059 §4).
 *
 * Two properties, both money-wrong when broken:
 *  1. BEHAVIOUR — the key is derived from `(timesheet id, approved_at)`, so the push's TWO originators
 *     (the Approvals UI and the sweep backstop) land on the SAME string and the outbox's
 *     `unique (org_id, domain, pmo_record_id, idempotency_key)` collides instead of minting a second ERP
 *     Timesheet. A duplicate here is a DUPLICATED WEEK OF HOURS on project cost.
 *  2. CONFINEMENT — the module must be importable by the DENO sweep. It used to live in
 *     `src/lib/repositories/index.ts`, a CLIENT module with 38 imports including the browser Supabase
 *     singleton (`@/src/lib/supabase/client`), which the sweep cannot load at all. The only two ways out
 *     of that are (a) move the key to a shared seam, or (b) let the sweep re-implement it — and (b) is
 *     precisely the failure mode the key exists to prevent, because two independently-maintained
 *     derivations drift and then the 4-tuple no longer collides. So the confinement is a TEST, not a
 *     convention: `budgetPushKey.ts` (its P3c sibling) says the same thing in its header.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timesheetPushKey, TIMESHEET_PUSH_KEY_PREFIX } from './timesheetPushKey';

const HERE = dirname(fileURLToPath(import.meta.url));
const TIMESHEET_ID = '3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

describe('timesheetPushKey (FR-TSP-041 — the deterministic approval key)', () => {
  it('derives `ts:<timesheet id>:<approved_at>`', () => {
    expect(timesheetPushKey(TIMESHEET_ID, '2026-01-12T03:04:05.678Z')).toBe(`ts:${TIMESHEET_ID}:2026-01-12T03:04:05.678Z`);
    expect(TIMESHEET_PUSH_KEY_PREFIX).toBe('ts');
  });

  it('both originators derive the IDENTICAL key from the same timesheet + approval', () => {
    // The Approvals UI reads `approved_at` off the `approved_timesheet_for_push` RPC; the sweep reads it
    // off the `timesheets` column. Both travel PostgREST and render identically, so the raw stamp is a
    // stable key input — the SAME inputs must give the SAME string, with no per-call state.
    const foreground = timesheetPushKey(TIMESHEET_ID, '2026-07-19T02:55:21.340995+00:00');
    const sweep = timesheetPushKey(TIMESHEET_ID, '2026-07-19T02:55:21.340995+00:00');
    expect(foreground).toBe(sweep);
  });

  it('⚑ a RE-approval (a new approved_at) is a DISTINCT command — never silently suppressed', () => {
    const original = timesheetPushKey(TIMESHEET_ID, '2026-01-12T03:04:05.678Z');
    const reApproval = timesheetPushKey(TIMESHEET_ID, '2026-02-02T00:00:00.000Z');
    expect(original).not.toBe(reApproval);
  });

  it('a different timesheet is a different key', () => {
    const a = timesheetPushKey(TIMESHEET_ID, '2026-01-12T03:04:05.678Z');
    const b = timesheetPushKey('7c8d9e0f-1a2b-4c3d-8e4f-3f1b0c9e5a6b', '2026-01-12T03:04:05.678Z');
    expect(a).not.toBe(b);
  });
});

/**
 * The structural half. Walks the module's own relative-import graph and asserts nothing in it reaches
 * the browser Supabase singleton — i.e. the Deno sweep really can import this file, rather than being
 * driven to re-implement the key. Source-scanned (Vitest + `node:fs`) because it is a property of the
 * FILES, not of any runtime value; `deno test` runs without `--allow-read` locally, so this layer owns it.
 */
function relativeImportGraph(entry: string): string[] {
  const seen = new Set<string>();
  const specifiers: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      specifiers.push(spec);
      if (!spec.startsWith('.')) continue;
      const base = resolve(dirname(file), spec);
      queue.push(base.endsWith('.ts') ? base : `${base}.ts`);
    }
  }
  return specifiers;
}

describe('timesheetPushKey confinement (the sweep must IMPORT this key, never re-derive it)', () => {
  it('lives on the shared adapterSeam, not inside the client repositories module', () => {
    expect(existsSync(resolve(HERE, 'timesheetPushKey.ts'))).toBe(true);
  });

  it('its whole relative-import graph is free of the browser Supabase client (so a Deno edge fn can load it)', () => {
    const specifiers = relativeImportGraph(resolve(HERE, 'timesheetPushKey.ts'));
    const offenders = specifiers.filter((s) => s.includes('supabase/client') || s.includes('lib/repositories'));
    expect(offenders).toEqual([]);
  });

  it('`repositories/index.ts` no longer DEFINES the key — it must consume the one shared derivation', () => {
    const repositories = readFileSync(resolve(HERE, '../../repositories/index.ts'), 'utf8');
    expect(repositories).not.toMatch(/export function timesheetPushKey/);
    expect(repositories).toMatch(/timesheetPushKey/);   // still USED — the push path keeps its key
  });
});
