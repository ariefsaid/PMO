import { describe, expect, it } from 'vitest';
import { sendsFinished, type SendsStatus } from './sendsFinished.ts';

const none = { link: 0, bring_in: 0, send: 0, review: 0, applied_link: 0 };
const settled = (over: Partial<SendsStatus> = {}): SendsStatus => ({
  run: { state: 'ready', finished_at: '2026-11-08T10:00:00Z' }, waitingForSend: 0, proposalCounts: { party: none, project: none }, ...over,
});

describe('odoo/sendsFinished: FR-ODC-110 the sends step follows send state, not a stored marker', () => {
  it('FR-ODC-110 a settled run with nothing waiting, nothing left to send and no review row is finished', () => {
    expect(sendsFinished(settled())).toBe(true);
  });

  it('FR-ODC-110 no setup run yet is not finished', () => {
    expect(sendsFinished(settled({ run: null }))).toBe(false);
  });

  it('FR-ODC-110 a run still staging or failed is not finished', () => {
    expect(sendsFinished(settled({ run: { state: 'proposing', finished_at: null } }))).toBe(false);
    expect(sendsFinished(settled({ run: { state: 'failed', finished_at: '2026-11-08T10:00:00Z' } }))).toBe(false);
  });

  it('FR-ODC-110 a ready run whose sends Odoo has not confirmed is not finished', () => {
    expect(sendsFinished(settled({ run: { state: 'ready', finished_at: null }, waitingForSend: 2 }))).toBe(false);
    expect(sendsFinished(settled({ waitingForSend: 1 }))).toBe(false);
  });

  it('FR-ODC-110 an open send row or an open review row in a party, item or project is not finished', () => {
    expect(sendsFinished(settled({ proposalCounts: { party: { ...none, send: 1 } } }))).toBe(false);
    expect(sendsFinished(settled({ proposalCounts: { party: none, project: { ...none, review: 3 } } }))).toBe(false);
    expect(sendsFinished(settled({ proposalCounts: { party: none, item: { ...none, review: 1 } } }))).toBe(false);
  });

  it('FR-ODC-110 an account review (Finance\'s chart mapping, which never sends) does not hold the step', () => {
    expect(sendsFinished(settled({ proposalCounts: { party: none, account: { ...none, review: 5, send: 2 } } }))).toBe(true);
  });

  it('FR-ODC-110 a ready run whose finished_at is unset is not finished even with nothing waiting', () => {
    expect(sendsFinished(settled({ run: { state: 'ready', finished_at: null }, waitingForSend: 0 }))).toBe(false);
  });

  it('FR-ODC-110 open link and bring-in rows do not hold the sends step', () => {
    expect(sendsFinished(settled({ proposalCounts: { party: { ...none, link: 4, bring_in: 2, applied_link: 1 } } }))).toBe(true);
  });

  it('FR-ODC-110 counts that were not returned cannot show Done', () => {
    expect(sendsFinished(settled({ proposalCounts: undefined }))).toBe(false);
  });
});
