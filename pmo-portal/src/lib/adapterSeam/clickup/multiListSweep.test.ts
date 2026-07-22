/**
 * runMultiListSweep — the org-level multi-List sweep orchestrator (read-hygiene round 2).
 * Fixes three findings simultaneously (see multiListSweep.ts docstring):
 *   - SEC-HIGH-1: per-List watermark cursors, advanced independently.
 *   - SEC-HIGH-2: deterministic task->project resolution (a mapped task keeps its existing project;
 *     an unmapped task shared across >1 bound List this cycle is held, not ambiguously adopted).
 *   - SEC-MEDIUM-6: an archived ClickUp task with an existing PMO mirror gets that mirror archived.
 */
import { describe, it, expect, vi } from 'vitest';
import { runMultiListSweep, type MultiListSweepDeps, type MultiListSweepBinding } from './multiListSweep.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };

function task(id: string, dateUpdated: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: `Task ${id}`,
    status: { status: 'to do' },
    assignees: [],
    start_date: null,
    due_date: null,
    date_updated: dateUpdated,
    ...extra,
  };
}

function binding(listId: string, projectId: string): MultiListSweepBinding {
  return { listId, projectId, statusMap, memberMap };
}

/** A minimal in-memory fake of every DB-side callback, so each test can assert exactly what got
 *  written without a real Supabase client. */
function makeFakeDeps(overrides: Partial<MultiListSweepDeps> = {}) {
  const watermarks = new Map<string, string | null>();
  const unhealthy: string[] = [];
  const mirrorProjectByPmoId = new Map<string, string>();
  const mirrorByExternalId = new Map<string, string>(); // externalId -> pmoRecordId
  const sourceModByPmoId = new Map<string, number>();
  const archived: string[] = [];
  const minted: Array<{ name: string; projectId: string }> = [];
  const updated: Array<{ pmoRecordId: string; name: string }> = [];
  let nextMintedId = 1;

  const deps: MultiListSweepDeps = {
    bindings: [],
    clientDeps: { fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch, token: 't' },
    readListWatermark: async (listId) => watermarks.get(listId) ?? null,
    advanceListWatermark: async (listId, cursor) => {
      watermarks.set(listId, cursor);
    },
    markListUnhealthy: async (listId) => {
      unhealthy.push(listId);
    },
    resolvePmoRecordId: async (externalId) => mirrorByExternalId.get(externalId) ?? null,
    readMirrorSourceMod: async (pmoId) => sourceModByPmoId.get(pmoId) ?? null,
    readMirrorProjectId: async (pmoId) => mirrorProjectByPmoId.get(pmoId) ?? null,
    updateMirror: async (pmoRecordId, canonical) => {
      updated.push({ pmoRecordId, name: canonical.name as string });
    },
    mintMirror: async (canonical, _sourceModMs, projectId) => {
      const id = `pmo-${nextMintedId++}`;
      minted.push({ name: canonical.name as string, projectId });
      mirrorProjectByPmoId.set(id, projectId);
      return id;
    },
    recordExternalRef: async (mapping) => {
      mirrorByExternalId.set(mapping.externalRecordId, mapping.pmoRecordId);
    },
    archiveMirror: async (pmoRecordId) => {
      archived.push(pmoRecordId);
    },
    ...overrides,
  };

  return { deps, watermarks, unhealthy, minted, updated, archived, mirrorByExternalId, mirrorProjectByPmoId, sourceModByPmoId };
}

describe('AC-CUA-104: the reconciliation sweep enumerates only bound Lists', () => {
  it('zero bound Lists performs no ClickUp reads or mirror work', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tasks: [] }), { status: 200 }));
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });

    const result = await runMultiListSweep({ ...harness.deps, bindings: [] });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(harness.minted).toEqual([]);
    expect(result).toMatchObject({ applied: 0, archived: 0, perList: [] });
  });
});

describe('SEC-HIGH-1: each bound List advances on its OWN watermark, independent of a sibling List', () => {
  it('a 404d List keeps its watermark UNTOUCHED while a healthy sibling List still advances', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-gone/')) return new Response('not found', { status: 404 });
      if (url.includes('/list/list-ok/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-1', '5000')], last_page: true }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });
    harness.watermarks.set('list-gone', '999');
    harness.watermarks.set('list-ok', '1000');

    const result = await runMultiListSweep({
      ...harness.deps,
      bindings: [binding('list-gone', 'proj-a'), binding('list-ok', 'proj-b')],
    });

    expect(harness.unhealthy).toEqual(['list-gone']);
    // The 404'd List's watermark is EXACTLY what it was before — never touched by list-ok's advance.
    expect(harness.watermarks.get('list-gone')).toBe('999');
    expect(harness.watermarks.get('list-ok')).toBe('5000');
    expect(result.applied).toBe(1);
    expect(result.perList.find((p) => p.listId === 'list-gone')?.notFound).toBe(true);
  });

  it('SEC-HIGH-1 full repro: a List restored after a 404 resumes from ITS OWN cursor, not a sibling List that raced ahead', async () => {
    // Cycle 1: list-a 404s; list-b (a different, healthy List) reports a change at 2000.
    const fetchImplCycle1 = vi.fn(async (url: string) => {
      if (url.includes('/list/list-a/')) return new Response('not found', { status: 404 });
      if (url.includes('/list/list-b/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-b', '2000')], last_page: true }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImplCycle1 as unknown as typeof fetch, token: 't' } });
    harness.watermarks.set('list-a', '1000');
    harness.watermarks.set('list-b', '1000');

    await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a'), binding('list-b', 'proj-b')] });

    expect(harness.watermarks.get('list-a')).toBe('1000'); // untouched
    expect(harness.watermarks.get('list-b')).toBe('2000');

    // Cycle 2: list-a is restored. It must be queried with ITS OWN cursor (1000), not list-b's (2000) —
    // otherwise a real change sitting at 1500 (between 1000 and 2000) would be skipped forever.
    const fetchImplCycle2 = vi.fn(async (url: string) => {
      expect(url).toContain('date_updated_gt=999'); // list-a's own cursor(1000) - 1
      return new Response(JSON.stringify({ tasks: [task('cu-a', '1500')], last_page: true }), { status: 200 });
    });
    const harness2 = makeFakeDeps({ clientDeps: { fetchImpl: fetchImplCycle2 as unknown as typeof fetch, token: 't' } });
    harness2.watermarks.set('list-a', harness.watermarks.get('list-a') ?? null);

    const result2 = await runMultiListSweep({ ...harness2.deps, bindings: [binding('list-a', 'proj-a')] });
    expect(result2.applied).toBe(1); // cu-a IS applied — not lost
    expect(harness2.watermarks.get('list-a')).toBe('1500');
  });
});

describe('SEC-HIGH-2: deterministic task->project resolution under include_timl sharing', () => {
  it('a task already mapped (external_refs) keeps its EXISTING project — never re-guessed off the List tagging it this cycle', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      // The task is now tagged under list-b this cycle, but it was originally adopted into proj-a.
      if (url.includes('/list/list-b/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-shared', '3000')], last_page: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ tasks: [], last_page: true }), { status: 200 });
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });
    harness.mirrorByExternalId.set('cu-shared', 'pmo-existing');
    harness.mirrorProjectByPmoId.set('pmo-existing', 'proj-a');

    const result = await runMultiListSweep({
      ...harness.deps,
      bindings: [binding('list-a', 'proj-a'), binding('list-b', 'proj-b')],
    });

    expect(result.applied).toBe(1);
    expect(harness.updated).toEqual([{ pmoRecordId: 'pmo-existing', name: 'Task cu-shared' }]);
    expect(harness.minted).toEqual([]); // never re-minted under proj-b
  });

  it('an UNMAPPED task seen under more than one bound List this cycle is held (skipped), never adopted ambiguously', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-a/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-new-shared', '4000')], last_page: true }), { status: 200 });
      }
      if (url.includes('/list/list-b/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-new-shared', '4000')], last_page: true }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });

    const result = await runMultiListSweep({
      ...harness.deps,
      bindings: [binding('list-a', 'proj-a'), binding('list-b', 'proj-b')],
    });

    expect(result.skippedAmbiguous).toBe(1);
    expect(result.applied).toBe(0);
    expect(harness.minted).toEqual([]); // never adopted under either project
  });

  it('an UNMAPPED task seen under exactly ONE bound List adopts normally into that List\'s project', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-a/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-solo', '4000')], last_page: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ tasks: [], last_page: true }), { status: 200 });
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });

    const result = await runMultiListSweep({
      ...harness.deps,
      bindings: [binding('list-a', 'proj-a'), binding('list-b', 'proj-b')],
    });

    expect(result.applied).toBe(1);
    expect(harness.minted).toEqual([{ name: 'Task cu-solo', projectId: 'proj-a' }]);
  });
});

describe('SEC-MEDIUM-6: an archived ClickUp task archives its EXISTING PMO mirror', () => {
  it('an archived task with an existing mirror gets that mirror archived', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ tasks: [{ ...task('cu-archived', '5000'), archived: true }], last_page: true }), {
        status: 200,
      }),
    );
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });
    harness.mirrorByExternalId.set('cu-archived', 'pmo-archived-me');

    const result = await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect(harness.archived).toEqual(['pmo-archived-me']);
    expect(result.archived).toBe(1);
  });

  it('an archived task with NO existing mirror is a no-op (nothing to archive)', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ tasks: [{ ...task('cu-archived-unmapped', '5000'), archived: true }], last_page: true }), {
        status: 200,
      }),
    );
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });

    const result = await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect(harness.archived).toEqual([]);
    expect(result.archived).toBe(0);
  });
});

describe('failure isolation: a non-404 read failure aborts the WHOLE cycle (no partial watermark advance)', () => {
  it('propagates a non-404 error and advances NO List watermark this cycle, even one already read successfully', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-a/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-1', '2000')], last_page: true }), { status: 200 });
      }
      return new Response('boom', { status: 500 });
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });
    harness.watermarks.set('list-a', '1000');
    harness.watermarks.set('list-b', '1000');

    await expect(
      runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a'), binding('list-b', 'proj-b')] }),
    ).rejects.toThrow();

    expect(harness.watermarks.get('list-a')).toBe('1000'); // untouched despite reading fine
    expect(harness.watermarks.get('list-b')).toBe('1000');
  });
});
