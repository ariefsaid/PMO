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
  it('AC-CUA-043 a 404d List keeps its watermark UNTOUCHED while a healthy sibling List still advances (the sweep applies what changed and advances)', async () => {
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
  it('AC-CUA-044 propagates a non-404 error and advances NO List watermark this cycle, even one already read successfully', async () => {
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

describe('claim-first adoption: the sweep forwards the atomic-adopt strategy and resolves the project per mint', () => {
  function recordingStrategy() {
    const order: string[] = [];
    const mints: Array<{ canonicalId: string; projectId: unknown; pmoRecordId: string }> = [];
    const claims: Array<{ externalRecordId: string; pmoRecordId: string }> = [];
    return {
      order,
      mints,
      claims,
      strategy: {
        newPmoRecordId: () => 'pmo-claimed-sweep',
        claimExternalRef: async (mapping: { externalRecordId: string; pmoRecordId: string }) => {
          order.push('claim');
          claims.push({ externalRecordId: mapping.externalRecordId, pmoRecordId: mapping.pmoRecordId });
        },
        mintWithId: async (canonical: { id: string; project_id?: string }, _ms: number, pmoRecordId: string) => {
          order.push('mint');
          mints.push({ canonicalId: canonical.id, projectId: canonical.project_id, pmoRecordId });
        },
        mirrorExists: async () => true,
      },
    };
  }

  it('an unmapped task adopts CLAIM-FIRST: the ref claim precedes the mint and the mint lands in the binding\'s project', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-a/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-adopt-me', '6000')], last_page: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ tasks: [], last_page: true }), { status: 200 });
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });
    const rec = recordingStrategy();

    const result = await runMultiListSweep({
      ...harness.deps,
      bindings: [binding('list-a', 'proj-a')],
      adoptAtomically: rec.strategy,
    });

    expect(result.applied).toBe(1);
    expect(rec.order).toEqual(['claim', 'mint']); // the claim is the adoption lock
    expect(rec.claims).toEqual([{ externalRecordId: 'cu-adopt-me', pmoRecordId: 'pmo-claimed-sweep' }]);
    expect(rec.mints).toEqual([
      { canonicalId: 'pmo-claimed-sweep', projectId: 'proj-a', pmoRecordId: 'pmo-claimed-sweep' },
    ]);
    expect(harness.minted).toEqual([]); // the legacy mint-then-ref path is not used
  });

  it('a LOSING claim (23505) aborts the sweep cycle before any mint or watermark advance', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-a/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-loser', '6000')], last_page: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ tasks: [], last_page: true }), { status: 200 });
    });
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' } });
    harness.watermarks.set('list-a', '1000');
    const conflict = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });

    await expect(
      runMultiListSweep({
        ...harness.deps,
        bindings: [binding('list-a', 'proj-a')],
        adoptAtomically: {
          newPmoRecordId: () => 'pmo-lose',
          claimExternalRef: async () => {
            throw conflict;
          },
          mintWithId: async () => {
            throw new Error('mintWithId must never run after a lost claim');
          },
          mirrorExists: async () => true,
        },
      }),
    ).rejects.toMatchObject({ code: '23505' });

    // No mirror was minted and the cursor stays where it was — the next tick reconciles to the winner.
    expect(harness.minted).toEqual([]);
    expect(harness.watermarks.get('list-a')).toBe('1000');
  });
});

describe('mapped tasks resolve current status, parent and project through the shared inbound routine', () => {
  const stickyStatusMap: ClickUpStatusMap = { ...statusMap, pmoOnlyStatuses: ['Blocked'] };
  const stickyBinding = (listId: string, projectId: string): MultiListSweepBinding => ({
    listId,
    projectId,
    statusMap: stickyStatusMap,
    memberMap,
  });
  const listOf = (...tasks: Array<ReturnType<typeof task>>) =>
    (async () => new Response(JSON.stringify({ tasks, last_page: true }), { status: 200 })) as unknown as typeof fetch;

  function recordCanonicals() {
    const canonicals: Array<Record<string, unknown>> = [];
    return {
      canonicals,
      updateMirror: async (_id: string, canonical: Record<string, unknown>) => {
        canonicals.push(canonical);
      },
    };
  }

  it('a pmo-only mirror status survives an unrelated inbound change (readMirrorStatus is consulted)', async () => {
    const rec = recordCanonicals();
    const harness = makeFakeDeps({
      clientDeps: { fetchImpl: listOf(task('cu-1', '3000')), token: 't' },
      updateMirror: rec.updateMirror,
      readMirrorStatus: async () => 'Blocked',
    });
    harness.mirrorByExternalId.set('cu-1', 'pmo-1');
    harness.mirrorProjectByPmoId.set('pmo-1', 'proj-a');

    await runMultiListSweep({ ...harness.deps, bindings: [stickyBinding('list-a', 'proj-a')] });

    expect(rec.canonicals[0].status).toBe('Blocked');
  });

  it('a task with no ClickUp parent leaves parent_task_id omitted so a linked PMO subtask is not flattened', async () => {
    const rec = recordCanonicals();
    const harness = makeFakeDeps({
      clientDeps: { fetchImpl: listOf(task('cu-1', '3000')), token: 't' },
      updateMirror: rec.updateMirror,
      resolveParentPmoId: async () => 'pmo-parent',
    });
    harness.mirrorByExternalId.set('cu-1', 'pmo-1');
    harness.mirrorProjectByPmoId.set('pmo-1', 'proj-a');

    await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect('parent_task_id' in rec.canonicals[0]).toBe(false);
  });

  it('a ClickUp parent resolves to its PMO id on an update; a parent in another project is refused', async () => {
    const rec = recordCanonicals();
    const harness = makeFakeDeps({
      clientDeps: {
        fetchImpl: listOf(task('cu-1', '3000', { parent: 'cu-p1' }), task('cu-2', '3000', { parent: 'cu-p2' })),
        token: 't',
      },
      updateMirror: rec.updateMirror,
      resolveParentPmoId: async (id) => (id === 'cu-p1' ? 'pmo-p1' : 'pmo-p2'),
    });
    harness.mirrorByExternalId.set('cu-1', 'pmo-1');
    harness.mirrorByExternalId.set('cu-2', 'pmo-2');
    harness.mirrorProjectByPmoId.set('pmo-1', 'proj-a');
    harness.mirrorProjectByPmoId.set('pmo-2', 'proj-a');
    harness.mirrorProjectByPmoId.set('pmo-p1', 'proj-a');
    harness.mirrorProjectByPmoId.set('pmo-p2', 'proj-other');

    await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect(rec.canonicals.map((c) => c.parent_task_id)).toEqual(['pmo-p1', null]);
  });

  it('an adopted subtask reaches the mint with its resolved parent', async () => {
    const mintedParents: unknown[] = [];
    const harness = makeFakeDeps({
      clientDeps: { fetchImpl: listOf(task('cu-new', '3000', { parent: 'cu-p1' })), token: 't' },
      resolveParentPmoId: async () => 'pmo-p1',
      mintMirror: async (canonical) => {
        mintedParents.push(canonical.parent_task_id);
        return 'pmo-new';
      },
    });
    harness.mirrorProjectByPmoId.set('pmo-p1', 'proj-a');

    await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect(mintedParents).toEqual(['pmo-p1']);
  });
});

describe('ADP-023 an incomplete List read is reported and advances only to its partial cursor', () => {
  /** Two rows per answer, always newer than the requested `date_updated_gt`: the feed never ends. */
  const endless = () =>
    vi.fn(async (url: string) => {
      const gt = Number(new URL(url).searchParams.get('date_updated_gt'));
      return new Response(
        JSON.stringify({ tasks: [task(`cu-${gt + 1}`, String(gt + 1)), task(`cu-${gt + 2}`, String(gt + 2))], last_page: false }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
  /** A tie that never ends: every answer is a full page of rows sharing one timestamp. */
  const endlessTie = () =>
    vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get('page');
      return new Response(JSON.stringify({ tasks: [task(`cu-${page}-a`, '5000'), task(`cu-${page}-b`, '5000')], last_page: false }), { status: 200 });
    }) as unknown as typeof fetch;
  const oneTask = () =>
    vi.fn(async () => new Response(JSON.stringify({ tasks: [task('cu-1', '5000')], last_page: true }), { status: 200 })) as unknown as typeof fetch;

  it('flags the List incomplete, applies what was read, and stores the partial cursor', async () => {
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: endless(), token: 't' } });
    harness.watermarks.set('list-a', '10000');

    const result = await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect(result.perList[0]).toMatchObject({ listId: 'list-a', incomplete: true, nextCursor: '10010' });
    expect(result.applied).toBe(11);
    expect(harness.watermarks.get('list-a')).toBe('10010');
  });

  it('a plain stored cursor plus a tie wider than the page cap advances the watermark to the page offset', async () => {
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: endlessTie(), token: 't' } });
    harness.watermarks.set('list-a', '5000');

    const result = await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect(result.perList[0]).toMatchObject({ incomplete: true, nextCursor: '5000:10' });
    expect(harness.watermarks.get('list-a')).toBe('5000:10');
  });

  it('a drained tie replaces the stored offset cursor with the plain timestamp (the offset is not kept forever)', async () => {
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: oneTask(), token: 't' } });
    harness.watermarks.set('list-a', '5000:2000');

    await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')] });

    expect(harness.watermarks.get('list-a')).toBe('5000');
  });

  it('a cursor another sweep advanced while this one ran is never rewound', async () => {
    const harness = makeFakeDeps({ clientDeps: { fetchImpl: oneTask(), token: 't' } });
    harness.watermarks.set('list-a', '5000');
    let reads = 0;
    const deps = {
      ...harness.deps,
      // the first read is this run's own start cursor; the re-read before the write sees a concurrent run's progress
      readListWatermark: async () => (reads++ === 0 ? '5000' : '5000:7'),
    };

    await runMultiListSweep({ ...deps, bindings: [binding('list-a', 'proj-a')] });

    expect(harness.watermarks.get('list-a')).toBe('5000:7');
  });

  it('a read deadline that has already passed reads nothing, reports the List incomplete and moves no cursor', async () => {
    const fetchImpl = endless();
    const harness = makeFakeDeps({ clientDeps: { fetchImpl, token: 't' } });
    harness.watermarks.set('list-a', '10000');

    const result = await runMultiListSweep({ ...harness.deps, bindings: [binding('list-a', 'proj-a')], readDeadlineAtMs: Date.now() - 1 });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.perList[0]).toMatchObject({ incomplete: true, nextCursor: null });
    expect(harness.watermarks.get('list-a')).toBe('10000');
  });
});
