import { useQuery } from '@tanstack/react-query';

import { repositories } from '@/src/lib/repositories';
import type { ConnectTier } from '@/src/lib/repositories/types';

/** "<name> already exists under <group>; linked there." — the note the sweep keeps on an account it linked under another group. */
const ELSEWHERE = /^(.+) already exists under (.+); linked there\.$/;

/** The notes on accounts PMO linked under a different group than the one picked (one shared query, so the checklist and the notes agree). */
export function useAccountLinkNotes(tier: ConnectTier = 'erpnext', enabled = true) {
  const applied = useQuery({
    queryKey: ['integrations', 'account-link-notes', tier],
    queryFn: async () => {
      const proposals: Awaited<ReturnType<typeof repositories.integrations.listConnectProposals>>['proposals'] = [];
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const page = await repositories.integrations.listConnectProposals(tier, 'account', 'send', cursor, 'applied');
        proposals.push(...page.proposals);
        cursor = page.nextAfterId;
        if (cursor !== null && seen.has(cursor)) throw new Error('Account notice pagination did not advance');
        if (cursor !== null) seen.add(cursor);
      } while (cursor !== null);
      return { proposals };
    },
    enabled,
    retry: false,
  });
  return (applied.data?.proposals ?? []).flatMap((p) => {
    const text = p.reason_text ?? '';
    const name = p.snapshot.accountName;
    const prefix = `${name} already exists under `;
    const suffix = '; linked there.';
    if (name && text.startsWith(prefix) && text.endsWith(suffix)) {
      return [{ id: p.id, name, group: text.slice(prefix.length, -suffix.length) }];
    }
    const legacy = ELSEWHERE.exec(text);
    return legacy ? [{ id: p.id, name: legacy[1], group: legacy[2] }] : [];
  });
}
