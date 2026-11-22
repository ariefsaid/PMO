import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { documentExpiry: { create: h.create, update: h.update } } }));
import { makePersonDocumentImportDescriptor } from '../personDocumentDescriptor';
import { applyMatches, rowToCells, validateRows } from '../validateRows';
import { autoMap } from '../autoMap';
import type { ExpiryDocumentRow } from '@/src/lib/db/documentExpiry';

const doc = (o: Partial<ExpiryDocumentRow>): ExpiryDocumentRow => ({ id: 'd1', subject_kind: 'person', person_id: 'p1', asset_id: null, type_id: 't1', number: 'N-1', issued_on: '2025-01-01', expires_on: '2026-01-01', location_note: 'Cabinet 3', attachment_path: 'x/y.pdf', medical_status: null, is_medical: false, archived_at: null, ...o });
const deps = (docs: ExpiryDocumentRow[] = []) => ({
  people: [{ id: 'p1', code: 'P-0001' }, { id: 'p2', code: 'P-0002' }],
  types: [{ id: 't1', name: 'Site pass', is_medical: false }, { id: 't2', name: 'Fitness', is_medical: true }],
  documents: async () => docs,
});
const HEAD = ['Person code', 'Document type', 'Number', 'Issue date', 'Expiry date'];

beforeEach(() => vi.clearAllMocks());

describe('person document import (AC-PDI)', () => {
  it('AC-PDI-001 the template columns, in order, with the example validating', () => {
    const d = makePersonDocumentImportDescriptor(deps());
    expect(d.fields.map((f) => f.key)).toEqual(['person_code', 'document_type', 'number', 'issued_on', 'expires_on']);
    expect(d.fields.filter((f) => f.required).map((f) => f.key)).toEqual(['person_code', 'document_type', 'expires_on']);
    const row = HEAD.map((_, i) => Object.values(d.template!.example)[i]);
    const v = validateRows([row], d.fields, autoMap(HEAD, d.fields), d.validateRow, d.validateSheet);
    expect(v[0].errors).toEqual({});
  });

  it('AC-PDI-002 an unknown person or type, bad dates, and issue after expiry are row errors naming the field', () => {
    const d = makePersonDocumentImportDescriptor(deps());
    const rows = [['P-9', 'Site pass', '', '', '2026-01-01'], ['P-0001', 'Nope', '', '', '2026-01-01'], ['P-0001', 'Site pass', '', '', '01/02/2026'], ['P-0001', 'Site pass', '', '2027-01-01', '2026-01-01']];
    const v = validateRows(rows, d.fields, autoMap(HEAD, d.fields), d.validateRow, d.validateSheet);
    expect(v[0].errors.person_code).toMatch(/not found/);
    expect(v[1].errors.document_type).toMatch(/not found/);
    expect(v[2].errors.expires_on).toMatch(/year-month-day/);
    expect(v[3].errors.issued_on).toMatch(/after/i);
  });

  it('AC-PDI-003 a medical type is never imported, whoever runs it (it keeps its status and the medical rule on the person page)', () => {
    const d = makePersonDocumentImportDescriptor(deps());
    const v = validateRows([['P-0001', 'Fitness', '', '', '2026-01-01']], d.fields, autoMap(HEAD, d.fields));
    expect(v[0].errors.document_type).toMatch(/medical/i);
  });

  it('AC-PDI-004 a repeated person and type in the file is a row error naming the first row', () => {
    const d = makePersonDocumentImportDescriptor(deps());
    const rows = [['P-0001', 'Site pass', '', '', '2026-01-01'], ['p-0001', 'SITE PASS', '', '', '2027-01-01']];
    const v = validateRows(rows, d.fields, autoMap(HEAD, d.fields), d.validateRow, d.validateSheet);
    expect(v[1].errors.document_type).toMatch(/row 2/);
  });

  const preview = async (docs: ExpiryDocumentRow[], rows: string[][]) => {
    const d = makePersonDocumentImportDescriptor(deps(docs));
    const mapping = autoMap(HEAD, d.fields);
    const records = new Map(await d.matchExisting!.load());
    return { d, out: applyMatches(validateRows(rows, d.fields, mapping), rows.map((r) => rowToCells(r, d.fields, mapping)), d.matchExisting!, records) };
  };

  it('AC-PDI-005 a person with a live document of that type updates it: new expiry previews old to new; no live one adds', async () => {
    const { out } = await preview([doc({})], [['P-0001', 'Site pass', '', '', '2027-01-01'], ['P-0002', 'Site pass', 'Z-1', '', '2027-01-01']]);
    expect(out[0].action).toBe('update');
    expect(out[0].changes).toEqual([{ field: 'Expiry date', from: '2026-01-01', to: '2027-01-01' }]);
    expect(out[1].action).toBe('new');
  });

  it('AC-PDI-006 with several live documents of the type, the one expiring last is the current one that is updated', async () => {
    const { d } = await preview([doc({ id: 'old', expires_on: '2025-06-01' }), doc({ id: 'cur', expires_on: '2026-06-01' })], [['P-0001', 'Site pass', '', '', '2027-01-01']]);
    await d.matchExisting!.update(new Map(await d.matchExisting!.load()).get('p-0001|site pass'), { person_code: 'P-0001', document_type: 'Site pass', number: '', issued_on: '', expires_on: '2027-01-01' });
    expect(h.update).toHaveBeenCalledWith('cur', expect.anything());
  });

  it('AC-PDI-007 blank number and issue date never clear a stored value; the note, file and status are untouched', async () => {
    const { d, out } = await preview([doc({})], [['P-0001', 'Site pass', '', '', '2027-01-01']]);
    expect(out[0].changes?.map((c) => c.field)).toEqual(['Expiry date']);
    await d.matchExisting!.update(doc({}), { person_code: 'P-0001', document_type: 'Site pass', number: '', issued_on: '', expires_on: '2027-01-01' });
    expect(h.update).toHaveBeenCalledWith('d1', { number: 'N-1', issued_on: '2025-01-01', expires_on: '2027-01-01', location_note: 'Cabinet 3', medical_status: null });
  });

  it('AC-PDI-008 identical values are no change and write nothing', async () => {
    const { out } = await preview([doc({})], [['P-0001', 'Site pass', 'N-1', '2025-01-01', '2026-01-01']]);
    expect(out[0]).toMatchObject({ valid: false, already: true });
  });

  it('AC-PDI-009 a new document is created for the person and type with the dates, no org id, no file, no status', async () => {
    const d = makePersonDocumentImportDescriptor(deps());
    await d.create(d.toInput({ person_code: 'P-0002', document_type: 'Site pass', number: ' Z-1 ', issued_on: '', expires_on: '2027-01-01' }));
    expect(h.create).toHaveBeenCalledWith({ subject_kind: 'person', subject_id: 'p2', type_id: 't1', number: 'Z-1', issued_on: null, expires_on: '2027-01-01', location_note: null, medical_status: null, attachment_path: null });
  });
});
