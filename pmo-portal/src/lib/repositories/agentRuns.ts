/** Agent run repository implementation. */
import { listRunEvents, rateAgentEvent } from '@/src/lib/db/agentEvents';
import { getRunHeartbeat } from '@/src/lib/db/agentRuns';
import { listAgentThreads } from '@/src/lib/db/agentThreads';
import { wrap } from './repositoryErrors';
import type { AgentRunRepository } from './contracts/agentRuns';

export const agentRunRepository: AgentRunRepository = {
  listEvents: (runId) => wrap(() => listRunEvents(runId)),
  getHeartbeat: (runId) => wrap(() => getRunHeartbeat(runId)),
  listThreads: () => wrap(() => listAgentThreads()),
  rateEvent: (eventId, rating, reason) => wrap(() => rateAgentEvent(eventId, rating, reason)),
};
