import { reconcileOrgBudgetArchiveCancellations, type BudgetArchiveCancelIntent, type BudgetArchiveBackstopDeps } from './budgetArchiveBackstop.ts';

globalThis.fetch = async () => { throw new Error('unexpected network access in archive queue unit test'); };
(Deno as unknown as { serve: (...args: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
await import('./index.ts');

const JOB: BudgetArchiveCancelIntent = {
  id: 'job-1', org_id: 'org-1', project_id: 'project-1', budget_version_id: 'version-1',
  source_mirror_id: 'mirror-1', actor_user_id: 'actor-1', fiscal_year: '2026', erp_account: 'Labor',
  erp_budget_name: 'BUD-1', activated_at_witness: '2026-10-15T10:00:00Z',
  pushed_project_start_date: '2026-01-01', pushed_project_end_date: '2026-12-31',
};

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function deps(overrides: Partial<BudgetArchiveBackstopDeps> = {}) {
  const calls: string[] = [];
  const base: BudgetArchiveBackstopDeps = {
    listPending: async () => [JOB],
    readLifecycle: async () => ({ status: 'Archived', activatedAt: JOB.activated_at_witness, activeSuccessorUsesTarget: false }),
    targetIsStillLiveAndOwned: async () => true,
    driveCancellation: async () => { calls.push('drive'); return true; },
    markComplete: async () => { calls.push('complete'); },
    markSuperseded: async () => { calls.push('superseded'); },
    markHeld: async (_job, reason) => { calls.push(`held:${reason}`); },
    noteRetry: async (_job, _reason) => { calls.push('retry'); },
  };
  return { deps: { ...base, ...overrides }, calls };
}

Deno.test('archive cancellation backstop drives only an archived, unchanged version with no active successor', async () => {
  const { deps: backstopDeps, calls } = deps();

  const result = await reconcileOrgBudgetArchiveCancellations(backstopDeps, 'org-1');

  assert(result.driven === 1, `expected one cancellation to be driven: ${JSON.stringify(result)}`);
  assert(calls.join(',') === 'drive,complete', `successful dispatch must be completed: ${calls.join(',')}`);
});

Deno.test('archive cancellation backstop supersedes a queued cancellation when a successor is active', async () => {
  const { deps: backstopDeps, calls } = deps({
    readLifecycle: async () => ({ status: 'Archived', activatedAt: JOB.activated_at_witness, activeSuccessorUsesTarget: true }),
  });

  const result = await reconcileOrgBudgetArchiveCancellations(backstopDeps, 'org-1');

  assert(result.superseded === 1, `successor should supersede the archive job: ${JSON.stringify(result)}`);
  assert(calls.join(',') === 'superseded', `superseded job must not reach ERP: ${calls.join(',')}`);
});

Deno.test('archive cancellation backstop leaves an outbox retry window pending', async () => {
  const calls: string[] = [];
  const { deps: backstopDeps } = deps({ driveCancellation: async () => { calls.push('deferred'); return false; } });

  const result = await reconcileOrgBudgetArchiveCancellations(backstopDeps, 'org-1');

  assert(result.driven === 0 && result.errors.length === 0, `an ordinary retry window is not an archive success: ${JSON.stringify(result)}`);
  assert(calls.join(',') === 'deferred', `deferred jobs must stay pending: ${calls.join(',')}`);
});

Deno.test('archive cancellation backstop holds stale witnesses and contains one failed row', async () => {
  const second = { ...JOB, id: 'job-2', budget_version_id: 'version-2' };
  const { deps: backstopDeps, calls } = deps({
    listPending: async () => [JOB, second],
    readLifecycle: async (job) => job.id === 'job-1'
      ? { status: 'Archived', activatedAt: '2026-10-16T10:00:00Z', activeSuccessorUsesTarget: false }
      : { status: 'Archived', activatedAt: job.activated_at_witness, activeSuccessorUsesTarget: false },
    driveCancellation: async (job) => { if (job.id === 'job-2') throw new Error('ERP unavailable'); return true; },
  });

  const result = await reconcileOrgBudgetArchiveCancellations(backstopDeps, 'org-1');

  assert(result.held === 1 && result.errors.length === 1, `stale and failed jobs must remain visible: ${JSON.stringify(result)}`);
  assert(calls.join(',') === 'held:activation-witness-changed,retry', `one bad row must not starve the next: ${calls.join(',')}`);
});
