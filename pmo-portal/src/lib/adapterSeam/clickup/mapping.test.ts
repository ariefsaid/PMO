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
