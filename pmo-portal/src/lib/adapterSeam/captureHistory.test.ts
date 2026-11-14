import { describe, expect, it } from 'vitest';
import { collectPages, proposeCapture, reconcileCapture, revisionsMatch } from './captureHistory';

const source = (id: string, extra = {}) => ({ id, sourceId: 'binding', version: 'v1', kind: 'supplier_invoice' as const, state: 'invoiced' as const, projectIds: ['p'], supplierId: 's', currency: 'USD', faceMinor: '100', faceScale: 2, lines: [], familyId: 'f', purchaseId: null, ...extra });

describe('AC-ROP-018 signed reconciliation', () => {
  it('separates face evidence from represented and signed remainder, and retains excluded reasons', () => {
    const report = reconcileCapture({ scope: { sourceId: 'binding', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' }, complete: true, ledgerGeneration: 'g',
      documents: [source('i', { purchaseId: 'purchase' }), source('o', { kind: 'order', state: 'ordered', faceMinor: '900' })],
      lines: [{ id: 'l1', sourceId: 'binding', currency: 'USD', projectId: 'p', documentId: 'i', amountMinor: '125', classification: 'mapped', kind: 'supplier_invoice' }, { id: 'l2', sourceId: 'binding', currency: 'USD', projectId: 'p', documentId: null, amountMinor: '-25', classification: 'mapped', kind: 'journal' }, { id: 'l3', sourceId: 'binding', currency: 'USD', projectId: 'p', documentId: null, amountMinor: '30', classification: 'capital_spending', kind: 'other' }] });
    expect(report).toMatchObject({ complete: true, ledgerMinor: '100', representedMinor: '125', remainderMinor: '-25' });
    expect(report.remainder).toEqual([{ id: 'l2', amountMinor: '-25', reason: 'negative_journal_not_capturable' }]);
    expect(report.excluded).toEqual([{ id: 'l3', amountMinor: '30', reason: 'capital_spending' }]);
    expect(report.documentOnly).toEqual(['o']);
  });
  it('withholds totals on incomplete evidence and rejects duplicate ownership', () => {
    const scope = { sourceId: 'b', projectId: 'p', currency: 'JPY', scale: 0, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' };
    expect(reconcileCapture({ scope, complete: false, ledgerGeneration: 'g', documents: [], lines: [] }).ledgerMinor).toBeNull();
    expect(() => reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: [source('a'), source('a')], lines: [] })).toThrow();
    expect(reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: [], lines: [{ id: 'a', sourceId: 'b', currency: 'JPY', projectId: 'p', documentId: null, amountMinor: '1', kind: 'other', classification: 'unknown' }] }).complete).toBe(false);
  });
});

describe('AC-ROP-017 partial proposal helper', () => {
  it('uses strong family evidence, refuses unclear sources and retains source revisions', () => {
    const result = proposeCapture([source('a'), source('b', { kind: 'order', state: 'ordered' }), source('c', { projectIds: ['p', 'q'], familyId: 'other' }), source('d', { familyId: null }), source('e', { kind: 'other' }), source('f', { faceMinor: '-1' })], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped', b: 'mapped' } });
    expect(result.map(x => [x.id, x.outcome, x.reason])).toEqual([['a', 'propose', undefined], ['b', 'propose', undefined], ['c', 'remainder', 'spans_projects'], ['d', 'remainder', 'family_unknown'], ['e', 'remainder', 'unsupported_kind'], ['f', 'remainder', 'adjustment_requires_source_link']]);
    expect(result[0]).toMatchObject({ version: 'v1', familyId: 'f' });
    expect(revisionsMatch('g', 'g', [source('a')], [source('a', { version: 'v2' })])).toBe(false);
  });
  it('does not combine incompatible sources or silently convert a matched purchase', () => {
    const result = proposeCapture([source('a', { purchaseId: 'ordinary' }), source('b', { supplierId: 'different' })], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped', b: 'mapped' } });
    expect(result.map(x => x.reason)).toEqual(['family_conflict', 'family_conflict']);
  });
});

describe('AC-ROP-021 bounded page collection', () => {
  it('resumes across pages, preserving generation and identities', async () => {
    const read = async (cursor: string | null) => ({ supported: true as const, generation: 'g', items: [source(cursor ?? 'a')], nextCursor: cursor ? null : 'b' });
    const first = await collectPages(read, { limit: 1 });
    expect(first).toMatchObject({ complete: false, nextCursor: 'b', missing: ['page_limit'] });
    const second = await collectPages(read, { limit: 1, resume: first });
    expect(second).toMatchObject({ complete: true, items: [{ id: 'a' }, { id: 'b' }] });
  });
  it('rejects changing generation, duplicate identities and repeated cursors', async () => {
    const changing = await collectPages(async cursor => ({ supported: true as const, generation: cursor ? 'h' : 'g', items: [source(cursor ?? 'a')], nextCursor: cursor ? null : 'b' }), { limit: 3 });
    expect(changing).toMatchObject({ complete: false, missing: ['generation_changed'] });
    const duplicate = await collectPages(async cursor => ({ supported: true as const, generation: 'g', items: [source('a')], nextCursor: cursor ? null : 'b' }), { limit: 3 });
    expect(duplicate.missing).toEqual(['duplicate_or_empty_identity']);
    const cycle = await collectPages(async () => ({ supported: true as const, generation: 'g', items: [], nextCursor: 'b' }), { limit: 3 });
    expect(cycle.missing).toEqual(['repeated_cursor']);
  });
});

it('AC-ROP-017 proposals need trusted scope and a complete coherent census', () => {
  expect(proposeCapture([source('a')], null, { sourceId: 'binding', generation: '', accountScope: 'mapped', complete: true })[0].reason).toBe('evidence_incomplete');
  expect(proposeCapture([source('a')], null, { sourceId: 'binding', generation: 'g', accountScope: '', complete: true })[0].reason).toBe('evidence_incomplete');
});
it('AC-ROP-018 a mismatched generation or missing scope withholds the totals', () => {
  const result = reconcileCapture({ scope: { sourceId: 'b', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' }, complete: true, documents: [], lines: [], ledgerGeneration: 'other' });
  expect(result).toMatchObject({ complete: false, ledgerMinor: null, missing: ['generation_changed'] });
});
it('AC-ROP-017 unknown account basis and an ordinary purchase require a decision', () => {
  const evidence = { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'unknown' as const, b: 'mapped' as const } };
  const result = proposeCapture([source('a', { familyId: 'a' }), source('b', { familyId: 'b', purchaseId: 'ordinary', purchaseOrigin: 'ordinary' })], null, evidence);
  expect(result[0].reason).toBe('account_basis_unknown');
  expect(result[1]).toMatchObject({ outcome: 'matched', purchaseId: 'ordinary' });
});
it('AC-ROP-018 keeps a PMO-only assignment bridge outside ERP ledger totals', () => {
  const result = reconcileCapture({ scope: { sourceId: 'b', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' }, complete: true, ledgerGeneration: 'g', documents: [], lines: [], assignmentBridge: [{ id: 'assignment', amountMinor: '42' }] });
  expect(result).toMatchObject({ complete: true, ledgerMinor: '0', assignmentBridge: [{ id: 'assignment', amountMinor: '42' }], scope: { asOf: '2026-01-01T00:00:00Z' } });
});
it('AC-ROP-017 a proposal preserves the census scope used for later revalidation', () => {
  const result = proposeCapture([source('a')], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped' } });
  expect(result[0]).toMatchObject({ sourceId: 'binding', generation: 'g' });
});
it('AC-ROP-018 rejects ledger lines from another source or currency', () => {
  const scope = { sourceId: 'b', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' };
  const line = { id: 'l', documentId: null, amountMinor: '100', kind: 'journal' as const, classification: 'mapped' as const, sourceId: 'other', currency: 'EUR', projectId: 'p' };
  expect(reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: [], lines: [line] })).toMatchObject({ complete: false, ledgerMinor: null, missing: ['line_scope_mismatch'] });
});
it('AC-ROP-017 refuses sources from a different binding', () => {
  const result = proposeCapture([source('a', { sourceId: 'other' })], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped' } });
  expect(result[0].reason).toBe('source_scope_mismatch');
});
it('AC-ROP-017 source revisions cannot be replayed across bindings', () => {
  expect(revisionsMatch('g', 'g', [source('a')], [source('a', { sourceId: 'other' })])).toBe(false);
});
it('AC-ROP-023 partial source shape rejects repeated line identities', () => {
  const line = { id: 'line', description: 'item', projectShares: [] };
  expect(() => proposeCapture([source('a', { lines: [line, line] })], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped' } })).toThrow();
});
it('AC-ROP-018 an unrecognized account classification is unknown, never a complete zero', () => {
  const scope = { sourceId: 'binding', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' };
  const line = { id: 'l', sourceId: 'binding', projectId: 'p', currency: 'USD', documentId: null, amountMinor: '5', kind: 'other' as const, classification: 'unexpected' as 'unknown' };
  expect(reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: [], lines: [line] })).toMatchObject({ complete: false, ledgerMinor: null, missing: ['classification_unknown'] });
});
it('AC-ROP-017 state must be compatible with the proposed source kind', () => {
  const result = proposeCapture([source('a', { kind: 'order', state: 'paid' }), source('b', { state: 'received' })], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped', b: 'mapped' } });
  expect(result.map(x => x.reason)).toEqual(['state_unsupported', 'state_unsupported']);
});
it('AC-ROP-021 missing item evidence stays separate from scoped reconciliation', () => {
  const doc = source('a', { missing: ['line_evidence'] });
  const proposal = proposeCapture([doc], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped' } });
  expect(proposal[0].outcome).toBe('propose');
  const scope = { sourceId: 'binding', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' };
  expect(reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: [doc], lines: [] })).toMatchObject({ complete: true, ledgerMinor: '0', itemCoverage: { complete: false, missing: ['line_evidence'] } });
});
it('AC-ROP-017 refuses face amounts without a currency scale', () => {
  const proposal = proposeCapture([source('a', { faceScale: null })], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped' } });
  expect(proposal[0].reason).toBe('amount_or_currency_unknown');
});
it('AC-ROP-021 absent item evidence does not prevent a proposal', () => {
  const row = source('a', { lines: undefined });
  const result = proposeCapture([row], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped' } });
  expect(result[0].outcome).toBe('propose');
});
it('AC-ROP-018 shows original document face values separately from ledger totals', () => {
  const scope = { sourceId: 'binding', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' };
  const order = source('order', { kind: 'order', state: 'ordered', currency: 'JPY', faceMinor: '200', faceScale: 0 });
  expect(reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: [order], lines: [] })).toMatchObject({ ledgerMinor: '0', documents: [{ id: 'order', currency: 'JPY', faceMinor: '200', faceScale: 0 }] });
});
it('AC-ROP-021 rejects oversized pages without treating them as a complete census', async () => {
  const result = await collectPages(async () => ({ supported: true as const, generation: 'g', items: Array.from({ length: 501 }, (_, n) => source(String(n))), nextCursor: null }), { limit: 1 });
  expect(result).toMatchObject({ complete: false, missing: ['page_size_exceeded'], items: [] });
});
it('AC-ROP-018 exposes cancelled source state even when line evidence is missing', () => {
  const doc = source('a', { state: 'cancelled', missing: ['line_evidence'], lines: null });
  const evidence = { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped' as const } };
  expect(proposeCapture([doc], null, evidence)[0].reason).toBe('cancelled');
  const scope = { sourceId: 'binding', projectId: 'p', currency: 'USD', scale: 2, accountScope: 'mapped', generation: 'g', asOf: '2026-01-01T00:00:00Z' };
  expect(reconcileCapture({ scope, complete: true, ledgerGeneration: 'g', documents: [doc], lines: [] }).documents[0]).toMatchObject({ id: 'a', kind: 'supplier_invoice', state: 'cancelled' });
});
it('AC-ROP-017 a family cannot acquire an existing purchase from another binding', () => {
  const result = proposeCapture([source('a'), source('b', { sourceId: 'other', purchaseId: 'outside', purchaseOrigin: 'captured' })], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped', b: 'mapped' } });
  expect(result[0]).toMatchObject({ outcome: 'remainder', reason: 'family_conflict' });
  expect(result[0].purchaseId).toBeUndefined();
});

it('AC-ROP-017 an unlinked sibling of an ordinary purchase needs a decision', () => {
  const result = proposeCapture([source('a', { purchaseId: 'ordinary', purchaseOrigin: 'ordinary' }), source('b')], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped', b: 'mapped' } });
  expect(result[0]).toMatchObject({ outcome: 'matched', purchaseId: 'ordinary' });
  expect(result[1]).toMatchObject({ outcome: 'remainder', reason: 'ordinary_purchase_requires_decision' });
});
it('AC-ROP-017 still refuses missing critical facts without item evidence', () => {
  const docs = [source('project', { projectIds: [], familyId: 'project', lines: null }), source('family', { familyId: null, lines: null }), source('currency', { currency: null, familyId: 'currency', lines: null }), source('account', { familyId: 'account', lines: null }), source('binding', { sourceId: 'other', familyId: 'binding', lines: null })];
  const evidence = { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true };
  expect(proposeCapture(docs, null, evidence).map(x => x.reason)).toEqual(['no_project', 'family_unknown', 'amount_or_currency_unknown', 'account_basis_unknown', 'source_scope_mismatch']);
  expect(proposeCapture([source('a', { lines: null })], null, { ...evidence, generation: '' })[0].reason).toBe('evidence_incomplete');
});

it('AC-ROP-017 names unsupported source kinds even when their face evidence is unavailable', () => {
  const candidates = [source('payment', { kind: 'supplier_payment', state: 'paid', missing: ['face_currency_or_amount'], familyId: 'payment' }), source('receipt', { kind: 'receipt', state: 'received', missing: ['face_currency_or_amount'], familyId: 'receipt' })];
  const proposals = proposeCapture(candidates, null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true });
  expect(proposals.map(item => item.reason)).toEqual(['payment_without_invoice', 'receipt_only']);
});

it('AC-ROP-011 carries the hold while leaving another family eligible', () => {
  const hold = { supplierId: 's', projectId: 'p', currency: 'USD', purchaseId: 'purchase', undoCommand: 'node scripts/pmo.mjs purchases undo-record-only purchase --reason "Incorrect link"' };
  const result = proposeCapture([
    source('held', { kind: 'order', state: 'ordered', familyId: 'held', needsUndo: [hold] }),
    source('other', { kind: 'order', state: 'ordered', familyId: 'other', supplierId: 'other' }),
  ], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true });
  expect(result[0]).toMatchObject({ outcome: 'remainder', reason: 'needs_undo', needsUndo: [hold] });
  expect(result[1]).toMatchObject({ outcome: 'propose' });
});

it('AC-ROP-017 an unlinked sibling of an older link requires a decision', () => {
  const result = proposeCapture([source('a', { purchaseId: 'existing', purchaseOrigin: 'erp_link' }), source('b')], null, { sourceId: 'binding', generation: 'g', accountScope: 'mapped', complete: true, classifications: { a: 'mapped', b: 'mapped' } });
  expect(result[1]).toMatchObject({ outcome: 'remainder', reason: 'ordinary_purchase_requires_decision' });
});
