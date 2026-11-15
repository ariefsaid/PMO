import { afterAll, describe, it } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handlePurchaseCaptureRequest } from './index.ts';
import { createJwtAuthority, installEdgeEnv } from '../_shared/testing/edgeTestKit.ts';
import { buildFixture, captureRelevant } from './__fixtures__/capture10x.ts';
import { runAction } from './__fixtures__/capture10xServe.ts';

// #2286: the served handler over a ten-times-volume organization, fed through the fetch mock exactly as the database pages it.
const env = installEdgeEnv();
const priorAnon = Deno.env.get('SUPABASE_ANON_KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
const auth = await createJwtAuthority(env.SUPABASE_URL);
afterAll(() => { env.restore(); if (priorAnon === undefined) Deno.env.delete('SUPABASE_ANON_KEY'); else Deno.env.set('SUPABASE_ANON_KEY', priorAnon); });

const GOLDEN = new URL('./__golden__/preview10x.json', import.meta.url);
// FR-CAPV-003: every one of these response fields must stay byte-identical. The golden keeps a SHA-256 of each field's JSON
// (the full response is about 1.5 MB) beside a readable summary of the money and the blocking lists.
const GOLDEN_FIELDS = ['complete', 'revision', 'proposals', 'reports', 'assignments', 'unassigned', 'other_unassigned', 'unassigned_documents', 'missing', 'feed', 'erp_write'] as const;
type Body = Record<string, unknown>;
async function resolveDigest(body: Body) {
  const sha256: Record<string, string> = {};
  for (const field of GOLDEN_FIELDS) {
    const bytes = new TextEncoder().encode(JSON.stringify(body[field] ?? null));
    sha256[field] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const reports = (body.reports as Array<Record<string, unknown> & { scope: { projectId: string }; remainder: unknown[]; excluded: unknown[] }>) ?? [];
  const summary = {
    complete: body.complete, missing: body.missing, other_unassigned: body.other_unassigned, proposals: Array.isArray(body.proposals) ? body.proposals.length : null,
    unassigned: (body.unassigned as unknown[]).length, unassigned_documents: (body.unassigned_documents as unknown[]).length, assignments: (body.assignments as unknown[]).length,
    reports: reports.map(report => ({ project: report.scope.projectId, complete: report.complete, ledgerMinor: report.ledgerMinor, representedMinor: report.representedMinor,
      remainderMinor: report.remainderMinor, bridge: report.bridge, missing: report.missing, remainder: report.remainder.length, excluded: report.excluded.length })),
  };
  return { summary, sha256 };
}

/**
 * Counts every whole-array pass the handler makes over the array it holds the ledger in: a call of an iterating
 * method or of the array iterator (for…of, spread, Set/Map construction) on an array of exactly the served ledger's
 * length. The fixture's own arrays are excluded by identity; the mock pages them with findIndex/slice, which are not counted.
 */
async function countLedgerPasses<T>(lengths: ReadonlySet<number>, exclude: readonly unknown[], run: () => Promise<T>): Promise<{ result: T; passes: number }> {
  const proto = Array.prototype as unknown as Record<string | symbol, (...args: unknown[]) => unknown>;
  const names: Array<string | symbol> = ['filter', 'find', 'some', 'every', 'map', 'flatMap', 'forEach', 'reduce', 'values', 'entries', Symbol.iterator];
  const originals = new Map(names.map(name => [name, proto[name]]));
  let passes = 0;
  for (const name of names) {
    const original = originals.get(name)!;
    Object.defineProperty(Array.prototype, name, { configurable: true, writable: true, value: function (this: unknown[], ...args: unknown[]) {
      if (lengths.has(this.length) && !exclude.includes(this)) passes++;
      return original.apply(this, args);
    } });
  }
  try { return { result: await run(), passes }; } finally {
    for (const name of names) Object.defineProperty(Array.prototype, name, { configurable: true, writable: true, value: originals.get(name) });
  }
}

describe('#2286 purchase capture at ten times the volume', () => {
  const fixture = buildFixture();

  it('AC-CAPV-002 the fixture stays inside the twenty-page reads, so the golden is a complete reading', () => {
    assertEquals(fixture.sources.length, 1000);
    assertEquals(fixture.ledger.length <= 10000, true, `${fixture.ledger.length} lines`);
    assertEquals(fixture.ledger.length > 9000, true, `${fixture.ledger.length} lines`);
  });

  it('AC-CAPV-002 the whole-org preview and report equal the stored golden response', async () => {
    const actual = { preview: (await runAction(handlePurchaseCaptureRequest, fixture, auth, 'preview')).body,
      report: (await runAction(handlePurchaseCaptureRequest, fixture, auth, 'report')).body };
    const resolved = { preview: await resolveDigest(actual.preview), report: await resolveDigest(actual.report) };
    if (Deno.env.get('UPDATE_GOLDEN') === '1') await Deno.writeTextFile(GOLDEN, JSON.stringify(resolved, null, 1) + '\n');
    const golden = JSON.parse(await Deno.readTextFile(GOLDEN));
    for (const action of ['preview', 'report'] as const) {
      assertEquals(resolved[action].summary, golden[action].summary, `${action} summary`);
      for (const field of GOLDEN_FIELDS) assertEquals(resolved[action].sha256[field], golden[action].sha256[field], `${action}.${field}`);
    }
  });

  it('NFR-CAPV-003 a whole-org preview walks the ledger at most three times, never once per source or per project', async () => {
    const lengths = new Set([fixture.ledger.length, fixture.ledger.filter(row => captureRelevant(row)).length]);
    const { result, passes } = await countLedgerPasses(lengths, [fixture.ledger], () => runAction(handlePurchaseCaptureRequest, fixture, auth, 'preview'));
    assertEquals(Array.isArray(result.body.proposals), true);
    assertEquals(passes <= 3, true, `${passes} passes over the ledger`);
  });
});
