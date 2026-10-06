import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { recordHistoryRepository } from '../recordHistory';

const change = (seq: number, at: string, extra: Record<string, unknown> = {}) => ({
  source: 'change', seq, event_id: `e${seq}`, entity_type: 'project', entity_id: 'p1', parent_type: null,
  parent_id: null, op: 'update', action: null, actor_id: 'u1', changes: { name: { old: 'A', new: 'B' } },
  detail: null, currency: 'USD', created_at: at, ...extra,
});
const audit = (id: string, at: string) => ({
  source: 'audit', seq: null, event_id: id, entity_type: 'project', entity_id: 'p1', parent_type: null,
  parent_id: null, op: null, action: 'project_document.create', actor_id: 'u2', changes: null,
  detail: { title: 'Spec' }, currency: null, created_at: at,
});

describe('recordHistoryRepository.list', () => {
  beforeEach(() => rpc.mockReset());

  it('AC-CHG-017: calls the read RPC with the record, filters and cursor — never an org_id', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await recordHistoryRepository.list({
      entityType: 'project', entityId: 'p1', includeChildren: true, entityTypes: ['task'],
      cursor: { seq: 9, at: '2026-10-06T10:00:00Z' }, limit: 25,
    });
    expect(rpc).toHaveBeenCalledWith('list_record_history', {
      p_entity_type: 'project', p_entity_id: 'p1', p_include_children: true, p_entity_types: ['task'],
      p_before_seq: 9, p_before_at: '2026-10-06T10:00:00Z', p_limit: 25,
    });
    expect(JSON.stringify(rpc.mock.calls[0])).not.toMatch(/org_id/);
  });

  it('AC-CHG-017: an Admin result merges audit lines in order; the audit line is mapped as source audit', async () => {
    rpc.mockResolvedValue({
      data: [change(5, '2026-10-06T10:05:00Z'), audit('a1', '2026-10-06T10:03:00Z')], error: null,
    });
    const page = await recordHistoryRepository.list({ entityType: 'project', entityId: 'p1' });
    expect(page.events.map((e) => [e.source, e.id])).toEqual([['change', 'e5'], ['audit', 'a1']]);
    expect(page.events[1]).toMatchObject({ action: 'project_document.create', actorId: 'u2', seq: null });
    expect(page.events[0].changes.name).toEqual({ old: 'A', new: 'B' });
  });

  it('AC-CHG-017: a non-Admin result (RPC returns no audit rows) shows none', async () => {
    rpc.mockResolvedValue({ data: [change(5, '2026-10-06T10:05:00Z')], error: null });
    const page = await recordHistoryRepository.list({ entityType: 'project', entityId: 'p1' });
    expect(page.events.some((e) => e.source === 'audit')).toBe(false);
  });

  it('AC-CHG-016: a full page of change rows yields a next cursor (smallest seq / created_at); a short page ends', async () => {
    rpc.mockResolvedValue({
      data: [change(7, '2026-10-06T10:07:00Z'), change(6, '2026-10-06T10:06:00Z')], error: null,
    });
    const full = await recordHistoryRepository.list({ entityType: 'project', entityId: 'p1', limit: 2 });
    expect(full.nextCursor).toEqual({ seq: 6, at: '2026-10-06T10:06:00Z' });
    const short = await recordHistoryRepository.list({ entityType: 'project', entityId: 'p1', limit: 3 });
    expect(short.nextCursor).toBeNull();
  });

  it('surfaces an RPC error as an AppError carrying the code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: '42501' } });
    await expect(recordHistoryRepository.list({ entityType: 'project', entityId: 'p1' })).rejects.toMatchObject({
      message: 'boom', code: '42501',
    });
  });
});
