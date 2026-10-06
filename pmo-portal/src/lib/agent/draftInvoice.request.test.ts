import { describe, expect, it } from 'vitest';
import { summarizeDraft, validateDraftRequest, validatePreparedDraft } from '../../../../supabase/functions/agent-chat/draftInvoice';
import { PREPARED } from './testing/draftInvoiceFixtures';

describe('validateDraftRequest (#787)', () => {
  it('FR-AIN-020 needs exactly one of workOrder / milestone', () => {
    expect(validateDraftRequest({ workOrder: ' WO-1 ' })).toEqual({ ok: true, value: { workOrder: 'WO-1' } });
    expect(validateDraftRequest({ milestone: '2', project: 'P' })).toEqual({ ok: true, value: { milestone: '2', project: 'P' } });
    expect(validateDraftRequest({})).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'a', milestone: 'b' })).toMatchObject({ ok: false });
  });
  it('rejects bad amounts and oversized text', () => {
    expect(validateDraftRequest({ workOrder: 'a', amount: 0 })).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'a', amount: 1.005 })).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'x'.repeat(101) })).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'a', amount: 5_000_000, itemCode: 'SVC' }))
      .toEqual({ ok: true, value: { workOrder: 'a', amount: 5_000_000, itemCode: 'SVC' } });
  });
});

describe('validatePreparedDraft / summarizeDraft (#787)', () => {
  it('AC-AIN-011 rebuilds from the allow-list, dropping smuggled fields', () => {
    const forged = { ...PREPARED, verb: 'submit', operation: 'transition', author_user_id: 'x', items: [{ ...PREPARED.items[0], verb: 'submit' }] };
    expect(validatePreparedDraft(forged)).toEqual({ ok: true, value: PREPARED });
  });
  it('refuses a malformed prepared draft', () => {
    expect(validatePreparedDraft({ ...PREPARED, kind: 'x' })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, customerId: 'not-a-uuid' })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, items: [{ ...PREPARED.items[0], qty: 2 }] })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, items: [{ ...PREPARED.items[0], rate: -1 }] })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, items: [] })).toMatchObject({ ok: false });
  });
  it('FR-AIN-024 the summary is ≤120 chars and says Draft / not submitted', () => {
    expect(summarizeDraft(PREPARED)).toBe('Save as Draft: invoice PT Client IDR 1,000,000.00 excl. tax for WO-20261001-001. Not submitted.');
    const long = { ...PREPARED, display: { ...PREPARED.display, customerName: 'C'.repeat(80), sourceLabel: 'S'.repeat(80), amountText: 'A'.repeat(40) } };
    expect(summarizeDraft(long).length).toBeLessThanOrEqual(120);
  });
});
