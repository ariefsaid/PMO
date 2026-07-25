import { describe, it, expect, vi } from 'vitest';
import {
  clickUpListChangesSinceWatermark,
  clickUpListRawChangesSinceWatermark,
  clickUpListRawChangesAcrossLists,
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
    let call = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      call += 1;
      expect(url).toContain('date_updated_gt=999'); // inclusive boundary: cursor(1000) - 1ms
      // Live-smoke finding (2026-07-11): without include_closed ClickUp omits closed-status
      // tasks and completions never reach the change-feed. Pin the param on every page read.
      expect(url).toContain('include_closed=true');
      if (call === 1) {
        expect(url).toContain('page=0');
        return new Response(
          JSON.stringify({ tasks: [task('cu-1', '1500'), task('cu-2', '1800')], last_page: false }),
          { status: 200 },
        );
      }
      expect(url).toContain('page=1');
      return new Response(JSON.stringify({ tasks: [task('cu-3', '2000')], last_page: true }), { status: 200 });
    });
    const page = await clickUpListChangesSinceWatermark('tasks', '1000', baseDeps(fetchImpl as unknown as typeof fetch));
    expect(page.changes).toHaveLength(3);
    expect(page.changes.map((r) => r.id)).toEqual(['cu-1', 'cu-2', 'cu-3']);
    expect(page.nextCursor).toBe('2000');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
