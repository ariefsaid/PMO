import { describe, it, expect, vi } from 'vitest';
import { toClickUpStatus, fromClickUpStatus, type ClickUpStatusMap } from './statusMap.ts';
import { AdapterError } from '../contract.ts';

const map: ClickUpStatusMap = {
  pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
  clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
  defaultPmoStatus: 'To Do',
};

describe('AC-CUA-034 outbound: toClickUpStatus resolves a PMO status to its configured List status', () => {
  it('AC-CUA-034 a mapped PMO status returns the List-configured ClickUp status string', () => {
    expect(toClickUpStatus(map, 'Done')).toBe('complete');
  });

  it('AC-CUA-034 an unmapped PMO status throws a commit-rejected AdapterError (config error)', () => {
    expect(() => toClickUpStatus(map, 'Blocked')).toThrow(AdapterError);
    try {
      toClickUpStatus(map, 'Blocked');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AdapterError);
      expect((err as AdapterError).code).toBe('commit-rejected');
    }
  });
});

describe('FR-CUA-011 inbound: fromClickUpStatus falls back to the configured default (logged, not thrown)', () => {
  it('a mapped ClickUp status returns the configured PMO status', () => {
    expect(fromClickUpStatus(map, 'complete')).toBe('Done');
  });

  it('an unknown ClickUp status returns the default PMO status without throwing, and logs a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => fromClickUpStatus(map, '<unknown clickup status>')).not.toThrow();
    expect(fromClickUpStatus(map, '<unknown clickup status>')).toBe('To Do');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('AC-CUA-034 outbound: a pmo-only PMO status resolves to no ClickUp status, without throwing', () => {
  const pmoOnlyMap: ClickUpStatusMap = {
    pmoToClickUp: { 'To Do': 'to do', Done: 'complete' },
    clickUpToPmo: { 'to do': 'To Do', complete: 'Done' },
    defaultPmoStatus: 'To Do',
    pmoOnlyStatuses: ['Blocked'],
  };

  it('toClickUpStatus returns undefined for a pmo-only PMO status (a legitimate configured outcome, not a config error)', () => {
    expect(() => toClickUpStatus(pmoOnlyMap, 'Blocked')).not.toThrow();
    expect(toClickUpStatus(pmoOnlyMap, 'Blocked')).toBeUndefined();
  });

  it('a PMO status that is neither mapped nor recorded pmo-only still throws commit-rejected (a genuine config error)', () => {
    const incompleteMap: ClickUpStatusMap = {
      pmoToClickUp: { 'To Do': 'to do' },
      clickUpToPmo: { 'to do': 'To Do' },
      defaultPmoStatus: 'To Do',
      pmoOnlyStatuses: [],
    };
    expect(() => toClickUpStatus(incompleteMap, 'Blocked')).toThrow(AdapterError);
  });
});

describe('FR-CUA-011 inbound: fromClickUpStatus never moves a PMO row OUT of a pmo-only status', () => {
  const pmoOnlyMap: ClickUpStatusMap = {
    pmoToClickUp: { 'To Do': 'to do', 'In Progress': 'in progress', Done: 'complete' },
    clickUpToPmo: { 'to do': 'To Do', 'in progress': 'In Progress', complete: 'Done' },
    defaultPmoStatus: 'To Do',
    pmoOnlyStatuses: ['Blocked'],
  };

  it('a PMO row currently Blocked (pmo-only) stays Blocked when an inbound ClickUp status arrives', () => {
    expect(fromClickUpStatus(pmoOnlyMap, 'in progress', 'Blocked')).toBe('Blocked');
    expect(fromClickUpStatus(pmoOnlyMap, 'complete', 'Blocked')).toBe('Blocked');
    expect(fromClickUpStatus(pmoOnlyMap, 'to do', 'Blocked')).toBe('Blocked');
  });

  it('a PMO row NOT currently pmo-only still resolves normally off the inbound ClickUp status', () => {
    expect(fromClickUpStatus(pmoOnlyMap, 'complete', 'To Do')).toBe('Done');
  });
});

describe('FR-CUA-011 inbound: an explicitly recorded collapse never downgrades the more specific PMO status', () => {
  // A hand-authored binding where Blocked and In Progress both explicitly resolve to the SAME
  // ClickUp status ('in progress') — allowed only when explicit (never produced silently by
  // buildClickUpStatusMap). clickUpToPmo's single inbound target for 'in progress' is the LESS
  // specific 'In Progress' (the default a brand-new/unmapped row adopts).
  const collapsedMap: ClickUpStatusMap = {
    pmoToClickUp: { 'To Do': 'to do', 'In Progress': 'in progress', Blocked: 'in progress', Done: 'complete' },
    clickUpToPmo: { 'to do': 'To Do', 'in progress': 'In Progress', complete: 'Done' },
    defaultPmoStatus: 'To Do',
  };

  it('a PMO row currently Blocked stays Blocked when the incoming ClickUp status is the SAME shared target', () => {
    expect(fromClickUpStatus(collapsedMap, 'in progress', 'Blocked')).toBe('Blocked');
  });

  it('a PMO row currently Blocked still moves off Blocked when the incoming ClickUp status genuinely differs', () => {
    expect(fromClickUpStatus(collapsedMap, 'complete', 'Blocked')).toBe('Done');
  });
});
