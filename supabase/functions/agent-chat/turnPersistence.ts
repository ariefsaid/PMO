/**
 * turnPersistence — the per-request persistence runtime for one agent-chat turn
 * (THEME-CROSS-93 / ADR-0043 §2/§3/§4): builds the seq/journal bookkeeping from
 * HandlerDeps.persistence, looks up journaled writes for the resume de-dupe gate and
 * wraps a turn's event stream so every yielded event is ALSO persisted (best-effort).
 */
import type { AgentEvent, AgentRunStatus } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { hashToolArgs, insertEvent, setRunStatus } from './persistence.ts';
import type { HandlerDeps, PersistenceRuntime, JournaledWrite, ToolJournal } from './handlerTypes.ts';

export function makePersistenceRuntime(deps: HandlerDeps): PersistenceRuntime | undefined {
  if (!deps.persistence) return undefined;
  const { journaledWrites, startSeq, ...persistDeps } = deps.persistence;
  // ADR-0043 §2: seed from startSeq (index.ts's loadMaxSeq(runId) + 1 on a resumed request) so
  // a decision re-POST — or any re-invocation on an existing runId — continues the run's seq
  // counter instead of restarting at 0 and colliding with already-persisted rows.
  let seq = startSeq ?? 0;
  return {
    deps: persistDeps,
    journaledWrites: journaledWrites ?? [],
    nextSeq: () => seq++,
  };
}

/** Look up a journaled COMPLETED write matching (toolName, argsHash) — FR-AGP-013/015. */
export function findJournaledWrite(
  persist: PersistenceRuntime,
  toolName: string,
  argsHash: string,
): JournaledWrite | undefined {
  return persist.journaledWrites.find((j) => j.toolName === toolName && j.argsHash === argsHash);
}

/**
 * Wrap an inner AgentEvent generator so every yielded event is ALSO persisted as an
 * agent_events row (FR-AGP-011), with journal columns populated on `type==='tool'`
 * (FR-AGP-012) and the terminal status persisted onto agent_runs.status when a `status`
 * event carries a terminal value (FR-AGP-015). A no-op passthrough when `persist` is
 * undefined (flag-off, FR-AGP-026) — every persistence write is additionally
 * best-effort (insertEvent/setRunStatus already swallow their own errors, NFR-AGP-SEC-005)
 * so a DB hiccup never blocks the SSE stream.
 *
 * Review round item 5 (partial-failure de-dupe window, preferred fix (a)): the tool event's
 * payload already carries name/input/result at emit time, so the journal fields (toolName/
 * argsHash/status) are computed BEFORE insertEvent is called and passed into the SAME insert —
 * never a separate follow-up UPDATE. This closes the two-step window where a completed write's
 * journal write could fail after the write itself already executed, making it invisible to the
 * resume de-dupe gate (FR-AGP-013) and letting a client retry re-execute it.
 */
export async function* withPersistence(
  inner: AsyncGenerator<AgentEvent>,
  persist: PersistenceRuntime | undefined,
  runId: string,
): AsyncGenerator<AgentEvent> {
  for await (const ev of inner) {
    // Step events are ephemeral live-trail hints — surfaced to the panel, never persisted
    // (they must not reappear on a durable-resume/history reload).
    if (ev.type === 'status' && (ev.payload as { kind?: string } | undefined)?.kind === 'step') {
      yield ev;
      continue;
    }
    if (persist) {
      let journal: ToolJournal | undefined;
      if (ev.type === 'tool') {
        const payload = ev.payload as { name?: string; input?: unknown; result?: unknown } | undefined;
        if (payload?.name) {
          const argsHash = hashToolArgs(payload.input ?? {});
          const status = payload.result && typeof payload.result === 'object' && 'error' in (payload.result as object)
            ? 'errored' as const
            : 'completed' as const;
          journal = { toolName: payload.name, argsHash, status };
          // Keep the in-memory journal current within this same request (a run can
          // journal a write and then, later in the SAME turn, propose it again after
          // a client retry — de-dupe must see it without a DB round-trip).
          if (status === 'completed') {
            persist.journaledWrites.push({ toolName: payload.name, argsHash, payload: payload.result });
          }
        }
      }
      await insertEvent(persist.deps, runId, persist.nextSeq(), ev, journal);
      if (ev.type === 'status') {
        const statusPayload = ev.payload as { status?: AgentRunStatus } | undefined;
        if (statusPayload?.status === 'completed' || statusPayload?.status === 'errored') {
          await setRunStatus(persist.deps, runId, statusPayload.status);
        }
      }
    }
    yield ev;
  }
}
