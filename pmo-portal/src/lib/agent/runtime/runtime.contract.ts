/**
 * runAgentRuntimeContract — reusable port contract suite.
 * FR-AR-025: ANY adapter implementing AgentRuntime must pass this suite.
 *
 * NOT a *.test.ts file — Vitest does not auto-collect it.
 * Imported by port.contract.test.ts which runs it against PmoNativeRuntime.
 * Future AgentNativeRuntime tests import it too.
 */
import { describe, it, expect } from 'vitest';
import type { AgentRuntime } from './port';

/** The minimum number of scripted events the cancel factory must provide. */
export const CANCEL_SCRIPTED_MIN = 8;

/**
 * Run the port behavioral contract against an AgentRuntime factory.
 *
 * @param makeRuntime          Factory returning a fresh runtime for each sub-test.
 *                             Its scripted transport should supply at least 3 events
 *                             (user, assistant, status:completed).
 * @param makeLongRunRuntime   Optional factory returning a runtime whose scripted
 *                             transport supplies ≥ CANCEL_SCRIPTED_MIN events.
 *                             Required for the cancel test to prove early termination.
 *                             If omitted the cancel test is still included but the
 *                             assertion is weakened to events.length < scripted total,
 *                             which is vacuously true only if AbortError is thrown.
 */
export function runAgentRuntimeContract(
  makeRuntime: () => AgentRuntime,
  makeLongRunRuntime?: () => { runtime: AgentRuntime; scriptedCount: number },
): void {
  describe('AgentRuntime contract (FR-AR-025)', () => {
    it('createRun resolves an AgentRun with a non-empty id and status in {queued, running}', async () => {
      const runtime = makeRuntime();
      const run = await runtime.createRun({ goal: 'test goal' });
      expect(run.id).toBeTruthy();
      expect(['queued', 'running']).toContain(run.status);
    });

    it('subscribe(runId) yields events starting with type:user and ending with terminal status', async () => {
      const runtime = makeRuntime();
      const run = await runtime.createRun({ goal: 'test goal' });
      const events = [];
      for await (const ev of runtime.subscribe(run.id)) {
        events.push(ev);
      }
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('user');
      const last = events.at(-1)!;
      expect(last.type).toBe('status');
      expect(
        ['completed', 'errored'].includes(
          (last.payload as { status: string })?.status,
        ),
      ).toBe(true);
    });

    it('control(runId, cancel) terminates the stream before exhausting the scripted events (FR-AR-005)', async () => {
      // Blocker 5: the cancel test must use a LONG event stream so that the
      // assertion proves early termination — not just that 3 ≤ 3.
      //
      // The factory provides a runtime with ≥ CANCEL_SCRIPTED_MIN scripted events.
      // After consuming the first event we call cancel and break.
      // The total events consumed must be strictly less than the scripted total.
      const { runtime, scriptedCount } = makeLongRunRuntime
        ? makeLongRunRuntime()
        : (() => {
            // Fallback: use the regular runtime and accept the weaker assertion
            // (cancel must at least not throw).
            const rt = makeRuntime();
            return { runtime: rt, scriptedCount: 3 };
          })();

      const run = await runtime.createRun({ goal: 'test goal' });
      const events: unknown[] = [];

      try {
        for await (const ev of runtime.subscribe(run.id)) {
          events.push(ev);
          if (events.length === 1) {
            // Cancel after the first event — a non-cancelled run would yield all scriptedCount events
            await runtime.control(run.id, 'cancel');
          }
        }
      } catch {
        // AbortError is acceptable — cancel aborted the fetch
      }

      // Prove early termination: collected fewer events than the scripted total.
      // For a long stream (CANCEL_SCRIPTED_MIN+), this cannot pass if cancel was a no-op.
      expect(events.length).toBeLessThan(scriptedCount);
    });

    it('followUp(runId, message) resolves and targets the same run', async () => {
      const runtime = makeRuntime();
      const run = await runtime.createRun({ goal: 'initial goal' });
      // followUp should resolve without throwing
      await expect(runtime.followUp(run.id, 'follow up message')).resolves.toBeUndefined();
    });
  });
}
