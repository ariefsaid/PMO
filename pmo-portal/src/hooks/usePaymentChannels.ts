import { useContext } from 'react';
import { QueryClient, QueryClientContext, useMutation, useQuery } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { paymentChannelRepository as repo } from '@/src/lib/repositories/paymentChannels';
import { useModuleOn } from '@/src/hooks/useOrgSwitch';

const KEY = 'payment-channels';

/**
 * The channel views are additive: they sit on screens that existed before #2698 (request details, payables list). So these
 * hooks tolerate a missing auth or data provider: with none, every read is disabled and the views render nothing.
 */
const FALLBACK_CLIENT = new QueryClient();

function useChannelContext() {
  const client = useContext(QueryClientContext);
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  return { client: client ?? FALLBACK_CLIENT, orgId, ready: client !== undefined && Boolean(orgId) };
}

/** True when a data provider is mounted. */
export function useHasQueryClient(): boolean {
  return useContext(QueryClientContext) !== undefined;
}

/** Whether the organisation records a payment channel (#2698). Off until an Admin turns it on; a failed read counts as off. */
export function usePaymentChannelsOn() {
  const { client, orgId, ready } = useChannelContext();
  const query = useQuery({
    queryKey: [KEY, 'enabled', orgId],
    queryFn: async () => { try { return await repo.enabled(); } catch { return false; } },
    enabled: ready,
    staleTime: 5 * 60 * 1000,
  }, client);
  const moduleOn = useModuleOn('modulePurchasingExtras');
  return { on: query.data === true && moduleOn, query };
}

/** The org's channels (live and archived), read only while the feature is on. */
export function usePaymentChannelList(enabled: boolean) {
  const { client, orgId, ready } = useChannelContext();
  return useQuery({ queryKey: [KEY, 'list', orgId], queryFn: () => repo.list(), enabled: enabled && ready }, client);
}

/** One request's channel, read only while the feature is on. */
export function useRequestPaymentChannel(procurementId: string, enabled: boolean) {
  const { client, orgId, ready } = useChannelContext();
  return useQuery({ queryKey: [KEY, 'request', orgId, procurementId], queryFn: () => repo.onRequest(procurementId), enabled: enabled && ready }, client);
}

/** Channel names for a list of requests, read only while the feature is on. */
export function usePaymentChannelNames(procurementIds: readonly string[], enabled: boolean) {
  const { client, orgId, ready } = useChannelContext();
  const key = [...procurementIds].sort().join(',');
  return useQuery({ queryKey: [KEY, 'names', orgId, key], queryFn: () => repo.namesFor(procurementIds), enabled: enabled && ready }, client);
}

/** Admin writes and the per-request write; every one refreshes the channel reads. */
export function usePaymentChannelMutations() {
  const { client } = useChannelContext();
  const refresh = () => client.invalidateQueries({ queryKey: [KEY] });
  return {
    setEnabled: useMutation({ mutationFn: (on: boolean) => repo.setEnabled(on), onSuccess: refresh }, client),
    save: useMutation({ mutationFn: (v: { id: string | null; name: string }) => repo.save(v.id, v.name), onSuccess: refresh }, client),
    archive: useMutation({ mutationFn: (v: { id: string; archived: boolean }) => repo.archive(v.id, v.archived), onSuccess: refresh }, client),
    setOnRequest: useMutation({ mutationFn: (v: { procurementId: string; channelId: string | null }) => repo.setOnRequest(v.procurementId, v.channelId), onSuccess: refresh }, client),
  };
}
