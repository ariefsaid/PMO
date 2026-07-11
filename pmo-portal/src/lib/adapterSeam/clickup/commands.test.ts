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
