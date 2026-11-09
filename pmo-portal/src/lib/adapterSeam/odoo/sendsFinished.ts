/**
 * The setup checklist's "Sends finished" step (FR-ODC-110), read from the setup run's send state (`connect-status`) so no
 * marker has to be written when sends complete. Finished = the latest run has settled (its sends are confirmed), nothing is
 * waiting on Odoo, and no party, item or project has an open send or review row. Open link and bring-in rows are other steps, not sends; an account review is Finance's chart mapping and never sends.
 */
export interface SendsStatus {
  run: { state: string; finished_at: string | null } | null;
  waitingForSend: number;
  proposalCounts?: Record<string, { link: number; bring_in: number; send: number; review: number; applied_link: number }>;
}

const SEND_KINDS = ['party', 'item', 'project'] as const;

export function sendsFinished(s: SendsStatus): boolean {
  if (!s.run || s.run.state !== 'ready' || !s.run.finished_at || s.waitingForSend > 0 || !s.proposalCounts) return false;
  const counts = s.proposalCounts;
  return SEND_KINDS.every((k) => !counts[k] || (counts[k].send === 0 && counts[k].review === 0));
}
