import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}), place: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/lib/repositories/crews', () => ({ crewRepository: { create: h.create, place: h.place } }));
import { makeCrewImportDescriptor, makeCrewMemberImportDescriptor } from '../crewDescriptor';
import { validateRows } from '../validateRows';
import { autoMap } from '../autoMap';
import { buildTemplateWorkbook } from '../templateFile';
import { buildFailedRowsWorkbook } from '../failedRowsFile';
import { parseWorkbook } from '../parseWorkbook';
import type { ImportDescriptor } from '../types';

const run = <I,>(d: ImportDescriptor<I>, headers: string[], rows: string[][]) =>
  validateRows(rows, d.fields, autoMap(headers, d.fields), d.validateRow, d.validateSheet);
beforeEach(() => vi.clearAllMocks());

const refs = {
  disciplines: [{ id: 'd1', name: 'Piping' }],
  controllers: [{ id: 'u1', name: 'Budi' }, { id: 'u2', name: 'Twin' }, { id: 'u3', name: 'twin' }],
  vendors: [{ id: 'v1', name: 'Vendor Co' }],
  existingCodes: async () => ['OLD-1'],
};
const crewHeaders = ['Crew code', 'Name', 'Crew type', 'Vendor', 'Discipline', 'Field controller', 'Standard roles'];
const crewD = makeCrewImportDescriptor(refs);

describe('crews import', () => {
  it('AC-CIM-001 the template round trips: headers are the labels in order and the example row validates', async () => {
    const sheet = await parseWorkbook(await buildTemplateWorkbook(crewD));
    expect(sheet.headers).toEqual(crewHeaders);
    expect(run(crewD, sheet.headers, sheet.rows).map((r) => r.errors)).toEqual([{}]);
  });

  it('AC-CIM-002 refuses each bad row naming its field', () => {
    const v = run(crewD, crewHeaders, [
      ['', 'No code', 'own', '', '', '', ''],
      ['C2', 'Bad discipline', 'own', '', 'Nope', '', ''],
      ['C3', 'Vendor no vendor', 'vendor', '', '', '', ''],
      ['C4', 'Own with vendor', 'own', 'Vendor Co', '', '', ''],
      ['C5', 'Odd type', 'contractor', '', '', '', ''],
      ['C6', 'Twin controller', '', '', '', 'Twin', ''],
      ['C7', 'x'.repeat(121), '', '', '', '', ''],
      ['C8', 'Fine', 'vendor', 'vendor co', 'piping', 'budi', ''],
    ]);
    expect(v[0].errors.code).toBeTruthy();
    expect(v[1].errors.discipline).toMatch(/not found/);
    expect(v[2].errors.vendor).toBeTruthy();
    expect(v[3].errors.vendor).toBeTruthy();
    expect(v[4].errors.kind).toBeTruthy();
    expect(v[5].errors.controller).toMatch(/ambiguous/);
    expect(v[6].errors.name).toBeTruthy();
    expect(v[7]).toMatchObject({ valid: true, errors: {} });
  });

  it('AC-CIM-003 a repeated code fails on the repeat only, naming the first row', () => {
    const v = run(crewD, crewHeaders, [['C1', 'A', '', '', '', '', ''], [' c1 ', 'B', '', '', '', '', ''], ['C2', 'C', '', '', '', '', '']]);
    expect(v[0].valid).toBe(true);
    expect(v[1].errors.code).toMatch(/row 2/i);
    expect(v[2].valid).toBe(true);
  });

  it('AC-CIM-004 creates the crew with its roles in order through the repository, never sending org_id', async () => {
    const i = crewD.toInput({ code: ' C1 ', name: ' Pipe crew ', kind: '', vendor: '', discipline: 'Piping', controller: 'Budi', roles: 'Welder=2; Fitter = 3' });
    await crewD.create(i);
    expect(h.create).toHaveBeenCalledWith(
      { code: 'C1', name: 'Pipe crew', kind: 'own', discipline_id: 'd1', field_controller_id: 'u1', vendor_company_id: null },
      [{ name: 'Welder', headcount: 2 }, { name: 'Fitter', headcount: 3 }],
    );
    expect(JSON.stringify(h.create.mock.calls)).not.toContain('org_id');
  });

  it('AC-CIM-005 refuses a malformed, zero-headcount, oversized or repeated standard role', () => {
    const roleErr = (roles: string) => run(crewD, crewHeaders, [['C1', 'A', '', '', '', '', roles]])[0].errors.roles;
    expect(roleErr('Welder')).toBeTruthy();
    expect(roleErr('Welder=0')).toBeTruthy();
    expect(roleErr('Welder=501')).toBeTruthy();
    expect(roleErr('Welder=1.5')).toBeTruthy();
    expect(roleErr('=3')).toBeTruthy();
    expect(roleErr('Welder=1; welder=2')).toBeTruthy();
    expect(roleErr(`${'x'.repeat(61)}=1`)).toBeTruthy();
    expect(roleErr('Welder=2; Fitter=3;')).toBeUndefined();
    expect(roleErr('')).toBeUndefined();
  });

  it('AC-CIM-006 an existing code is keyed case-insensitively so it reads as already there', async () => {
    const keys = new Set(await crewD.existingKeys!.load());
    expect(keys.has(crewD.existingKeys!.keyOf({ code: ' old-1 ' }))).toBe(true);
    expect(keys.has(crewD.existingKeys!.keyOf({ code: 'NEW' }))).toBe(false);
  });
});

const memberRefs = {
  crews: [{ id: 'c1', code: 'CR-1' }, { id: 'c2', code: 'CR-2' }],
  workers: [{ id: 'w1', name: 'Sari', code: 'E-1' }, { id: 'w2', name: 'Andi', code: 'E-2' }, { id: 'w3', name: 'Andi', code: 'E-3' }],
  roles: [{ id: 'r1', crew_id: 'c1', name: 'Welder' }, { id: 'r2', crew_id: 'c2', name: 'Fitter' }],
  existing: async () => [{ crew_id: 'c1', worker_id: 'w1', valid_from: '2026-01-01' }],
};
const memHeaders = ['Crew code', 'Person', 'Standard role', 'From', 'To'];
const memD = makeCrewMemberImportDescriptor(memberRefs);

describe('crew members import', () => {
  it('AC-CIM-001 the template round trips', async () => {
    const sheet = await parseWorkbook(await buildTemplateWorkbook(memD));
    expect(sheet.headers).toEqual(memHeaders);
    expect(run(memD, sheet.headers, sheet.rows).map((r) => r.errors)).toEqual([{}]);
  });

  it('AC-CIM-007 refuses an unknown crew, person, a role not in the crew, and bad dates, naming the field', () => {
    const v = run(memD, memHeaders, [
      ['NOPE', 'E-1', '', '2026-02-01', ''],
      ['CR-1', 'Ghost', '', '2026-02-01', ''],
      ['CR-1', 'Andi', '', '2026-02-01', ''],
      ['CR-1', 'E-1', 'Fitter', '2026-02-01', ''],
      ['CR-1', 'E-1', '', '', ''],
      ['CR-1', 'E-1', '', '2026-02-30', ''],
      ['CR-1', 'E-1', '', '2026-03-01', '2026-02-01'],
      ['cr-1', 'sari', 'welder', '2026-02-01', '2026-02-28'],
      ['CR-2', 'E-2', 'Fitter', '2026-02-01', ''],
    ]);
    expect(v[0].errors.crew).toMatch(/not found/);
    expect(v[1].errors.worker).toMatch(/not found/);
    expect(v[2].errors.worker).toMatch(/ambiguous/);
    expect(v[3].errors.role).toBeTruthy();
    expect(v[4].errors.from).toBeTruthy();
    expect(v[5].errors.from).toBeTruthy();
    expect(v[6].errors.to).toBeTruthy();
    expect(v[7]).toMatchObject({ valid: true, errors: {} });
    expect(v[8]).toMatchObject({ valid: true, errors: {} });
  });

  it('AC-CIM-008 a later row placing the same person on overlapping dates fails; an open end runs on', () => {
    const v = run(memD, memHeaders, [
      ['CR-1', 'E-2', '', '2026-02-01', '2026-02-28'],
      ['CR-2', 'E-2', '', '2026-02-15', ''],
      ['CR-2', 'E-2', '', '2026-03-01', ''],
      ['CR-1', 'E-1', '', '2026-02-01', '2026-02-28'],
      ['CR-1', 'E-1', '', '2026-03-01', ''],
    ]);
    expect(v[0].valid).toBe(true);
    expect(v[1].errors.from).toMatch(/row 2/i);
    expect(v[2].valid).toBe(true);
    expect(v[3].valid).toBe(true);
    expect(v[4].valid).toBe(true);
  });

  it('AC-CIM-010 a placement with the same crew, person and start is already there', async () => {
    const keys = new Set(await memD.existingKeys!.load());
    expect(keys.has(memD.existingKeys!.keyOf({ crew: 'cr-1', worker: 'Sari', from: '2026-01-01' }))).toBe(true);
    expect(keys.has(memD.existingKeys!.keyOf({ crew: 'CR-1', worker: 'E-1', from: '2026-01-01' }))).toBe(true);
    expect(keys.has(memD.existingKeys!.keyOf({ crew: 'CR-1', worker: 'E-1', from: '2026-01-02' }))).toBe(false);
  });

  it('AC-CIM-012 creates with the resolved ids through the repository and no org_id', async () => {
    await memD.create(memD.toInput({ crew: 'cr-2', worker: 'E-2', role: 'fitter', from: '2026-02-01', to: '' }));
    expect(h.place).toHaveBeenCalledWith({ crew_id: 'c2', worker_id: 'w2', standard_role_id: 'r2', valid_from: '2026-02-01', valid_to: null });
    expect(JSON.stringify(h.place.mock.calls)).not.toContain('org_id');
  });

  it('AC-CIM-009 a database overlap refusal fails the row with the plain sentence, and the failed-rows file keeps its cells', async () => {
    h.place.mockRejectedValueOnce(Object.assign(new Error('conflicting key value violates exclusion constraint'), { code: '23P01' }));
    await expect(memD.create(memD.toInput({ crew: 'CR-1', worker: 'E-1', role: '', from: '2026-02-01', to: '' })))
      .rejects.toThrow(/overlap/i);
    const buf = await buildFailedRowsWorkbook({
      headers: memHeaders, rows: [['CR-1', 'E-1', '', '2026-02-01', '']], failed: [{ index: 0, reason: 'These dates overlap another placement.' }],
      skipped: [], labels: { sheet: 'Not imported', alreadyThere: 'Already there', rowInFile: 'Row in your file', reason: 'Why not imported' },
    });
    const back = await parseWorkbook(buf);
    expect(back.rows[0].slice(0, 5)).toEqual(['CR-1', 'E-1', '', '2026-02-01', '']);
    // the added columns are ignored by the mapper, so the file re-imports without editing headers
    expect(autoMap(back.headers, memD.fields).crew).toBe(0);
  });

  it('answers in Bahasa Indonesia headers too (FR-CIM-016)', () => {
    const m = autoMap(['Kode kru', 'Orang', 'Peran', 'Dari', 'Sampai'], memD.fields);
    expect(Object.values(m)).toEqual([0, 1, 2, 3, 4]);
    const c = autoMap(['Kode kru', 'Nama', 'Jenis kru', 'Perusahaan supplier', 'Disiplin', 'Pengawas lapangan', 'Peran standar'], crewD.fields);
    expect(Object.values(c)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
