import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import type { ImportDescriptor } from './types';
import { keyedAlready, labelOf, makeField, requiredText } from './importShared';

/**
 * People import (#2530, FR-IMT-012): employee code and display name only. No salary, contact, tax, bank or location
 * data, and no login link: those are never read from a file. `create` is the people register's own create (job title and login link stay empty).
 */
export function makePeopleImportDescriptor(existingCodes: () => Promise<Iterable<string>>, t?: TFunction): ImportDescriptor<{ code: string; name: string }> {
  const L = labelOf(t);
  const F = (key: string, en: string, id: string, validate: (r: string) => string | null, hint?: string) =>
    makeField<{ code: string; name: string }>(key, L(`import:people.${key}`, en), true, validate, { aliases: [en, id], inRowTitle: true, ...(hint ? { hint } : {}) });
  return {
    entity: 'People',
    entityDisplay: L('import:entity.people', 'people'),
    entityDisplayOne: L('import:entity.person', 'person'),
    rowTitle: (c) => [c.code, c.name].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: { version: 1, example: { code: 'E-0001', name: 'Sample Person' } },
    fields: [
      F('code', 'Employee code', 'Kode karyawan', requiredText(L('import:people.error.code', 'Employee code is required.'), 40, L('import:people.error.codeLong', 'Employee code is too long.')), L('import:people.codeHint', 'Your own code for the person. Each code is used once.')),
      F('name', 'Display name', 'Nama tampilan', requiredText(L('import:people.error.name', 'Display name is required.'), 120, L('import:people.error.nameLong', 'Display name is too long.'))),
    ],
    existingKeys: keyedAlready(existingCodes, 'code', {
      alreadyThere: L('import:people.alreadyThere', 'This employee code already exists.'),
      unavailable: L('import:existing.unavailable', 'Could not check which records already exist.'),
      nothingNew: L('import:existing.nothingNew', 'Every row is already there.'),
    }),
    toInput: (c) => ({ code: c.code.trim(), name: c.name.trim() }),
    create: (input) => repositories.people.create({ ...input, job_title: null, profile_id: null }),
  };
}
