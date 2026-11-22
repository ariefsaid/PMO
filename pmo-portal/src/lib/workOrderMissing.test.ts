import { describe, expect, it } from 'vitest';
import { deriveWorkOrderMissing, missingStepsFromSource, toMissingExport, type MissingStep } from './workOrderMissing';

const none = { steps: [], scopeLines: [], reconciliation: [], status: 'Issued' };
const step = (o: Partial<MissingStep>): MissingStep => ({ id: 's1', position: 1, name: 'Step one', ownerRole: null, done: false, attachments: [], ...o });
const line = (o: Partial<{ id: string; boqItemId: string; accepted: number }>) => ({ id: 'l1', boqItemId: 'b1', itemCode: 'A1', description: 'Pipe', unit: 'm', accepted: 0, ...o });
const rec = (o: Partial<{ boqItemId: string; progressQty: number | null; billedQty: number }>) => ({ boqItemId: 'b1', itemCode: 'A1', description: 'Pipe', unit: 'm', progressQty: 0, billedQty: 0, ...o });

describe('deriveWorkOrderMissing', () => {
  it('AC-WML-001 an open step names its owner role; a done step gives no row; no owner role falls back to the team', () => {
    const rows = deriveWorkOrderMissing({ ...none, steps: [step({ ownerRole: 'Finance Officer' }), step({ id: 's2', position: 2, name: 'Done', done: true }), step({ id: 's3', position: 3, name: 'No owner' })] });
    expect(rows.map((r) => [r.kind, r.name, r.who])).toEqual([['step', 'Step one', { key: 'role', role: 'Finance Officer' }], ['step', 'No owner', { key: 'team' }]]);
  });

  it('AC-WML-002 a required attachment not attached is its own row under the step owner; attached and optional ones are not', () => {
    const rows = deriveWorkOrderMissing({ ...none, steps: [step({ ownerRole: 'Finance Officer', attachments: [
      { id: 'a1', name: 'Doc a', required: true, attached: false }, { id: 'a2', name: 'Doc b', required: true, attached: true }, { id: 'a3', name: 'Doc c', required: false, attached: false }] })] });
    expect(rows.map((r) => [r.kind, r.name])).toEqual([['step', 'Step one'], ['step-attachment', 'Doc a']]);
    expect(rows[1].who).toEqual({ key: 'role', role: 'Finance Officer' });
    expect(rows[1].reasonParams.step).toBe('Step one');
  });

  it('AC-WML-002 a done step lists none of its attachments', () => {
    expect(deriveWorkOrderMissing({ ...none, steps: [step({ done: true, attachments: [{ id: 'a1', name: 'Doc a', required: true, attached: false }] })] })).toEqual([]);
  });

  it('AC-WML-003 quantity reported but not accepted, and accepted but not claimed', () => {
    const rows = deriveWorkOrderMissing({ ...none, scopeLines: [line({ accepted: 6 }), line({ id: 'l2', boqItemId: 'b2', accepted: 5 })],
      reconciliation: [rec({ progressQty: 10, billedQty: 2 }), rec({ boqItemId: 'b2', progressQty: 5, billedQty: 5 })] });
    expect(rows.map((r) => [r.kind, r.reasonParams.quantity])).toEqual([['quantity-accept', 4], ['quantity-claim', 4]]);
    expect(rows[0].who).toEqual({ key: 'team' });
    expect(rows[1].who).toEqual({ key: 'finance' });
  });

  it('AC-WML-003 a shared item (reported unknown) and fully accepted or claimed items give no row', () => {
    expect(deriveWorkOrderMissing({ ...none, scopeLines: [line({ accepted: 3 })], reconciliation: [rec({ progressQty: null, billedQty: 3 })] })).toEqual([]);
  });

  it('AC-WML-004 steps arrive only through the input: a different source changes only the step rows', () => {
    const base = { ...none, scopeLines: [line({ accepted: 0 })], reconciliation: [rec({ progressQty: 2 })] };
    const a = deriveWorkOrderMissing({ ...base, steps: [step({ name: 'From source A' })] });
    const b = deriveWorkOrderMissing({ ...base, steps: [step({ name: 'From source B' })] });
    expect(a.map((r) => r.name)).toEqual(['From source A', 'A1 · Pipe']);
    expect(b.map((r) => r.name)).toEqual(['From source B', 'A1 · Pipe']);
  });

  it('AC-WML-006 a closed or cancelled work order lists nothing', () => {
    expect(deriveWorkOrderMissing({ ...none, status: 'Closed', steps: [step({})] })).toEqual([]);
    expect(deriveWorkOrderMissing({ ...none, status: 'Cancelled', steps: [step({})] })).toEqual([]);
  });
});

describe('toMissingExport', () => {
  it('AC-WML-005 header and body follow the rows in order', () => {
    const rows = deriveWorkOrderMissing({ ...none, steps: [step({}), step({ id: 's2', position: 2, name: 'Step two' })] });
    const table = toMissingExport(rows, { header: ['Item', 'Kind', 'Why', 'Who'], describe: (r) => ({ kind: 'k', reason: 'why ' + r.name, who: 'w' }) });
    expect(table.header).toEqual(['Item', 'Kind', 'Why', 'Who']);
    expect(table.body).toEqual([['Step one', 'k', 'why Step one', 'w'], ['Step two', 'k', 'why Step two', 'w']]);
  });
});

describe('missingStepsFromSource', () => {
  const src = (o: object) => ({ id: 's1', position: 1, name: 'Step one', ownerRoleKey: null, assigneeName: null, doneOn: null, skippedOn: null, documents: [], ...o });
  const label = (k: string) => 'Label of ' + k;

  it('AC-WML-008 done or skipped steps are done; open ones are not', () => {
    const m = missingStepsFromSource([src({}), src({ id: 's2', doneOn: '2026-11-01' }), src({ id: 's3', skippedOn: '2026-11-01' })], label);
    expect(m.map((s) => s.done)).toEqual([false, true, true]);
  });

  it('AC-WML-008 who adds is the assignee name, else the role label, else nobody', () => {
    const m = missingStepsFromSource([src({ assigneeName: 'Dewi', ownerRoleKey: 'r1' }), src({ id: 's2', ownerRoleKey: 'r1' }), src({ id: 's3' })], label);
    expect(m.map((s) => s.ownerRole)).toEqual(['Dewi', 'Label of r1', null]);
  });

  it('AC-WML-008 a slot with a document is attached, without one is not, and the required flag carries', () => {
    const m = missingStepsFromSource([src({ documents: [{ id: 'a', name: 'A', required: true, documentId: 'd' }, { id: 'b', name: 'B', required: false, documentId: null }] })], label);
    expect(m[0].attachments).toEqual([{ id: 'a', name: 'A', required: true, attached: true }, { id: 'b', name: 'B', required: false, attached: false }]);
  });
});
