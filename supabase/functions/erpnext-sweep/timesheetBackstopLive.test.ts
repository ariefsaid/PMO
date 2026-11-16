// THEME-BACK-40 (#1643): the timesheet backstop's live wiring, imported from its own module.
import { absentQueueBudget, reconcileOrgTimesheetPushesLive } from './timesheetBackstopLive.ts';
import { listCandidatesLive } from './sweepShared.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test('THEME-BACK-06 a full mirror queue still leaves a quarter of the tick for approved sheets with no mirror row', () => {
  assert(absentQueueBudget(200, 0) === 200, 'an empty mirror queue gives absent sheets the whole limit');
  assert(absentQueueBudget(200, 180) === 50, 'the reserved floor wins over the leftover');
  assert(absentQueueBudget(200, 500) === 50, 'an overfull mirror queue cannot starve absent sheets');
});

Deno.test('BLOCK 9 an org that never assigned timesheets to ERPNext has nothing to reconcile and reads nothing', async () => {
  const client = { from: () => { throw new Error('no read expected'); }, rpc: () => { throw new Error('no read expected'); } } as never;
  const org = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, ownedDomains: ['budget'], versionMajor: 15 };
  const result = await reconcileOrgTimesheetPushesLive(client, org);
  assert(result.driven === 0 && result.error === undefined, JSON.stringify(result));
});

/** A recording client for the live timesheet pass. Every sheet has a `failed` mirror row and an EXISTING outbox
 *  row (so nothing is minted); `outbox_reconcile_candidates` answers `candidates`. A sheet whose outbox row is
 *  NOT in the eligible set is parked `held` (attempts-exhausted) — that park is the observable proof the id was
 *  absent from the set the deps received. */
function timesheetPassClient(sheets: Array<{ timesheetId: string; outboxId: string; state: string }>, candidates: Array<Record<string, unknown>>) {
  const parkedHeld: string[] = [];
  const client = {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      // deno-lint-ignore no-explicit-any
      const q: any = new Proxy({}, {
        get: (_t, prop) => {
          if (prop === 'then') {
            return (resolve: (v: unknown) => unknown) => {
              if (table === 'timesheet_erp_mirror' && patch === null) {
                return resolve({ data: sheets.map((s) => ({ id: `m-${s.timesheetId}`, timesheet_id: s.timesheetId, push_state: 'failed', erp_cancelled_at: null, last_attempt_at: null })), error: null });
              }
              if (table === 'timesheet_erp_mirror' && patch?.push_state === 'held') parkedHeld.push(String(eqs.timesheet_id));
              return resolve({ data: [], error: null });
            };
          }
          if (prop === 'update') return (p: Record<string, unknown>) => { patch = p; return q; };
          if (prop === 'eq') return (column: string, value: unknown) => { eqs[column] = value; return q; };
          if (prop === 'maybeSingle') {
            return () => {
              if (table === 'timesheets') return Promise.resolve({ data: { approved_by: 'approver' }, error: null });
              if (table === 'external_command_outbox') {
                const sheet = sheets.find((s) => s.timesheetId === eqs.pmo_record_id);
                return Promise.resolve({ data: sheet ? { id: sheet.outboxId, domain: 'timesheets', pmo_record_id: sheet.timesheetId, idempotency_key: 'k', state: sheet.state } : null, error: null });
              }
              return Promise.resolve({ data: null, error: null });
            };
          }
          return () => q;
        },
      });
      return q;
    },
    rpc: (fn: string) => Promise.resolve({
      data: fn === 'outbox_reconcile_candidates' ? candidates
        : fn === 'approved_timesheet_for_push' ? [{ approved_at: '2026-03-01T00:00:00Z', user_id: 'u', entries: [] }]
        : [],
      error: null,
    }),
  } as never;
  return { client, parkedHeld };
}

Deno.test('H-1 the timesheet pass hands the deps EVERY timesheets-domain candidate the RPC admits (any state) and no other domain', async () => {
  const org = { orgId: 'o', siteUrl: 'https://erp.example.com', secretRef: 's', company: 'C', config: {}, ownedDomains: ['timesheets'], versionMajor: 15 };
  // The sheets whose outbox row the RPC admits (pending, failed) must NOT be parked; the one it omits, and the
  // one whose id only appears under another domain, must be.
  const sheets = [
    { timesheetId: 'ts-pending', outboxId: 'ob-1', state: 'pending' },
    { timesheetId: 'ts-failed', outboxId: 'ob-2', state: 'failed' },
    { timesheetId: 'ts-omitted', outboxId: 'ob-3', state: 'failed' },
    { timesheetId: 'ts-other-domain', outboxId: 'ob-4', state: 'failed' },
  ];
  const candidates = [
    { id: 'ob-1', domain: 'timesheets', pmo_record_id: 'ts-pending', idempotency_key: 'k', state: 'pending' },
    { id: 'ob-2', domain: 'timesheets', pmo_record_id: 'ts-failed', idempotency_key: 'k', state: 'failed' },
    { id: 'ob-4', domain: 'budget', pmo_record_id: 'ts-other-domain', idempotency_key: 'k', state: 'failed' },
  ];
  const { client, parkedHeld } = timesheetPassClient(sheets, candidates);
  // Sanity: the RPC wrapper the pass uses really returns all three rows, so any narrowing is the pass's own.
  assert((await listCandidatesLive(client)('o')).length === 3, 'the candidates RPC answer is the fixture');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error('no network in this test'))) as typeof fetch;
  try {
    await reconcileOrgTimesheetPushesLive(client, org);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert(
    JSON.stringify([...parkedHeld].sort()) === JSON.stringify(['ts-omitted', 'ts-other-domain']),
    `only sheets whose outbox row is outside the timesheets candidates are parked: ${JSON.stringify(parkedHeld)}`,
  );
});
