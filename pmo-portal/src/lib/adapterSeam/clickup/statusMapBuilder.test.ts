import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  buildClickUpStatusMap,
  statusMapCoversAllPmoStatuses,
  PMO_TASK_STATUSES,
  type ClickUpListStatus,
} from './statusMapBuilder.ts';
import { toClickUpStatus } from './statusMap.ts';

// The REAL committed fixture (2026-07-20 workspace probe): open/custom/closed only, no `done` type.
const REAL_LIST_STATUSES = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../supabase/functions/_shared/testing/fixtures/clickup-webhook/list-statuses.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as ClickUpListStatus[];

describe('OD-INT-10 buildClickUpStatusMap: a List with open/custom/closed only builds a full map, but a single custom status cannot represent Blocked distinctly from In Progress', () => {
  it('yields a pmoToClickUp entry for every PMO status, but Blocked and In Progress collapse to the same target', () => {
    const map = buildClickUpStatusMap(REAL_LIST_STATUSES);
    expect(map.pmoToClickUp).toEqual({
      'To Do': 'to do',
      'In Progress': 'in progress',
      Done: 'complete',
      // No second custom status exists in this real List -> Blocked collapses onto In Progress
      // rather than being left unmapped (every PMO status still gets an outbound target)...
      Blocked: 'in progress',
    });
    // ...but security audit HIGH (round 2): a PMO task set to Blocked would be written to ClickUp as
    // 'in progress', and reading 'in progress' back can never recover which PMO state it was — the
    // Blocked state is destroyed in both directions. Coverage now requires every PMO status to map
    // to a DISTINCT ClickUp status, not merely a present one, so this List is correctly rejected.
    expect(statusMapCoversAllPmoStatuses(map)).toBe(false);
  });

  it('toClickUpStatus throws for none of the four PMO statuses', () => {
    const map = buildClickUpStatusMap(REAL_LIST_STATUSES);
    for (const pmoStatus of PMO_TASK_STATUSES) {
      expect(() => toClickUpStatus(map, pmoStatus)).not.toThrow();
    }
  });

  it('inbound: the custom "in progress" status maps to PMO In Progress, not the default (To Do)', () => {
    const map = buildClickUpStatusMap(REAL_LIST_STATUSES);
    expect(map.clickUpToPmo['in progress']).toBe('In Progress');
    expect(map.clickUpToPmo['in progress']).not.toBe(map.defaultPmoStatus);
  });
});

describe('OD-INT-10 buildClickUpStatusMap: a `done`-type status is preferred over `closed` for PMO Done', () => {
  const statuses: ClickUpListStatus[] = [
    { status: 'open', type: 'open', orderindex: 0 },
    { status: 'archived', type: 'closed', orderindex: 1 },
    { status: 'completed', type: 'done', orderindex: 2 },
  ];

  it('pmoToClickUp.Done points at the done-type status, not the closed-type one', () => {
    const map = buildClickUpStatusMap(statuses);
    expect(map.pmoToClickUp.Done).toBe('completed');
  });

  it('inbound: both the closed-type and the done-type status map to PMO Done', () => {
    const map = buildClickUpStatusMap(statuses);
    expect(map.clickUpToPmo.archived).toBe('Done');
    expect(map.clickUpToPmo.completed).toBe('Done');
  });
});

describe('OD-INT-10 buildClickUpStatusMap: two distinct custom statuses split In Progress and Blocked', () => {
  const statuses: ClickUpListStatus[] = [
    { status: 'open', type: 'open', orderindex: 0 },
    { status: 'in review', type: 'custom', orderindex: 1 },
    { status: 'on hold', type: 'custom', orderindex: 2 },
    { status: 'closed', type: 'closed', orderindex: 3 },
  ];

  it('the first custom status (by orderindex) becomes In Progress, the second becomes Blocked', () => {
    const map = buildClickUpStatusMap(statuses);
    expect(map.pmoToClickUp['In Progress']).toBe('in review');
    expect(map.pmoToClickUp.Blocked).toBe('on hold');
  });

  it('inbound: each custom status maps back to its distinct PMO status', () => {
    const map = buildClickUpStatusMap(statuses);
    expect(map.clickUpToPmo['in review']).toBe('In Progress');
    expect(map.clickUpToPmo['on hold']).toBe('Blocked');
  });

  it('a List that CAN represent every PMO status distinctly passes coverage', () => {
    const map = buildClickUpStatusMap(statuses);
    expect(statusMapCoversAllPmoStatuses(map)).toBe(true);
  });
});

describe('OD-INT-10 statusMapCoversAllPmoStatuses: rejects a List that cannot represent every PMO status', () => {
  it('a List with only an open-type status has no Done target -> coverage fails', () => {
    const map = buildClickUpStatusMap([{ status: 'open', type: 'open', orderindex: 0 }]);
    expect(map.pmoToClickUp.Done).toBeUndefined();
    expect(statusMapCoversAllPmoStatuses(map)).toBe(false);
  });

  it('an empty statuses list covers nothing', () => {
    expect(statusMapCoversAllPmoStatuses(buildClickUpStatusMap([]))).toBe(false);
  });

  // Security audit HIGH (round 2): a List with only ONE custom status has an outbound target for
  // every PMO status, but Blocked and In Progress collapse onto the SAME target — writing PMO
  // Blocked to ClickUp lands on 'in progress', and reading 'in progress' back can never recover
  // which PMO state it was. This must be rejected, not silently accepted as "covered".
  it('a List with a single custom status collapses Blocked onto In Progress -> coverage fails', () => {
    const statuses: ClickUpListStatus[] = [
      { status: 'to do', type: 'open', orderindex: 0 },
      { status: 'doing', type: 'custom', orderindex: 1 },
      { status: 'done', type: 'closed', orderindex: 2 },
    ];
    const map = buildClickUpStatusMap(statuses);
    expect(map.pmoToClickUp['In Progress']).toBe('doing');
    expect(map.pmoToClickUp.Blocked).toBe('doing'); // same target — the collapse
    expect(statusMapCoversAllPmoStatuses(map)).toBe(false);
  });

  // Mutation check (required by the brief): if the builder's output silently dropped a PMO status,
  // the coverage check MUST catch it — an assertion that cannot fail is decoration.
  it('MUTATION CHECK: deleting one PMO status from the builder output flips coverage to false', () => {
    const distinctStatuses: ClickUpListStatus[] = [
      { status: 'open', type: 'open', orderindex: 0 },
      { status: 'in review', type: 'custom', orderindex: 1 },
      { status: 'on hold', type: 'custom', orderindex: 2 },
      { status: 'closed', type: 'closed', orderindex: 3 },
    ];
    const map = buildClickUpStatusMap(distinctStatuses);
    expect(statusMapCoversAllPmoStatuses(map)).toBe(true); // sanity: this List covers everything distinctly
    const mutated = { ...map, pmoToClickUp: { ...map.pmoToClickUp } };
    delete mutated.pmoToClickUp.Blocked; // simulate the builder "forgetting" one PMO status
    expect(statusMapCoversAllPmoStatuses(mutated)).toBe(false);
  });
});
