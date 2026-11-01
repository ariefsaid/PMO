import { emitServerEvent } from './posthogServer.ts';

export const JOB_NAMES = ['erpnext-sweep', 'clickup-sweep', 'clickup-webhook-worker', 'agent-dispatch', 'telegram-notify'] as const;
export type JobName = (typeof JOB_NAMES)[number];

export interface JobSummary {
  items: number;
  /** A "200" that skipped all its work (misconfigured): reported as failed with this stable code (FR-PHO-022). */
  failedCode?: string;
  /** Nothing to do by design (no bound org, e.g. standalone, ADR-0094): reported as skipped, never failed. */
  skipped?: boolean;
  orgCount?: number;
  extra?: { recovered?: number; reconcile_errors?: number; org_error_count?: number };
}
export interface JobRunOptions {
  /** null => not a scheduled run (e.g. a manual maintenance request): emit nothing. */
  summarize?: (body: unknown) => JobSummary | null;
}

const EMIT_DEADLINE_MS = 3_000; // ponytail: background ticks may wait this long; shorten if a tick ever runs near the 150 s cap
const CODE = /^[A-Z][A-Z0-9_]{2,40}$/;

/**
 * Wrap a job handler (inside serveWithErrorReporting): emit ONE `job_run` per run, never change the
 * response, rethrow so reportEdgeError still sees a throw. 401 (wrong secret) and OPTIONS are not runs;
 * the absence alert catches a tick that never authenticates.
 */
export function withJobRun(job: JobName, handler: (req: Request) => Response | Promise<Response>, opts: JobRunOptions = {}) {
  const emit = (p: Record<string, unknown>) => emitServerEvent('job_run', job, { job, ...p }, { timeoutMs: EMIT_DEADLINE_MS });
  return async (req: Request): Promise<Response> => {
    const t0 = Date.now();
    let res: Response;
    try {
      res = await handler(req);
    } catch (err) {
      await emit({ status: 'failed', error_code: 'UNHANDLED_EXCEPTION', duration_ms: Date.now() - t0 });
      throw err;
    }
    if (req.method === 'OPTIONS' || res.status === 401) return res;
    let body: unknown = null;
    try { body = await res.clone().json(); } catch { /* non-JSON body: counts as no summary */ }
    if (res.status >= 400) {
      const code = (body as { error?: unknown } | null)?.error;
      await emit({ status: 'failed', error_code: typeof code === 'string' && CODE.test(code) ? code : `HTTP_${res.status}`, duration_ms: Date.now() - t0 });
      return res;
    }
    const s = opts.summarize ? opts.summarize(body) : { items: 0 };
    if (s === null) return res;
    await emit({
      status: s.failedCode ? 'failed' : s.skipped ? 'skipped' : 'ok',
      items_processed: s.items,
      duration_ms: Date.now() - t0,
      ...(s.failedCode ? { error_code: s.failedCode } : {}),
      ...(s.orgCount !== undefined ? { org_count: s.orgCount } : {}),
      ...s.extra,
    });
    return res;
  };
}
