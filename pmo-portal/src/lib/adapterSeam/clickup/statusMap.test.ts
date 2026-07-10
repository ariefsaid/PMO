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
