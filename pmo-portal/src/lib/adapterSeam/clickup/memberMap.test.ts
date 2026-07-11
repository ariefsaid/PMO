import { describe, it, expect } from 'vitest';
import { toClickUpAssignee, fromClickUpAssignee, type ClickUpMemberMap } from './memberMap.ts';

const map: ClickUpMemberMap = {
  pmoToClickUp: { 'pmo-user-1': 111 },
  clickUpToPmo: { 111: 'pmo-user-1' },
};

describe('AC-CUA-037 outbound: toClickUpAssignee never throws on an unmapped assignee', () => {
  it('AC-CUA-037 a mapped PMO assignee resolves to the ClickUp member id', () => {
    const result = toClickUpAssignee(map, 'pmo-user-1');
    expect(result).toEqual({ unassigned: false, id: 111 });
  });

  it('AC-CUA-037 an unmapped PMO assignee returns a surfaced unassigned marker, never throws', () => {
    expect(() => toClickUpAssignee(map, 'pmo-user-unknown')).not.toThrow();
    const result = toClickUpAssignee(map, 'pmo-user-unknown');
    expect(result.unassigned).toBe(true);
    expect((result as { surfaced: string }).surfaced).toContain('pmo-user-unknown');
  });
});

describe('FR-CUA-013 inbound: fromClickUpAssignee resolves a ClickUp member id to a PMO assignee', () => {
  it('a mapped ClickUp member id resolves to the PMO assignee id', () => {
    expect(fromClickUpAssignee(map, 111)).toBe('pmo-user-1');
  });

  it('an unmapped ClickUp member id resolves to null', () => {
    expect(fromClickUpAssignee(map, 999)).toBeNull();
  });
});
