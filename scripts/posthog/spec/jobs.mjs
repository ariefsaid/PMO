// Dashboard fragment owned by slice S3 (#1532). Nobody else edits this file.
// job_run is emitted by withJobRun (supabase/functions/_shared/jobRun.ts): one event per run, status ok|failed|skipped.
import { trend, NS } from '../queryBuilders.mjs';

const FAILED = [{ key: 'status', value: 'failed', operator: 'exact', type: 'event' }];

export default [
  {
    dashboard: `${NS} Jobs`,
    description: 'Background job health: runs, failures, items processed, duration. Source: job_run (server event, no user id).',
    insights: [
      {
        name: `${NS} Jobs — runs by job (last-run view)`,
        query: trend([{ event: 'job_run', label: 'runs' }], { breakdown: 'job', display: 'ActionsTable' }),
      },
      {
        name: `${NS} Jobs — runs per hour`,
        query: trend([{ event: 'job_run', label: 'runs' }], { breakdown: 'job', interval: 'hour' }),
      },
      {
        name: `${NS} Jobs — failure rate (all runs vs failed)`,
        query: trend([{ event: 'job_run', label: 'runs' }], { breakdown: 'job' }),
      },
      {
        name: `${NS} Jobs — failed runs by job`,
        query: trend([{ event: 'job_run', label: 'failed' }], { breakdown: 'job', properties: FAILED }),
      },
      {
        name: `${NS} Jobs — failed runs by error code`,
        query: trend([{ event: 'job_run', label: 'failed' }], { breakdown: 'error_code', display: 'ActionsBarValue', properties: FAILED }),
      },
      {
        name: `${NS} Jobs — items processed`,
        query: trend([{ event: 'job_run', label: 'items', math: 'sum', mathProperty: 'items_processed' }], { breakdown: 'job' }),
      },
      {
        name: `${NS} Jobs — duration p95 (ms)`,
        query: trend([{ event: 'job_run', label: 'p95 ms', math: 'p95', mathProperty: 'duration_ms' }], { breakdown: 'job' }),
      },
    ],
  },
];
