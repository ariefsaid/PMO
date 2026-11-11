/** Agent run repository contract: persisted run events, the liveness heartbeat, thread history and event feedback the assistant panel uses. */
import type { AgentEventRow, DownvoteReason } from '@/src/lib/db/agentEvents';
import type { RunHeartbeat } from '@/src/lib/db/agentRuns';
import type { AgentThreadListItem } from '@/src/lib/db/agentThreads';

export interface AgentRunRepository {
  /** The persisted events of one run, in order. */
  listEvents(runId: string): Promise<AgentEventRow[]>;
  /** The run's last-progress stamp and status, or null when the run is not readable. */
  getHeartbeat(runId: string): Promise<RunHeartbeat | null>;
  /** The caller's live threads, each with its latest run id. */
  listThreads(): Promise<AgentThreadListItem[]>;
  /** Record thumbs up/down (+ optional reason) on an event; rejects when the write did not land. */
  rateEvent(eventId: string, rating: 'up' | 'down', reason?: DownvoteReason): Promise<void>;
}
