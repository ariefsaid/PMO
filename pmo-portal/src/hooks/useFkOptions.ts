import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { ComboboxOption } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// FK-option hooks (crud-components §4, "hooks own data fetching").
//
// Each returns a stable, cached, org-scoped `ComboboxOption[]` for a foreign-key
// `<Combobox>` picker (vendor / project / client company / project manager).
// Promoting the FK loaders out of the create/edit components into TanStack Query
// hooks gives them the same caching + dedup the rest of the app uses, and fixes
// the empty-picker flake (AC-PRJ-001): the option list is fetched + cached once
// rather than re-fetched on every popover open. Archived rows are filtered so a
// soft-archived record can never be selected as an FK target.
//
// The org_id is NEVER sent from the client — RLS scopes rows; org_id only keys
// the cache so it is tenant-scoped (FR-QRY-002). Disabled until org is known.
// ---------------------------------------------------------------------------

const FK_STALE_MS = 5 * 60_000; // FK reference lists change rarely; cache for 5 min.

/** Vendor companies as FK options (id→value, name→label, "Vendor" sub). */
export function useVendorOptions() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ComboboxOption[]>({
    queryKey: ['fk-options', 'vendor', orgId],
    queryFn: async () => {
      const rows = await repositories.company.list({ type: 'Vendor' });
      return rows.map((c) => ({ value: c.id, label: c.name, sub: 'Vendor' }));
    },
    enabled: Boolean(orgId),
    staleTime: FK_STALE_MS,
  });
}

/** Active (non-archived) projects as FK options (id→value, name→label, code→sub). */
export function useProjectOptions() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ComboboxOption[]>({
    queryKey: ['fk-options', 'project', orgId],
    queryFn: async () => {
      const rows = await repositories.project.list();
      return rows
        .filter((p) => p.archived_at == null)
        .map((p) => ({ value: p.id, label: p.name, sub: p.code ?? undefined }));
    },
    enabled: Boolean(orgId),
    staleTime: FK_STALE_MS,
  });
}

/** Client companies as FK options (id→value, name→label, "Client" sub). */
export function useClientCompanyOptions() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ComboboxOption[]>({
    queryKey: ['fk-options', 'client', orgId],
    queryFn: async () => {
      const rows = await repositories.company.listClients();
      return rows.map((c) => ({ value: c.id, label: c.name, sub: 'Client' }));
    },
    enabled: Boolean(orgId),
    staleTime: FK_STALE_MS,
  });
}

/** Project managers as FK options (id→value, full_name→label). */
export function useProjectManagerOptions() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ComboboxOption[]>({
    queryKey: ['fk-options', 'pm', orgId],
    queryFn: async () => {
      const rows = await repositories.profile.listProjectManagers();
      return rows.map((m) => ({ value: m.id, label: m.full_name }));
    },
    enabled: Boolean(orgId),
    staleTime: FK_STALE_MS,
  });
}
