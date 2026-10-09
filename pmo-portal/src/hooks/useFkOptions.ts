import { companyDisplayName } from '@/src/lib/companyDisplayName';
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
      return rows.map((c) => ({ value: c.id, label: companyDisplayName(c), sub: c.short_name ? c.name : 'Vendor' }));
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

/** A project as an invoice picker option, with what the invoice form needs to know about it (#784). */
export interface InvoiceProjectOption extends ComboboxOption {
  /** The project's client — the invoice form offers only the chosen customer's projects (M-1). */
  clientId: string | null;
  /** OD-TAX-4: the project decides a PMO invoice's VAT; a VAT project with no rate is refused (DD-TAX-4a). */
  subjectToVat: boolean;
  taxRate: number | null;
  /** Archived projects stay resolvable by name (an approval preview) but are never offered for a new invoice. */
  archived: boolean;
}

/** Every project with its client and VAT setting, for the sales-invoice form and the invoice approval preview (#784). */
export function useInvoiceProjectOptions() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<InvoiceProjectOption[]>({
    queryKey: ['fk-options', 'invoice-project', orgId],
    queryFn: async () => {
      const rows = await repositories.project.list();
      return rows.map((p) => ({
        value: p.id,
        label: p.name,
        sub: p.code ?? undefined,
        clientId: p.client_id,
        subjectToVat: p.subject_to_vat,
        taxRate: p.tax_rate,
        archived: p.archived_at != null,
      }));
    },
    enabled: Boolean(orgId),
    staleTime: FK_STALE_MS,
  });
}

/** Client companies as FK options (id→value, name→label, "Client" sub — translated at read, so the cached list
 *  follows a language switch). */
export function useClientCompanyOptions() {
  const { currentUser } = useAuth();
  const { t } = useTranslation();
  const orgId = currentUser?.org_id;
  const clientLabel = t('companies.type.client', 'Client');
  const select = useCallback(
    (options: ComboboxOption[]) => options.map((o) => (o.sub ? o : { ...o, sub: clientLabel })),
    [clientLabel],
  );
  return useQuery<ComboboxOption[], Error, ComboboxOption[]>({
    queryKey: ['fk-options', 'client', orgId],
    queryFn: async () => {
      const rows = await repositories.company.listClients();
      return rows.map((c) => ({ value: c.id, label: companyDisplayName(c), ...(c.short_name ? { sub: c.name } : {}) }));
    },
    select,
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
