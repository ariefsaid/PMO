import { describe, it, expect, vi } from 'vitest';
import { resolveClickUpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { ClickUpRateLimiter } from './rateLimit.ts';
import type { AdapterCommand } from '../contract.ts';

function serviceClient(parentRef: 'mapped' | 'unmapped' | 'error' = 'mapped'): DispatchServiceClient {
  return {
    from(table: string) {
      return {
        select(_columns: string) {
          const filters = new Map<string, string>();
          const builder = {
            eq(column: string, value: string) {
              filters.set(column, value);
              return builder;
            },
            is(column: string, value: null) {
              filters.set(column, String(value));
              return builder;
            },
            async maybeSingle() {
              if (table === 'external_project_bindings') {
                expect(filters.get('disconnected_at')).toBe('null');
                return {
                  data: {
                    external_container_id: 'list-1',
                    config: {
                      statusMap: {
                        pmoToClickUp: { 'To Do': 'to do' },
                        clickUpToPmo: { 'to do': 'To Do' },
                        defaultPmoStatus: 'To Do',
                      },
                      memberMap: { pmoToClickUp: {}, clickUpToPmo: {} },
                    },
                  },
                  error: null,
                };
              }
              if (table === 'tasks') {
                return { data: { assignee_id: null }, error: null };
              }
              if (table === 'external_refs') {
                if (parentRef === 'error') return { data: null, error: { message: 'read failed', code: 'XX000' } };
                return { data: parentRef === 'mapped' ? { external_record_id: 'cu-parent' } : null, error: null };
              }
              throw new Error(`unexpected maybeSingle table ${table}`);
            },
            async single() {
              if (table === 'external_refs') {
                expect(filters.get('pmo_record_id')).toBe('pmo-1');
                return { data: { external_record_id: 'cu-1' }, error: null };
              }
              throw new Error(`unexpected single table ${table}`);
            },
          };
          return builder;
        },
      };
    },
  };
}

describe('resolveClickUpDispatchAdapter baseUrl seam', () => {
  it('AC-SEC-A3 resolves only an active project binding', async () => {
    const adapter = await resolveClickUpDispatchAdapter({
      serviceClient: serviceClient(),
      orgId: 'org-1',
      command: { domain: 'tasks', operation: 'delete', record: { id: 'pmo-1', project_id: 'proj-1' } },
      fetchImpl: vi.fn() as unknown as typeof fetch,
      token: 'test-token',
      rateLimiter: new ClickUpRateLimiter(),
    });
    expect(adapter).toBeDefined();
  });

  it('threads an optional baseUrl override into the real adapter client', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://example.test/api/v2/task/cu-1');
      expect(init?.method).toBe('PUT');
      return new Response(
        JSON.stringify({
          id: 'cu-1',
          name: 'Renamed in mock',
          status: { status: 'to do' },
          assignees: [],
          start_date: null,
          due_date: null,
          date_updated: '1700000000000',
        }),
        { status: 200 },
      );
    });
    const command: AdapterCommand = {
      domain: 'tasks',
      operation: 'update',
      record: { id: 'pmo-1', project_id: 'proj-1', name: 'Renamed in mock' },
    };

    const adapter = await resolveClickUpDispatchAdapter({
      serviceClient: serviceClient(),
      orgId: 'org-1',
      command,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      token: 'test-token',
      baseUrl: 'https://example.test/api/v2',
      rateLimiter: new ClickUpRateLimiter(),
    });

    const result = await adapter.commit(command);
    expect(result.externalRecordId).toBe('cu-1');
    expect(result.canonical).toMatchObject({ id: 'pmo-1', name: 'Renamed in mock' });
  });

  describe('parent resolution for a command that names a parent', () => {
    const create: AdapterCommand = {
      domain: 'tasks',
      operation: 'create',
      record: { id: 'pmo-c', project_id: 'proj-1', name: 'C', status: 'To Do', parent_task_id: 'pmo-parent' },
    };
    const adapterFor = (parentRef: 'mapped' | 'unmapped' | 'error', fetchImpl: typeof fetch) =>
      resolveClickUpDispatchAdapter({
        serviceClient: serviceClient(parentRef),
        orgId: 'org-1',
        command: create,
        fetchImpl,
        token: 't',
        rateLimiter: new ClickUpRateLimiter(),
      });

    it('a parent with no external_refs row is refused with a clear message and nothing reaches ClickUp', async () => {
      const fetchImpl = vi.fn();
      const adapter = await adapterFor('unmapped', fetchImpl as unknown as typeof fetch);
      await expect(adapter.commit(create)).rejects.toMatchObject({ code: 'commit-rejected', message: expect.stringMatching(/not linked to ClickUp/) });
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('a failed external_refs read is an error, not "unmapped"', async () => {
      const fetchImpl = vi.fn();
      const adapter = await adapterFor('error', fetchImpl as unknown as typeof fetch);
      await expect(adapter.commit(create)).rejects.toMatchObject({ code: 'XX000' });
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });
});
