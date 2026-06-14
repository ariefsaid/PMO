import { repositories } from '@/src/lib/repositories';
import type { CompanyInput, CompanyType } from '@/src/lib/db/companies';
import type { ImportDescriptor } from './types';

/** The three company_type enum values (mirrors the New-company form). */
const COMPANY_TYPES: CompanyType[] = ['Internal', 'Client', 'Vendor'];

/**
 * v1 import descriptor — Companies (ADR-0027). Two flat fields: `name` (required) and
 * `type` (must be one of the three enum values). `toInput` emits ONLY `{ name, type }` —
 * never `org_id`; a crafted xlsx cannot carry an org_id. `create` delegates to the EXISTING
 * `repositories.company.create` → `createCompany`, so RLS `companies_write` (org_id =
 * auth_org_id() AND role ∈ write-roles) stamps org_id and is the sole write authority.
 */
export const companyImportDescriptor: ImportDescriptor<CompanyInput> = {
  entity: 'Companies',
  fields: [
    {
      key: 'name',
      label: 'Company name',
      required: true,
      validate: (raw) => (raw.trim() ? null : 'Company name is required.'),
    },
    {
      key: 'type',
      label: 'Type',
      required: true,
      validate: (raw) =>
        COMPANY_TYPES.includes(raw.trim() as CompanyType)
          ? null
          : `Type must be one of: ${COMPANY_TYPES.join(', ')}.`,
    },
  ],
  toInput: (cells) => ({ name: cells.name.trim(), type: cells.type.trim() as CompanyType }),
  create: (input) => repositories.company.create(input),
};

// Future (NOT built in v1): projectImportDescriptor, taskImportDescriptor — descriptor-only
// fast-follows that reuse this wizard unchanged (see ADR-0027).
