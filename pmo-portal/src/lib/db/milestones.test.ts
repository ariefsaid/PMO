import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DAL tests for milestones.ts (AC-DEL-008..011, FR-DEL-008..011).
 * Uses a hoisted chainable mock for supabase.from (write paths) + supabase.rpc (read paths).
 */
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const rpcResult = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as string[],
    rpc: [] as Array<[string, unknown]>,
    insert: [] as unknown[],
    update: [] as unknown[],
    eq: [] as unknown[],
    delete: 0,
    select: 0,
    single: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'select' || name === 'single') {
      (calls[name] as number)++;
    } else if (name === 'insert' || name === 'update') {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    } else if (name === 'eq') {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);

  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  const rpc = vi.fn((name: string, args: unknown) => {
    calls.rpc.push([name, args]);
    return Promise.resolve(rpcResult.value);
  });
  return { from, rpc, calls, result, rpcResult };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: h.from, rpc: h.rpc },
}));

import {
  listMilestones,
  getProjectsDelivery,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  updateTaskMilestone,
} from './milestones';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
  h.rpcResult.value = { data: null, error: null };
});

// ── listMilestones ────────────────────────────────────────────────────────────

describe('AC-DEL-008 listMilestones', () => {
  it('AC-DEL-008: calls get_project_milestones RPC with p_project_id, never sends org_id', async () => {
    h.rpcResult.value = {
      data: [
        {
          id: 'm1', project_id: 'p1', name: 'Engineering design', sort_order: 0,
          target_date: '2026-09-01', weight: 1, input_pct: null,
          task_count: 3, calculated_pct: 66.67, effective_pct: 66.67,
        },
      ],
      error: null,
    };
    const rows = await listMilestones('p1');
    expect(h.calls.rpc[0]).toEqual(['get_project_milestones', { p_project_id: 'p1' }]);
    expect(JSON.stringify(h.calls.rpc)).not.toContain('org_id');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Engineering design');
    expect(rows[0].calculated_pct).toBeCloseTo(66.67);
    expect(rows[0].effective_pct).toBeCloseTo(66.67);
    expect(rows[0].task_count).toBe(3);
  });

  it('AC-DEL-009: null calculated_pct / null input_pct are normalised to null / 0', async () => {
    h.rpcResult.value = {
      data: [
        {
          id: 'm2', project_id: 'p1', name: 'No-tasks milestone', sort_order: 1,
          target_date: null, weight: 1, input_pct: null,
          task_count: 0, calculated_pct: null, effective_pct: 0,
        },
      ],
      error: null,
    };
    const [row] = await listMilestones('p1');
    expect(row.calculated_pct).toBeNull();
    expect(row.input_pct).toBeNull();
    expect(row.effective_pct).toBe(0);
  });

  it('AC-DEL-008: returns [] when RPC returns null data', async () => {
    h.rpcResult.value = { data: null, error: null };
    await expect(listMilestones('p1')).resolves.toEqual([]);
  });

  it('AC-DEL-008: throws AppError preserving PG code on RPC error', async () => {
    h.rpcResult.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listMilestones('p1')).rejects.toMatchObject({ code: '42501' });
    await expect(listMilestones('p1')).rejects.toBeInstanceOf(AppError);
  });
});

// ── getProjectsDelivery ───────────────────────────────────────────────────────

describe('AC-DEL-017 getProjectsDelivery', () => {
  it('AC-DEL-017: calls get_projects_delivery RPC with p_ids, maps rows to a {project_id:pct} map', async () => {
    h.rpcResult.value = {
      data: [
        { project_id: 'p1', delivery_pct: 75 },
        { project_id: 'p2', delivery_pct: 32 },
      ],
      error: null,
    };
    const map = await getProjectsDelivery(['p1', 'p2']);
    expect(h.calls.rpc[0]).toEqual(['get_projects_delivery', { p_ids: ['p1', 'p2'] }]);
    expect(map).toEqual({ p1: 75, p2: 32 });
  });

  it('AC-DEL-007: returns {} without making an RPC call when ids is empty (no N+1 guard)', async () => {
    const result = await getProjectsDelivery([]);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(result).toEqual({});
  });

  it('AC-DEL-017: rows with null delivery_pct are excluded from the map (absent key = no chip)', async () => {
    h.rpcResult.value = {
      data: [
        { project_id: 'p1', delivery_pct: 50 },
        { project_id: 'p2', delivery_pct: null },
      ],
      error: null,
    };
    const map = await getProjectsDelivery(['p1', 'p2']);
    expect(map).toHaveProperty('p1', 50);
    expect(map).not.toHaveProperty('p2');
  });

  it('AC-DEL-017: throws AppError on RPC error', async () => {
    h.rpcResult.value = { data: null, error: { message: 'rpc error', code: '42P01' } };
    await expect(getProjectsDelivery(['p1'])).rejects.toBeInstanceOf(AppError);
    await expect(getProjectsDelivery(['p1'])).rejects.toMatchObject({ code: '42P01' });
  });
});

// ── createMilestone ───────────────────────────────────────────────────────────

describe('AC-DEL-008 createMilestone', () => {
  it('AC-DEL-008: inserts project_id/name/sort_order/target_date/weight; NEVER org_id; returns new row', async () => {
    const newRow = {
      id: 'm1', org_id: 'org1', project_id: 'p1', name: 'Phase 1',
      sort_order: 0, target_date: '2026-09-01', weight: 2, input_pct: null, created_at: '2026-06-11',
    };
    h.result.value = { data: newRow, error: null };
    const row = await createMilestone(
      { name: 'Phase 1', sort_order: 0, target_date: '2026-09-01', weight: 2 },
      'p1',
    );
    expect(h.calls.from).toEqual(['project_milestones']);
    const insertPayload = h.calls.insert[0] as Record<string, unknown>;
    expect(insertPayload).toMatchObject({ project_id: 'p1', name: 'Phase 1', sort_order: 0, weight: 2 });
    expect(insertPayload).not.toHaveProperty('org_id');
    expect(insertPayload.input_pct).toBeUndefined(); // never sent on create
    expect(h.calls.single).toBe(1);
    expect(row.name).toBe('Phase 1');
  });

  it('AC-DEL-008: null/empty target_date is normalised to null in the insert', async () => {
    h.result.value = { data: { id: 'm2' }, error: null };
    await createMilestone({ name: 'Untimed', sort_order: 0, target_date: null, weight: 1 }, 'p1');
    const insertPayload = h.calls.insert[0] as Record<string, unknown>;
    expect(insertPayload.target_date).toBeNull();
  });

  it('AC-DEL-008: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(
      createMilestone({ name: 'X', sort_order: 0, target_date: null, weight: 1 }, 'p1'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      createMilestone({ name: 'X', sort_order: 0, target_date: null, weight: 1 }, 'p1'),
    ).rejects.toBeInstanceOf(AppError);
  });
});

// ── updateMilestone ───────────────────────────────────────────────────────────

describe('AC-DEL-009 updateMilestone', () => {
  it('AC-DEL-009: sends only the keys present in the patch, never org_id/project_id', async () => {
    h.result.value = { data: null, error: null };
    await updateMilestone('m1', { name: 'Renamed', weight: 3 });
    expect(h.calls.from).toEqual(['project_milestones']);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ name: 'Renamed', weight: 3 });
    expect(patch).not.toHaveProperty('org_id');
    expect(patch).not.toHaveProperty('project_id');
    expect(patch).not.toHaveProperty('input_pct'); // not in patch
  });

  it('AC-DEL-009: input_pct: null in patch explicitly clears it (FR-DEL-009 clear path)', async () => {
    h.result.value = { data: null, error: null };
    await updateMilestone('m1', { input_pct: null });
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toHaveProperty('input_pct', null);
  });

  it('AC-DEL-009: omitting input_pct from patch does NOT send it (absent key never sent)', async () => {
    h.result.value = { data: null, error: null };
    await updateMilestone('m1', { name: 'Only rename' });
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('input_pct');
  });

  it('AC-DEL-009: throws AppError on update error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(updateMilestone('m1', { name: 'X' })).rejects.toBeInstanceOf(AppError);
    await expect(updateMilestone('m1', { name: 'X' })).rejects.toMatchObject({ code: '42501' });
  });
});

// ── deleteMilestone ───────────────────────────────────────────────────────────

describe('AC-DEL-021 deleteMilestone', () => {
  it('AC-DEL-021: hard-deletes by id from project_milestones (FK SET NULL un-groups tasks)', async () => {
    h.result.value = { data: null, error: null };
    await deleteMilestone('m1');
    expect(h.calls.from).toEqual(['project_milestones']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'm1']);
  });

  it('AC-DEL-021: throws AppError on delete error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(deleteMilestone('m1')).rejects.toBeInstanceOf(AppError);
  });
});

// ── updateTaskMilestone ───────────────────────────────────────────────────────

describe('AC-DEL-011 updateTaskMilestone', () => {
  it('AC-DEL-011: updates tasks.milestone_id by taskId; null ungroups; NEVER sends org_id', async () => {
    h.result.value = { data: null, error: null };
    await updateTaskMilestone('t1', 'm1');
    expect(h.calls.from).toEqual(['tasks']);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ milestone_id: 'm1' });
    expect(patch).not.toHaveProperty('org_id');
    expect(h.calls.eq).toContainEqual(['id', 't1']);
  });

  it('AC-DEL-011: null milestoneId explicitly ungroups the task (clears milestone_id)', async () => {
    h.result.value = { data: null, error: null };
    await updateTaskMilestone('t1', null);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch).toMatchObject({ milestone_id: null });
  });

  it('AC-DEL-011: throws AppError on update error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(updateTaskMilestone('t1', 'm1')).rejects.toBeInstanceOf(AppError);
  });
});
