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

  it('create with an UNRESOLVABLE parent_task_id omits parent and still creates the task (flat)', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/list/list-1/task');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect('parent' in body).toBe(false); // unresolved parent omitted
      expect(body).toMatchObject({ name: 'Child task', assignees: [] });
      return new Response(JSON.stringify(clickUpTaskResponse({ id: 'cu-child-1' })), { status: 200 });
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: { id: 'pmo-child-1', name: 'Child task', status: 'To Do', parent_task_id: 'pmo-unknown-parent' },
    };
    const deps = baseDeps(fetchImpl as unknown as typeof fetch, {
      resolveParentExternalId: vi.fn(async () => null), // unresolved
    });
    const result = await commitClickUpTaskCommand(command, deps);
    expect(result.externalRecordId).toBe('cu-child-1');
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

  it('update promoting to top-level (parent_task_id: null) sets parent: null in update body', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://api.clickup.com/api/v2/task/cu-task-1');
      expect(init?.method).toBe('PUT');
      const body = JSON.parse(init?.body as string);
      expect(body).toMatchObject({ parent: null });
      return new Response(JSON.stringify(clickUpTaskResponse()), { status: 200 });
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'update',
      record: { id: 'pmo-1', parent_task_id: null },
    };
    const deps = baseDeps(fetchImpl as unknown as typeof fetch, {
      resolveParentExternalId: vi.fn(async () => 'cu-old-parent'), // ignored when null
    });
    await commitClickUpTaskCommand(command, deps);
  });
});