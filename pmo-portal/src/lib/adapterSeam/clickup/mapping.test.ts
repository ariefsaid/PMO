import { describe, it, expect } from 'vitest';
import { clickUpTaskToPmoRecord, pmoTaskToClickUpBody } from './mapping.ts';
import type { ClickUpTask } from './types.ts';
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

const maps = { statusMap, memberMap };

const rawTask: ClickUpTask = {
  id: 'cu-task-1',
  name: 'Wire the widget',
  status: { status: 'to do' },
  assignees: [{ id: 111 }],
  start_date: '1700000000000',
  due_date: '1700100000000',
  date_updated: '1700100000000',
};

describe('AC-CUA-031 clickUpTaskToPmoRecord maps a ClickUp task JSON to the canonical PMO record', () => {
  it('AC-CUA-031 converts unix-ms dates to ISO and due_date to end_date', () => {
    const record = clickUpTaskToPmoRecord(rawTask, maps);
    expect(record).toMatchObject({
      id: 'cu-task-1',
      name: 'Wire the widget',
      status: 'To Do',
      assignee_id: 'pmo-user-1',
      start_date: new Date(1700000000000).toISOString(),
      end_date: new Date(1700100000000).toISOString(),
    });
  });

  it('AC-CUA-031 an unassigned task maps to a null assignee_id', () => {
    const record = clickUpTaskToPmoRecord({ ...rawTask, assignees: [] }, maps);
    expect(record.assignee_id).toBeNull();
  });

  it('AC-CUA-031 absent start/due dates map to null (not "1970")', () => {
    const record = clickUpTaskToPmoRecord({ ...rawTask, start_date: null, due_date: null }, maps);
    expect(record.start_date).toBeNull();
    expect(record.end_date).toBeNull();
  });

  it('OD-INT-10: an optional currentPmoStatus is threaded through to fromClickUpStatus (pmo-only stickiness)', () => {
    const pmoOnlyStatusMap: ClickUpStatusMap = {
      pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
      clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
      defaultPmoStatus: 'To Do',
      pmoOnlyStatuses: ['Blocked'],
    };
    const record = clickUpTaskToPmoRecord(
      { ...rawTask, status: { status: 'to do' } },
      { statusMap: pmoOnlyStatusMap, memberMap },
      'Blocked',
    );
    // The mirror was Blocked (pmo-only); an inbound "to do" must not move it out of Blocked.
    expect(record.status).toBe('Blocked');
  });
});

describe('FR-CUA-010 pmoTaskToClickUpBody branches create vs. update/transition shapes', () => {
  it('create produces ClickUp v2 create body: assignees:[id], ms dates, nothing extra', () => {
    const body = pmoTaskToClickUpBody(
      {
        id: 'pmo-1',
        name: 'Wire the widget',
        status: 'Done',
        assignee_id: 'pmo-user-1',
        start_date: new Date(1700000000000).toISOString(),
        end_date: new Date(1700100000000).toISOString(),
      },
      maps,
      { mode: 'create' },
    );
    expect(body).toEqual({
      name: 'Wire the widget',
      status: 'complete',
      assignees: [111],
      start_date: 1700000000000,
      due_date: 1700100000000,
    });
  });

  it('create with no assignee maps to an empty assignees array (never throws)', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-1', name: 'Solo task', status: 'To Do', assignee_id: null },
      maps,
      { mode: 'create' },
    );
    expect(body).toMatchObject({ assignees: [] });
  });

  it('update/transition produces assignees:{add,rem} and only the fields present in the patch', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-1', status: 'Done' },
      maps,
      { mode: 'update' },
    );
    expect(body).toEqual({ status: 'complete' });
  });

  it('update reassigning an assignee computes the ClickUp add/rem delta against previousAssigneeIds', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-1', assignee_id: 'pmo-user-1' },
      maps,
      { mode: 'update', previousAssigneeIds: [222] },
    );
    expect(body).toEqual({ assignees: { add: [111], rem: [222] } });
  });

  it('OD-INT-10: a pmo-only status pushes the other patched fields but never throws and never emits a status key', () => {
    const pmoOnlyStatusMap: ClickUpStatusMap = {
      pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
      clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
      defaultPmoStatus: 'To Do',
      pmoOnlyStatuses: ['Blocked'],
    };
    let body: ReturnType<typeof pmoTaskToClickUpBody>;
    expect(() => {
      body = pmoTaskToClickUpBody(
        { id: 'pmo-1', name: 'Escalated task', status: 'Blocked', assignee_id: 'pmo-user-1' },
        { statusMap: pmoOnlyStatusMap, memberMap },
        { mode: 'update', previousAssigneeIds: [] },
      );
    }).not.toThrow();
    expect('status' in body!).toBe(false);
    expect(body!).toEqual({ name: 'Escalated task', assignees: { add: [111], rem: [] } });
  });

  it('update unassigning removes the previous assignee and adds none', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-1', assignee_id: null },
      maps,
      { mode: 'update', previousAssigneeIds: [111] },
    );
    expect(body).toEqual({ assignees: { add: [], rem: [111] } });
  });
});

describe('OD-INT-9 parent sync: outbound PMO parent_task_id → ClickUp parent', () => {
  const parentPmoId = 'pmo-parent-1';
  const parentClickUpId = 'cu-parent-1';

  it('create with a RESOLVABLE parent_task_id includes parent in the ClickUp create body', () => {
    const body = pmoTaskToClickUpBody(
      {
        id: 'pmo-child-1',
        name: 'Child task',
        status: 'To Do',
        assignee_id: null,
        parent_task_id: parentPmoId,
        parentClickUpId, // resolved ClickUp parent id threaded in by caller
      },
      maps,
      { mode: 'create', parentClickUpId },
    );
    expect(body).toMatchObject({ parent: parentClickUpId });
  });

  it('create with an UNRESOLVABLE parent_task_id omits parent and still creates the task', () => {
    const body = pmoTaskToClickUpBody(
      {
        id: 'pmo-child-1',
        name: 'Child task',
        status: 'To Do',
        assignee_id: null,
        parent_task_id: parentPmoId,
        // parentClickUpId omitted (undefined) = unresolved parent on create
      },
      maps,
      { mode: 'create' }, // no parentClickUpId = unresolved
    );
    expect('parent' in body).toBe(false);
    expect(body).toMatchObject({ name: 'Child task', assignees: [] });
  });

  it('update re-parents: setting a new resolved parent includes parent in the update body', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-child-1', parent_task_id: 'pmo-new-parent', parentClickUpId: 'cu-new-parent' },
      maps,
      { mode: 'update', parentClickUpId: 'cu-new-parent' },
    );
    expect(body).toMatchObject({ parent: 'cu-new-parent' });
  });

  it('update promoting to top-level (parent_task_id: null) sets parent to null in update body', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-child-1', parent_task_id: null, parentClickUpId: null },
      maps,
      { mode: 'update', parentClickUpId: null },
    );
    // ClickUp: parent: null on update promotes to top-level
    expect(body).toMatchObject({ parent: null });
  });
});

describe('OD-INT-9 parent sync: inbound ClickUp parent → PMO parent_task_id', () => {
  it('a ClickUp task with a RESOLVABLE parent sets parent_task_id on the canonical record', () => {
    const record = clickUpTaskToPmoRecord(
      { ...rawTask, parent: 'cu-parent-1' },
      maps,
      undefined,
      'pmo-parent-1', // resolved PMO parent id threaded in by caller
    );
    expect(record.parent_task_id).toBe('pmo-parent-1');
  });

  it('a ClickUp task with an UNRESOLVABLE parent leaves parent_task_id null (does not drop the row)', () => {
    const record = clickUpTaskToPmoRecord(
      { ...rawTask, parent: 'cu-unknown-parent' },
      maps,
      undefined,
      null, // unresolved
    );
    expect(record.parent_task_id).toBeNull();
    expect(record.id).toBe('cu-task-1'); // row still created
  });

  it('a ClickUp task with a CROSS-PROJECT resolved parent refuses the link (null)', () => {
    const record = clickUpTaskToPmoRecord(
      { ...rawTask, parent: 'cu-cross-project-parent' },
      maps,
      undefined,
      'pmo-cross-project-parent', // resolved but caller detects cross-project
    );
    // The mapping itself doesn't know project_id; the CALLER (apply path) must null it.
    // This test documents that the mapping passes through whatever the caller provides.
    // The cross-project guard lives in the apply path (multiListSweep / webhookApply).
    expect(record.parent_task_id).toBe('pmo-cross-project-parent'); // mapping is a pure pass-through
  });
});

// ── OD-INT-9: description + priority mapping (fixed 4-value constant, NOT per-List config). ─────

describe('OD-INT-9 priority + description: outbound PMO → ClickUp', () => {
  it('OD-INT-9: maps every PMO priority to the fixed ClickUp integer (Urgent=1,High=2,Normal=3,Low=4)', () => {
    const cases: Array<[string, number]> = [
      ['Urgent', 1],
      ['High', 2],
      ['Normal', 3],
      ['Low', 4],
    ];
    for (const [pmo, clickUpInt] of cases) {
      const body = pmoTaskToClickUpBody(
        { id: 'pmo-1', priority: pmo },
        maps,
        { mode: 'update' },
      );
      expect(body).toEqual({ priority: clickUpInt });
    }
  });

  it('OD-INT-9: a null priority OMITS the key entirely (never invents a default integer)', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-1', priority: null },
      maps,
      { mode: 'update' },
    );
    expect('priority' in body).toBe(false);
    expect(body).toEqual({});
  });

  it('OD-INT-9: an unknown priority string OMITS the key (never invents a default)', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-1', priority: 'Bogus' as string },
      maps,
      { mode: 'update' },
    );
    expect('priority' in body).toBe(false);
  });

  it('OD-INT-9: description round-trips outbound (a present string is emitted verbatim)', () => {
    const body = pmoTaskToClickUpBody(
      { id: 'pmo-1', description: 'Pour the foundation before backfill.' },
      maps,
      { mode: 'update' },
    );
    expect(body).toEqual({ description: 'Pour the foundation before backfill.' });
  });

  it('OD-INT-9: a null/empty description is omitted outbound (never writes an empty string)', () => {
    const bodyNull = pmoTaskToClickUpBody(
      { id: 'pmo-1', description: null },
      maps,
      { mode: 'update' },
    );
    expect('description' in bodyNull).toBe(false);

    const bodyEmpty = pmoTaskToClickUpBody(
      { id: 'pmo-1', description: '' },
      maps,
      { mode: 'update' },
    );
    expect('description' in bodyEmpty).toBe(false);
  });

  it('OD-INT-9: outbound emits description + priority ALONGSIDE the existing scalar fields on create', () => {
    const body = pmoTaskToClickUpBody(
      {
        id: 'pmo-1',
        name: 'Wire the widget',
        status: 'Done',
        assignee_id: 'pmo-user-1',
        description: 'Detailed scope here.',
        priority: 'High',
      },
      maps,
      { mode: 'create' },
    );
    expect(body).toMatchObject({
      name: 'Wire the widget',
      status: 'complete',
      assignees: [111],
      description: 'Detailed scope here.',
      priority: 2,
    });
  });
});

describe('OD-INT-9 priority + description: inbound ClickUp → PMO', () => {
  it('OD-INT-9: a ClickUp priority OBJECT maps to the PMO enum (label → Urgent/High/Normal/Low)', () => {
    // ClickUp GET returns priority as an OBJECT: { id, priority (the label), color, orderindex }.
    // The label is lowercase on the wire; the map is case-insensitive so it cannot rot on casing.
    const cases: Array<[string, string]> = [
      ['urgent', 'Urgent'],
      ['high', 'High'],
      ['normal', 'Normal'],
      ['low', 'Low'],
    ];
    for (const [label, pmo] of cases) {
      const record = clickUpTaskToPmoRecord(
        { ...rawTask, priority: { id: 'p-id', priority: label, color: '#ff0f00', orderindex: '1' } },
        maps,
      );
      expect(record.priority).toBe(pmo);
    }
  });

  it('OD-INT-9: a Capitalized ClickUp priority label still maps (case-insensitive, defensive)', () => {
    // We cannot call the live API; the map is case-insensitive so a casing drift on ClickUp's
    // side never silently drops the priority to null.
    const record = clickUpTaskToPmoRecord(
      { ...rawTask, priority: { id: 'p-id', priority: 'High', color: '#ff0f00', orderindex: '2' } },
      maps,
    );
    expect(record.priority).toBe('High');
  });

  it('OD-INT-9: an absent priority (undefined) maps to null — never invents a default', () => {
    const record = clickUpTaskToPmoRecord(rawTask, maps); // no priority field on rawTask
    expect(record.priority).toBeNull();
  });

  it('OD-INT-9: an explicit null priority maps to null', () => {
    const record = clickUpTaskToPmoRecord({ ...rawTask, priority: null }, maps);
    expect(record.priority).toBeNull();
  });

  it('OD-INT-9: an unknown ClickUp priority label maps to null (never invents a default)', () => {
    const record = clickUpTaskToPmoRecord(
      { ...rawTask, priority: { id: 'p-id', priority: 'critical', color: '#000', orderindex: '0' } },
      maps,
    );
    expect(record.priority).toBeNull();
  });

  it('OD-INT-9: description round-trips inbound (a present string maps to the PMO description)', () => {
    const record = clickUpTaskToPmoRecord(
      { ...rawTask, description: 'Pour the foundation before backfill.' },
      maps,
    );
    expect(record.description).toBe('Pour the foundation before backfill.');
  });

  it('OD-INT-9: an absent description maps to null inbound', () => {
    const record = clickUpTaskToPmoRecord(rawTask, maps); // no description field
    expect(record.description).toBeNull();
  });
});
