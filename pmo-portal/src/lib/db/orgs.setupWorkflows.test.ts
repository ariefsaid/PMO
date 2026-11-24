import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = { from: [] as string[], select: [] as string[], upsert: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  builder.select = (columns: string) => { calls.select.push(columns); return builder; };
  builder.maybeSingle = () => Promise.resolve(queue.shift() ?? { data: null, error: null });
  builder.upsert = (...args: unknown[]) => { calls.upsert.push(args); return builder; };
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  return { from, calls, queue };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getOrgSetupWorkflowsEnabled, setOrgSetupWorkflowsEnabled } from './orgs';

beforeEach(() => {
  h.from.mockClear();
  h.queue.length = 0;
  h.calls.from.length = 0;
  h.calls.select.length = 0;
  h.calls.upsert.length = 0;
});

describe('organisation setup workflow setting', () => {
  it('treats an absent row as disabled for existing organisations', async () => {
    h.queue.push({ data: null, error: null });
    await expect(getOrgSetupWorkflowsEnabled()).resolves.toBe(false);
    expect(h.calls.from).toEqual(['org_setup_workflow_settings']);
    expect(h.calls.select).toEqual(['enabled']);
  });

  it('reads the organisation setting without taking an org id from the client', async () => {
    h.queue.push({ data: { enabled: true }, error: null });
    await expect(getOrgSetupWorkflowsEnabled()).resolves.toBe(true);
    expect(h.calls.upsert).toEqual([]);
  });

  it('upserts only the switch value and relies on the database org_id default', async () => {
    h.queue.push({ data: { enabled: true }, error: null });
    await expect(setOrgSetupWorkflowsEnabled(true)).resolves.toBe(true);
    expect(h.calls.upsert).toEqual([[{ enabled: true }, { onConflict: 'org_id' }]]);
  });

  it('surfaces a denied read or write instead of falling back to enabled', async () => {
    h.queue.push({ data: null, error: { message: 'read denied', code: '42501' } });
    await expect(getOrgSetupWorkflowsEnabled()).rejects.toMatchObject({ code: '42501' });
    h.queue.push({ data: null, error: { message: 'write denied', code: '42501' } });
    await expect(setOrgSetupWorkflowsEnabled(true)).rejects.toMatchObject({ code: '42501' });
  });
});
