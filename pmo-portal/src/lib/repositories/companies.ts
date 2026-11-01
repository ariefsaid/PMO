/** Company and contact repository implementations (ADR-0017 seam). Contact follows the companies routing: an externally-owned parties domain dispatches contact creates too. */
import { AppError } from '@/src/lib/appError';
import {
  listClientCompanies,
  listCompanies,
  getCompany,
  createCompany,
  updateCompany,
  updateCompanyShortName,
  setCompanyProjectNumberSegment,
  setCompanyTaxDefaults,
  archiveCompany,
  deleteCompany,
  type CompanyRow,
  type CompanyType,
} from '@/src/lib/db/companies';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import { dispatchDomainCommand } from '@/src/lib/adapterSeam/dispatchClient';
import {
  type ContactRow,
  listContacts,
  listContactsByCompany,
  getContact,
  createContact,
  updateContact,
  archiveContact,
  deleteContact,
} from '@/src/lib/db/contacts';
import {
  listActivities,
  listActivitiesForContacts,
  createActivity,
  updateActivity,
  deleteActivity,
} from '@/src/lib/db/crmActivities';
import { wrap } from './repositoryErrors';
import { keyFor, dispatchCreate } from './repositoryDispatch';
import type { CompanyRepository, ContactRepository } from './contracts/companies';

// task 3.8 (finding-3 path fix, FR-ENA-090/091): the ERP party kind is DERIVED from the company's
// own type — Vendor->'supplier', Client->'customer'. 'Internal' is never ERP-flipped (it is PMO's
// own org marker, FR-ENA-090/091) — no `erp_doc_kind` exists for it in DOCTYPE_REGISTRY, so an
// Internal-type write ALWAYS takes the direct DAL path regardless of the org's companies routing.
function erpPartyDocKind(type: CompanyType): 'supplier' | 'customer' | null {
  if (type === 'Vendor') return 'supplier';
  if (type === 'Client') return 'customer';
  return null;
}

export const companyRepository: CompanyRepository = {
  listClients: () => wrap(() => listClientCompanies()),
  list: (params) => wrap(() => listCompanies(params)),
  get: (id) => wrap(() => getCompany(id)),
  create: async (input) => {
    const kind = erpPartyDocKind(input.type);
    if (routeDomainWrite('companies') !== 'external' || !kind) return wrap(() => createCompany(input));
    const { short_name, ...native } = input;
    const res = await dispatchCreate('companies', { ...native, erp_doc_kind: kind }, undefined);
    const row = res.canonical as unknown as CompanyRow;
    if (short_name !== undefined) {
      await wrap(() => updateCompanyShortName(row.id, short_name));
      return { ...row, short_name: short_name?.trim() || null };
    }
    return row;
  },
  update: async (id, input) => {
    const kind = erpPartyDocKind(input.type);
    if (routeDomainWrite('companies') !== 'external' || !kind) return wrap(() => updateCompany(id, input));
    const shortName = input.short_name;
    if (shortName !== undefined) {
      const current = await wrap(() => getCompany(id));
      if (!current) throw new AppError('Company not found or you do not have permission to edit it.', '42501');
      if (current.name !== input.name || current.type !== input.type) {
        throw new AppError('Company legal name and type are read-only while externally-owned.', '42501');
      }
      return wrap(() => updateCompanyShortName(id, shortName));
    }
    await dispatchDomainCommand('companies', 'update', { id, ...input, erp_doc_kind: kind }, keyFor());
  },
  setProjectNumberSegment: (id, segment) => wrap(() => setCompanyProjectNumberSegment(id, segment)),
  setTaxDefaults: (id, input) => wrap(() => setCompanyTaxDefaults(id, input)),
  archive: (id) => wrap(() => archiveCompany(id)),
  delete: (id) => wrap(() => deleteCompany(id)),
};

export const contactRepository: ContactRepository = {
  list: () => wrap(() => listContacts()),
  listByCompany: (id) => wrap(() => listContactsByCompany(id)),
  get: (id) => wrap(() => getContact(id)),
  create: async (input) => {
    if (routeDomainWrite('companies') !== 'external') return wrap(() => createContact(input));
    const result = await dispatchCreate('companies', {...input, erp_doc_kind: 'contact'}, undefined);
    return result.canonical as unknown as ContactRow;
  },
  update: (id, input) => wrap(() => updateContact(id, input)),
  archive: (id) => wrap(() => archiveContact(id)),
  delete: (id) => wrap(() => deleteContact(id)),
  listActivities: (id) => wrap(() => listActivities(id)),
  listActivitiesForContacts: (ids) => wrap(() => listActivitiesForContacts(ids)),
  createActivity: (input, loggedById) => wrap(() => createActivity(input, loggedById)),
  updateActivity: (id, patch) => wrap(() => updateActivity(id, patch)),
  deleteActivity: (id) => wrap(() => deleteActivity(id)),
};
