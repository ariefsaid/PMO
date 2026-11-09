/**
 * The setup checklist's "Sends finished" step (AC-ODC-080), read from the setup run's send state (`connect-status`) so no
 * marker has to be written when sends complete. Finished = the latest run has settled (its sends are confirmed), nothing is
 * waiting on Odoo, and no kind has an open send or review row. Open link and bring-in rows are other steps, not sends.
 */
export interface SendsStatus {
  run: { state: string; finished_at: string | null } | null;
  waitingForSend: number;
  proposalCounts?: Record<string, { send: number; review: number }>;
}

export function sendsFinished(s: SendsStatus): boolean {
  if (!s.run || s.run.state !== 'ready' || !s.run.finished_at || s.waitingForSend > 0 || !s.proposalCounts) return false;
  return Object.values(s.proposalCounts).every((c) => c.send === 0 && c.review === 0);
}
