import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { CompanyRow, CompanyType, CompanyInput } from '@/src/lib/db/companies';
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
  const invalidate = () => qc.invalidateQueries({ queryKey: ['companies'] });

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
