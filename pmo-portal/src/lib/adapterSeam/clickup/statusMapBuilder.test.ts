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

describe('OD-INT-10 buildClickUpStatusMap (round 3): a List with open/custom/closed only (the real, default ClickUp vocabulary) builds a full, LINKABLE map — Blocked resolves pmo-only rather than colliding with In Progress', () => {
  it('yields a pmoToClickUp entry for To Do/In Progress/Done; Blocked gets NO ClickUp entry and is recorded pmo-only instead', () => {
    const map = buildClickUpStatusMap(REAL_LIST_STATUSES);
    expect(map.pmoToClickUp).toEqual({
      'To Do': 'to do',
      'In Progress': 'in progress',
      Done: 'complete',
      // No second custom status exists in this real List -> rather than silently colliding Blocked
      // onto In Progress's target (round 2's since-reverted rule), Blocked gets NO ClickUp entry...
    });
    expect(map.pmoOnlyStatuses).toEqual(['Blocked']);
    // ...and every PMO status still has an explicit, recorded resolution (mapped or pmo-only) — this
    // is the real 2026-07-20 workspace probe shape, and it is LINKABLE.
    expect(statusMapCoversAllPmoStatuses(map)).toBe(true);
  });

  it('toClickUpStatus throws for none of the four PMO statuses (Blocked resolves to undefined, not a throw)', () => {
    const map = buildClickUpStatusMap(REAL_LIST_STATUSES);
    for (const pmoStatus of PMO_TASK_STATUSES) {
      expect(() => toClickUpStatus(map, pmoStatus)).not.toThrow();
    }
    expect(toClickUpStatus(map, 'Blocked')).toBeUndefined();
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

describe('OD-INT-10 statusMapCoversAllPmoStatuses (round 3): rejects a List where any PMO status has NO recorded resolution (mapped or pmo-only) — distinctness is no longer required', () => {
  it('a List with only an open-type status has no Done target (mapped or pmo-only) -> coverage fails', () => {
    const map = buildClickUpStatusMap([{ status: 'open', type: 'open', orderindex: 0 }]);
    expect(map.pmoToClickUp.Done).toBeUndefined();
    expect(statusMapCoversAllPmoStatuses(map)).toBe(false);
  });

  it('an empty statuses list covers nothing', () => {
    expect(statusMapCoversAllPmoStatuses(buildClickUpStatusMap([]))).toBe(false);
  });

  // Round 3 (this task): a List with only ONE custom status used to be rejected outright (round 2's
  // strict pairwise-distinctness rule) — too strict to ship, since ClickUp's own default vocabulary
  // IS exactly this shape. Blocked now defaults to pmo-only instead of colliding with In Progress, so
  // this List is LINKABLE, not rejected.
  it('a List with a single custom status defaults Blocked to pmo-only -> coverage now PASSES (no collision, no rejection)', () => {
    const statuses: ClickUpListStatus[] = [
      { status: 'to do', type: 'open', orderindex: 0 },
      { status: 'doing', type: 'custom', orderindex: 1 },
      { status: 'done', type: 'closed', orderindex: 2 },
    ];
    const map = buildClickUpStatusMap(statuses);
    expect(map.pmoToClickUp['In Progress']).toBe('doing');
    expect(map.pmoToClickUp.Blocked).toBeUndefined(); // no collapse — Blocked has NO ClickUp entry
    expect(map.pmoOnlyStatuses).toEqual(['Blocked']);
    expect(statusMapCoversAllPmoStatuses(map)).toBe(true);
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

  // MUTATION CHECK, pmo-only path: forgetting to RECORD a status as pmo-only is just as much a
  // "forgotten resolution" as forgetting a mapped entry — the check must catch both.
  it('MUTATION CHECK: dropping the pmo-only recording for Blocked flips coverage to false', () => {
    const map = buildClickUpStatusMap(REAL_LIST_STATUSES);
    expect(statusMapCoversAllPmoStatuses(map)).toBe(true); // sanity
    const mutated = { ...map, pmoOnlyStatuses: [] };
    expect(statusMapCoversAllPmoStatuses(mutated)).toBe(false);
  });
});
