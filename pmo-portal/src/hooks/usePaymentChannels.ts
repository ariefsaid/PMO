import { useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { paymentChannelRepository as repo } from '@/src/lib/repositories/paymentChannels';
import { useModuleOn } from '@/src/hooks/useOrgSwitch';

const KEY = 'payment-channels';

/** The org's id, or nothing while signed out; reads stay disabled until it is known. */
function useChannelOrgId(): string | undefined {
  return useContext(AuthContext)?.currentUser?.org_id;
}

/** Whether the organisation records a payment channel (#2698). Off until an Admin turns it on; a failed read counts as off. */
export function usePaymentChannelsOn() {
  const orgId = useChannelOrgId();
  const query = useQuery({
    queryKey: [KEY, 'enabled', orgId],
    queryFn: async () => { try { return await repo.enabled(); } catch { return false; } },
    enabled: Boolean(orgId),
    staleTime: 5 * 60 * 1000,
  });
  const moduleOn = useModuleOn('modulePurchasingExtras');
  return { on: query.data === true && moduleOn, query };
}

/** The org's channels (live and archived), read only while the feature is on. */
export function usePaymentChannelList(enabled: boolean) {
  const orgId = useChannelOrgId();
  return useQuery({ queryKey: [KEY, 'list', orgId], queryFn: () => repo.list(), enabled: enabled && Boolean(orgId) });
}

/** One request's channel, read only while the feature is on. */
export function useRequestPaymentChannel(procurementId: string, enabled: boolean) {
  const orgId = useChannelOrgId();
  return useQuery({ queryKey: [KEY, 'request', orgId, procurementId], queryFn: () => repo.onRequest(procurementId), enabled: enabled && Boolean(orgId) });
}

/** Channel names for a list of requests, read only while the feature is on. */
export function usePaymentChannelNames(procurementIds: readonly string[], enabled: boolean) {
  const orgId = useChannelOrgId();
  const key = [...procurementIds].sort().join(',');
  return useQuery({ queryKey: [KEY, 'names', orgId, key], queryFn: () => repo.namesFor(procurementIds), enabled: enabled && Boolean(orgId) });
}

/** Admin writes and the per-request write; every one refreshes the channel reads. */
export function usePaymentChannelMutations() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: [KEY] });
  return {
    setEnabled: useMutation({ mutationFn: (on: boolean) => repo.setEnabled(on), onSuccess: refresh }),
    save: useMutation({ mutationFn: (v: { id: string | null; name: string }) => repo.save(v.id, v.name), onSuccess: refresh }),
    archive: useMutation({ mutationFn: (v: { id: string; archived: boolean }) => repo.archive(v.id, v.archived), onSuccess: refresh }),
    setOnRequest: useMutation({ mutationFn: (v: { procurementId: string; channelId: string | null }) => repo.setOnRequest(v.procurementId, v.channelId), onSuccess: refresh }),
  };
}
