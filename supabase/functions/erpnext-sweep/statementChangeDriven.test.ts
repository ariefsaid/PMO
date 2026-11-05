// AC-CD-001/003/004: the shipped sweep cycle + driver. An unchanged ledger opens no statement batch and writes
// nothing; a nightly/intent/first-publication run refreshes once and settles through the captured cuts; a
// checker error falls back to today's hourly refresh. The DB owns every decision (0653/0654/0655).
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle } = await import('./index.ts');
const { planChangeDrivenStatements, settleChangeDrivenRun } = await import('./statementChangeDriven.ts');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
const BINDING = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const ACT = '2026-10-18T09:00:00Z';
const org = {
  orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'synthetic-test-ref', company: 'Synthetic Co',
  config: {}, ownedDomains: [], versionMajor: 16, bindingId: BINDING, activatedAt: ACT,
};
const noOpDeps = {
  reconcileOrgOutbox: () => Promise.resolve({ reconciled: 0, errors: [] }),
  sweepOrgDoctypes: () => Promise.resolve({ applied: 0 }),
  feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
  refreshOrgAccounting: () => Promise.resolve({}),
  claimStatementLock: () => Promise.resolve(true),
  releaseStatementLock: () => Promise.resolve(),
};

type Call = { name: string; args: Record<string, unknown> };
function fakeService(opts: { mode?: string; nextCheckAt?: string; plan?: Record<string, unknown>; rpcError?: string }) {
  const calls: Call[] = [];
  const service = {
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args });
      if (opts.rpcError === name) return Promise.resolve({ data: null, error: { code: 'XX000' } });
      if (name === 'sync_erp_statement_change_scope') return Promise.resolve({ data: { enabled: true, scope_epoch: 'epoch-1' }, error: null });
      if (name === 'observe_erp_statement_change') return Promise.resolve({ data: { status: 'recorded' }, error: null });
      if (name === 'plan_erp_statement_pass') return Promise.resolve({ data: opts.plan ?? { mode: opts.mode ?? 'skip' }, error: null });
      return Promise.resolve({ data: { status: 'ok' }, error: null });
    },
    from() {
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
        data: { next_check_at: opts.nextCheckAt ?? '2099-01-01T00:00:00Z', diagnostic_result: null, binding_context: { a: 1 } }, error: null,
      }) }) }) };
    },
  };
  return { service, calls };
}
const orgWithHolder = { ...org, statementLockHolder: '33333333-3333-4333-8333-333333333333' };

Deno.test('AC-CD-001: an unchanged ledger with nothing due plans a skip and never touches the ERP', async () => {
  const { service, calls } = fakeService({ mode: 'skip' });
  let clientBuilt = false;
  const d = await planChangeDrivenStatements(service, orgWithHolder, () => { clientBuilt = true; return Promise.reject(new Error('no ERP call expected')); }, Date.now());
  assert(d.kind === 'skip', `expected skip, got ${d.kind}`);
  assert(!clientBuilt, 'a check that is not due must not read the ERP');
  assert(calls.map((c) => c.name).join() === 'sync_erp_statement_change_scope,record_erp_statement_nightly_due,plan_erp_statement_pass', 'only sync, nightly recording and plan run');
});

Deno.test('AC-CD-001: a skipped tick opens no batch: no statement refresh is invoked', async () => {
  const { service } = fakeService({ mode: 'skip' });
  let refreshed = 0;
  const result = await runErpSweepCycle({
    ...noOpDeps,
    listEmployingOrgs: () => Promise.resolve([{ ...org }]),
    planChangeDrivenStatements: (o) => planChangeDrivenStatements(service, o, () => Promise.reject(new Error('unused')), Date.now()),
    refreshNativeStatements: () => { refreshed += 1; return Promise.resolve({ status: 'published' as const }); },
  });
  assert(refreshed === 0, 'a skip must not call the statement refresh, even on a due hourly tick');
  assert(!result.perOrg[0]?.errors.some((e) => e.startsWith('native-statement')), 'no statement error');
});

Deno.test('AC-CD-003/004: a run refreshes once, bypasses the hourly marker and settles through the captured cuts', async () => {
  const { service, calls } = fakeService({ plan: { mode: 'run', reason: 'nightly', dirty_cut: '7', intent_cut: '3', nightly_cut: '2026-11-04' } });
  const opts: Array<unknown> = [];
  await runErpSweepCycle({
    ...noOpDeps,
    listEmployingOrgs: () => Promise.resolve([{ ...org }]),
    claimStatementLock: () => Promise.resolve(true),
    planChangeDrivenStatements: (o) => planChangeDrivenStatements(service, { ...o, statementLockHolder: orgWithHolder.statementLockHolder }, () => Promise.reject(new Error('unused')), Date.now()),
    settleChangeDrivenStatements: (o, run, r) => settleChangeDrivenRun(service, { ...o, statementLockHolder: orgWithHolder.statementLockHolder }, run, r),
    refreshNativeStatements: (_o, o) => { opts.push(o); return Promise.resolve({ status: 'published' as const, snapshotId: 'snap-1' }); },
  }, undefined, 'money-only');
  assert(opts.length === 1 && (opts[0] as { bypassMarker?: boolean }).bypassMarker === true, 'one refresh, marker bypassed, on a money-only tick');
  const done = calls.find((c) => c.name === 'complete_erp_statement_pass');
  assert(!!done, 'a published run is completed');
  assert(done!.args.p_dirty_cut === '7' && done!.args.p_intent_cut === '3' && done!.args.p_nightly_cut === '2026-11-04' && done!.args.p_snapshot_id === 'snap-1', 'completion carries exactly the captured cuts and the generation');
});

Deno.test('AC-CD-002: a failed run backs off; an in-progress segment settles nothing', async () => {
  const { service, calls } = fakeService({ plan: { mode: 'run', reason: 'intent', dirty_cut: '1', intent_cut: '1', nightly_cut: null } });
  const run = { kind: 'run' as const, reason: 'intent', scopeEpoch: 'e', dirtyCut: '1', intentCut: '1', nightlyCut: null };
  await settleChangeDrivenRun(service, orgWithHolder, run, { status: 'progress' });
  assert(calls.length === 0, 'progress is resumable: nothing is acknowledged');
  await settleChangeDrivenRun(service, orgWithHolder, run, { status: 'failed' });
  assert(calls.length === 1 && calls[0].name === 'fail_erp_statement_pass', 'a failed run records its backoff');
});

Deno.test('AC-CD-004: a checker error falls back to today\'s hourly refresh', async () => {
  const { service, calls } = fakeService({ mode: 'skip', nextCheckAt: '2000-01-01T00:00:00Z' });
  const failingClient = { baseUrl: 'https://erp.example.test', fetchImpl: () => Promise.reject(new Error('down')) } as never;
  const d = await planChangeDrivenStatements(service, orgWithHolder, () => Promise.resolve(failingClient), Date.now());
  assert(d.kind === 'legacy', `a failed check must fall back to legacy, got ${d.kind}`);
  assert(calls.some((c) => c.name === 'observe_erp_statement_change'), 'the failure is still recorded');
  assert(!calls.some((c) => c.name === 'plan_erp_statement_pass'), 'no skip is planned off a failed check');

  // and the cycle then runs the legacy hourly pass
  let legacyRuns = 0;
  await runErpSweepCycle({
    ...noOpDeps,
    listEmployingOrgs: () => Promise.resolve([{ ...org }]),
    planChangeDrivenStatements: () => Promise.resolve({ kind: 'legacy' as const }),
    refreshNativeStatements: () => { legacyRuns += 1; return Promise.resolve({ status: 'published' as const }); },
  });
  assert(legacyRuns === 1, 'legacy decision keeps the hourly statement pass');
});

Deno.test('AC-CD-004: any RPC error falls back to legacy, never to skip', async () => {
  for (const rpcError of ['sync_erp_statement_change_scope', 'record_erp_statement_nightly_due', 'plan_erp_statement_pass']) {
    const { service } = fakeService({ mode: 'skip', rpcError });
    const d = await planChangeDrivenStatements(service, orgWithHolder, () => Promise.reject(new Error('unused')), Date.now());
    assert(d.kind === 'legacy', `${rpcError} error must fall back to legacy`);
  }
});

Deno.test('AC-CD-004: an explicit full-mode request still runs the hourly pass', async () => {
  let planned = 0; let runs = 0;
  await runErpSweepCycle({
    ...noOpDeps,
    listEmployingOrgs: () => Promise.resolve([{ ...org }]),
    forceStatementPass: true,
    planChangeDrivenStatements: () => { planned += 1; return Promise.resolve({ kind: 'skip' as const }); },
    refreshNativeStatements: () => { runs += 1; return Promise.resolve({ status: 'published' as const }); },
  }, undefined, 'full');
  assert(planned === 0 && runs === 1, 'the operator full run bypasses the change-driven plan');
});
