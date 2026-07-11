import { describe, it, expect, vi } from 'vitest';
import { createClickUpAdapter, CLICKUP_TIER, CLICKUP_TASKS_DOMAIN } from './adapter.ts';
import type { ClickUpAdapterDeps } from './adapter.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do' },
  clickUpToPmo: { 'to do': 'To Do' },
  defaultPmoStatus: 'To Do',
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };

function deps(fetchImpl: typeof fetch): ClickUpAdapterDeps {
  return {
    fetchImpl,
    token: 't',
    listId: 'list-1',
    statusMap,
    memberMap,
    resolveExternalId: vi.fn(async () => 'cu-1'),
  };
}

describe('AC-CUA-030 createClickUpAdapter assembles the P0 contract in PMO domain language only', () => {
  it('AC-CUA-030 declares tier "clickup" and a capability map containing exactly the tasks domain', () => {
    const adapter = createClickUpAdapter(deps(vi.fn()));
    expect(adapter.tier).toBe(CLICKUP_TIER);
    expect(adapter.tier).toBe('clickup');
    expect(adapter.capabilityMap).toEqual(new Set(['tasks']));
    expect(CLICKUP_TASKS_DOMAIN).toBe('tasks');
  });

  it('AC-CUA-030 the public surface is typed contract-shape only — no ClickUp field names leak', () => {
    const adapter = createClickUpAdapter(deps(vi.fn()));
    const surfaceKeys = Object.keys(adapter);
    // The adapter contract's own vocabulary (tier/capabilityMap/commit/listChangesSinceWatermark/
    // getByExternalId) — never a ClickUp-specific key (list_id, date_updated, assignees, ...).
    for (const key of surfaceKeys) {
      expect(['tier', 'capabilityMap', 'commit', 'listChangesSinceWatermark', 'getByExternalId']).toContain(key);
    }
    expect(typeof adapter.commit).toBe('function');
    expect(typeof adapter.listChangesSinceWatermark).toBe('function');
    expect(typeof adapter.getByExternalId).toBe('function');
  });

  it('AC-CUA-030 commit() dispatches a create command through to ClickUp REST v2', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: 'cu-1',
          name: 'Widget',
          status: { status: 'to do' },
          assignees: [],
          start_date: null,
          due_date: null,
          date_updated: '1000',
        }),
        { status: 200 },
      ),
    );
    const adapter = createClickUpAdapter(deps(fetchImpl as unknown as typeof fetch));
    const result = await adapter.commit({
      domain: CLICKUP_TASKS_DOMAIN,
      operation: 'create',
      record: { id: 'pmo-1', name: 'Widget', status: 'To Do' },
    });
    expect(result.canonical.id).toBe('pmo-1');
    expect(result.externalRecordId).toBe('cu-1');
  });

  it('AC-CUA-030 listChangesSinceWatermark/getByExternalId route through reads.ts (contract-shape only)', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ tasks: [], last_page: true }), { status: 200 }));
    const adapter = createClickUpAdapter(deps(fetchImpl as unknown as typeof fetch));
    const page = await adapter.listChangesSinceWatermark(CLICKUP_TASKS_DOMAIN, null);
    expect(page).toEqual({ changes: [], nextCursor: null });
  });
});
