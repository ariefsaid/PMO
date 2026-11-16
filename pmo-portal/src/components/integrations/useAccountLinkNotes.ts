import { useQuery } from '@tanstack/react-query';

import { repositories } from '@/src/lib/repositories';
import type { ConnectTier } from '@/src/lib/repositories/types';

/** "<name> already exists under <group>; linked there." — the note the sweep keeps on an account it linked under another group. */
const ELSEWHERE = /^(.+) already exists under (.+); linked there\.$/;

/** The notes on accounts PMO linked under a different group than the one picked (one shared query, so the checklist and the notes agree). */
export function useAccountLinkNotes(tier: ConnectTier = 'erpnext', enabled = true) {
  const applied = useQuery({
    queryKey: ['integrations', 'account-link-notes', tier],
    queryFn: () => repositories.integrations.listConnectProposals(tier, 'account', 'send', null, 'applied'),
    enabled,
    retry: false,
  });
  return (applied.data?.proposals ?? [])
    .map((p) => ({ id: p.id, match: ELSEWHERE.exec(p.reason_text ?? '') }))
    .filter((n): n is { id: string; match: RegExpExecArray } => n.match !== null);
}
