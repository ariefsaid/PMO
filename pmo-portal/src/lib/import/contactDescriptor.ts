import { repositories } from '@/src/lib/repositories';
import type { ContactInput } from '@/src/lib/db/contacts';
import type { ImportDescriptor } from './types';
import { makeRefLookup, refValidate, refId } from './refLookup';

/**
 * Contacts import descriptor (ADR-0027 fast-follow). Factory: closes over the org's companies
 * so the required "Company" cell resolves name→`company_id`. `toInput` emits ONLY the contact
 * columns (never `org_id`); `create` delegates to the EXISTING `repositories.contact.create` →
 * `createContact`, so RLS `contacts_write` stamps org_id + gates the role (sole write authority).
 */
export function makeContactImportDescriptor(
  companies: readonly { id: string; name: string }[],
): ImportDescriptor<ContactInput> {
  const company = makeRefLookup(companies, 'Company');
  return {
    entity: 'Contacts',
    fields: [
      {
        key: 'full_name',
        label: 'Full name',
        required: true,
        validate: (raw) => (raw.trim() ? null : 'Full name is required.'),
      },
      { key: 'company_id', label: 'Company', required: true, validate: refValidate(company, true) },
      { key: 'title', label: 'Title', required: false, validate: () => null },
      { key: 'email', label: 'Email', required: false, validate: () => null },
      { key: 'phone', label: 'Phone', required: false, validate: () => null },
      { key: 'notes', label: 'Notes', required: false, validate: () => null },
    ],
    toInput: (cells) => ({
      company_id: refId(company, cells.company_id ?? '') ?? '',
      full_name: cells.full_name.trim(),
      title: cells.title?.trim() || null,
      email: cells.email?.trim() || null,
      phone: cells.phone?.trim() || null,
      notes: cells.notes?.trim() || null,
    }),
    create: (input) => repositories.contact.create(input),
  };
}
