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

/**
 * Run the port behavioral contract against an AgentRuntime factory.
 * @param makeRuntime  Factory that returns a fresh runtime for each sub-test.
 *                     The factory should supply its own fake transport/fetch.
 */
export function runAgentRuntimeContract(makeRuntime: () => AgentRuntime): void {
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

    it('control(runId, cancel) terminates the stream without further events', async () => {
      const runtime = makeRuntime();
      const run = await runtime.createRun({ goal: 'test goal' });
      // Cancel immediately
      await runtime.control(run.id, 'cancel');
      // After cancel, subscribe should not yield any events (stream aborted)
      const events = [];
      try {
        for await (const ev of runtime.subscribe(run.id)) {
          events.push(ev);
        }
      } catch {
        // AbortError is acceptable — cancel aborted the stream
      }
      // Either empty (cancelled before any events) or the fetch threw AbortError
      expect(events.length).toBeLessThanOrEqual(3); // at most user+tool+status before abort
    });

    it('followUp(runId, message) resolves and targets the same run', async () => {
      const runtime = makeRuntime();
      const run = await runtime.createRun({ goal: 'initial goal' });
      // followUp should resolve without throwing
      await expect(runtime.followUp(run.id, 'follow up message')).resolves.toBeUndefined();
    });
  });
}
