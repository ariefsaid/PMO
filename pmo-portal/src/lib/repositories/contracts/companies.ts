/** Company, contact and customer-reference repository contracts (ADR-0017). */
import type { VendorTaxDefaultsInput } from '@/src/lib/vendorWithholding';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';
import type { CrmActivityRow, CrmActivityInput, CrmActivityPatch } from '@/src/lib/db/crmActivities';
import type { CompanyCustomerRef } from '@/src/lib/db/companyCollections';

export interface CompanyRepository {
  /** Client companies only — the FK picker for project/opportunity clients. */
  listClients(): Promise<CompanyRow[]>;
  /** All companies in the org (archived hidden by default), optionally filtered by type. */
  list(params?: { type?: CompanyType }): Promise<CompanyRow[]>;
  /** A single company by id, or null when not found / not readable. */
  get(id: string): Promise<CompanyRow | null>;
  /** Create a company (org_id stamped by RLS, never sent). */
  create(input: CompanyInput): Promise<CompanyRow>;
  /** Update a company's name + type. */
  update(id: string, input: CompanyInput): Promise<void>;
  /** Update only the PMO-local client-number segment; never dispatches to an external native adapter. */
  setProjectNumberSegment(id: string, segment: string | null): Promise<void>;
  /** #876 slice 2: set the vendor's default tax treatment (Admin/Finance; `set_vendor_tax_defaults`). */
  setTaxDefaults(id: string, input: VendorTaxDefaultsInput): Promise<void>;
  /** Soft-archive a company (stamps archived_at). */
  archive(id: string): Promise<void>;
  /** Hard-delete a company; rejects with AppError code 23503 if referenced. */
  delete(id: string): Promise<void>;
}

export interface ContactRepository {
  /** All non-archived contacts in the org, ordered by name. */
  list(): Promise<ContactRow[]>;
  /** A company's non-archived contacts (the company-detail list). */
  listByCompany(companyId: string): Promise<ContactRow[]>;
  /** A single contact by id, or null when not found / not readable. */
  get(id: string): Promise<ContactRow | null>;
  /** Create a contact (org_id stamped by RLS, never sent). */
  create(input: ContactInput): Promise<ContactRow>;
  /** Update a contact's fields. */
  update(id: string, input: ContactInput): Promise<void>;
  /** Soft-archive a contact (stamps archived_at). */
  archive(id: string): Promise<void>;
  /** Hard-delete a contact (Admin-only at the RLS layer); cascades its activities. */
  delete(id: string): Promise<void>;
  /** A contact's activities, newest-first by occurred_at. */
  listActivities(contactId: string): Promise<CrmActivityRow[]>;
  /** Batch-fetch activities for N contacts in one query (C3 N+1 fix), merged newest-first. */
  listActivitiesForContacts(contactIds: string[]): Promise<CrmActivityRow[]>;
  /** Log an activity (org_id trigger-stamped from the parent; logged_by from the caller). */
  createActivity(input: CrmActivityInput, loggedById: string | null): Promise<CrmActivityRow>;
  /** Update an activity's editable fields (kind/subject/body/occurred_at). */
  updateActivity(id: string, patch: CrmActivityPatch): Promise<void>;
  /** Hard-delete an activity by id (RLS gate: MASTER_DATA roles + org). */
  deleteActivity(id: string): Promise<void>;
}

/** Read-only canonical Customer-reference reads for composing ERP aging by PMO company. */
export interface CompanyCollectionsRepository {
  listPartyIds(companyIds: readonly string[]): Promise<string[]>;
  listForCompanies(companyIds: readonly string[]): Promise<CompanyCustomerRef[]>;
  listForErpCustomerIds(erpCustomerIds: readonly string[]): Promise<CompanyCustomerRef[]>;
}
