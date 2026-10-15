import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { orgDay } from '@/src/lib/fxEquivalent';

export function useFxOrgDay(enabled: boolean) {
  const org = useAuth().currentUser?.org_id;
  const context = useQuery({
    queryKey: ['fx-context', org ?? ''],
    queryFn: () => repositories.fxRates.context(),
    enabled: Boolean(org),
    staleTime: Infinity,
  });
  const timezone = context.data?.timezone;
  const day = useQuery({
    queryKey: ['fx-org-day', org ?? '', timezone ?? null],
    queryFn: () => orgDay(new Date(), timezone as string),
    enabled: enabled && Boolean(org) && Boolean(timezone),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  return {
    day: day.data ?? null,
    isPending: Boolean(enabled && (context.isPending || (context.data && day.isPending))),
    isError: context.isError || day.isError,
    retry: () => {
      void context.refetch();
      if (context.data) void day.refetch();
    },
  };
}
