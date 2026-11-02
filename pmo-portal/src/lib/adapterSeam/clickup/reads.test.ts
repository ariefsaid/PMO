import { describe, it, expect, vi } from 'vitest';
import {
  clickUpListChangesSinceWatermark,
  clickUpListRawChangesSinceWatermark,
  clickUpListRawChangesAcrossLists,
  laterReadCursor,
  SWEEP_LIST_PAGE_CAP,
  clickUpGetByExternalId,
  clickUpGetTaskRaw,
  type ClickUpReadDeps,
} from './reads.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ClickUpClientDeps } from './client.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };

function task(id: string, dateUpdated: string) {
  return {
    id,
    name: `Task ${id}`,
    status: { status: 'to do' },
    assignees: [],
    start_date: null,
    due_date: null,
    date_updated: dateUpdated,
  };
}

function baseDeps(fetchImpl: typeof fetch): ClickUpReadDeps {
  return { fetchImpl, token: 't', listId: 'list-1', statusMap, memberMap };
}


type FakeTask = ReturnType<typeof task>;

/**
 * An in-memory ClickUp list endpoint that honours `date_updated_gt`, `page` and `reverse` like the real
 * one (page-size rows, `last_page` on the final page). `reverseMeansOldestFirst: false` models a server
 * whose `reverse=true` is newest-first; `listPagesBackwards` keeps each page the OLDEST window but lists
 * its rows newest-first. `onRequest(n)` runs before the n-th request is answered (to edit tasks mid-read).
 */
function listServer(
  initial: FakeTask[],
  opts: { pageSize: number; reverseMeansOldestFirst?: boolean; listPagesBackwards?: boolean; onRequest?: (n: number, tasks: FakeTask[]) => void },
) {
  const tasks = [...initial];
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    urls.push(url);
    opts.onRequest?.(urls.length, tasks);
    const q = new URL(url).searchParams;
    const gt = q.has('date_updated_gt') ? Number(q.get('date_updated_gt')) : -1;
    const page = Number(q.get('page'));
    const oldestFirst = (q.get('reverse') === 'true') === (opts.reverseMeansOldestFirst ?? true);
    const rows = tasks
      .filter((t) => Number(t.date_updated) > gt)
      .sort((a, b) => (Number(a.date_updated) - Number(b.date_updated) || a.id.localeCompare(b.id)) * (oldestFirst ? 1 : -1));
    const slice = rows.slice(page * opts.pageSize, (page + 1) * opts.pageSize);
    if (opts.listPagesBackwards) slice.sort((a, b) => Number(b.date_updated) - Number(a.date_updated));
    return new Response(JSON.stringify({ tasks: slice, last_page: (page + 1) * opts.pageSize >= rows.length }), { status: 200 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, urls, tasks };
}

/** Drain a list through capped reads, resuming from each returned cursor, until a read completes. */
async function drain(fetchImpl: typeof fetch, maxPages: number, from: string | null = null) {
  const ids: string[] = [];
  let cursor = from;
  for (let reads = 0; reads < 50; reads += 1) {
    const r = await clickUpListRawChangesSinceWatermark(cursor, { ...baseDeps(fetchImpl), maxPages });
    ids.push(...r.changes.map((t) => t.id));
    cursor = r.nextCursor ?? cursor;
    if (r.complete) return { ids, cursor, reads: reads + 1 };
  }
  throw new Error('did not drain');
}

describe('buildListQuery emits the full non-default-excluding filter set (read-hygiene fix)', () => {
  it('every page read carries include_closed, subtasks, archived, and include_timl', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      // GET /list/{id}/task excludes closed, subtasks, archived, and multi-list tasks BY DEFAULT
      // (ClickUp REST v2). Without all four flags: ClickUp subtasks never reach PMO; archived tasks
      // vanish from the feed while their PMO mirror lives on forever; a task in two Lists is seen or
      // missed depending which List is polled.
      expect(url).toContain('include_closed=true');
      expect(url).toContain('subtasks=true');
      expect(url).toContain('archived=true');
      expect(url).toContain('include_timl=true');
      return new Response(JSON.stringify({ tasks: [], last_page: true }), { status: 200 });
    });
    await clickUpListChangesSinceWatermark('tasks', null, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('AC-CUA-035 listChangesSinceWatermark pages through changes and advances the cursor', () => {
  it('AC-CUA-035 two mocked pages combine into canonical records + a max-date_updated nextCursor', async () => {
    const server = listServer([task('cu-1', '1500'), task('cu-2', '1800'), task('cu-3', '2000')], { pageSize: 2 });
    const page = await clickUpListChangesSinceWatermark('tasks', '1000', baseDeps(server.fetchImpl));
    expect(page.changes.map((r) => r.id)).toEqual(['cu-1', 'cu-2', 'cu-3']);
    expect(page.nextCursor).toBe('2000');
    expect(server.urls).toHaveLength(2);
    expect(server.urls[0]).toContain('date_updated_gt=999'); // inclusive boundary: cursor(1000) - 1ms
    // keyset step: the second page asks past the greatest timestamp read, at page 0 (no offset)
    expect(server.urls[1]).toContain('date_updated_gt=1799');
    expect(server.urls[1]).toContain('page=0');
  });

  it('AC-CUA-035 no changes since the cursor -> empty changes and a null nextCursor (exhaustion)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tasks: [], last_page: true }), { status: 200 }));
    const page = await clickUpListChangesSinceWatermark('tasks', '1000', baseDeps(fetchImpl as unknown as typeof fetch));
    expect(page.changes).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('AC-CUA-035 a null cursor (first sync) omits date_updated_gt entirely', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).not.toContain('date_updated_gt');
      return new Response(JSON.stringify({ tasks: [task('cu-1', '500')], last_page: true }), { status: 200 });
    });
    await clickUpListChangesSinceWatermark('tasks', null, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('archived tasks (present now that archived=true is passed) are excluded from every change set', () => {
  it('an archived task is dropped from listChangesSinceWatermark but still advances the cursor', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tasks: [task('cu-1', '1000'), { ...task('cu-2', '2000'), archived: true }],
          last_page: true,
        }),
        { status: 200 },
      ),
    );
    const page = await clickUpListChangesSinceWatermark('tasks', null, baseDeps(fetchImpl as unknown as typeof fetch));
    // The archived task (cu-2) must never be mirrored as live — no archived_at column exists on this
    // branch to record its real state, so the safe interim behaviour is: don't mirror it at all.
    expect(page.changes.map((r) => r.id)).toEqual(['cu-1']);
    // The cursor still advances past the archived task's date_updated (2000), not just the live one's
    // (1000) — otherwise an org with only-ever-archived changes would re-fetch the same page forever.
    expect(page.nextCursor).toBe('2000');
  });

  it('an archived task is dropped from the raw sweep source too', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ tasks: [{ ...task('cu-1', '1000'), archived: true }], last_page: true }),
        { status: 200 },
      ),
    );
    const page = await clickUpListRawChangesSinceWatermark(null, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(page.changes).toEqual([]);
    expect(page.nextCursor).toBe('1000');
  });

  it('SEC-MEDIUM-6 an archived task id is surfaced separately (not silently discarded) so a caller can archive its mirror', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tasks: [task('cu-1', '1000'), { ...task('cu-2', '2000'), archived: true }],
          last_page: true,
        }),
        { status: 200 },
      ),
    );
    const page = await clickUpListRawChangesSinceWatermark(null, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(page.changes.map((t) => t.id)).toEqual(['cu-1']);
    expect(page.archivedTaskIds).toEqual(['cu-2']);
  });
});

describe('clickUpListRawChangesSinceWatermark — raw tasks + per-row source-mod (sweep source, FR-CUA-049)', () => {
  it('returns the raw ClickUp tasks (with date_updated) + the max-date_updated nextCursor', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ tasks: [task('cu-1', '1500'), task('cu-2', '1800')], last_page: false }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ tasks: [task('cu-3', '2000')], last_page: true }), { status: 200 });
    });
    const page = await clickUpListRawChangesSinceWatermark('1000', baseDeps(fetchImpl as unknown as typeof fetch));
    expect(page.changes.map((t) => t.id)).toEqual(['cu-1', 'cu-2', 'cu-3']);
    // date_updated is preserved per row (the sweep needs it for the source-mod guard).
    expect(page.changes.map((t) => t.date_updated)).toEqual(['1500', '1800', '2000']);
    expect(page.nextCursor).toBe('2000');
  });

  it('a null cursor (first sweep) lists from the start', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).not.toContain('date_updated_gt');
      return new Response(JSON.stringify({ tasks: [task('cu-1', '500')], last_page: true }), { status: 200 });
    });
    const page = await clickUpListRawChangesSinceWatermark(null, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(page.changes).toHaveLength(1);
    expect(page.nextCursor).toBe('500');
  });
});

describe('clickUpListRawChangesAcrossLists — each bound List reads + advances on its OWN cursor (SEC-HIGH-1)', () => {
  it('a deleted/moved List (404) is skipped + reported; the other bound List still enumerates on its own cursor', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-gone/')) {
        return new Response(JSON.stringify({ err: 'List not found' }), { status: 404 });
      }
      if (url.includes('/list/list-ok/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-1', '5000')], last_page: true }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const result = await clickUpListRawChangesAcrossLists(
      [
        { listId: 'list-gone', statusMap, memberMap, cursor: '999' },
        { listId: 'list-ok', statusMap, memberMap, cursor: null },
      ],
      { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' },
    );
    expect(result.notFoundListIds).toEqual(['list-gone']);
    expect(result.changes.map((c) => c.task.id)).toEqual(['cu-1']);
    expect(result.changes.map((c) => c.listId)).toEqual(['list-ok']);
    // SEC-HIGH-1: no merged org-wide cursor — the failed List simply has NO entry (its own prior
    // cursor, '999', is left completely untouched by the caller); only the healthy List's own
    // progress is reported.
    expect(result.perListNextCursor).toEqual({ 'list-ok': '5000' });
    expect('list-gone' in result.perListNextCursor).toBe(false);
  });

  it('SEC-HIGH-1 repro: a List that 404s this cycle keeps ITS OWN cursor when restored — a healthy sibling never advances it', async () => {
    // List A (the org's shared bug scenario) has a real change at date_updated=1500 sitting UNREAD
    // behind its own last-successful cursor. This cycle, A 404s (temporarily unreachable); B is
    // healthy and reports a change at 2000.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/list/list-a/')) return new Response(JSON.stringify({ err: 'not found' }), { status: 404 });
      if (url.includes('/list/list-b/')) {
        return new Response(JSON.stringify({ tasks: [task('cu-b', '2000')], last_page: true }), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    const cycle1 = await clickUpListRawChangesAcrossLists(
      [
        { listId: 'list-a', statusMap, memberMap, cursor: '1000' }, // A's own prior cursor
        { listId: 'list-b', statusMap, memberMap, cursor: '1000' },
      ],
      { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' },
    );
    expect(cycle1.notFoundListIds).toEqual(['list-a']);
    // Only B's cursor is reported to advance — A's is untouched (a caller applying this map never
    // rewrites A's watermark row at all).
    expect(cycle1.perListNextCursor).toEqual({ 'list-b': '2000' });

    // A is restored; the caller re-reads A with its OWN untouched cursor (1000), never B's 2000 —
    // the 1500 change is still within range (date_updated_gt=999), not lost.
    const fetchImpl2 = vi.fn(async (url: string) => {
      expect(url).toContain('date_updated_gt=999'); // A's own cursor (1000) - 1, NOT B's 2000 - 1
      return new Response(JSON.stringify({ tasks: [task('cu-a', '1500')], last_page: true }), { status: 200 });
    });
    const cycle2 = await clickUpListRawChangesAcrossLists(
      [{ listId: 'list-a', statusMap, memberMap, cursor: '1000' }],
      { fetchImpl: fetchImpl2 as unknown as typeof fetch, token: 't' },
    );
    expect(cycle2.changes.map((c) => c.task.id)).toEqual(['cu-a']);
  });

  it('a non-404 failure on one List still propagates (only 404 — a deleted/moved List — is treated as skippable)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ err: 'boom' }), { status: 500 }));
    await expect(
      clickUpListRawChangesAcrossLists([{ listId: 'list-a', statusMap, memberMap, cursor: null }], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        token: 't',
      }),
    ).rejects.toThrow();
  });

  it('every bound List 404ing -> empty changes, all reported not-found, nothing to advance', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ err: 'not found' }), { status: 404 }));
    const result = await clickUpListRawChangesAcrossLists(
      [
        { listId: 'list-a', statusMap, memberMap, cursor: null },
        { listId: 'list-b', statusMap, memberMap, cursor: null },
      ],
      { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' },
    );
    expect(result.notFoundListIds).toEqual(['list-a', 'list-b']);
    expect(result.changes).toEqual([]);
    expect(result.perListNextCursor).toEqual({});
  });

  it('SEC-MEDIUM-6 archived task ids across every List that read successfully are aggregated for the caller to archive', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          tasks: [task('cu-1', '1000'), { ...task('cu-2', '2000'), archived: true }],
          last_page: true,
        }),
        { status: 200 },
      ),
    );
    const result = await clickUpListRawChangesAcrossLists(
      [{ listId: 'list-a', statusMap, memberMap, cursor: null }],
      { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' },
    );
    expect(result.archivedTaskIds).toEqual(['cu-2']);
  });
});

describe('AC-CUA-036 getByExternalId resolves a task or null on a 404', () => {
  it('AC-CUA-036 an existing task resolves to its canonical record', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(task('cu-1', '1000')), { status: 200 }));
    const record = await clickUpGetByExternalId('tasks', 'cu-1', baseDeps(fetchImpl as unknown as typeof fetch));
    expect(record?.id).toBe('cu-1');
  });

  it('AC-CUA-036 a 404 resolves to null (not thrown)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ err: 'Task not found' }), { status: 404 }));
    const record = await clickUpGetByExternalId('tasks', 'cu-missing', baseDeps(fetchImpl as unknown as typeof fetch));
    expect(record).toBeNull();
  });
});

describe('clickUpGetTaskRaw — the WORKER re-GET (OD-INT-11): the RAW task incl. list.id + archived', () => {
  it('GET /task/{id} returns the raw task (list.id + archived preserved, not just the mapped canonical)', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/task/cu-1');
      return new Response(
        JSON.stringify({ ...task('cu-1', '9999'), list: { id: 'list-9' }, archived: true }),
        { status: 200 },
      );
    });
    const deps: ClickUpClientDeps = { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' };
    const raw = await clickUpGetTaskRaw('cu-1', deps);
    expect(raw?.id).toBe('cu-1');
    expect(raw?.date_updated).toBe('9999');
    expect(raw?.list?.id).toBe('list-9');
    expect(raw?.archived).toBe(true);
  });

  it('a 404 (the task no longer exists) resolves to null (not thrown)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ err: 'Task not found' }), { status: 404 }));
    const deps: ClickUpClientDeps = { fetchImpl: fetchImpl as unknown as typeof fetch, token: 't' };
    const raw = await clickUpGetTaskRaw('cu-gone', deps);
    expect(raw).toBeNull();
  });
});

describe('ADP-023 keyset paging: a capped read is incomplete and resumable, and never skips a row', () => {
  const ids = (n: number, ms: (i: number) => number, prefix = 'cu') =>
    Array.from({ length: n }, (_, i) => task(`${prefix}-${String(i).padStart(2, '0')}`, String(ms(i))));

  it('sends reverse=true (oldest first) on the first request', async () => {
    const server = listServer([], { pageSize: 2 });
    await clickUpListRawChangesSinceWatermark(null, baseDeps(server.fetchImpl));
    expect(server.urls[0]).toContain('reverse=true');
  });

  it('editing an already-read task mid-read skips nothing (offset paging would drop the first row of the next page)', async () => {
    const all = ids(6, (i) => 1001 + i);
    const server = listServer(all, {
      pageSize: 2,
      // after page 0 (cu-00, cu-01) is served, cu-00 is edited and moves to the end of the feed
      onRequest: (n, tasks) => {
        if (n === 2) tasks.find((t) => t.id === 'cu-00')!.date_updated = '2000';
      },
    });
    const result = await clickUpListRawChangesSinceWatermark(null, baseDeps(server.fetchImpl));
    expect(result.complete).toBe(true);
    expect([...new Set(result.changes.map((t) => t.id))].sort()).toEqual(all.map((t) => t.id));
    expect(result.changes.find((t) => t.id === 'cu-00')!.date_updated).toBe('2000'); // the edited state wins
    expect(result.nextCursor).toBe('2000');
  });

  it('a tie wider than one page drains inside one read (page offset only within the tie), then moves on', async () => {
    const tie = ids(5, () => 5000, 'tie');
    const server = listServer([...tie, task('later', '6000')], { pageSize: 2 });
    const result = await clickUpListRawChangesSinceWatermark(null, baseDeps(server.fetchImpl));
    expect(result.changes.map((t) => t.id).sort()).toEqual(['later', ...tie.map((t) => t.id)].sort());
    expect(result.complete).toBe(true);
    expect(result.nextCursor).toBe('6000');
  });

  it('a page cap reports incomplete with a keyset cursor, and resuming from it reads every row exactly once more', async () => {
    const all = ids(10, (i) => 1001 + i);
    const server = listServer(all, { pageSize: 2 });
    const first = await clickUpListRawChangesSinceWatermark(null, { ...baseDeps(server.fetchImpl), maxPages: 2 });
    expect(first.complete).toBe(false);
    expect(first.changes).toHaveLength(3); // pages overlap by the boundary row (inclusive re-read)
    expect(first.nextCursor).toBe('1003');
    const drained = await drain(server.fetchImpl, 2, null);
    expect([...new Set(drained.ids)].sort()).toEqual(all.map((t) => t.id));
    expect(drained.cursor).toBe('1010');
  });

  it('a tie wider than the page CAP resumes at its page offset, then drops the offset once drained', async () => {
    const tie = ids(5, () => 5000, 'tie');
    const server = listServer(tie, { pageSize: 2 });
    const r1 = await clickUpListRawChangesSinceWatermark(null, { ...baseDeps(server.fetchImpl), maxPages: 2 });
    expect(r1.complete).toBe(false);
    expect(r1.nextCursor).toBe('5000:2');
    const r2 = await clickUpListRawChangesSinceWatermark(r1.nextCursor, { ...baseDeps(server.fetchImpl), maxPages: 2 });
    expect(server.urls.at(-1)).toContain('date_updated_gt=4999');
    expect(server.urls.at(-1)).toContain('page=2');
    expect(r2.changes.map((t) => t.id)).toEqual(['tie-04']);
    expect(r2.complete).toBe(true);
    expect(r2.nextCursor).toBe('5000');
  });

  it('a deadline already passed reads nothing: incomplete, no cursor to advance', async () => {
    const server = listServer(ids(4, (i) => 1001 + i), { pageSize: 2 });
    const r = await clickUpListRawChangesSinceWatermark(null, { ...baseDeps(server.fetchImpl), deadlineAtMs: Date.now() - 1 });
    expect(server.urls).toHaveLength(0);
    expect(r).toMatchObject({ complete: false, nextCursor: null, changes: [] });
  });

  it('a deadline that passes mid-read stops with a resumable cursor', async () => {
    const server = listServer(ids(10, (i) => 1001 + i), { pageSize: 2 });
    let now = 0;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const timed = (async (...args: Parameters<typeof fetch>) => {
        now += 10; // each request burns 10ms of a 25ms budget
        return server.fetchImpl(...args);
      }) as typeof fetch;
      const r = await clickUpListRawChangesSinceWatermark(null, { ...baseDeps(timed), deadlineAtMs: 25 });
      expect(server.urls).toHaveLength(3);
      expect(r.complete).toBe(false);
      expect(r.nextCursor).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('works when the server answers newest-first under reverse=true: reverse is flipped and every row is read', async () => {
    const all = ids(6, (i) => 1001 + i);
    const server = listServer(all, { pageSize: 2, reverseMeansOldestFirst: false });
    const drained = await drain(server.fetchImpl, 50);
    expect([...new Set(drained.ids)].sort()).toEqual(all.map((t) => t.id));
    expect(server.urls.some((u) => u.includes('reverse=false'))).toBe(true);
  });

  it('works when each page is the oldest window but lists its rows newest-first (no flip needed)', async () => {
    const all = ids(6, (i) => 1001 + i);
    const server = listServer(all, { pageSize: 2, listPagesBackwards: true });
    const drained = await drain(server.fetchImpl, 50);
    expect([...new Set(drained.ids)].sort()).toEqual(all.map((t) => t.id));
    expect(server.urls.every((u) => u.includes('reverse=true'))).toBe(true);
  });

  it('refuses a partial read when the server is newest-first under both reverse settings', async () => {
    const all = ids(6, (i) => 1001 + i);
    const base = listServer(all, { pageSize: 2, reverseMeansOldestFirst: false });
    const alwaysNewestFirst = vi.fn(async (url: string) => base.fetchImpl(url.replace('reverse=false', 'reverse=true'))) as unknown as typeof fetch;
    await expect(clickUpListRawChangesSinceWatermark(null, baseDeps(alwaysNewestFirst))).rejects.toThrow(/newest-first/);
  });

  it('the multi-List read lists every List that came back incomplete', async () => {
    const server = listServer(ids(30, (i) => 10_000 + i), { pageSize: 2 });
    const result = await clickUpListRawChangesAcrossLists(
      [{ listId: 'list-1', statusMap, memberMap, cursor: null }],
      { fetchImpl: server.fetchImpl, token: 't' },
      { maxPagesPerList: 3 },
    );
    expect(result.incompleteListIds).toEqual(['list-1']);
    expect(result.perListNextCursor['list-1']).toBe('10003');
  });

  it('the multi-List read caps each List at SWEEP_LIST_PAGE_CAP pages by default', async () => {
    const server = listServer(ids(60, (i) => 10_000 + i), { pageSize: 2 });
    const result = await clickUpListRawChangesAcrossLists([{ listId: 'list-1', statusMap, memberMap, cursor: null }], {
      fetchImpl: server.fetchImpl,
      token: 't',
    });
    expect(server.urls).toHaveLength(SWEEP_LIST_PAGE_CAP);
    expect(result.incompleteListIds).toEqual(['list-1']);
  });
});

describe('laterReadCursor — a concurrent writer is compared by (timestamp, page offset)', () => {
  it('a higher page offset at the same timestamp wins, in either argument order', () => {
    expect(laterReadCursor('5000', '5000:3')).toBe('5000:3');
    expect(laterReadCursor('5000:3', '5000')).toBe('5000:3');
    expect(laterReadCursor('5000:2', '5000:3')).toBe('5000:3');
  });
  it('a later timestamp beats any offset on an earlier one', () => {
    expect(laterReadCursor('5000:9', '5001')).toBe('5001');
    expect(laterReadCursor('5001', '5000:9')).toBe('5001');
  });
});
