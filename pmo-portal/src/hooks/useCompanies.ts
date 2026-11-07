import { procurementKeys } from './procurementQueryKeys';
import { projectKeys, invalidateProjectProjections } from './projectQueryKeys';
import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { CompanyDirectoryPage, CompanyOptionRow, CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import type { CompanyTypeFilter } from '@/src/lib/listWorkingSet';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { useAuth } from '@/src/auth/useAuth';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  pendingPushAfterWrite,
  type PendingPushState,
} from '@/src/lib/adapterSeam/pendingPush';

/**
 * Org-scoped Companies list over the repository seam (ADR-0017). queryKey includes
 * org_id so the cache is tenant-scoped (FR-QRY); an optional `type` narrows to one
 * company_type (Internal / Client / Vendor). Archived rows are hidden by the DAL.
 */
export function useCompanies(type?: CompanyType, opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyRow[]>({
    queryKey: ['companies', orgId, type ?? 'all'],
    queryFn: () => repositories.company.list(type ? { type } : undefined),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/** The directory's page size: 50, the established Odoo-directory/AdminUsers page size (#1989). */
export const COMPANIES_DIRECTORY_PAGE_SIZE = 50;

/**
 * ONE server page of the Companies directory (issue #1989, the Master-data/AdminUsers pattern):
 * the URL's type filter + committed search go to the SERVER; filter, search, page and page size
 * are part of the query key so an old view's response can never be served as the new one, and
 * `keepPreviousData` keeps the previous page visible while a new one loads (no empty flash).
 * 'All' is the ABSENCE of a type filter; a blank search is the absence of a search.
 */
export function useCompaniesPage(input: {
  type: CompanyTypeFilter;
  search: string;
  page: number;
  pageSize: number;
}) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyDirectoryPage>({
    queryKey: ['companies', orgId, 'page', input.type, input.search, input.page, input.pageSize],
    queryFn: () =>
      repositories.company.listPage({
        page: input.page,
        pageSize: input.pageSize,
        type: input.type === 'All' ? undefined : input.type,
        search: input.search.trim() || undefined,
      }),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });
}

/**
 * The exact non-archived company total — the "of Y" behind the directory's filtered
 * "Showing X of Y" (#1989). One head count per org, cached; the page enables it only while a
 * filter/search is active (unfiltered, the page's own total IS the directory total).
 */
export function useCompaniesTotal(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<number>({
    queryKey: ['companies', orgId, 'total'],
    queryFn: () => repositories.company.count(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
    staleTime: 30_000,
  });
}

/**
 * EVERY company as a display row (id + name fields only) — the Contacts page's filter options,
 * export company names and create/edit select (#1989). A picker must offer everyone, not one
 * page (the AdminUsers ruling); the narrow projection keeps that whole-directory read small.
 */
export function useCompanyOptions(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyOptionRow[]>({
    queryKey: ['companies', orgId, 'options'],
    queryFn: () => repositories.company.listOptions(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/**
 * The full-set export read (#1989): EVERY company matching the directory's current
 * filter/search, fetched only when the user actually exports.
 */
export function useCompaniesExportAll() {
  return useMutation({
    mutationFn: (params?: { type?: CompanyType; search?: string }) =>
      repositories.company.listAll(params),
  });
}

/**
 * A single company by id over the repository seam (ADR-0017) — backs the routable
 * `/companies/:id` record page (CW-4b). queryKey includes org_id so the cache is
 * tenant-scoped; disabled until both an org and an id are present. Returns `null`
 * when the record is absent or RLS-scoped out (the page renders a calm not-found).
 */
export function useCompany(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyRow | null>({
    queryKey: ['company', orgId, id],
    queryFn: () => repositories.company.get(id!),
    enabled: Boolean(orgId && id),
  });
}

/**
 * Related projects for a company (as client) — AC-IFW-COMPANY-01. Fetches all projects where
 * `client_id = companyId`. queryKey includes org_id so cache is tenant-scoped; disabled until
 * both org and company id are present.
 */
export function useProjectsByClient(companyId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProjectWithRefs[]>({
    queryKey: projectKeys.byClient(orgId, companyId),
    queryFn: () => repositories.project.listByClient(companyId!),
    enabled: Boolean(orgId && companyId),
  });
}

/**
 * Related procurement for a company (as vendor) — AC-IFW-COMPANY-01. Fetches all PRs where
 * `vendor_id = companyId`. queryKey includes org_id so cache is tenant-scoped; disabled until
 * both org and company id are present.
 */
export function useProcurementsByVendor(companyId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ProcurementWithRefs[]>({
    queryKey: procurementKeys.byVendor(orgId, companyId),
    queryFn: () => repositories.procurement.listByVendor(companyId!),
    enabled: Boolean(orgId && companyId),
  });
}

export interface UpdateCompanyArgs {
  id: string;
  input: CompanyInput;
}

/**
 * Company create / update / archive / delete mutations over the repository seam.
 * Each invalidates the `['companies', …]` query family on success so every list
 * (and any type-filtered variant) refetches. Errors propagate as `AppError`
 * (code preserved) for the caller to classify via `classifyMutationError`.
 */
export function useCompanyMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  // Also bust the FK-picker caches (F2, Wave 3): a company is both a vendor and a client option,
  // so create/edit/archive/delete must refresh `['fk-options','vendor']` + `['fk-options','client']`
  // or combobox forms serve a stale/archived/missing company for the ~5-min query staleTime.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['companies'] });
    // CW-4b: also bust the single-record family so an open `/companies/:id` detail page refetches.
    qc.invalidateQueries({ queryKey: ['company'] });
    qc.invalidateQueries({ queryKey: ['fk-options', 'vendor'] });
    qc.invalidateQueries({ queryKey: ['fk-options', 'client'] });
    invalidateProjectProjections(qc, orgId);
  };

  // Discover CRITICAL 1 follow-up: create/update already route through the repository seam (Slice
  // 1's `routeDomainWrite('companies')` guard) — this state surfaces that routing to the form UI
  // (TaskPushBadge, the P1 idiom). Only a Vendor/Client create dispatches externally (an Internal
  // company never carries an `erp_doc_kind`, FR-ENA-090/091) — `isExternal` mirrors that check so
  // an Internal-type write never shows a push badge even on a flipped org.
  const [pendingPush, setPendingPush] = useState<PendingPushState>(IDLE_PENDING_PUSH);
  const isExternal = (type: CompanyType) =>
    routeDomainWrite('companies') === 'external' && type !== 'Internal';

  const create = useMutation({
    mutationFn: (input: CompanyInput) => repositories.company.create(input),
    onMutate: (input: CompanyInput) => {
      if (isExternal(input.type)) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: (_data, input) => {
      invalidate();
      if (isExternal(input.type)) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err, input) => {
      if (isExternal(input.type)) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateCompanyArgs) => repositories.company.update(id, input),
    onMutate: ({ input }: UpdateCompanyArgs) => {
      if (input.short_name === undefined && isExternal(input.type)) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: (_data, { input }) => {
      invalidate();
      if (input.short_name === undefined && isExternal(input.type)) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err, { input }) => {
      if (input.short_name === undefined && isExternal(input.type)) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.company.archive(id),
    onSuccess: invalidate,
  });

  const setProjectNumberSegment = useMutation({
    mutationFn: ({ id, segment }: { id: string; segment: string | null }) =>
      repositories.company.setProjectNumberSegment(id, segment),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.company.delete(id),
    onSuccess: invalidate,
  });

  return { create, update, setProjectNumberSegment, archive, remove, pendingPush };
}
