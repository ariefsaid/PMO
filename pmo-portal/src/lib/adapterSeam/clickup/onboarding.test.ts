import { describe, it, expect, vi } from 'vitest';
import {
  provisionBinding,
  pushSeed,
  pullAdopt,
  MIXED_ONBOARDING_MESSAGE,
  type ProvisioningDeps,
  type PushSeedDeps,
  type PullAdoptDeps,
  type ProjectBinding,
} from './onboarding.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

/**
 * Slice E — onboarding both ways (FR-CUA-050/051/052/060/061/062/063/064, AC-CUA-050..053).
 *
 * `onboarding.ts` is a pure, Deno-importable orchestrator (same idiom as commands.ts/reads.ts): it
 * speaks ClickUp vocabulary (confined here) over an injected `fetch`, and reaches PMO-side state
 * (task counts, the read-model, `external_refs`, the watermark, the binding row) ONLY through
 * injected service-client callbacks — so the unit tests mock ClickUp + PMO alike, no live token.
 *
 * The two clean directions (OD-CUA-3): an empty List → push-seed; an empty project → pull-adopt;
 * BOTH non-empty → rejected at provisioning with an operator-facing message.
 */

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = {
  pmoToClickUp: { 'pmo-user-1': 111 },
  clickUpToPmo: { 111: 'pmo-user-1' },
};

const DEFAULT_BASE = 'https://api.clickup.com/api/v2';

/** A canned ClickUp task JSON (the REST v2 shape mapping.ts consumes). */
function clickUpTask(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'cu-task-1',
    name: 'Wire the widget',
    status: { status: 'to do' },
    assignees: [{ id: 111 }],
    start_date: null,
    due_date: null,
    date_updated: '1700000000000',
    ...over,
  };
}

/** Build a mocked `fetch` that dispatches by method + URL substring to canned JSON responses. */
function mockFetch(
  routes: Array<{ method: string; urlIncludes: string; status?: number; json: unknown | (() => unknown) }>,
): { fetchImpl: typeof fetch; calls: { url: string; init: RequestInit | undefined }[] } {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((r) => r.method.toUpperCase() === method && url.includes(r.urlIncludes));
    if (!route) throw new Error(`unexpected ClickUp request ${method} ${url}`);
    const json = typeof route.json === 'function' ? (route.json as () => unknown)() : route.json;
    return new Response(JSON.stringify(json), { status: route.status ?? 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

// ──────────────────────────────────────────────────────────────────────────────
// E1 — provisionBinding + reject-mixed (FR-CUA-063, OD-CUA-3)
// ──────────────────────────────────────────────────────────────────────────────

describe('FR-CUA-063 / OD-CUA-3 provisionBinding — one List per project + reject-mixed direction', () => {
  function baseProvisioningDeps(overrides: Partial<ProvisioningDeps> = {}): ProvisioningDeps {
    return {
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      token: 'test-token',
      target: { kind: 'create', folderId: 'folder-1', name: 'My Project' },
      captureMaps: vi.fn(async () => ({ statusMap, memberMap })),
      countPmoTasks: vi.fn(async () => 0),
      countListTasks: vi.fn(async () => 0),
      upsertBinding: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it('FR-CUA-063 create mode: POSTs a new List under the folder, captures maps, persists the binding, returns push-seed', async () => {
    const { fetchImpl, calls } = mockFetch([
      { method: 'POST', urlIncludes: '/folder/folder-1/list', json: { id: 'list-new', name: 'My Project' } },
    ]);
    const upsertBinding = vi.fn(async () => undefined);
    const deps = baseProvisioningDeps({ fetchImpl, upsertBinding });

    const result = await provisionBinding('proj-1', deps);

    // Created exactly one List under the configured folder.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${DEFAULT_BASE}/folder/folder-1/list`);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ name: 'My Project' });

    // Captured the maps for the freshly-created List.
    expect(deps.captureMaps).toHaveBeenCalledWith('list-new');

    // Persisted the binding row with the List id + captured maps.
    const expectedBinding: ProjectBinding = { projectId: 'proj-1', listId: 'list-new', statusMap, memberMap };
    expect(upsertBinding).toHaveBeenCalledWith(expectedBinding);

    // An empty project + empty List → push-seed direction.
    expect(result.direction).toBe('push-seed');
    expect(result.binding).toEqual(expectedBinding);
  });

  it('FR-CUA-063 bind mode: keeps the existing List id (no create POST), still captures maps + persists', async () => {
    const { fetchImpl, calls } = mockFetch([]);
    const upsertBinding = vi.fn(async () => undefined);
    const deps = baseProvisioningDeps({
      fetchImpl,
      target: { kind: 'bind', listId: 'list-existing' },
      countListTasks: async () => 5,
      upsertBinding,
    });

    const result = await provisionBinding('proj-1', deps);

    expect(calls).toHaveLength(0); // bind mode never creates a List
    expect(deps.captureMaps).toHaveBeenCalledWith('list-existing');
    expect(upsertBinding).toHaveBeenCalledWith({
      projectId: 'proj-1',
      listId: 'list-existing',
      statusMap,
      memberMap,
    });
    // Empty project + non-empty List → pull-adopt direction.
    expect(result.direction).toBe('pull-adopt');
  });

  it('FR-CUA-063 a non-empty project + a fresh empty List → push-seed (the normal seed case)', async () => {
    const { fetchImpl } = mockFetch([
      { method: 'POST', urlIncludes: '/folder/folder-1/list', json: { id: 'list-new' } },
    ]);
    const deps = baseProvisioningDeps({ fetchImpl, countPmoTasks: async () => 3, countListTasks: async () => 0 });
    const result = await provisionBinding('proj-1', deps);
    expect(result.direction).toBe('push-seed');
  });

  it('OD-CUA-3 BOTH project and List non-empty → throws the operator-facing reject-at-provisioning message', async () => {
    const { fetchImpl } = mockFetch([
      { method: 'POST', urlIncludes: '/folder/folder-1/list', json: { id: 'list-new' } },
    ]);
    const upsertBinding = vi.fn(async () => undefined);
    const deps = baseProvisioningDeps({
      fetchImpl,
      countPmoTasks: async () => 3,
      countListTasks: async () => 5,
      upsertBinding,
    });

    await expect(provisionBinding('proj-1', deps)).rejects.toThrow(
      /List and project both non-empty — choose a clean direction/i,
    );
    // Rejected BEFORE persisting a binding (no half-provisioned state).
    expect(upsertBinding).not.toHaveBeenCalled();
  });

  // Security audit LOW (round 2): for `kind: 'create'`, the List is created BEFORE its statuses are
  // fetched/validated. A validation failure must not leave an orphan List sitting in the customer's
  // ClickUp workspace forever — clean it up.
  describe('orphan-List cleanup when a `create`-mode provisioning is rejected after the List already exists', () => {
    it('captureMaps rejects (incomplete status map) → the just-created List is DELETEd, and the rejection still propagates', async () => {
      const { fetchImpl, calls } = mockFetch([
        { method: 'POST', urlIncludes: '/folder/folder-1/list', json: { id: 'list-new' } },
        { method: 'DELETE', urlIncludes: '/list/list-new', json: {} },
      ]);
      const upsertBinding = vi.fn(async () => undefined);
      const deps = baseProvisioningDeps({
        fetchImpl,
        captureMaps: vi.fn(async () => {
          throw new Error('ClickUp List cannot represent every PMO task status');
        }),
        upsertBinding,
      });

      await expect(provisionBinding('proj-1', deps)).rejects.toThrow(
        /cannot represent every PMO task status/i,
      );
      expect(upsertBinding).not.toHaveBeenCalled();

      const deleteCall = calls.find((c) => c.init?.method === 'DELETE');
      expect(deleteCall?.url).toBe(`${DEFAULT_BASE}/list/list-new`);
    });

    it('the mixed-content rejection also cleans up the just-created List', async () => {
      const { fetchImpl, calls } = mockFetch([
        { method: 'POST', urlIncludes: '/folder/folder-1/list', json: { id: 'list-new' } },
        { method: 'DELETE', urlIncludes: '/list/list-new', json: {} },
      ]);
      const deps = baseProvisioningDeps({
        fetchImpl,
        countPmoTasks: async () => 3,
        countListTasks: async () => 5,
      });

      await expect(provisionBinding('proj-1', deps)).rejects.toThrow(MIXED_ONBOARDING_MESSAGE);

      const deleteCall = calls.find((c) => c.init?.method === 'DELETE');
      expect(deleteCall?.url).toBe(`${DEFAULT_BASE}/list/list-new`);
    });

    it('`kind: bind` (an EXISTING List the org already owns) is NEVER deleted on rejection', async () => {
      const { fetchImpl, calls } = mockFetch([]);
      const deps = baseProvisioningDeps({
        fetchImpl,
        target: { kind: 'bind', listId: 'list-existing' },
        captureMaps: vi.fn(async () => {
          throw new Error('ClickUp List cannot represent every PMO task status');
        }),
      });

      await expect(provisionBinding('proj-1', deps)).rejects.toThrow();
      expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
    });

    it('a DELETE cleanup failure is swallowed (logged) — the ORIGINAL rejection still propagates, never masked', async () => {
      // No DELETE route registered -> mockFetch throws "unexpected ClickUp request" for the cleanup
      // call, simulating a network failure during cleanup (fails fast, no retry-loop by construction).
      const { fetchImpl } = mockFetch([
        { method: 'POST', urlIncludes: '/folder/folder-1/list', json: { id: 'list-new' } },
      ]);
      const deps = baseProvisioningDeps({
        fetchImpl,
        captureMaps: vi.fn(async () => {
          throw new Error('ClickUp List cannot represent every PMO task status');
        }),
      });

      // The cleanup DELETE itself fails — the caller still sees the ORIGINAL validation rejection,
      // not a cleanup error masking it.
      await expect(provisionBinding('proj-1', deps)).rejects.toThrow(
        /cannot represent every PMO task status/i,
      );
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// E2 — pushSeed (AC-CUA-050/051/052)
// ──────────────────────────────────────────────────────────────────────────────

describe('AC-CUA-050/051/052 pushSeed — PMO tasks → ClickUp, idempotent + resumable', () => {
  function basePushDeps(overrides: Partial<PushSeedDeps> = {}): PushSeedDeps {
    return {
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      token: 'test-token',
      listId: 'list-1',
      statusMap,
      memberMap,
      listPmoTasks: vi.fn(async () => []),
      resolveExternalId: vi.fn(async () => null),
      recordExternalRef: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  it('AC-CUA-050 empty List: one ClickUp create per PMO task, records external_refs; a re-run creates nothing new', async () => {
    const createCounter = { n: 0 };
    const { fetchImpl } = mockFetch([
      {
        method: 'POST',
        urlIncludes: '/list/list-1/task',
        json: () => clickUpTask({ id: `cu-${++createCounter.n}` }),
      },
    ]);
    const recordExternalRef = vi.fn(async () => undefined);
    const tasks = [
      { id: 'pmo-1', name: 'Task A', status: 'To Do', assignee_id: 'pmo-user-1', start_date: null, end_date: null },
      { id: 'pmo-2', name: 'Task B', status: 'Done', assignee_id: null, start_date: null, end_date: null },
    ];
    const deps = basePushDeps({ fetchImpl, listPmoTasks: async () => tasks, recordExternalRef });

    // First run: both tasks seeded.
    const first = await pushSeed('proj-1', deps);
    expect(first.seeded).toBe(2);
    expect(first.skipped).toBe(0);
    expect(recordExternalRef).toHaveBeenCalledTimes(2);
    expect(recordExternalRef).toHaveBeenNthCalledWith(1, {
      pmoRecordId: 'pmo-1',
      externalTier: 'clickup',
      externalRecordId: 'cu-1',
      domain: 'tasks',
    });
    expect(recordExternalRef).toHaveBeenNthCalledWith(2, {
      pmoRecordId: 'pmo-2',
      externalTier: 'clickup',
      externalRecordId: 'cu-2',
      domain: 'tasks',
    });

    // Re-run with both tasks now mapped → nothing created, nothing recorded (idempotent).
    const rerunDeps = basePushDeps({
      fetchImpl,
      listPmoTasks: async () => tasks,
      resolveExternalId: async (pmoId: string) => (pmoId === 'pmo-1' ? 'cu-1' : 'cu-2'),
      recordExternalRef,
    });
    recordExternalRef.mockClear();
    (fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length = 0;

    const second = await pushSeed('proj-1', rerunDeps);
    expect(second.seeded).toBe(0);
    expect(second.skipped).toBe(2);
    expect(recordExternalRef).not.toHaveBeenCalled();
  });

  it('AC-CUA-051 a partial failure then resume: only the unmapped remainder is created — no duplicates', async () => {
    const tasks = [
      { id: 'pmo-1', name: 'Task A', status: 'To Do', assignee_id: null, start_date: null, end_date: null },
      { id: 'pmo-2', name: 'Task B', status: 'To Do', assignee_id: null, start_date: null, end_date: null },
    ];

    // Partial run: task 1 succeeds + is recorded; task 2's create is rejected mid-batch (a 400
    // commit-rejected — non-transient, so withBackoff does not retry on real timers) → pushSeed
    // throws, leaving task 1's mapping committed as the resumption ledger.
    let attempt = 0;
    const mixedFetch = vi.fn(async (_url: string, _init?: RequestInit) => {
      attempt += 1;
      if (attempt === 1) return new Response(JSON.stringify(clickUpTask({ id: 'cu-1' })), { status: 200 });
      return new Response(JSON.stringify({ err: 'invalid task' }), { status: 400 });
    }) as unknown as typeof fetch;
    const recordExternalRef = vi.fn(async () => undefined);
    const partialDeps = basePushDeps({
      fetchImpl: mixedFetch,
      listPmoTasks: async () => tasks,
      recordExternalRef,
    });

    await expect(pushSeed('proj-1', partialDeps)).rejects.toThrow();
    // task 1 was committed before the failure — external_refs is the resumption ledger.
    expect(recordExternalRef).toHaveBeenCalledTimes(1);
    expect(recordExternalRef).toHaveBeenCalledWith({
      pmoRecordId: 'pmo-1',
      externalTier: 'clickup',
      externalRecordId: 'cu-1',
      domain: 'tasks',
    });

    // Resume: task 1 now mapped (skipped), only task 2 is created — no duplicate for task 1.
    let resumeAttempts = 0;
    const resumeFetch = vi.fn(async (_url: string, _init?: RequestInit) => {
      resumeAttempts += 1;
      return new Response(JSON.stringify(clickUpTask({ id: 'cu-2' })), { status: 200 });
    }) as unknown as typeof fetch;
    recordExternalRef.mockClear();
    const resumeDeps = basePushDeps({
      fetchImpl: resumeFetch,
      listPmoTasks: async () => tasks,
      resolveExternalId: async (pmoId: string) => (pmoId === 'pmo-1' ? 'cu-1' : null),
      recordExternalRef,
    });

    const resumed = await pushSeed('proj-1', resumeDeps);
    expect(resumed.seeded).toBe(1);
    expect(resumed.skipped).toBe(1);
    expect(resumeAttempts).toBe(1); // only task 2 hit ClickUp
    expect(recordExternalRef).toHaveBeenCalledTimes(1);
    expect(recordExternalRef).toHaveBeenCalledWith({
      pmoRecordId: 'pmo-2',
      externalTier: 'clickup',
      externalRecordId: 'cu-2',
      domain: 'tasks',
    });
  });

  it('AC-CUA-052 pushes only the mapping-set fields — no milestone/dependency data is sent to ClickUp', async () => {
    const { fetchImpl, calls } = mockFetch([
      { method: 'POST', urlIncludes: '/list/list-1/task', json: clickUpTask({ id: 'cu-1' }) },
    ]);
    // The PMO task carries enhancement data (milestone grouping + a dependency) that must NOT leak.
    const tasks = [
      {
        id: 'pmo-1',
        name: 'Widget',
        status: 'To Do',
        assignee_id: 'pmo-user-1',
        start_date: null,
        end_date: null,
        milestone_id: 'mil-9',
        dependencies: [{ depends_on: 'pmo-other', type: 'waiting' }],
      },
    ];
    const deps = basePushDeps({ fetchImpl, listPmoTasks: async () => tasks });

    await pushSeed('proj-1', deps);

    const body = JSON.parse(calls[0].init?.body as string) as Record<string, unknown>;
    // Mapping-set only (FR-CUA-010): name, status, assignees. Never milestone_id / dependencies.
    expect(body).toEqual({ name: 'Widget', status: 'to do', assignees: [111] });
    expect(body).not.toHaveProperty('milestone_id');
    expect(body).not.toHaveProperty('dependencies');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// E3 — pullAdopt (AC-CUA-053)
// ──────────────────────────────────────────────────────────────────────────────

describe('AC-CUA-053 pullAdopt — ClickUp tasks → mirrored read-model, idempotent + resumable', () => {
  function basePullDeps(overrides: Partial<PullAdoptDeps> = {}): PullAdoptDeps {
    return {
      fetchImpl: vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      token: 'test-token',
      listId: 'list-1',
      statusMap,
      memberMap,
      readWatermark: vi.fn(async () => null),
      advanceWatermark: vi.fn(async () => undefined),
      resolvePmoRecordId: vi.fn(async () => null),
      mintMirror: vi.fn(async () => 'pmo-new'),
      updateMirror: vi.fn(async () => undefined),
      recordExternalRef: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  /** A two-task ClickUp List page, task B newer than task A. */
  function twoTaskListPage() {
    return {
      tasks: [
        clickUpTask({ id: 'cu-A', name: 'Alpha', date_updated: '1700000000000' }),
        clickUpTask({ id: 'cu-B', name: 'Beta', date_updated: '1700000005000' }),
      ],
      last_page: true,
    };
  }

  it('AC-CUA-053 first run: mints one mirror + mapping per ClickUp task (from a null cursor), advances the watermark', async () => {
    const { fetchImpl } = mockFetch([
      { method: 'GET', urlIncludes: '/list/list-1/task', json: twoTaskListPage() },
    ]);
    const mintMirror = vi.fn(async (canonical: { id: string }) => `pmo-${canonical.id}`);
    const recordExternalRef = vi.fn(async () => undefined);
    const advanceWatermark = vi.fn(async () => undefined);
    const deps = basePullDeps({ fetchImpl, mintMirror, recordExternalRef, advanceWatermark });

    const result = await pullAdopt('proj-1', deps);

    expect(result.adopted).toBe(2);
    expect(mintMirror).toHaveBeenCalledTimes(2);
    expect(recordExternalRef).toHaveBeenCalledTimes(2);
    expect(recordExternalRef).toHaveBeenNthCalledWith(1, {
      pmoRecordId: 'pmo-cu-A',
      externalTier: 'clickup',
      externalRecordId: 'cu-A',
      domain: 'tasks',
    });
    expect(recordExternalRef).toHaveBeenNthCalledWith(2, {
      pmoRecordId: 'pmo-cu-B',
      externalTier: 'clickup',
      externalRecordId: 'cu-B',
      domain: 'tasks',
    });
    // Watermark advanced to the max date_updated observed (monotonic — never rewinds).
    expect(advanceWatermark).toHaveBeenCalledTimes(1);
    expect(advanceWatermark).toHaveBeenCalledWith('1700000005000');
  });

  it('AC-CUA-053 re-run reconciles without duplicating: already-mapped tasks update the mirror, never re-mint', async () => {
    const { fetchImpl } = mockFetch([
      { method: 'GET', urlIncludes: '/list/list-1/task', json: twoTaskListPage() },
    ]);
    const mintMirror = vi.fn(async () => 'pmo-should-not-happen');
    const updateMirror = vi.fn(async () => undefined);
    const recordExternalRef = vi.fn(async () => undefined);
    const deps = basePullDeps({
      fetchImpl,
      // Both ClickUp tasks already mapped → pull-adopt reconciles, it does not adopt again.
      resolvePmoRecordId: async (extId: string) => (extId === 'cu-A' ? 'pmo-A' : 'pmo-B'),
      mintMirror,
      updateMirror,
      recordExternalRef,
    });

    const result = await pullAdopt('proj-1', deps);

    expect(result.adopted).toBe(0); // no NEW mirrors minted
    expect(result.updated).toBe(2); // both existing mirrors refreshed (idempotent upsert)
    expect(mintMirror).not.toHaveBeenCalled();
    expect(recordExternalRef).not.toHaveBeenCalled();
    expect(updateMirror).toHaveBeenCalledTimes(2);
  });

  it('AC-CUA-053 a partial run resumes from the watermark: only post-cursor changes are processed', async () => {
    // The watermark reflects prior partial progress (task A already adopted behind the cursor).
    const { fetchImpl } = mockFetch([
      { method: 'GET', urlIncludes: '/list/list-1/task', json: { tasks: [clickUpTask({ id: 'cu-B', date_updated: '1700000005000' })], last_page: true } },
    ]);
    const mintMirror = vi.fn(async () => 'pmo-cu-B');
    const recordExternalRef = vi.fn(async () => undefined);
    const advanceWatermark = vi.fn(async () => undefined);
    const deps = basePullDeps({
      fetchImpl,
      readWatermark: async () => '1700000000000', // resume past task A
      mintMirror,
      recordExternalRef,
      advanceWatermark,
    });

    const result = await pullAdopt('proj-1', deps);

    expect(result.adopted).toBe(1); // only task B (task A is behind the watermark cursor)
    expect(mintMirror).toHaveBeenCalledTimes(1);
    expect(recordExternalRef).toHaveBeenCalledWith({
      pmoRecordId: 'pmo-cu-B',
      externalTier: 'clickup',
      externalRecordId: 'cu-B',
      domain: 'tasks',
    });
  });
});
