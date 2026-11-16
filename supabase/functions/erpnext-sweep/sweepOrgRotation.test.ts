import "../_shared/testing/publicErpDns.ts";

/**
 * The sweep serves organisations with no failed hourly run in rotation: each tick's turn picks which of them goes
 * first, so over N consecutive ticks each of N such organisations leads once. Organisations whose last hourly run
 * failed still go after all of them. An organisation whose ERPNext answers slowly on every tick therefore leads at
 * most every other tick when two organisations share the sweep, and the other's money passes start within two ticks.
 *
 * Drives the shipped `runErpSweepCycle` (index.ts) and the shipped `sweepTurn` (sweepCadence.ts).
 *
 * Verify: deno test --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/sweepOrgRotation.test.ts
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { runErpSweepCycle } = await import('./index.ts');
import { moneyRowsStopped, sweepTryTimeoutMs, SWEEP_MIN_TRY_MS, type OrgBinding } from './sweepShared.ts';
import { SWEEP_INVOCATION_DEADLINE_MS, sweepTurn } from './sweepCadence.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const bindingOf = (orgId: string, lastFullSweepAt: string | null): OrgBinding => ({
  orgId, siteUrl: 'https://erp.example.test', secretRef: 'synthetic-test-ref', company: 'Synthetic Co',
  config: {}, ownedDomains: ['revenue'], versionMajor: 16, lastFullSweepAt, fullSweepFailures: 0,
});

/** One money-only tick: `slow`'s ERPNext answers, but each of its passes takes most of the invocation. */
async function tick(turn: number | undefined, slow: string) {
  let clock = 0; // the invocation's own clock
  const firstTry: Record<string, number> = {};
  const order: string[] = [];
  const pass = () => Promise.resolve({ driven: 0 });
  // The slow organisation waited longest for its hourly work, so without rotation it would always go first.
  const orgs = [bindingOf('b', '2026-11-16T09:50:00Z'), bindingOf('a', '2026-11-16T09:00:00Z')];
  await runErpSweepCycle({
    listEmployingOrgs: () => Promise.resolve(orgs),
    reconcileOrgOutbox: (o: OrgBinding) => {
      order.push(o.orgId);
      firstTry[o.orgId] = moneyRowsStopped(o) ? 0 : sweepTryTimeoutMs(o.sweepBudget!);
      if (o.orgId === slow) clock += 130_000; // answered, slowly
      return Promise.resolve({ reconciled: 0, errors: [] });
    },
    reconcileOrgBudgetPushes: pass,
    reconcileOrgTimesheetPushes: pass,
    reconcileOrgExpensePostings: pass,
    sweepOrgDoctypes: () => Promise.resolve({ applied: 0, complete: true }),
    feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
    refreshOrgAccounting: () => Promise.resolve({}),
    isFullSweepDue: () => false,
    nowMs: () => clock,
    invocationDeadlineAtMs: SWEEP_INVOCATION_DEADLINE_MS,
    ...(turn === undefined ? {} : { turn }),
  } as unknown as Parameters<typeof runErpSweepCycle>[0], undefined, 'money-only');
  return { firstTry, order };
}

Deno.test('two organisations, one whose ERPNext answers slowly every tick: the other\'s money pass starts within two ticks', async () => {
  for (const start of [0, 1, 28_000_000, 28_000_001]) {
    const ticks = [await tick(start, 'a'), await tick(start + 1, 'a')];
    assert(ticks.some((t) => (t.firstTry.b ?? 0) >= SWEEP_MIN_TRY_MS),
      `from turn ${start}, b's money pass starts with a full minimum try within two ticks: ${JSON.stringify(ticks)}`);
    assert(ticks.some((t) => (t.firstTry.a ?? 0) >= SWEEP_MIN_TRY_MS), `a is still served within two ticks: ${JSON.stringify(ticks)}`);
  }
});

Deno.test('the organisations with no failed hourly run take turns going first; each leads once over as many ticks as there are', async () => {
  const leads = new Map<string, number>();
  for (let turn = 40; turn < 46; turn++) {
    const { order } = await tick(turn, 'none');
    assert(order.length === 2, `both organisations are visited: ${order.join()}`);
    leads.set(order[0]!, (leads.get(order[0]!) ?? 0) + 1);
  }
  assert(leads.get('a') === 3 && leads.get('b') === 3, `six ticks, three leads each: ${JSON.stringify([...leads])}`);
});

Deno.test('an organisation whose last hourly run failed still goes after every rotating organisation', async () => {
  for (let turn = 0; turn < 3; turn++) {
    const order: string[] = [];
    const orgs = [
      { ...bindingOf('failing', null), fullSweepFailures: 2 },
      bindingOf('x', '2026-11-16T09:00:00Z'),
      bindingOf('y', '2026-11-16T09:10:00Z'),
    ];
    await runErpSweepCycle({
      listEmployingOrgs: () => Promise.resolve(orgs),
      reconcileOrgOutbox: (o: OrgBinding) => { order.push(o.orgId); return Promise.resolve({ reconciled: 0, errors: [] }); },
      sweepOrgDoctypes: () => Promise.resolve({ applied: 0, complete: true }),
      feedOrgLedgers: () => Promise.resolve({ gl: 0, ple: 0, glCaughtUp: true, pleCaughtUp: true }),
      refreshOrgAccounting: () => Promise.resolve({}),
      isFullSweepDue: () => false,
      turn,
    } as unknown as Parameters<typeof runErpSweepCycle>[0], undefined, 'money-only');
    assert(order[2] === 'failing', `turn ${turn}: the failing organisation goes last: ${order.join()}`);
  }
});

Deno.test('with no turn given, the organisation whose hourly work waited longest goes first', async () => {
  const { order } = await tick(undefined, 'none');
  assert(order.join() === 'a,b', `waited-longest first: ${order.join()}`);
});

Deno.test('sweepTurn: consecutive once-a-minute ticks get consecutive turns, a few seconds late or early', () => {
  const minute = Date.parse('2026-11-16T10:00:00Z');
  const turns = [minute + 3_000, minute + 60_000 + 25_000, minute + 120_000 - 20_000, minute + 180_000].map(sweepTurn);
  for (let i = 1; i < turns.length; i++) assert(turns[i]! - turns[i - 1]! === 1, `consecutive turns: ${turns.join()}`);
  assert(Number.isSafeInteger(turns[0]!) && turns[0]! >= 0, `a whole, non-negative turn: ${turns[0]}`);
});
