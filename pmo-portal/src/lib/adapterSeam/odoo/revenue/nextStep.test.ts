import { describe, expect, it } from 'vitest';
import { nextStep, OBSERVATIONS, type Recovery, type Step } from './nextStep.ts';

const RECOVERY: Recovery[] = ['none', 'in-window', 'after-window'];
type Row = readonly [Step, Step, Step];
const same = (s: Step): Row => [s, s, s];

// One row per observation; columns are the recovery stage (none, in-window, after-window).
const INVOICE: Record<(typeof OBSERVATIONS)[number], Row> = {
  'absent': ['create', 'wait', 'hold'],
  'draft-with-anchor': same('post'),
  'posted-with-anchor': same('adopt'),
  'payment-created': same('hold'),
  'payment-posted': same('hold'),
  'payment-reconciled': same('hold'),
  'state-unreadable': ['wait', 'wait', 'hold'],
  'several': same('hold'),
};
const PAYMENT: Record<(typeof OBSERVATIONS)[number], Row> = {
  'absent': ['create', 'wait', 'hold'],
  'draft-with-anchor': same('hold'),
  'posted-with-anchor': same('hold'),
  'payment-created': same('post'),
  'payment-posted': same('reconcile'),
  'payment-reconciled': same('adopt'),
  'state-unreadable': ['wait', 'wait', 'hold'],
  'several': same('hold'),
};

describe('AC-OCI-011/042 revenue recovery decisions', () => {
  it.each([['sales-invoice', INVOICE], ['incoming-payment', PAYMENT]] as const)('%s: the table covers every observation and stage', (kind, table) => {
    expect(Object.keys(table).sort()).toEqual([...OBSERVATIONS].sort());
    for (const observed of OBSERVATIONS) {
      RECOVERY.forEach((recovery, i) => expect(nextStep(kind, observed, recovery), `${kind} ${observed} ${recovery}`).toBe(table[observed][i]));
    }
  });

  it('AC-OCI-043 a payment is never reissued once the recovery window has passed: absent holds', () => {
    expect(nextStep('incoming-payment', 'absent', 'after-window')).toBe('hold');
    expect(nextStep('sales-invoice', 'absent', 'after-window')).toBe('hold');
  });

  it('AC-OCI-043 two matches hold, and a unique reconciled match is adopted, never created', () => {
    expect(nextStep('incoming-payment', 'several', 'after-window')).toBe('hold');
    expect(nextStep('incoming-payment', 'payment-reconciled', 'after-window')).toBe('adopt');
  });
});
