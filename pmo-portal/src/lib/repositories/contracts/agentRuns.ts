/** Agent run read contract: persisted run events and the liveness heartbeat the assistant panel polls. */
import type { AgentEventRow } from '@/src/lib/db/agentEvents';
import type { RunHeartbeat } from '@/src/lib/db/agentRuns';

export interface AgentRunRepository {
  /** The persisted events of one run, in order. */
  listEvents(runId: string): Promise<AgentEventRow[]>;
  /** The run's last-progress stamp and status, or null when the run is not readable. */
  getHeartbeat(runId: string): Promise<RunHeartbeat | null>;
}
