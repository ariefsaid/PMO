import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import type { MicrosoftReferenceInput } from '@/src/lib/m365/reference';

/**
 * Microsoft evidence links of ONE budget version over the repository seam (AC-M365DOC-052/062).
 * The key is org- and version-scoped, so switching the selected version swaps the list and a clone
 * never inherits its source's links. Disabled until a version exists. Mutations invalidate only this
 * evidence key: evidence is not a financial input, so amounts, status and editor queries are untouched.
 */
export const budgetDocumentLinkKeys = {
  list: (orgId: string | null | undefined, versionId: string | null | undefined) =>
    ['budget-document-links', orgId ?? null, versionId ?? null] as const,
};

export function useBudgetDocumentLinks(versionId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id ?? null;
  const queryClient = useQueryClient();
  const key = budgetDocumentLinkKeys.list(orgId, versionId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => repositories.budget.listDocumentLinks(versionId as string),
    enabled: Boolean(orgId && versionId),
    retry: false,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const add = useMutation({
    mutationFn: (ref: MicrosoftReferenceInput) => repositories.budget.addDocumentLink(versionId as string, ref),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => repositories.budget.removeDocumentLink(id),
    onSuccess: invalidate,
  });
  return { query, add, remove };
}
