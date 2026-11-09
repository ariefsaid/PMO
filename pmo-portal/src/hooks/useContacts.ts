import {
  keepPreviousData,
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { contactRepository } from '@/src/lib/repositories/companies';
import { meetingRepository } from '@/src/lib/repositories/meetings';
import type { ContactDirectoryPage, ContactRow, ContactInput } from '@/src/lib/db/contacts';
import type {
  CrmActivityRow,
  CrmActivityInput,
  CrmActivityPatch,
  ActivityCursor,
  ActivityPage,
} from '@/src/lib/db/crmActivities';
import type { ContactMeetingRef } from '@/src/lib/db/meetings';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Org-scoped Contacts list over the repository seam (ADR-0017). queryKey includes org_id so the
 * cache is tenant-scoped; archived rows are hidden by the DAL.
 */
export function useContacts(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ContactRow[]>({
    queryKey: ['contacts', orgId],
    queryFn: () => contactRepository.list(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
  });
}

/** The directory's page size: 50, the established Odoo-directory/AdminUsers page size (#1989). */
export const CONTACTS_DIRECTORY_PAGE_SIZE = 50;

/**
 * ONE server page of the Contacts directory (issue #1989, the Master-data/AdminUsers pattern):
 * the URL's company filter + committed search go to the SERVER; filter, search, page and page
 * size are part of the query key so an old view's response can never be served as the new one,
 * and `keepPreviousData` keeps the previous page visible while a new one loads. 'All' is the
 * ABSENCE of a company filter; a blank search is the absence of a search.
 */
export function useContactsPage(input: {
  companyId: string;
  search: string;
  page: number;
  pageSize: number;
}) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ContactDirectoryPage>({
    queryKey: ['contacts', orgId, 'page', input.companyId, input.search, input.page, input.pageSize],
    queryFn: () =>
      contactRepository.listPage({
        page: input.page,
        pageSize: input.pageSize,
        companyId: input.companyId === 'All' ? undefined : input.companyId,
        search: input.search.trim() || undefined,
      }),
    enabled: Boolean(orgId),
    placeholderData: keepPreviousData,
  });
}

/**
 * The exact non-archived contact total — the "of Y" behind the directory's filtered
 * "Showing X of Y" (#1989). One head count per org, cached; the page enables it only while a
 * filter/search is active (unfiltered, the page's own total IS the directory total).
 */
export function useContactsTotal(opts?: { enabled?: boolean }) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<number>({
    queryKey: ['contacts', orgId, 'total'],
    queryFn: () => contactRepository.count(),
    enabled: Boolean(orgId) && opts?.enabled !== false,
    staleTime: 30_000,
  });
}

/**
 * The full-set export read (#1989): EVERY contact matching the directory's current
 * filter/search, fetched only when the user actually exports.
 */
export function useContactsExportAll() {
  return useMutation({
    mutationFn: (params?: { companyId?: string; search?: string }) =>
      contactRepository.listAll(params),
  });
}

/**
 * A single contact by id over the repository seam (ADR-0017) — backs the routable
 * `/contacts/:id` record page (CW-4b). queryKey includes org_id so the cache is
 * tenant-scoped; disabled until both an org and an id are present. Returns `null`
 * when the record is absent or RLS-scoped out (the page renders a calm not-found).
 */
export function useContact(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ContactRow | null>({
    queryKey: ['contact', orgId, id],
    queryFn: () => contactRepository.get(id!),
    enabled: Boolean(orgId && id),
  });
}

/** A single company's non-archived contacts — the Companies-drawer fast-follow read. */
export function useContactsByCompany(companyId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ContactRow[]>({
    queryKey: ['contacts', 'by-company', orgId, companyId],
    queryFn: () => contactRepository.listByCompany(companyId as string),
    enabled: Boolean(orgId && companyId),
  });
}

/**
 * Newest-first activity pages (#1990): the first page is the most recent; `fetchNextPage` loads
 * the next older one by keyset cursor. `data` is the flattened list of every loaded row.
 * Every activity write trims the cache to page one and refetches it (stale cursors on older
 * pages would skip or repeat a row), so a new activity lands on top.
 */
function useActivityPages(
  queryKey: unknown[],
  enabled: boolean,
  fetchPage: (cursor: ActivityCursor | null) => Promise<ActivityPage>,
) {
  return useInfiniteQuery<ActivityPage, Error, CrmActivityRow[], unknown[], ActivityCursor | null>({
    queryKey,
    initialPageParam: null,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    getNextPageParam: (last) => last.nextCursor,
    select: (d) => d.pages.flatMap((p) => p.rows),
    enabled,
  });
}

/** A contact's activity timeline (newest-first, paged), for the contact record page. */
export function useContactActivities(contactId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useActivityPages(
    ['crm-activities', orgId, contactId],
    Boolean(orgId && contactId),
    (cursor) => contactRepository.listActivitiesPage(contactId as string, cursor),
  );
}

/**
 * Minuted meetings this contact attended (DD-MTG-6: the contact timeline unions crm_activities
 * with the meeting module's records). RLS filters to what the VIEWER may read (attendance ∪
 * author ∪ grant ∪ Admin — FR-MTG-031), so an empty list is the normal state for most viewers.
 * Lives here (not useMeetings) because it is the contact timeline's read, and the ContactDetail
 * test suites mock this module wholesale.
 */
export function useContactMeetings(contactId: string | null | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ContactMeetingRef[]>({
    queryKey: ['contact-meetings', orgId, contactId],
    queryFn: () => meetingRepository.listForContact(contactId as string),
    enabled: Boolean(orgId && contactId),
  });
}

/**
 * Account-level activity timeline (T17): the newest page of crm_activities across a company's
 * contacts in ONE batched query (C3 — crm_activities_contact_idx covers this path), with
 * `fetchNextPage` for older ones (#1990).
 *
 * The hook accepts the list of contactIds for this company (from useContactsByCompany)
 * to avoid coupling to another DB query. When contactIds is empty the result is empty.
 * `enabled` is false until both orgId and at least one contactId are known.
 */
export function useCompanyActivities(contactIds: string[]) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const key = contactIds.slice().sort().join(',');
  return useActivityPages(
    ['crm-activities', 'by-company', orgId, key],
    Boolean(orgId && contactIds.length > 0),
    (cursor) => contactRepository.listActivitiesForContactsPage(contactIds, cursor),
  );
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
  // Older pages were fetched with cursors from the OLD first page; after a write those cursors
  // would skip (insert) or repeat (delete) a row. Keep only page one, then refetch it (#1990).
  const refreshActivities = () => {
    qc.setQueriesData<InfiniteData<ActivityPage, ActivityCursor | null>>(
      { queryKey: ['crm-activities'] },
      (d) => d && { pages: d.pages.slice(0, 1), pageParams: d.pageParams.slice(0, 1) },
    );
    qc.invalidateQueries({ queryKey: ['crm-activities'] });
  };
  const invalidateContacts = () => {
    qc.invalidateQueries({ queryKey: ['contacts'] });
    // CW-4b: also bust the single-record family so an open `/contacts/:id` detail page refetches.
    qc.invalidateQueries({ queryKey: ['contact'] });
  };

  const create = useMutation({
    mutationFn: (input: ContactInput) => contactRepository.create(input),
    onSuccess: invalidateContacts,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: UpdateContactArgs) => contactRepository.update(id, input),
    onSuccess: invalidateContacts,
  });

  const archive = useMutation({
    mutationFn: (id: string) => contactRepository.archive(id),
    onSuccess: invalidateContacts,
  });

  const remove = useMutation({
    mutationFn: (id: string) => contactRepository.delete(id),
    onSuccess: invalidateContacts,
  });

  const logActivity = useMutation({
    mutationFn: (input: CrmActivityInput) =>
      contactRepository.createActivity(input, currentUser?.id ?? null),
    onSuccess: () => {
      refreshActivities();
      qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });

  const updateActivity = useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & CrmActivityPatch) =>
      contactRepository.updateActivity(id, patch),
    onSuccess: () => {
      refreshActivities();
    },
  });

  const deleteActivity = useMutation({
    mutationFn: (id: string) => contactRepository.deleteActivity(id),
    onSuccess: () => {
      refreshActivities();
    },
  });

  return { create, update, archive, remove, logActivity, updateActivity, deleteActivity };
}
