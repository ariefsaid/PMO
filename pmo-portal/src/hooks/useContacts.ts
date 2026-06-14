import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { ContactRow, ContactInput } from '@/src/lib/db/contacts';
import type { CrmActivityRow, CrmActivityInput } from '@/src/lib/db/crmActivities';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped Contacts list over the repository seam (ADR-0017). queryKey includes org_id so the
 * cache is tenant-scoped; archived rows are hidden by the DAL.
 */
export function useContacts() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ContactRow[]>({
    queryKey: ['contacts', orgId],
    queryFn: () => repositories.contact.list(),
    enabled: Boolean(orgId),
  });
}

/** A single company's non-archived contacts — the Companies-drawer fast-follow read. */
export function useContactsByCompany(companyId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ContactRow[]>({
    queryKey: ['contacts', 'by-company', orgId, companyId],
    queryFn: () => repositories.contact.listByCompany(companyId as string),
    enabled: Boolean(orgId && companyId),
  });
}

/** A contact's activity timeline (newest-first), for the quick-view drawer. */
export function useContactActivities(contactId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<CrmActivityRow[]>({
    queryKey: ['crm-activities', orgId, contactId],
    queryFn: () => repositories.contact.listActivities(contactId as string),
    enabled: Boolean(orgId && contactId),
  });
}

export interface UpdateContactArgs {
  id: string;
  input: ContactInput;
}

/**
 * Contact create / update / archive / delete + log-activity mutations over the repository seam.
 * Each invalidates the `['contacts', …]` query family on success so every list refetches;
 * `logActivity` also invalidates `['crm-activities', …]` so the open timeline refetches.
 * `logActivity` stamps `logged_by_id` from the current user (server enforces the rest).
 */
export function useContactMutations() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const invalidateContacts = () => qc.invalidateQueries({ queryKey: ['contacts'] });

  const create = useMutation({
    mutationFn: (input: ContactInput) => repositories.contact.create(input),
    onSuccess: invalidateContacts,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateContactArgs) => repositories.contact.update(id, input),
    onSuccess: invalidateContacts,
  });

  const archive = useMutation({
    mutationFn: (id: string) => repositories.contact.archive(id),
    onSuccess: invalidateContacts,
  });

  const remove = useMutation({
    mutationFn: (id: string) => repositories.contact.delete(id),
    onSuccess: invalidateContacts,
  });

  const logActivity = useMutation({
    mutationFn: (input: CrmActivityInput) =>
      repositories.contact.createActivity(input, currentUser?.id ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-activities'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  return { create, update, archive, remove, logActivity };
}
