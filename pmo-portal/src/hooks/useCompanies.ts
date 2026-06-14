import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
import { listProjectsByClient, type ProjectWithRefs } from '@/src/lib/db/projects';
import { listProcurementsByVendor, type ProcurementWithRefs } from '@/src/lib/db/procurements';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped Companies list over the repository seam (ADR-0017). queryKey includes
 * org_id so the cache is tenant-scoped (FR-QRY); an optional `type` narrows to one
 * company_type (Internal / Client / Vendor). Archived rows are hidden by the DAL.
 */
export function useCompanies(type?: CompanyType) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CompanyRow[]>({
    queryKey: ['companies', orgId, type ?? 'all'],
    queryFn: () => repositories.company.list(type ? { type } : undefined),
    enabled: Boolean(orgId),
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
    queryKey: ['projects', 'by-client', orgId, companyId],
    queryFn: () => listProjectsByClient(companyId!),
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
    queryKey: ['procurements', 'by-vendor', orgId, companyId],
    queryFn: () => listProcurementsByVendor(companyId!),
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
  // Also bust the FK-picker caches (F2, Wave 3): a company is both a vendor and a client option,
  // so create/edit/archive/delete must refresh `['fk-options','vendor']` + `['fk-options','client']`
  // or combobox forms serve a stale/archived/missing company for the ~5-min query staleTime.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['companies'] });
    // CW-4b: also bust the single-record family so an open `/companies/:id` detail page refetches.
    qc.invalidateQueries({ queryKey: ['company'] });
    qc.invalidateQueries({ queryKey: ['fk-options', 'vendor'] });
    qc.invalidateQueries({ queryKey: ['fk-options', 'client'] });
  };

  const create = useMutation({
    mutationFn: (input: CompanyInput) => repositories.company.create(input),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateCompanyArgs) => repositories.company.update(id, input),
    onSuccess: invalidate,
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.company.archive(id),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.company.delete(id),
    onSuccess: invalidate,
  });

  return { create, update, archive, remove };
}
