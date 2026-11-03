import { describe, it, expect, vi } from 'vitest';
import { commitClickUpTaskCommand, type ClickUpCommandDeps } from './commands.ts';
import { AdapterError } from '../contract.ts';
import type { AdapterCommand } from '../contract.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = {
  pmoToClickUp: { 'pmo-user-1': 111 },
  clickUpToPmo: { 111: 'pmo-user-1' },
};

function baseDeps(fetchImpl: typeof fetch, overrides: Partial<ClickUpCommandDeps> = {}): ClickUpCommandDeps {
  return {
    fetchImpl,
    token: 'test-token',
    listId: 'list-1',
    statusMap,
    memberMap,
    resolveExternalId: vi.fn(async () => 'cu-task-1'),
    ...overrides,
  };
}

const clickUpTaskResponse = (over: Record<string, unknown> = {}) => ({
  id: 'cu-task-1',
  name: 'Wire the widget',
  status: { status: 'to do' },
  assignees: [{ id: 111 }],
  start_date: null,
  due_date: null,
  date_updated: '1700000000000',
  ...over,
});

describe('AC-CUA-031 create issues a POST to the List task endpoint with the mapping-set body', () => {
  it('AC-CUA-031 POSTs /list/{list_id}/task and returns the external id + canonical record', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/list/list-1/task');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        name: 'Wire the widget',
        status: 'to do',
        assignees: [111],
      });
      return new Response(JSON.stringify(clickUpTaskResponse()), { status: 200 });
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: { id: 'pmo-1', name: 'Wire the widget', status: 'To Do', assignee_id: 'pmo-user-1' },
    };
    const result = await commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(result.externalRecordId).toBe('cu-task-1');
    expect(result.canonical).toMatchObject({ id: 'pmo-1', name: 'Wire the widget', status: 'To Do' });
  });

  it('sync-integrity a 5xx while creating attempts the POST exactly once and throws — no duplicate task is minted by an auto-retry', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: { id: 'pmo-1', name: 'Wire the widget', status: 'To Do' },
    };
    await expect(commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch)))
      .rejects.toThrow(AdapterError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // one create attempt — a re-send could duplicate the task
  });
});

describe('AC-CUA-032 update/transition/delete resolve the ClickUp task id from the injected mapping', () => {
  it('AC-CUA-032 update PUTs /task/{id} and returns canonical from ClickUp\'s answer', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/task/cu-task-1');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init?.body as string)).toEqual({ name: 'Renamed widget' });
      return new Response(JSON.stringify(clickUpTaskResponse({ name: 'Renamed widget' })), { status: 200 });
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'update',
      record: { id: 'pmo-1', name: 'Renamed widget' },
    };
    const result = await commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(result.externalRecordId).toBe('cu-task-1');
    expect(result.canonical).toMatchObject({ id: 'pmo-1', name: 'Renamed widget' });
  });

  it('AC-CUA-032 transition PUTs /task/{id} with the mapped status', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/task/cu-task-1');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init?.body as string)).toEqual({ status: 'complete' });
      return new Response(JSON.stringify(clickUpTaskResponse({ status: { status: 'complete' } })), { status: 200 });
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'transition',
      record: { id: 'pmo-1', status: 'Done' },
    };
    const result = await commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(result.canonical.status).toBe('Done');
  });

  it('AC-CUA-032 delete DELETEs /task/{id}', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/task/cu-task-1');
      expect(init?.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    });
    const command: AdapterCommand = { domain: 'tasks', operation: 'delete', record: { id: 'pmo-1' } };
    const result = await commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch));
    expect(result.externalRecordId).toBe('cu-task-1');
    expect(result.canonical.id).toBe('pmo-1');
  });
});

describe('AC-CUA-033 ClickUp rejections/unreachability surface as classified AdapterErrors', () => {
  it('AC-CUA-033 a mocked 400 surfaces AdapterError(commit-rejected, <ClickUp message>)', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ err: 'Status not found' }), { status: 400 }),
    );
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: { id: 'pmo-1', name: 'x', status: 'To Do' },
    };
    const call = commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch));
    await expect(call).rejects.toBeInstanceOf(AdapterError);
    await expect(
      commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch)),
    ).rejects.toMatchObject({ code: 'commit-rejected', message: 'Status not found' });
  });

  it('AC-CUA-033 repeated 5xx surfaces AdapterError(external-unreachable, ...) after the retry budget', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));
      const command: AdapterCommand = { domain: 'tasks', operation: 'delete', record: { id: 'pmo-1' } };
      const resultPromise = commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch));
      // Attach the rejection assertion BEFORE advancing timers, so the rejection never goes
      // unhandled mid-advance (a benign but noisy harness warning otherwise).
      const assertion = expect(resultPromise).rejects.toMatchObject({ code: 'external-unreachable' });
      // withBackoff's default retry budget (3 retries, linear backoff) all run on fake timers —
      // advance well past the worst case so the promise settles without a real multi-second wait.
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('OD-INT-9 parent sync: outbound PMO parent_task_id → ClickUp parent', () => {
  it('create with a RESOLVABLE parent_task_id includes parent in the ClickUp create body', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/list/list-1/task');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body).toMatchObject({
        name: 'Child task',
        status: 'to do',
        assignees: [],
        parent: 'cu-parent-1',
      });
      return new Response(JSON.stringify(clickUpTaskResponse({ id: 'cu-child-1' })), { status: 200 });
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: { id: 'pmo-child-1', name: 'Child task', status: 'To Do', parent_task_id: 'pmo-parent-1' },
    };
    const deps = baseDeps(fetchImpl as unknown as typeof fetch, {
      resolveParentExternalId: vi.fn(async () => 'cu-parent-1'),
    });
    const result = await commitClickUpTaskCommand(command, deps);
    expect(result.externalRecordId).toBe('cu-child-1');
  });

  it('create with a parent that has NO ClickUp mapping is refused before any ClickUp call (never a flat task that PMO records as nested)', async () => {
    const fetchImpl = vi.fn();
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: { id: 'pmo-child-1', name: 'Child task', status: 'To Do', parent_task_id: 'pmo-unknown-parent' },
    };
    const deps = baseDeps(fetchImpl as unknown as typeof fetch, { resolveParentExternalId: vi.fn(async () => null) });
    await expect(commitClickUpTaskCommand(command, deps)).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/not linked to ClickUp/) });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('update to a parent with NO ClickUp mapping is refused before any ClickUp call', async () => {
    const fetchImpl = vi.fn();
    const command: AdapterCommand = { domain: 'tasks', operation: 'update', record: { id: 'pmo-1', parent_task_id: 'pmo-unmapped' } };
    const deps = baseDeps(fetchImpl as unknown as typeof fetch, { resolveParentExternalId: vi.fn(async () => null) });
    await expect(commitClickUpTaskCommand(command, deps)).rejects.toMatchObject({ code: 'commit-rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('update re-parents: setting a new resolved parent includes parent in the update body', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/task/cu-task-1');
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(init?.body as string);
      expect(body).toMatchObject({ parent: 'cu-new-parent' });
      return new Response(JSON.stringify(clickUpTaskResponse()), { status: 200 });
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'update',
      record: { id: 'pmo-1', parent_task_id: 'pmo-new-parent' },
    };
    const deps = baseDeps(fetchImpl as unknown as typeof fetch, {
      resolveParentExternalId: vi.fn(async () => 'cu-new-parent'),
    });
    await commitClickUpTaskCommand(command, deps);
  });

  it('update with parent_task_id: null sends NO parent (ClickUp cannot un-nest a subtask) and stamps nothing', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      expect('parent' in body).toBe(false);
      return new Response(JSON.stringify(clickUpTaskResponse({ parent: 'cu-old-parent' })), { status: 200 });
    });
    const command: AdapterCommand = { domain: 'tasks', operation: 'update', record: { id: 'pmo-1', parent_task_id: null } };
    const result = await commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch));
    expect('parent_task_id' in result.canonical).toBe(false); // the mirror is not told the task is top-level
  });

  it('the canonical parent comes from ClickUp\'s response: confirmed → stamped; not confirmed → left out', async () => {
    const command: AdapterCommand = { domain: 'tasks', operation: 'update', record: { id: 'pmo-1', parent_task_id: 'pmo-new-parent' } };
    const deps = (parent: string | null) =>
      baseDeps(vi.fn(async () => new Response(JSON.stringify(clickUpTaskResponse({ parent })), { status: 200 })) as unknown as typeof fetch, {
        resolveParentExternalId: vi.fn(async () => 'cu-new-parent'),
      });
    expect((await commitClickUpTaskCommand(command, deps('cu-new-parent'))).canonical.parent_task_id).toBe('pmo-new-parent');
    expect('parent_task_id' in (await commitClickUpTaskCommand(command, deps(null))).canonical).toBe(false);
    expect('parent_task_id' in (await commitClickUpTaskCommand(command, deps('cu-somewhere-else'))).canonical).toBe(false);
  });

  it('create stamps the parent only when ClickUp confirms it on the created task', async () => {
    const command: AdapterCommand = { domain: 'tasks', operation: 'create', record: { id: 'pmo-c', name: 'C', status: 'To Do', parent_task_id: 'pmo-p' } };
    const deps = (parent: string | null) =>
      baseDeps(vi.fn(async () => new Response(JSON.stringify(clickUpTaskResponse({ id: 'cu-c', parent })), { status: 200 })) as unknown as typeof fetch, {
        resolveParentExternalId: vi.fn(async () => 'cu-p'),
      });
    expect((await commitClickUpTaskCommand(command, deps('cu-p'))).canonical.parent_task_id).toBe('pmo-p');
    expect('parent_task_id' in (await commitClickUpTaskCommand(command, deps(null))).canonical).toBe(false);
  });

  it('a status transition never sends or resolves a parent, even if the record carries one', async () => {
    const resolveParentExternalId = vi.fn(async () => 'cu-p');
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect('parent' in JSON.parse(init?.body as string)).toBe(false);
      return new Response(JSON.stringify(clickUpTaskResponse({ parent: 'cu-p' })), { status: 200 });
    });
    const command: AdapterCommand = { domain: 'tasks', operation: 'transition', record: { id: 'pmo-1', status: 'Done', parent_task_id: 'pmo-p' } };
    const result = await commitClickUpTaskCommand(command, baseDeps(fetchImpl as unknown as typeof fetch, { resolveParentExternalId }));
    expect(resolveParentExternalId).not.toHaveBeenCalled();
    expect('parent_task_id' in result.canonical).toBe(false);
  });
});
