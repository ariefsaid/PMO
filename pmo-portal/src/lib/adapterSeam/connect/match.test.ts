import { describe, expect, it } from 'vitest';
import { normaliseName, proposeMatches } from './match.ts';
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
