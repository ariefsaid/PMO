import type { RosterWorker } from '@/src/lib/db/safetyDays';

/** Name for a worker id: the roster's display name, or a neutral fallback when the viewer may not see names. */
export function workerName(roster: RosterWorker[], id: string | null, fallback: string): string {
  if (!id) return fallback;
  return roster.find((w) => w.worker_id === id)?.display_name ?? fallback;
}
