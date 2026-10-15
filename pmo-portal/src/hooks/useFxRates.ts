import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { FxRateInput } from '@/src/lib/repositories/types';

export const fxKeys = {
  root: (org: string) => ['fx-rates', org] as const,
  page: (org: string, before?: string) => ['fx-rates', org, 'page', before ?? null] as const,
  onDate: (org: string, base: string, quote: string, day: string) =>
    ['fx-rates', org, 'on', base, quote, day] as const,
};

export function useFxRates(before?: string) {
  const org = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: fxKeys.page(org ?? '', before),
    queryFn: () => repositories.fxRates.list(before),
    enabled: Boolean(org),
  });
}

export function useFxRate(base: string, quote: string, day: string | null, enabled = true) {
  const org = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey:
      org && day
        ? fxKeys.onDate(org, base, quote, day)
        : ['fx-rates', org ?? '', 'on', base, quote, day],
    queryFn: () => repositories.fxRates.onDate(base, quote, day as string),
    enabled: Boolean(org) && Boolean(day) && enabled,
    staleTime: 30_000,
  });
}

export function useFxRateMutations() {
  const org = useAuth().currentUser?.org_id;
  const queryClient = useQueryClient();
  const upsert = useMutation({
    mutationFn: (rows: FxRateInput[]) => repositories.fxRates.upsert(rows),
    onSuccess: () => {
      if (org) void queryClient.invalidateQueries({ queryKey: fxKeys.root(org) });
    },
  });
  return { upsert };
}
