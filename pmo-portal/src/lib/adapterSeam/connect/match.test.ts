import { describe, expect, it } from 'vitest';
import { normaliseName, proposeMatches, reviewReasonText } from './match.ts';
import type { NormalisedMaster, PmoMaster } from './types.ts';

const erp = (externalId: string, name: string, o: Partial<NormalisedMaster> = {}): NormalisedMaster =>
  ({ kind: 'party', externalId, name, role: 'vendor', active: true, ...o });
const pmo = (id: string, name: string, o: Partial<PmoMaster> = {}): PmoMaster => ({ id, name, role: 'vendor', ...o });

describe('AC-ECA-002 proposeMatches gives every row exactly one outcome and never links a doubtful pair', () => {
  const P = [
    pmo('p-tax', 'Different Name', { taxId: '01.234' }), pmo('p-code', 'Beta', { code: 'B-1' }), pmo('p-name', 'PT. Gamma Tbk'),
    pmo('p-dup1', 'Delta'), pmo('p-dup2', 'Delta'), pmo('p-conf', 'Eps', { taxId: '111' }), pmo('p-only', 'Zeta'),
  ];
  const E = [
    erp('E-tax', 'Alpha', { taxId: '01234' }), erp('E-code', 'Beta Ltd', { code: 'b-1' }), erp('E-name', 'pt gamma'),
    erp('E-dup', 'Delta'), erp('E-conf', 'Eps', { taxId: '222' }), erp('E-only', 'Theta'), erp('E-off', 'Iota', { active: false }),
  ];
  const out = proposeMatches('party', P, E);
  const of = (id: string) => out.filter((o) => ('pmoId' in o && o.pmoId === id) || ('externalId' in o && o.externalId === id)
    || ('pmoIds' in o && o.pmoIds.includes(id)) || ('externalIds' in o && o.externalIds.includes(id)));

  it('unique tax id links on tax even when names differ', () => expect(of('E-tax')).toEqual([{ outcome: 'link', pmoId: 'p-tax', externalId: 'E-tax', key: 'tax' }]));
  it('unique code links on code, case-insensitive', () => expect(of('E-code')).toEqual([{ outcome: 'link', pmoId: 'p-code', externalId: 'E-code', key: 'code' }]));
  it('unique normalised name links (case, punctuation and a trailing legal form stripped)', () => expect(of('E-name')).toEqual([{ outcome: 'link', pmoId: 'p-name', externalId: 'E-name', key: 'name' }]));
  it('two name matches are one review, no link', () => expect(of('E-dup')).toEqual([{ outcome: 'review', pmoIds: ['p-dup1', 'p-dup2'], externalIds: ['E-dup'], reason: 'ambiguous' }]));
  it('a name match with conflicting tax ids is a review', () => expect(of('E-conf')).toEqual([{ outcome: 'review', pmoIds: ['p-conf'], externalIds: ['E-conf'], reason: 'tax-conflict' }]));
  it('ERP-only becomes bring-in, PMO-only becomes send', () => {
    expect(of('E-only')).toEqual([{ outcome: 'bring-in', externalId: 'E-only' }]);
    expect(of('p-only')).toEqual([{ outcome: 'send', pmoId: 'p-only' }]);
  });
  it('PQ-ECA-2 an inactive unmatched ERP row has no outcome', () => expect(of('E-off')).toEqual([]));
  it('every PMO and active ERP row appears exactly once', () => {
    for (const id of [...P.map((p) => p.id), ...E.filter((e) => e.active).map((e) => e.externalId)]) expect(of(id)).toHaveLength(1);
  });
  it('two ERP rows claiming one PMO row by name are both review', () => {
    const r = proposeMatches('party', [pmo('p', 'Acme')], [erp('E1', 'Acme'), erp('E2', 'ACME')]);
    expect(r).toEqual([{ outcome: 'review', pmoIds: ['p'], externalIds: ['E1', 'E2'], reason: 'ambiguous' }]);
  });
  it('kind policy: an ERP-only item or project is never brought in; a PMO-only account is never sent', () => {
    expect(proposeMatches('item', [], [{ ...erp('I', 'Semen'), kind: 'item', role: undefined }])).toEqual([]);
    expect(proposeMatches('project', [], [{ ...erp('P', 'Jembatan'), kind: 'project', role: undefined }])).toEqual([]);
    expect(proposeMatches('account', [{ id: 'Labor', name: 'Labor', code: 'Labor' }], [])).toEqual([]);
  });
  it('roles never cross: a client does not match a vendor of the same name', () => {
    expect(proposeMatches('party', [pmo('p', 'Acme', { role: 'client' })], [erp('E', 'Acme')]))
      .toEqual([{ outcome: 'bring-in', externalId: 'E' }, { outcome: 'send', pmoId: 'p' }]);
  });
  it('PD-ECA-16 normaliseName strips case, punctuation, spacing and trailing legal forms, never a leading one', () => {
    expect(normaliseName('PT. ACME  Tbk')).toBe('pt acme');
    expect(normaliseName('Acme Co., Ltd')).toBe('acme');
    expect(normaliseName('PT Acme')).not.toBe(normaliseName('CV Acme'));
  });
  it('FR-ECA-011 two same-name candidates are a review even when only one has a tax id that differs', () => {
    expect(proposeMatches('party', [pmo('a', 'Acme', { taxId: '2' }), pmo('b', 'Acme')], [erp('E', 'Acme', { taxId: '1' })]))
      .toEqual([{ outcome: 'review', pmoIds: ['a', 'b'], externalIds: ['E'], reason: 'tax-conflict' }]);
  });
  it('doubtful claims that share a PMO row merge into one review, so no row has two outcomes', () => {
    const r = proposeMatches('party', [pmo('p1', 'Acme', { code: 'A-1' }), pmo('p2', 'Acme')], [erp('E1', 'Acme'), erp('E2', 'Other', { code: 'a-1' })]);
    expect(r).toEqual([{ outcome: 'review', pmoIds: ['p1', 'p2'], externalIds: ['E1', 'E2'], reason: 'ambiguous' }]);
  });
  it('PQ-ECA-2 an inactive ERP row links on a strong key only, never on a name', () => {
    expect(proposeMatches('party', [pmo('k', 'Other', { taxId: '77' })], [erp('E', 'Kappa', { taxId: '77', active: false })]))
      .toEqual([{ outcome: 'link', pmoId: 'k', externalId: 'E', key: 'tax' }]);
    expect(proposeMatches('party', [pmo('l', 'Lambda')], [erp('E', 'Lambda', { active: false })]))
      .toEqual([{ outcome: 'send', pmoId: 'l' }]);
  });
});

describe('C1 a person or an account never links on a bare name', () => {
  const emp = (externalId: string, name: string, o: Partial<NormalisedMaster> = {}): NormalisedMaster => ({ kind: 'employee', externalId, name, active: true, ...o });
  it('a unique employee name is a review, never a link', () => {
    expect(proposeMatches('employee', [{ id: 'u1', name: 'Budi Santoso' }], [emp('E1', 'Budi Santoso')]))
      .toEqual([{ outcome: 'review', pmoIds: ['u1'], externalIds: ['E1'], reason: 'ambiguous' }]);
  });
  it('an employee name hit whose work emails disagree is a review marked as a conflict', () => {
    expect(proposeMatches('employee', [{ id: 'u1', name: 'Budi Santoso', code: 'budi@pmo.co' }], [emp('E1', 'Budi Santoso', { code: 'other@x.co' })]))
      .toEqual([{ outcome: 'review', pmoIds: ['u1'], externalIds: ['E1'], reason: 'tax-conflict' }]);
  });
  it('an employee still links on a unique work email', () => {
    expect(proposeMatches('employee', [{ id: 'u1', name: 'Budi', code: 'budi@pmo.co' }], [emp('E1', 'Someone Else', { code: 'BUDI@pmo.co' })]))
      .toEqual([{ outcome: 'link', pmoId: 'u1', externalId: 'E1', key: 'code' }]);
  });
  it('an account named like a category but without the category code is a review, never a link', () => {
    const r = proposeMatches('account', [{ id: 'Labor', name: 'Labor', code: 'Labor' }], [{ kind: 'account', externalId: 'ACC', name: 'Labor', code: null, active: true }]);
    expect(r).toEqual([{ outcome: 'review', pmoIds: ['Labor'], externalIds: ['ACC'], reason: 'ambiguous' }]);
  });
  it('other kinds still link on a unique name', () => {
    expect(proposeMatches('item', [{ id: 'i', name: 'Semen' }], [{ kind: 'item', externalId: 'I', name: 'Semen', active: true }]))
      .toEqual([{ outcome: 'link', pmoId: 'i', externalId: 'I', key: 'name' }]);
  });
});

describe('reviewReasonText says why a row needs a person, in plain words', () => {
  it('names the reason for each kind of doubt', () => {
    expect(reviewReasonText('party', { reason: 'ambiguous', pmoIds: ['a', 'b'], externalIds: ['x'] })).toBe('Two or more records could be this one');
    expect(reviewReasonText('employee', { reason: 'ambiguous', pmoIds: ['a'], externalIds: ['x'] })).toBe('The names match, but nothing else confirms it is the same record');
    expect(reviewReasonText('party', { reason: 'tax-conflict', pmoIds: ['a'], externalIds: ['x'] })).toBe('Tax numbers do not match');
    expect(reviewReasonText('employee', { reason: 'tax-conflict', pmoIds: ['a'], externalIds: ['x'] })).toBe('Work emails do not match');
    expect(reviewReasonText('party', { reason: 'rejected', pmoIds: ['a'], externalIds: ['x'] })).toBe('An administrator declined this pairing');
    expect(reviewReasonText('party', { reason: 'held', pmoIds: ['a'], externalIds: [] })).toBe('We could not confirm whether the ERP created this record');
  });
  it('never carries ERP vocabulary', () => {
    for (const reason of ['ambiguous', 'tax-conflict', 'rejected', 'held'] as const) {
      expect(reviewReasonText('account', { reason, pmoIds: ['a'], externalIds: ['x'] })).not.toMatch(/doctype|supplier|customer|frappe/i);
    }
  });
});

describe('AC-OSP-001 stock kinds propose links on code or plain name, hold doubts, and say what matched nothing', () => {
  // #1508 setup stock mapping: PMO proposes, the Admin accepts. A stock item/warehouse is never sent to the ERP and
  // nothing is imported, so every PMO row ends in a link, a review, or an explicit unmatched — never silence.
  const stockErp = (externalId: string, name: string, o: Partial<NormalisedMaster> = {}): NormalisedMaster =>
    ({ kind: 'stock_item', externalId, name, active: true, ...o });
  const stockPmo = (id: string, name: string, o: Partial<PmoMaster> = {}): PmoMaster => ({ id, name, ...o });

  it('a unique code proposes a link (case-insensitive), names only breaking ties', () => {
    expect(proposeMatches('stock_item', [stockPmo('i-1', 'Semen 50 kg', { code: 'SMN-50' })], [stockErp('9', 'Semen 50 KG', { code: 'smn-50' })]))
      .toEqual([{ outcome: 'link', pmoId: 'i-1', externalId: '9', key: 'code' }]);
  });

  it('without a code hit, a unique name links on whitespace and case only', () => {
    expect(proposeMatches('stock_warehouse', [stockPmo('w-1', 'Gudang  Utama')], [{ ...stockErp('10', 'gudang utama'), kind: 'stock_warehouse' }]))
      .toEqual([{ outcome: 'link', pmoId: 'w-1', externalId: '10', key: 'name' }]);
  });

  it('no legal-form is stripped and punctuation is kept: "Gudang Tbk" is not "Gudang"', () => {
    expect(proposeMatches('stock_warehouse', [stockPmo('w-1', 'Gudang Tbk')], [{ ...stockErp('10', 'Gudang'), kind: 'stock_warehouse' }]))
      .toEqual([{ outcome: 'unmatched', pmoId: 'w-1' }]);
    expect(proposeMatches('stock_item', [stockPmo('i-1', 'Borong 50kg.')], [stockErp('9', 'borong 50kg')]))
      .toEqual([{ outcome: 'unmatched', pmoId: 'i-1' }]);
  });

  it('two PMO stock rows competing for one Odoo record are one review, never a link', () => {
    expect(proposeMatches('stock_item', [stockPmo('a', 'Cat Tembok'), stockPmo('b', 'cat tembok')], [stockErp('9', 'Cat Tembok')]))
      .toEqual([{ outcome: 'review', pmoIds: ['a', 'b'], externalIds: ['9'], reason: 'ambiguous' }]);
  });

  it('one PMO stock row matching several Odoo records is a review, never a link', () => {
    expect(proposeMatches('stock_warehouse', [stockPmo('w', 'Gudang Site A')],
      [{ ...stockErp('10', 'Gudang Site A'), kind: 'stock_warehouse' }, { ...stockErp('11', 'gudang site a'), kind: 'stock_warehouse' }]))
      .toEqual([{ outcome: 'review', pmoIds: ['w'], externalIds: ['10', '11'], reason: 'ambiguous' }]);
  });

  it('a PMO row with no match is an explicit unmatched, an Odoo-only record proposes nothing, archived rows nothing', () => {
    expect(proposeMatches('stock_item',
      [stockPmo('i-1', 'Semen 50 kg', { code: 'SMN-50' }), stockPmo('i-2', 'Only in PMO'), stockPmo('i-old', 'Archived item', { active: false })],
      [stockErp('9', 'Semen', { code: 'SMN-50' }), stockErp('8', 'Only in Odoo')]))
      .toEqual([{ outcome: 'link', pmoId: 'i-1', externalId: '9', key: 'code' }, { outcome: 'unmatched', pmoId: 'i-2' }]);
    expect(proposeMatches('stock_warehouse', [stockPmo('w-1', 'Only in PMO')], [{ ...stockErp('10', 'Only in Odoo'), kind: 'stock_warehouse' }]))
      .toEqual([{ outcome: 'unmatched', pmoId: 'w-1' }]);
  });

  it('rows already linked are not proposed again on either side', () => {
    const linked = { pmoIds: new Set(['i-1']), externalIds: new Set(['9']) };
    expect(proposeMatches('stock_item',
      [stockPmo('i-1', 'Already linked', { code: 'OLD-1' }), stockPmo('i-2', 'Cat Tembok')],
      [stockErp('9', 'Already linked', { code: 'OLD-1' }), stockErp('8', 'Cat Tembok')], linked))
      .toEqual([{ outcome: 'link', pmoId: 'i-2', externalId: '8', key: 'name' }]);
  });

  it('the procurement item kind keeps its own matching: it still strips a trailing legal form', () => {
    expect(proposeMatches('item', [stockPmo('i-1', 'Beta')], [stockErp('E', 'Beta Ltd', { kind: 'item' })]))
      .toEqual([{ outcome: 'link', pmoId: 'i-1', externalId: 'E', key: 'name' }]);
  });
});

describe('FR-ODC-052 reviewReasonText for a party with no role', () => {
  it('says what is missing, in PMO words', () => {
    expect(reviewReasonText('party', { reason: 'ambiguous', pmoIds: [], externalIds: ['7'] })).toBe('The ERP does not say whether this is a supplier or a customer');
  });
});
