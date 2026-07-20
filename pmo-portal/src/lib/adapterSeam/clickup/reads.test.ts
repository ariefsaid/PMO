import { describe, it, expect, vi } from 'vitest';
import {
  clickUpListChangesSinceWatermark,
  clickUpListRawChangesSinceWatermark,
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
