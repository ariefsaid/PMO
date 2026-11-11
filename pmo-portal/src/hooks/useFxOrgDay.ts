import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';
import { useOrgFxContext } from './useOrgFxContext';

export function useFxOrgDay(enabled: boolean) {
  const context = useOrgFxContext();
  const org = useAuth().currentUser?.org_id;
  const timezone = context.data?.timezone;
  const day = useQuery({
    queryKey: ['fx-org-day', org ?? '', timezone ?? null],
    queryFn: () => formatCalendarDayInTimeZone(new Date(), timezone as string),
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
