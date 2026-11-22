import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}), updateFields: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { people: { create: h.create, updateFields: h.updateFields } } }));
import { makePeopleImportDescriptor } from '../employeeDescriptor';
import { applyMatches, validateRows } from '../validateRows';
import { autoMap } from '../autoMap';
import { rowToCells } from '../validateRows';
import type { PersonListRow } from '@/src/lib/db/people';

const person = (over: Partial<PersonListRow>): PersonListRow => ({ id: 'a', code: 'P-0001', name: 'Ana', job_title: 'Welder', profile_id: null, manager_id: null, archived_at: null, ...over });
const managers = [{ id: 'm1', email: 'Lead@Example.org' }, { id: 'm2', email: 'other@example.org' }];
const make = (people: PersonListRow[] = []) => makePeopleImportDescriptor({ people: async () => people, managers });
const HEAD = ['Employee code', 'Display name', 'Job title', 'Manager email'];

beforeEach(() => vi.clearAllMocks());

describe('people import: match by code, update, never clear (AC-PIU)', () => {
  it('AC-PIU-002 the template has code, name, job title and manager email', () => {
    expect(make().fields.map((f) => f.key)).toEqual(['code', 'name', 'job_title', 'manager_id']);
    expect(make().fields.filter((f) => f.required).map((f) => f.key)).toEqual(['code', 'name']);
  });

  it('AC-PIU-013 a manager is matched to an active member by sign-in email (case-insensitive); an unknown one is a row error naming the field', () => {
    const d = make();
    const v = validateRows([['E-1', 'A', '', ' lead@example.ORG '], ['E-2', 'B', '', 'nobody@example.org']], d.fields, autoMap(HEAD, d.fields));
    expect(v[0].valid).toBe(true);
    expect(d.toInput({ code: 'E-1', name: 'A', job_title: '', manager_id: ' lead@example.ORG ' })).toMatchObject({ manager_id: 'm1' });
    expect(v[1].errors.manager_id).toMatch(/Manager email "nobody@example.org" not found/);
  });

  it('AC-PIU-007 a repeated code in the file is a row error naming the first row', () => {
    const d = make();
    const v = validateRows([['E-1', 'A', '', ''], ['e-1 ', 'B', '', '']], d.fields, autoMap(HEAD, d.fields), d.validateRow, d.validateSheet);
    expect(v[0].valid).toBe(true);
    expect(v[1].errors.code).toMatch(/row 2/);
  });

  const preview = async (people: PersonListRow[], rows: string[][]) => {
    const d = make(people);
    const mapping = autoMap(HEAD, d.fields);
    const records = new Map(await d.matchExisting!.load());
    const v = validateRows(rows, d.fields, mapping);
    return { d, out: applyMatches(v, rows.map((r) => rowToCells(r, d.fields, mapping)), d.matchExisting!, records) };
  };

  it('AC-PIU-001 an existing code with a new name and title previews each change, old to new', async () => {
    const { out } = await preview([person({})], [[' p-0001 ', 'Ana Putri', 'Foreman', '']]);
    expect(out[0].action).toBe('update');
    expect(out[0].changes).toEqual([
      { field: 'Display name', from: 'Ana', to: 'Ana Putri' },
      { field: 'Job title', from: 'Welder', to: 'Foreman' },
    ]);
  });

  it('AC-PIU-004 a blank job title or manager cell changes nothing: it never clears a stored value', async () => {
    const { out } = await preview([person({ manager_id: 'm1' })], [['P-0001', 'Ana', '', '']]);
    expect(out[0]).toMatchObject({ valid: false, already: true });
  });

  it('AC-PIU-013 a different manager previews as a change from the stored manager email to the new one', async () => {
    const { out } = await preview([person({ manager_id: 'm1' })], [['P-0001', 'Ana', '', 'other@example.org']]);
    expect(out[0].changes).toEqual([{ field: 'Manager email', from: 'Lead@Example.org', to: 'other@example.org' }]);
  });

  it('AC-PIU-005 identical values (ignoring case and spaces in the manager email) are no change', async () => {
    const { out } = await preview([person({ manager_id: 'm1' })], [['P-0001', ' Ana ', 'Welder', 'lead@example.org']]);
    expect(out[0]).toMatchObject({ valid: false, already: true });
  });

  it('AC-PIU-006 only live people are loaded, so a code used only by a former person is new', async () => {
    const list = vi.fn().mockResolvedValue([]);
    const d = makePeopleImportDescriptor({ people: list, managers });
    await d.matchExisting!.load();
    expect(list).toHaveBeenCalledWith();
  });

  it('AC-PIU-002 confirm sends only the fields that changed, to the update seam (never code or profile)', async () => {
    const { d } = await preview([person({})], [['P-0001', 'Ana Putri', 'Welder', 'other@example.org']]);
    const record = person({});
    await d.matchExisting!.update(record, { code: 'P-0001', name: 'Ana Putri', job_title: 'Welder', manager_id: 'other@example.org' });
    expect(h.updateFields).toHaveBeenCalledWith('a', { name: 'Ana Putri', manager_id: 'm2' });
  });

  it('AC-PIU-003 a new person is created with code, name, title and manager', async () => {
    const d = make();
    await d.create(d.toInput({ code: ' E-9 ', name: ' Cici ', job_title: ' Foreman ', manager_id: 'lead@example.org' }));
    expect(h.create).toHaveBeenCalledWith({ code: 'E-9', name: 'Cici', job_title: 'Foreman', manager_id: 'm1' });
  });

  it('a new person with blank optional cells is created without those keys', async () => {
    const d = make();
    await d.create(d.toInput({ code: 'E-9', name: 'Cici', job_title: '', manager_id: '' }));
    expect(h.create).toHaveBeenCalledWith({ code: 'E-9', name: 'Cici' });
  });
});
