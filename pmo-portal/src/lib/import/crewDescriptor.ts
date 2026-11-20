import type { TFunction } from 'i18next';
import { crewRepository, type CrewInput, type PlacementInput, type StandardRoleInput } from '@/src/lib/repositories/crews';
import type { ImportDescriptor } from './types';
import { makeRefLookup, refId, refValidate } from './refLookup';
import { labelOf, makeField, requiredText } from './importShared';

type Cells = Record<string, string>;
type Ref = { id: string; name: string };

/** One crew with its standard roles, as `crewRepository.create` takes it (#2551). */
export interface CrewImportInput { crew: CrewInput; roles: StandardRoleInput[] }

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => {
  if (!ISO.test(s)) return false;
  const date = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === s;
};
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const FAR = '9999-12-31';

/** "Welder=2; Fitter=3" → roles, or the first thing wrong with it as a message key. */
function parseRoles(raw: string): { roles: StandardRoleInput[]; error: 'format' | 'headcount' | 'long' | 'repeat' | null } {
  const roles: StandardRoleInput[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*=\s*(\d+)$/.exec(part);
    if (!m) return { roles, error: 'format' };
    const name = m[1].trim();
    const headcount = Number(m[2]);
    if (headcount < 1 || headcount > 500) return { roles, error: 'headcount' };
    if (name.length > 60) return { roles, error: 'long' };
    if (seen.has(name.toLowerCase())) return { roles, error: 'repeat' };
    seen.add(name.toLowerCase());
    roles.push({ name, headcount });
  }
  return { roles, error: null };
}

export interface CrewImportRefs {
  disciplines: readonly Ref[];
  /** Users who may be a crew's field controller, by display name. */
  controllers: readonly Ref[];
  vendors: readonly Ref[];
  existingCodes: () => Promise<Iterable<string>>;
}

/**
 * Crews import (#2551, FR-CIM-001..008): code, name, own or vendor crew, vendor, discipline, field controller and
 * standard roles written `Name=headcount; Name=headcount`. `create` is the crew repository's atomic create (the crew
 * and its roles in one transaction under the caller's RLS grants); `org_id` is never sent.
 */
export function makeCrewImportDescriptor(refs: CrewImportRefs, t?: TFunction): ImportDescriptor<CrewImportInput> {
  const L = labelOf(t);
  const vendor = makeRefLookup(refs.vendors, L('import:crewImport.vendor', 'Vendor'));
  const discipline = makeRefLookup(refs.disciplines, L('import:crewImport.discipline', 'Discipline'));
  const controller = makeRefLookup(refs.controllers, L('import:crewImport.controller', 'Field controller'));
  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra = {}) =>
    makeField<CrewImportInput>(key, L(`import:crewImport.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  const kindOf = (c: Cells) => (norm(c.kind) === 'vendor' ? 'vendor' : 'own');
  return {
    entity: 'Crews',
    entityDisplay: L('import:entity.crews', 'crews'),
    entityDisplayOne: L('import:entity.crew', 'crew'),
    rowTitle: (c) => [c.code, c.name].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: {
      version: 1,
      example: {
        code: 'CR-01', name: 'Piping crew A', kind: 'own', vendor: '', discipline: refs.disciplines[0]?.name ?? '', controller: '',
        roles: 'Welder=2; Fitter=3',
      },
      lists: {
        kind: ['own', 'vendor'],
        ...(refs.disciplines.length > 0 && refs.disciplines.length <= 200 ? { discipline: refs.disciplines.map((d) => d.name) } : {}),
        ...(refs.vendors.length > 0 && refs.vendors.length <= 200 ? { vendor: refs.vendors.map((v) => v.name) } : {}),
      },
    },
    fields: [
      F('code', 'Crew code', 'Kode kru', true, requiredText(L('import:crewImport.error.code', 'Crew code is required.'), 20, L('import:crewImport.error.codeLong', 'Crew code is too long.')), { inRowTitle: true, hint: L('import:crewImport.codeHint', 'Your own code for the crew. Each live crew has its own code.') }),
      F('name', 'Name', 'Nama', true, requiredText(L('import:crewImport.error.name', 'Name is required.'), 120, L('import:crewImport.error.nameLong', 'Name is too long.')), { inRowTitle: true }),
      F('kind', 'Crew type', 'Jenis kru', false, (r) => (['', 'own', 'vendor'].includes(norm(r)) ? null : L('import:crewImport.error.kind', 'Crew type must be own or vendor.')), { hint: L('import:crewImport.kindHint', 'own or vendor. Blank means own.') }),
      F('vendor', 'Vendor', 'Perusahaan supplier', false, refValidate(vendor, false), { hint: L('import:crewImport.vendorHint', 'Required for a vendor crew: the name of an existing company.') }),
      F('discipline', 'Discipline', 'Disiplin', false, refValidate(discipline, false)),
      F('controller', 'Field controller', 'Pengawas lapangan', false, refValidate(controller, false), { hint: L('import:crewImport.controllerHint', 'The name of an existing user.') }),
      F('roles', 'Standard roles', 'Peran standar', false, (r) => {
        const { error } = parseRoles(r);
        if (error === null) return null;
        if (error === 'headcount') return L('import:crewImport.error.rolesHeadcount', 'Each role headcount must be a whole number from 1 to 500.');
        if (error === 'long') return L('import:crewImport.error.rolesLong', 'A role name is too long (60 characters at most).');
        if (error === 'repeat') return L('import:crewImport.error.rolesRepeat', 'A role name is listed twice.');
        return L('import:crewImport.error.rolesFormat', 'Standard roles must read like Welder=2; Fitter=3.');
      }, { hint: L('import:crewImport.rolesHint', 'Optional. Role name and headcount, e.g. Welder=2; Fitter=3.') }),
    ],
    validateRow: (c: Cells) => {
      const out: Record<string, string> = {};
      if (kindOf(c) === 'vendor' && norm(c.vendor) === '') out.vendor = L('import:crewImport.error.vendorNeeded', 'A vendor crew needs its vendor company.');
      if (kindOf(c) === 'own' && norm(c.kind) !== 'vendor' && norm(c.vendor) !== '') out.vendor = L('import:crewImport.error.vendorNotAllowed', 'An own-staff crew has no vendor company.');
      return out as never;
    },
    validateSheet: (rows) => {
      const first = new Map<string, number>();
      return rows.map((c, i) => {
        const key = norm(c.code);
        if (key === '') return {};
        const at = first.get(key);
        if (at === undefined) { first.set(key, i); return {}; }
        return { code: L('import:crewImport.error.repeat', 'This crew code already appears in row {n}.').replace('{n}', String(at + 2)) } as never;
      });
    },
    existingKeys: {
      load: async () => [...(await refs.existingCodes())].map((k) => norm(k)),
      keyOf: (c: Cells) => norm(c.code),
      alreadyThere: L('import:crewImport.alreadyThere', 'A live crew with this code already exists.'),
      unavailable: L('import:existing.unavailable', 'Could not check which records already exist.'),
      nothingNew: L('import:existing.nothingNew', 'Every row is already there.'),
    },
    toInput: (c: Cells) => {
      const kind = kindOf(c);
      return {
        crew: {
          code: c.code.trim(), name: c.name.trim(), kind,
          discipline_id: refId(discipline, c.discipline ?? ''), field_controller_id: refId(controller, c.controller ?? ''),
          vendor_company_id: kind === 'vendor' ? refId(vendor, c.vendor ?? '') : null,
        },
        roles: parseRoles(c.roles ?? '').roles,
      };
    },
    create: (i) => crewRepository.create(i.crew, i.roles),
  };
}

export interface CrewMemberImportRefs {
  crews: readonly { id: string; code: string }[];
  workers: readonly { id: string; name: string; code: string }[];
  roles: readonly { id: string; crew_id: string; name: string }[];
  /** Placements that exist, for the already-there check. */
  existing: () => Promise<readonly { crew_id: string; worker_id: string; valid_from: string }[]>;
}

/**
 * Crew members import (#2551, FR-CIM-009..014): crew code, person (code or name), optional standard role, from and to.
 * `create` is the crew repository's `place`: the database refuses a person already placed on overlapping dates
 * (`23P01`), and that row lands in the failed-rows file. Overlaps inside the file are caught at preview.
 */
export function makeCrewMemberImportDescriptor(refs: CrewMemberImportRefs, t?: TFunction): ImportDescriptor<PlacementInput> {
  const L = labelOf(t);
  const crew = makeRefLookup(refs.crews.map((c) => ({ id: c.id, name: c.code })), L('import:crewMemberImport.crew', 'Crew code'));
  const personByName = makeRefLookup(refs.workers, L('import:crewMemberImport.worker', 'Person'));
  const idsByCode = new Map<string, string[]>();
  for (const w of refs.workers) {
    const k = norm(w.code);
    if (k) idsByCode.set(k, [...(idsByCode.get(k) ?? []), w.id]);
  }
  const person = (raw: string): { id: string | null; error: string | null } => {
    const hits = idsByCode.get(norm(raw));
    if (hits?.length === 1) return { id: hits[0], error: null };
    if (hits && hits.length > 1) return { id: null, error: `${L('import:crewMemberImport.worker', 'Person')} "${raw.trim()}" is ambiguous (matches ${hits.length} records).` };
    return personByName(raw);
  };
  const crewCodeById = new Map(refs.crews.map((c) => [c.id, norm(c.code)]));
  const rolesOf = new Map<string, Map<string, string>>();
  for (const r of refs.roles) {
    const m = rolesOf.get(r.crew_id) ?? new Map<string, string>();
    m.set(norm(r.name), r.id);
    rolesOf.set(r.crew_id, m);
  }
  const roleId = (c: Cells): string | null => {
    const crewId = refId(crew, c.crew ?? '');
    return crewId && norm(c.role) ? rolesOf.get(crewId)?.get(norm(c.role)) ?? null : null;
  };
  const dateMsg = L('import:crewMemberImport.error.date', 'Dates are written year-month-day, e.g. 2026-01-31.');
  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, extra = {}) =>
    makeField<PlacementInput>(key, L(`import:crewMemberImport.${key}`, en), required, validate, { aliases: [en, id], ...extra });
  const requiredRef = (v: { id: string | null; error: string | null }) => v.error ?? (v.id === null ? L('import:crewMemberImport.error.required', 'Required.') : null);
  const firstCrew = refs.crews[0];
  const firstWorker = refs.workers[0];
  return {
    entity: 'Crew members',
    entityDisplay: L('import:entity.crewMembers', 'crew members'),
    entityDisplayOne: L('import:entity.crewMember', 'crew member'),
    rowTitle: (c) => [c.crew, c.worker].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: {
      version: 1,
      example: {
        crew: firstCrew?.code ?? 'CR-01', worker: firstWorker ? (firstWorker.code.length <= 20 ? firstWorker.code : firstWorker.name) : 'E-0001',
        role: '', from: '2026-01-01', to: '',
      },
    },
    fields: [
      F('crew', 'Crew code', 'Kode kru', true, (r) => requiredRef(crew(r)), { inRowTitle: true, hint: L('import:crewMemberImport.crewHint', 'The code of a live crew.') }),
      F('worker', 'Person', 'Orang', true, (r) => requiredRef(person(r)), { inRowTitle: true, hint: L('import:crewMemberImport.workerHint', 'The person\'s code or name, as in the people register.') }),
      F('role', 'Standard role', 'Peran', false, () => null, { hint: L('import:crewMemberImport.roleHint', 'Optional. One of the crew\'s standard roles.') }),
      F('from', 'From', 'Dari', true, (r) => (isDate(r.trim()) ? null : r.trim() === '' ? L('import:crewMemberImport.error.fromNeeded', 'From is required.') : dateMsg)),
      F('to', 'To', 'Sampai', false, (r) => (r.trim() === '' || isDate(r.trim()) ? null : dateMsg), { hint: L('import:crewMemberImport.toHint', 'Optional. Leave blank for no end date.') }),
    ],
    validateRow: (c: Cells) => {
      const out: Record<string, string> = {};
      if (norm(c.role) && refId(crew, c.crew ?? '') && roleId(c) === null) {
        out.role = L('import:crewMemberImport.error.role', 'This is not one of the crew\'s standard roles.');
      }
      const from = (c.from ?? '').trim(); const to = (c.to ?? '').trim();
      if (isDate(from) && isDate(to) && to < from) out.to = L('import:crewMemberImport.error.endBefore', 'To is before From.');
      return out as never;
    },
    validateSheet: (rows) => {
      const kept = new Map<string, { from: string; to: string; row: number }[]>();
      return rows.map((c, i) => {
        const w = person(c.worker ?? '').id;
        const from = (c.from ?? '').trim(); const to = (c.to ?? '').trim();
        if (!w || !refId(crew, c.crew ?? '') || (norm(c.role) !== '' && roleId(c) === null) || !isDate(from) || (to !== '' && (!isDate(to) || to < from))) return {};
        const list = kept.get(w) ?? [];
        const clash = list.find((p) => p.from <= (to || FAR) && from <= (p.to || FAR));
        if (clash) {
          return { from: L('import:crewMemberImport.error.overlapInFile', 'This person is already placed on overlapping dates in row {n}.').replace('{n}', String(clash.row + 2)) } as never;
        }
        kept.set(w, [...list, { from, to, row: i }]);
        return {};
      });
    },
    existingKeys: {
      load: async () => (await refs.existing()).flatMap((m) => {
        const code = crewCodeById.get(m.crew_id);
        return code ? [`${code}|${m.worker_id}|${m.valid_from}`] : [];
      }),
      keyOf: (c: Cells) => `${norm(c.crew)}|${person(c.worker ?? '').id ?? norm(c.worker)}|${(c.from ?? '').trim()}`,
      alreadyThere: L('import:crewMemberImport.alreadyThere', 'This person is already placed in this crew from this date.'),
      unavailable: L('import:existing.unavailable', 'Could not check which records already exist.'),
      nothingNew: L('import:existing.nothingNew', 'Every row is already there.'),
    },
    toInput: (c: Cells) => ({
      crew_id: refId(crew, c.crew ?? '') ?? '', worker_id: person(c.worker ?? '').id ?? '', standard_role_id: roleId(c),
      valid_from: c.from.trim(), valid_to: (c.to ?? '').trim() || null,
    }),
    create: async (input) => {
      try {
        await crewRepository.place(input);
      } catch (err) {
        if ((err as { code?: string } | null)?.code === '23P01') {
          throw new Error(L('import:crewMemberImport.error.overlap', 'These dates overlap another placement of this person. End that one first.'), { cause: err });
        }
        throw err;
      }
    },
  };
}
