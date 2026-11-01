import { describe, expect, it } from 'vitest';
import { buildImprestPostingCommand, parseImprestGateTruth } from './imprestPostingCommand';
import { resolveImprestPosting, type ImprestResolveDeps } from './imprestPostingResolve';
import { imprestTransferToBody } from './bodies/imprestTransfer';
import type { ErpAccountFacts } from './expenseAccountRules';

const REP = '15150000-0000-0000-0000-0000000000E3';
const gate = {
  mirror_id: 'm1', posting_identity: `${REP.toLowerCase()}:replenishment`, subject_id: REP.toLowerCase(), number: 'REP-2611010003',
  kind: 'replenishment', amount: '800000.00', currency: 'IDR', float_id: 'f1', float_cash_account: 'Site Cash F - PSC',
  reference: 'BANK-1', state_stamp: '2026-10-07T10:00:00.123+00:00', posting_date: '2026-11-01', actor_id: 'u-admin',
};
const refs = { company: 'PMO Smoke Co', headOfficeAccount: 'Bank - PSC' };

describe('buildImprestPostingCommand (AC-IMP-072)', () => {
  it('AC-IMP-072 freezes head office → float cash under a key derived from the replenishment and its paid stamp', () => {
    const cmd = buildImprestPostingCommand(gate, refs);
    expect(cmd).toMatchObject({ domain: 'expenses', operation: 'create', outboxIdentity: `${REP.toLowerCase()}:replenishment`,
      idempotencyKey: `impt:${REP.toLowerCase()}:1791367200123` });
    expect(cmd.record).toMatchObject({ erp_doc_kind: 'imprest-transfer', from_account: 'Bank - PSC', to_account: 'Site Cash F - PSC',
      amount: '800000.00', company: 'PMO Smoke Co', posting_date: '2026-11-01', reference: 'BANK-1' });
  });

  it('AC-IMP-072 the frozen record builds a valid transfer body', () => {
    const cmd = buildImprestPostingCommand(gate, refs);
    expect(() => imprestTransferToBody(cmd.record, { refs: {}, config: {} })).not.toThrow();
  });

  it('AC-IMP-072 refuses a malformed gate answer, building nothing', () => {
    expect(parseImprestGateTruth(JSON.parse(JSON.stringify(gate)))).toEqual(gate);
    for (const bad of [null, { ...gate, amount: 800000 }, { ...gate, amount: '1.000' }, { ...gate, float_cash_account: '' }, { ...gate, posting_date: '1/11' }, { ...gate, actor_id: undefined }]) {
      expect(() => parseImprestGateTruth(bad)).toThrow(/imprest-gate-truth-malformed/);
    }
  });
});

describe('resolveImprestPosting (AC-IMP-071)', () => {
  const acct = (name: string, over: Partial<ErpAccountFacts> = {}): ErpAccountFacts =>
    ({ name, account_type: 'Cash', company: 'PMO Smoke Co', is_group: 0, disabled: 0, ...over });
  const deps = (over: Partial<ImprestResolveDeps> = {}, accounts: ErpAccountFacts[] = [acct('Site Cash F - PSC'), acct('Bank - PSC', { account_type: 'Bank' })]): ImprestResolveDeps => ({
    readBinding: async () => ({ company: 'PMO Smoke Co', headOfficeAccount: 'Bank - PSC' }),
    readErpAccounts: async (names) => accounts.filter((a) => names.includes(a.name)),
    readErpCompany: async () => ({ currency: 'IDR' }),
    ...over,
  });

  it('AC-IMP-071 ready with the company and the head office account', async () => {
    expect(await resolveImprestPosting(gate, deps())).toEqual({ outcome: 'ready', refs });
  });

  it('AC-IMP-071 an account that no longer fits is refused, not posted', async () => {
    expect(await resolveImprestPosting(gate, deps({}, [acct('Site Cash F - PSC', { account_type: 'Bank' }), acct('Bank - PSC')])))
      .toMatchObject({ outcome: 'refuse', code: 'imprest-cash-account-unfit' });
    expect(await resolveImprestPosting(gate, deps({}, [acct('Bank - PSC')]))).toMatchObject({ outcome: 'refuse', code: 'imprest-cash-account-unfit' });
    expect(await resolveImprestPosting(gate, deps({}, [acct('Site Cash F - PSC'), acct('Bank - PSC', { disabled: 1 })])))
      .toMatchObject({ outcome: 'refuse', code: 'imprest-head-office-account-unfit' });
  });

  it('AC-IMP-071 refuses without a company, a head office account, or a matching currency', async () => {
    expect(await resolveImprestPosting(gate, deps({ readBinding: async () => ({ company: null, headOfficeAccount: 'Bank - PSC' }) }))).toMatchObject({ code: 'config-rejected' });
    expect(await resolveImprestPosting(gate, deps({ readBinding: async () => ({ company: 'PMO Smoke Co', headOfficeAccount: null }) })))
      .toMatchObject({ code: 'imprest-head-office-account-unconfigured' });
    expect(await resolveImprestPosting(gate, deps({ readErpCompany: async () => ({ currency: 'USD' }) }))).toMatchObject({ code: 'config-rejected' });
    expect(await resolveImprestPosting(gate, deps({ readErpCompany: async () => null }))).toMatchObject({ code: 'config-rejected' });
  });

  it('AC-IMP-071 the same account at both ends is refused', async () => {
    expect(await resolveImprestPosting(gate, deps({ readBinding: async () => ({ company: 'PMO Smoke Co', headOfficeAccount: 'Site Cash F - PSC' }) })))
      .toMatchObject({ outcome: 'refuse', code: 'imprest-head-office-account-unfit' });
  });
});
