import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { describeAttributionError } from './costAttributionError';

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

describe('AC-WCA-013 describeAttributionError', () => {
  it('AC-WCA-013 names the database reason for each refusal', () => {
    expect(describeAttributionError({ message: 'COST_WO_PROJECT: the work order belongs to another project' }, t).detail)
      .toBe('That work order belongs to another project.');
    expect(describeAttributionError({ message: 'COST_WO_NO_PROJECT: this record has no project, so it cannot name a work order' }, t).detail)
      .toBe('This record has no project, so it cannot go on a work order.');
    expect(describeAttributionError({ message: 'COST_WO_CANCELLED: the work order is cancelled' }, t).detail).toBe('That work order is cancelled.');
    expect(describeAttributionError({ message: "COST_DISCIPLINE: the discipline is not on this organisation's list" }, t).detail)
      .toBe("That discipline is no longer on your organisation's list.");
  });

  it('AC-WCA-013 says the record was saved, and falls back for any other failure', () => {
    const out = describeAttributionError(new Error('network down'), t);
    expect(out.headline).toBe('Saved, but the work order or discipline was not set');
    expect(out.detail).toBe('Try again from the record.');
  });
});
