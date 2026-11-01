/** Agent run repository implementation. */
import { listRunEvents } from '@/src/lib/db/agentEvents';
import { getRunHeartbeat } from '@/src/lib/db/agentRuns';
import { wrap } from './repositoryErrors';
import type { AgentRunRepository } from './contracts/agentRuns';

export const agentRunRepository: AgentRunRepository = {
  listEvents: (runId) => wrap(() => listRunEvents(runId)),
  getHeartbeat: (runId) => wrap(() => getRunHeartbeat(runId)),
};
