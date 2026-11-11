import type { ServerEventName } from './posthogServer.ts';

/**
 * Server-emitted event -> the producer function that sends it (#1532). Parsed by
 * scripts/check-dashboard-tiles.mjs (one row per line, this literal shape): a dashboard tile on a
 * server event needs a CALL of its producer under supabase/functions/<fn>/ (not _shared/).
 * All rows are pre-registered by S0; owners: S1 `$ai_*`, S3 `job_run`, S4 `erp_push_outcome`.
 */
export const SERVER_EVENT_PRODUCERS: Record<ServerEventName, { producer: string; kind: 'server' }> = {
  job_run:          { producer: 'withJobRun',             kind: 'server' },
  erp_push_outcome: { producer: 'emitErpPushOutcome',     kind: 'server' },
  $ai_generation:   { producer: 'emitAiGeneration',       kind: 'server' },
  $ai_span:         { producer: 'emitAiSpan',             kind: 'server' },
  $ai_trace:        { producer: 'emitAiTrace',            kind: 'server' },
  ai_eval:          { producer: 'emitAiEval',             kind: 'server' },
};
