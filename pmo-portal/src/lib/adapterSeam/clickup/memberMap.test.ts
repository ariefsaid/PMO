import { describe, it, expect } from 'vitest';
import {
  toClickUpAssignee,
  fromClickUpAssignee,
  buildClickUpMemberMap,
  type ClickUpMemberMap,
} from './memberMap.ts';

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

describe('OD-INT-10 buildClickUpMemberMap: matched-by-email pairs map; unmatched are absent and do not throw', () => {
  it('maps a PMO profile and a ClickUp member that share an email', () => {
    const result = buildClickUpMemberMap(
      [{ id: 'pmo-user-1', email: 'alice@example.com' }],
      [{ id: 111, email: 'alice@example.com' }],
    );
    expect(result).toEqual({
      pmoToClickUp: { 'pmo-user-1': 111 },
      clickUpToPmo: { 111: 'pmo-user-1' },
    });
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const result = buildClickUpMemberMap(
      [{ id: 'pmo-user-1', email: '  Alice@Example.com  ' }],
      [{ id: 111, email: 'alice@example.com' }],
    );
    expect(result.pmoToClickUp['pmo-user-1']).toBe(111);
  });

  it('a PMO profile with no matching ClickUp member is absent from the map, never throws', () => {
    expect(() =>
      buildClickUpMemberMap(
        [{ id: 'pmo-user-unmatched', email: 'nobody@example.com' }],
        [{ id: 111, email: 'alice@example.com' }],
      ),
    ).not.toThrow();
    const result = buildClickUpMemberMap(
      [{ id: 'pmo-user-unmatched', email: 'nobody@example.com' }],
      [{ id: 111, email: 'alice@example.com' }],
    );
    expect(result.pmoToClickUp['pmo-user-unmatched']).toBeUndefined();
    expect(Object.keys(result.clickUpToPmo)).toHaveLength(0);
  });

  it('a ClickUp member with no matching PMO profile is absent from the map, never throws', () => {
    const result = buildClickUpMemberMap(
      [{ id: 'pmo-user-1', email: 'alice@example.com' }],
      [
        { id: 111, email: 'alice@example.com' },
        { id: 222, email: 'ghost@example.com' },
      ],
    );
    expect(result.clickUpToPmo[222]).toBeUndefined();
    expect(Object.keys(result.pmoToClickUp)).toHaveLength(1);
  });

  it('both lists empty yields an empty map, never throws', () => {
    expect(buildClickUpMemberMap([], [])).toEqual({ pmoToClickUp: {}, clickUpToPmo: {} });
  });
});
