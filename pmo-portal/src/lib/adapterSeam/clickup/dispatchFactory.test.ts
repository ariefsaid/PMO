import { describe, it, expect, vi } from 'vitest';
import { resolveClickUpDispatchAdapter, type DispatchServiceClient } from './dispatchFactory.ts';
import { ClickUpRateLimiter } from './rateLimit.ts';
import type { AdapterCommand } from '../contract.ts';

function serviceClient(): DispatchServiceClient {
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
            async maybeSingle() {
              if (table === 'external_project_bindings') {
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
});
