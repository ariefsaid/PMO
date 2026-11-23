import type { TFunction } from 'i18next';
import { repositories } from '@/src/lib/repositories';
import type { ExpiryDocumentRow } from '@/src/lib/db/documentExpiry';
import type { ImportDescriptor, RowChange } from './types';
import { labelOf, makeField } from './importShared';
import { makeRefLookup } from './refLookup';

/** One row of the document sheet, resolved: the person and type are ids, the optional cells are null when blank. */
interface PersonDocumentImportInput { person_code: string; document_type: string; number: string; issued_on: string; expires_on: string }
export interface PersonDocumentImportDeps {
  /** Live people (the register's default list). */
  people: readonly { id: string; code: string }[];
  /** The organisation's active person document types. */
  types: readonly { id: string; name: string; is_medical: boolean }[];
  /** The live person documents the caller may read, read fresh when the preview opens. */
  documents: () => Promise<ExpiryDocumentRow[]>;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();
const keyOf = (c: Record<string, string>) => `${norm(c.person_code)}|${norm(c.document_type)}`;

/**
 * Person document import: ONE template with the columns person code, document type, number, issue date and expiry date.
 * A person with a live document of that type has it updated (the one expiring last when there are several); otherwise a
 * document is added. A blank number or issue date leaves the stored value; the note, attached file and archived state
 * are never touched. Medical types are never imported (they carry a status and stay with the person page and its medical
 * rule). Who may run it is decided by the caller's page with the one people-documents rule (`can('create','expiryDocument')`);
 * the database refuses anyone else per row.
 */
export function makePersonDocumentImportDescriptor(deps: PersonDocumentImportDeps, t?: TFunction): ImportDescriptor<PersonDocumentImportInput> {
  const L = labelOf(t);
  const personLabel = L('import:personDocument.person_code', 'Person code');
  const typeLabel = L('import:personDocument.document_type', 'Document type');
  const dateMsg = L('import:personDocument.error.date', 'Dates are written year-month-day, e.g. 2026-01-31.');
  const personByCode = makeRefLookup(deps.people.map((p) => ({ id: p.id, name: p.code })), personLabel);
  const typeByName = makeRefLookup(deps.types.map((x) => ({ id: x.id, name: x.name })), typeLabel);
  const medicalIds = new Set(deps.types.filter((x) => x.is_medical).map((x) => x.id));
  const F = (key: string, en: string, id: string, required: boolean, validate: (r: string) => string | null, hint?: string, inRowTitle = false) =>
    makeField<PersonDocumentImportInput>(key, L(`import:personDocument.${key}`, en), required, validate, { aliases: [en, id], ...(inRowTitle ? { inRowTitle } : {}), ...(hint ? { hint } : {}) });
  const optDate = (raw: string) => (raw.trim() === '' || isDate(raw.trim()) ? null : dateMsg);
  const personOf = (c: Record<string, string>) => personByCode(c.person_code ?? '').id;
  const typeOf = (c: Record<string, string>) => typeByName(c.document_type ?? '').id;
  const codeById = new Map(deps.people.map((p) => [p.id, p.code]));
  const typeNameById = new Map(deps.types.map((x) => [x.id, x.name]));
  const fieldWord = (key: string, en: string) => L(`import:personDocument.${key}`, en);

  /** What the file would change on a document: only non-blank cells that differ. */
  const diff = (doc: ExpiryDocumentRow, c: Record<string, string>) => {
    const number = (c.number ?? '').trim();
    const issued = (c.issued_on ?? '').trim();
    const expires = (c.expires_on ?? '').trim();
    return {
      ...(number !== '' && number !== (doc.number ?? '') ? { number } : {}),
      ...(issued !== '' && issued !== (doc.issued_on ?? '') ? { issued_on: issued } : {}),
      ...(expires !== '' && expires !== doc.expires_on ? { expires_on: expires } : {}),
    };
  };

  return {
    entity: 'Person documents',
    entityDisplay: L('import:entity.personDocuments', 'person documents'),
    entityDisplayOne: L('import:entity.personDocument', 'person document'),
    rowTitle: (c) => [c.person_code, c.document_type].map((v) => (v ?? '').trim()).filter(Boolean).join(' · '),
    template: { version: 1, example: { person_code: deps.people[0]?.code ?? 'P-0001', document_type: deps.types.find((x) => !x.is_medical)?.name ?? 'Site pass', number: 'DOC-001', issued_on: '2026-01-01', expires_on: '2027-01-01' } },
    fields: [
      F('person_code', 'Person code', 'Kode personel', true, (r) => personByCode(r).error ?? (r.trim() === '' ? L('import:personDocument.error.person', 'Person code is required.') : null), L('import:personDocument.personHint', 'The code of a person in the register.'), true),
      F('document_type', 'Document type', 'Jenis dokumen', true, (r) => {
        if (r.trim() === '') return L('import:personDocument.error.type', 'Document type is required.');
        const hit = typeByName(r);
        if (hit.error) return hit.error;
        return hit.id && medicalIds.has(hit.id) ? L('import:personDocument.error.medical', 'Document type "{type}" is a medical type. Medical documents are recorded on the person page, not imported.').replace('{type}', r.trim()) : null;
      }, L('import:personDocument.typeHint', 'A document type from Administration, by name.'), true),
      F('number', 'Number', 'Nomor', false, (r) => (r.trim().length > 80 ? L('import:personDocument.error.numberLong', 'Number is too long.') : null), L('import:personDocument.numberHint', 'Optional. Blank leaves the stored number as it is.')),
      F('issued_on', 'Issue date', 'Tanggal terbit', false, optDate, L('import:personDocument.issuedHint', 'Optional. Year-month-day. Blank leaves the stored date as it is.')),
      F('expires_on', 'Expiry date', 'Tanggal kedaluwarsa', true, (r) => (isDate(r.trim()) ? null : r.trim() === '' ? L('import:personDocument.error.expiry', 'Expiry date is required.') : dateMsg), L('import:personDocument.expiryHint', 'Year-month-day.')),
    ],
    validateRow: (c) => {
      const issued = (c.issued_on ?? '').trim();
      const expires = (c.expires_on ?? '').trim();
      return isDate(issued) && isDate(expires) && issued > expires
        ? { issued_on: L('import:personDocument.error.issuedAfter', 'Issue date is after the expiry date.') } : {};
    },
    validateSheet: (rows) => {
      const first = new Map<string, number>();
      return rows.map((c, i) => {
        if (!personOf(c) || !typeOf(c)) return {};
        const key = keyOf(c);
        const at = first.get(key);
        if (at === undefined) { first.set(key, i); return {}; }
        return { document_type: L('import:personDocument.error.repeat', 'This person already has this document type in row {n}.').replace('{n}', String(at + 2)) };
      });
    },
    matchExisting: {
      load: async () => {
        // The current document of a person and type is the live one expiring last.
        const best = new Map<string, ExpiryDocumentRow>();
        for (const d of await deps.documents()) {
          const person = d.person_id ? codeById.get(d.person_id) : undefined;
          const type = typeNameById.get(d.type_id);
          if (!person || !type || d.is_medical) continue;
          const key = `${norm(person)}|${norm(type)}`;
          const cur = best.get(key);
          if (!cur || d.expires_on > cur.expires_on) best.set(key, d);
        }
        return [...best.entries()];
      },
      keyOf,
      changes: (record, c): RowChange[] => {
        const doc = record as ExpiryDocumentRow;
        const d = diff(doc, c);
        return [
          ...(d.number ? [{ field: fieldWord('number', 'Number'), from: doc.number ?? '', to: d.number }] : []),
          ...(d.issued_on ? [{ field: fieldWord('issued_on', 'Issue date'), from: doc.issued_on ?? '', to: d.issued_on }] : []),
          ...(d.expires_on ? [{ field: fieldWord('expires_on', 'Expiry date'), from: doc.expires_on, to: d.expires_on }] : []),
        ];
      },
      update: (record, c) => {
        const doc = record as ExpiryDocumentRow;
        const d = diff(doc, c);
        return repositories.documentExpiry.update(doc.id, {
          number: d.number ?? doc.number, issued_on: d.issued_on ?? doc.issued_on, expires_on: d.expires_on ?? doc.expires_on,
          location_note: doc.location_note, medical_status: null,
        });
      },
      noChange: L('import:personDocument.noChange', 'This document already has these values.'),
      unavailable: L('import:personDocument.unavailable', 'Could not read the existing documents, so changes cannot be previewed. Try again.'),
      nothingToDo: L('import:personDocument.nothingToDo', 'Nothing to add or change: every row matches an existing document.'),
    },
    toInput: (c) => ({ person_code: c.person_code.trim(), document_type: c.document_type.trim(), number: (c.number ?? '').trim(), issued_on: (c.issued_on ?? '').trim(), expires_on: (c.expires_on ?? '').trim() }),
    create: (input) => repositories.documentExpiry.create({
      subject_kind: 'person', subject_id: personOf({ ...input }) as string, type_id: typeOf({ ...input }) as string,
      number: input.number || null, issued_on: input.issued_on || null, expires_on: input.expires_on,
      location_note: null, medical_status: null, attachment_path: null,
    }),
  };
}
