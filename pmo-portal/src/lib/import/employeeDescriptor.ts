import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import type { PersonListRow } from '@/src/lib/db/people';
import type { ImportDescriptor } from './types';
import { labelOf, makeField, requiredText } from './importShared';
import { makeRefLookup } from './refLookup';

/** What the people import sends: code and name, and the optional job title and manager (an app user's id). */
interface PeopleImportInput { code: string; name: string; job_title?: string; manager_id?: string }
/** An active app user a person can be managed by; matched by sign-in email. */
export interface ManagerChoice { id: string; email: string }
export interface PeopleImportDeps {
  /** Live people only (the register's default list): a code used only by a former person is new, never reactivated. */
  people: () => Promise<PersonListRow[]>;
  /** Active members of the organisation. */
  managers: readonly ManagerChoice[];
}

const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase();

/**
 * People import (#2530, FR-IMT-012; update mode FR-PIU): matched by person code. A row whose code is a live person's updates
 * that person's display name, job title and manager; any other row adds a person. A blank cell, or a column not in the
 * file, leaves the stored value alone, so the import never clears a field and never archives anyone. The manager is
 * named by the manager's sign-in email and must be an active member. No salary, contact, tax, bank or location data,
 * and no login link: those are never read from a file. Writes go through the people repository under the caller's RLS.
 */
export function makePeopleImportDescriptor(deps: PeopleImportDeps, t?: TFunction): ImportDescriptor<PeopleImportInput> {
  const L = labelOf(t);
  const managerLabel = L('import:people.manager_id', 'Manager email');
  const managerByEmail = makeRefLookup(deps.managers.filter((m) => m.email).map((m) => ({ id: m.id, name: m.email })), managerLabel);
  const emailOf = (id: string | null | undefined) => deps.managers.find((m) => m.id === id)?.email;
  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, hint?: string, inRowTitle = false) =>
    makeField<PeopleImportInput>(key, L(`import:people.${key}`, en), required, validate, { aliases: [en, id], ...(inRowTitle ? { inRowTitle } : {}), ...(hint ? { hint } : {}) });
  const optionalText = (max: number, tooLong: string) => (raw: string): string | null => (raw.trim().length > max ? tooLong : null);
  const fieldLabel = (key: string, en: string) => L(`import:people.${key}`, en);

  return {
    entity: 'People',
    entityDisplay: L('import:entity.people', 'people'),
    entityDisplayOne: L('import:entity.person', 'person'),
    rowTitle: (c) => [c.code, c.name].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: { version: 2, example: { code: 'E-0001', name: 'Sample Person', job_title: 'Foreman', manager_id: '' } },
    fields: [
      F('code', 'Employee code', 'Kode karyawan', true, requiredText(L('import:people.error.code', 'Employee code is required.'), 40, L('import:people.error.codeLong', 'Employee code is too long.')), L('import:people.codeHint', 'Your own code for the person. A code already in the register updates that person; a new code adds one.'), true),
      F('name', 'Display name', 'Nama tampilan', true, requiredText(L('import:people.error.name', 'Display name is required.'), 120, L('import:people.error.nameLong', 'Display name is too long.')), undefined, true),
      F('job_title', 'Job title', 'Jabatan', false, optionalText(120, L('import:people.error.jobTitleLong', 'Job title is too long.')), L('import:people.jobTitleHint', 'Optional. Blank leaves the stored job title as it is.')),
      F('manager_id', 'Manager email', 'Email manajer', false, (raw) => managerByEmail(raw).error, L('import:people.managerHint', "Optional. The manager's sign-in email; they must be an active user. Blank leaves the stored manager as it is.")),
    ],
    validateSheet: (rows) => {
      const first = new Map<string, number>();
      return rows.map((c, i) => {
        const key = norm(c.code);
        if (key === '') return {};
        const at = first.get(key);
        if (at === undefined) { first.set(key, i); return {}; }
        return { code: L('import:people.error.repeat', 'This employee code already appears in row {n}.').replace('{n}', String(at + 2)) };
      });
    },
    matchExisting: {
      load: async () => (await deps.people()).map((p): [string, unknown] => [norm(p.code), p]),
      keyOf: (c) => norm(c.code),
      changes: (record, c) => {
        const p = record as PersonListRow;
        const out: { field: string; from: string; to: string }[] = [];
        const name = c.name.trim();
        if (name !== '' && name !== p.name) out.push({ field: fieldLabel('name', 'Display name'), from: p.name, to: name });
        const title = (c.job_title ?? '').trim();
        if (title !== '' && title !== (p.job_title ?? '')) out.push({ field: fieldLabel('job_title', 'Job title'), from: p.job_title ?? '', to: title });
        const manager = managerByEmail(c.manager_id ?? '').id;
        if (manager && manager !== p.manager_id) out.push({ field: managerLabel, from: emailOf(p.manager_id) ?? '', to: (c.manager_id ?? '').trim() });
        return out;
      },
      update: (record, c) => {
        const p = record as PersonListRow;
        const name = c.name.trim();
        const title = (c.job_title ?? '').trim();
        const manager = managerByEmail(c.manager_id ?? '').id;
        return repositories.people.updateFields(p.id, {
          ...(name !== '' && name !== p.name ? { name } : {}),
          ...(title !== '' && title !== (p.job_title ?? '') ? { job_title: title } : {}),
          ...(manager && manager !== p.manager_id ? { manager_id: manager } : {}),
        });
      },
      noChange: L('import:people.noChange', 'Already in the register with these values.'),
      unavailable: L('import:people.unavailable', 'Could not read the people register, so changes cannot be previewed. Try again.'),
      nothingToDo: L('import:people.nothingToDo', 'Nothing to add or change: every row matches the register.'),
    },
    toInput: (c) => {
      const title = (c.job_title ?? '').trim();
      const manager = managerByEmail(c.manager_id ?? '').id;
      return { code: c.code.trim(), name: c.name.trim(), ...(title ? { job_title: title } : {}), ...(manager ? { manager_id: manager } : {}) };
    },
    create: (input) => repositories.people.create(input),
  };
}
