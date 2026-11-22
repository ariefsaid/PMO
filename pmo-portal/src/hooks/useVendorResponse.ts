import { useContext } from 'react';
import { QueryClientContext, useMutation, useQueryClient } from '@tanstack/react-query';
import { equipmentVendorResponseRepository as repo } from '@/src/lib/repositories/equipmentVendorResponse';
import type { VendorResponseInput } from '@/src/lib/db/equipmentVendorResponse';
import type { TFunction } from 'i18next';
import { useCompanies } from '@/src/hooks/useCompanies';
import { splitMinutes } from '@/src/lib/vendorResponse';
import { AuthContext } from '@/src/auth/AuthContext';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Vendor response on breakdowns (#2702) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
const KEY = 'equipment-vendor-response';

export function useBreakdowns(assetIds: string[], from: string, to: string) {
  return useOrgQuery([KEY, assetIds, from, to], () => repo.listBreakdowns(assetIds, from, to), { enabled: assetIds.length > 0 });
}
export function useRecordVendorResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: VendorResponseInput) => repo.record(v),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}
export function useClearVendorResponse() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { assetId: string; periodStart: string }) => repo.clear(v.assetId, v.periodStart),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** True only inside the app providers; the vendor-response components render nothing without them (FR-EVR-009). */
export function useVendorResponseReady(): boolean {
  const auth = useContext(AuthContext);
  const query = useContext(QueryClientContext);
  return Boolean(auth && query);
}

export function useVendorNames(): (id: string) => string {
  const vendors = useCompanies('Vendor', { enabled: true });
  return (id) => vendors.data?.find((v) => v.id === id)?.name ?? id;
}

/** "1 d 2 h 5 min" with localised unit words; zero parts are left out. */
export const formatDuration = (t: TFunction, minutes: number | null): string => {
  if (minutes == null) return '—';
  const { days, hours, minutes: m } = splitMinutes(minutes);
  return [
    days ? t('equipment:vendorResponse.days', '{{count}} d', { count: days }) : '',
    hours ? t('equipment:vendorResponse.hours', '{{count}} h', { count: hours }) : '',
    m || (!days && !hours) ? t('equipment:vendorResponse.minutes', '{{count}} min', { count: m }) : '',
  ].filter(Boolean).join(' ');
};
