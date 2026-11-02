/**
 * resolveInboundRecord — the ONE routine both live inbound paths (webhook worker + multi-List sweep)
 * use to turn a ClickUp task into the canonical record for an existing-or-new mirror: current status
 * (stickiness), parent link and project guard are resolved here, never re-implemented per path.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveInboundRecord } from './inboundRecord.ts';
import type { ClickUpStatusMap } from './statusMap.ts';
import type { ClickUpMemberMap } from './memberMap.ts';
import type { ClickUpTask } from './types.ts';

const statusMap: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
  pmoOnlyStatuses: ['Blocked'],
};
const memberMap: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };
const maps = { statusMap, memberMap };

function task(extra: Partial<ClickUpTask> = {}): ClickUpTask {
  return {
    id: 'cu-1',
    name: 'T',
    status: { status: 'to do' },
    assignees: [],
    start_date: null,
    due_date: null,
    date_updated: '5000',
    ...extra,
  };
}

describe('resolveInboundRecord — current status', () => {
  it('reads the mapped mirror status so a pmo-only status survives an unrelated inbound sync', async () => {
    const readMirrorStatus = vi.fn(async () => 'Blocked');
    const rec = await resolveInboundRecord(task(), maps, { readMirrorStatus }, { mappedPmoId: 'pmo-1' });
    expect(readMirrorStatus).toHaveBeenCalledWith('pmo-1');
    expect(rec.status).toBe('Blocked');
  });

  it('does not read a status for an unmapped (new) task', async () => {
    const readMirrorStatus = vi.fn(async () => 'Blocked');
    const rec = await resolveInboundRecord(task(), maps, { readMirrorStatus }, { mappedPmoId: null });
    expect(readMirrorStatus).not.toHaveBeenCalled();
    expect(rec.status).toBe('To Do');
  });
});

describe('resolveInboundRecord — parent link', () => {
  it('omits parent_task_id when the ClickUp task has no parent (an existing PMO link stays)', async () => {
    const rec = await resolveInboundRecord(task(), maps, { resolveParentPmoId: async () => 'x' }, { mappedPmoId: 'pmo-1' });
    expect('parent_task_id' in rec).toBe(false);
  });

  it('an explicit parent: null (task un-nested in ClickUp) clears parent_task_id, distinct from an absent key', async () => {
    const rec = await resolveInboundRecord(task({ parent: null }), maps, { resolveParentPmoId: async () => 'x' }, { mappedPmoId: 'pmo-1' });
    expect('parent_task_id' in rec).toBe(true);
    expect(rec.parent_task_id).toBeNull();
  });

  it('resolves a mirrored parent to its PMO id', async () => {
    const resolveParentPmoId = vi.fn(async () => 'pmo-parent');
    const rec = await resolveInboundRecord(task({ parent: 'cu-p' }), maps, { resolveParentPmoId }, { mappedPmoId: 'pmo-1' });
    expect(resolveParentPmoId).toHaveBeenCalledWith('cu-p');
    expect(rec.parent_task_id).toBe('pmo-parent');
  });

  it('an unmirrored parent resolves to null (flat until the parent lands)', async () => {
    const rec = await resolveInboundRecord(task({ parent: 'cu-p' }), maps, { resolveParentPmoId: async () => null }, { mappedPmoId: 'pmo-1' });
    expect(rec.parent_task_id).toBeNull();
  });

  it('refuses a parent that lives in a different project than the child', async () => {
    const rec = await resolveInboundRecord(
      task({ parent: 'cu-p' }),
      maps,
      { resolveParentPmoId: async () => 'pmo-parent', readMirrorProjectId: async () => 'proj-other' },
      { mappedPmoId: 'pmo-1', childProjectId: 'proj-a' },
    );
    expect(rec.parent_task_id).toBeNull();
  });

  it('keeps a same-project parent', async () => {
    const rec = await resolveInboundRecord(
      task({ parent: 'cu-p' }),
      maps,
      { resolveParentPmoId: async () => 'pmo-parent', readMirrorProjectId: async () => 'proj-a' },
      { mappedPmoId: null, childProjectId: 'proj-a' },
    );
    expect(rec.parent_task_id).toBe('pmo-parent');
  });

  it('fails closed when the parent mirror project cannot be read (null): the parent is not stamped', async () => {
    const rec = await resolveInboundRecord(
      task({ parent: 'cu-p' }),
      maps,
      { resolveParentPmoId: async () => 'pmo-parent', readMirrorProjectId: async () => null },
      { mappedPmoId: null, childProjectId: 'proj-a' },
    );
    expect(rec.parent_task_id).toBeNull();
  });
});
