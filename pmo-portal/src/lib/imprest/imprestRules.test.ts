import { describe, it, expect } from 'vitest';
import {
  availableFloatActions, availableReplenishmentActions, availablePlanActions, sumCents, toCents, gapCents, isPlanException,
} from './imprestRules';

const float = (o: Partial<Parameters<typeof availableFloatActions>[0]> = {}) => ({
  userId: 'cust', realRole: 'Project Manager' as const, custodianId: 'cust', receiptsWaiting: 100, gap: 50, openFunding: false, ...o,
});

describe('AC-IMP-081 float actions', () => {
  it('AC-IMP-081 the custodian may request a replenishment and a funding, nobody else may', () => {
    expect(availableFloatActions(float())).toEqual(expect.arrayContaining(['requestReplenishment', 'requestFunding']));
    const other = availableFloatActions(float({ userId: 'fin', realRole: 'Finance' }));
    expect(other).not.toContain('requestReplenishment');
    expect(other).not.toContain('requestFunding');
  });
  it('AC-IMP-081 replenishment needs receipts waiting; funding needs a gap and no open funding', () => {
    expect(availableFloatActions(float({ receiptsWaiting: 0 }))).not.toContain('requestReplenishment');
    expect(availableFloatActions(float({ gap: 0 }))).not.toContain('requestFunding');
    expect(availableFloatActions(float({ openFunding: true }))).not.toContain('requestFunding');
  });
  it('AC-IMP-081 recording a count: the custodian or Finance/Admin, not a bystander', () => {
    expect(availableFloatActions(float())).toContain('recordCount');
    expect(availableFloatActions(float({ userId: 'a', realRole: 'Admin' }))).toContain('recordCount');
    expect(availableFloatActions(float({ userId: 'e', realRole: 'Engineer' }))).not.toContain('recordCount');
  });
  it('AC-IMP-081 no user or role gives nothing', () => {
    expect(availableFloatActions(float({ userId: null }))).toEqual([]);
    expect(availableFloatActions(float({ realRole: null }))).toEqual([]);
  });
});

const rep = (o: { status?: string; requested_by?: string; approved_by?: string | null } = {}) =>
  ({ status: 'Requested', requested_by: 'req', approved_by: null, ...o });
const repCtx = (userId: string, realRole: Parameters<typeof availableReplenishmentActions>[0]['realRole'], r = rep()) =>
  availableReplenishmentActions({ userId, realRole, custodianId: 'cust', rep: r });

describe('AC-IMP-081 replenishment actions', () => {
  it('AC-IMP-081 a Requested replenishment: Finance/Admin who is neither custodian nor requester may approve and reject', () => {
    expect(repCtx('fin', 'Finance')).toEqual(expect.arrayContaining(['approveReplenishment', 'rejectReplenishment']));
    expect(repCtx('adm', 'Admin')).toContain('approveReplenishment');
    for (const [u, r] of [['cust', 'Finance'], ['req', 'Finance'], ['pm', 'Project Manager'], ['eng', 'Engineer']] as const) {
      const a = repCtx(u, r);
      expect(a).not.toContain('approveReplenishment');
      expect(a).not.toContain('rejectReplenishment');
    }
  });
  it('AC-IMP-081 an Approved replenishment: pay only for Finance/Admin who is not approver, requester or custodian', () => {
    const r = rep({ status: 'Approved', approved_by: 'appr' });
    expect(repCtx('fin', 'Finance', r)).toContain('payReplenishment');
    for (const [u, role] of [['appr', 'Finance'], ['req', 'Finance'], ['cust', 'Finance'], ['pm', 'Project Manager']] as const) {
      expect(repCtx(u, role, r)).not.toContain('payReplenishment');
    }
  });
  it('AC-IMP-081 cancel: the requester while Requested; Finance/Admin while Requested or Approved', () => {
    expect(repCtx('req', 'Project Manager')).toContain('cancelReplenishment');
    expect(repCtx('fin', 'Finance')).toContain('cancelReplenishment');
    expect(repCtx('eng', 'Engineer')).not.toContain('cancelReplenishment');
    const approved = rep({ status: 'Approved', approved_by: 'appr' });
    expect(repCtx('req', 'Project Manager', approved)).not.toContain('cancelReplenishment');
    expect(repCtx('fin', 'Finance', approved)).toContain('cancelReplenishment');
    expect(repCtx('fin', 'Finance', rep({ status: 'Paid' }))).toEqual([]);
  });
  it('AC-IMP-081 no user or role gives nothing', () => {
    expect(repCtx(undefined as never, 'Finance')).toEqual([]);
    expect(repCtx('fin', null)).toEqual([]);
  });
});

const planCtx = (userId: string, realRole: Parameters<typeof availablePlanActions>[0]['realRole'], status: string) =>
  availablePlanActions({ userId, realRole, custodianId: 'cust', plan: { status, author_id: 'auth' } });

describe('AC-IMP-081 plan actions follow transition_imprest_plan', () => {
  it('AC-IMP-081 author: submit (Draft), reopen (Rejected), cancel', () => {
    expect(planCtx('auth', 'Project Manager', 'Draft')).toEqual(expect.arrayContaining(['submitPlan', 'cancelPlan']));
    expect(planCtx('auth', 'Project Manager', 'Rejected')).toEqual(expect.arrayContaining(['reopenPlan', 'cancelPlan']));
    expect(planCtx('auth', 'Project Manager', 'Submitted')).not.toContain('submitPlan');
    expect(planCtx('other', 'Engineer', 'Draft')).toEqual([]);
  });
  it('AC-IMP-081 approval rank, not author and not custodian: approve, reject (Submitted)', () => {
    expect(planCtx('fin', 'Finance', 'Submitted')).toEqual(expect.arrayContaining(['approvePlan', 'rejectPlan']));
    expect(planCtx('exec', 'Executive', 'Submitted')).toContain('approvePlan');
    for (const [u, r] of [['auth', 'Finance'], ['cust', 'Finance'], ['eng', 'Engineer']] as const) {
      expect(planCtx(u, r, 'Submitted')).not.toContain('approvePlan');
    }
    expect(planCtx('fin', 'Finance', 'Draft')).not.toContain('approvePlan');
  });
  it('AC-IMP-081 no user or role gives nothing', () => {
    expect(planCtx('', 'Finance', 'Draft')).toEqual([]);
    expect(planCtx('fin', null, 'Draft')).toEqual([]);
  });
});

describe('AC-IMP-081 arithmetic', () => {
  it('AC-IMP-081 position arithmetic is cent-exact', () => {
    expect(sumCents(['0.10', '0.20'])).toBe(30);
    expect(toCents('-1.5')).toBe(-150);
    expect(toCents(null)).toBe(0);
    expect(gapCents({ float_amount: '10000000.00', cash_book: '800000.10', advances_out: '0.20', receipts_waiting: '9199999.70' })).toBe(0);
  });
  it('AC-IMP-081 the exception hint matches FR-IMP-024', () => {
    expect(isPlanException(700000, 500000)).toBe(true);
    expect(isPlanException(500000, 500000)).toBe(false);
    expect(isPlanException(1, null)).toBe(true);
    expect(isPlanException(0, null)).toBe(true); // no plan line at all is an exception even for a zero item
  });
});
