import { describe, expect, it } from 'vitest';
import { nextStep } from './nextStep.ts';

describe('purchase recovery decisions', () => {
  it.each([
    ['order', { state: 'draft', anchor: 'ours' }, 'confirm'],
    ['order', { state: 'purchase' }, 'adopt'],
    ['order', { state: 'sent', anchor: 'ours' }, 'confirm'],
    ['order', { state: 'to approve', anchor: 'ours' }, 'adopt'],   // waiting inside Odoo: reported as such, never re-confirmed or approved
    ['order', { state: 'cancel', anchor: 'ours' }, 'hold'],
    ['order', { absent: true, probe: 'conclusive' }, 'create'],
    ['order', { absent: true, probe: 'inconclusive' }, 'hold'],
    ['bill', { state: 'draft', anchor: 'ours' }, 'post'],
    ['bill', { state: 'posted', anchor: 'ours' }, 'adopt'],
    ['bill', { absent: true, probe: 'inconclusive' }, 'hold'],
    ['payment', { state: 'draft', anchor: 'ours' }, 'post'],
    ['payment', { state: 'posted-unreconciled', anchor: 'ours' }, 'reconcile'],
    ['payment', { state: 'reconciled', anchor: 'ours' }, 'adopt'],
    ['payment', { absent: true, probe: 'inconclusive' }, 'hold'],
    ['receipt', { state: 'done' }, 'adopt'],
  ] as const)('%s %o → %s', (kind, observed, expected) => expect(nextStep(kind, observed)).toBe(expected));
});
