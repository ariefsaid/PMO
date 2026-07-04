/**
 * fire.ts — run a fired automation through the NORMAL deputy loop (ADR-0044 §3, FR-AAN-017/020).
 *
 * The fired run is an ORDINARY agent run: it invokes the SAME `agentChatHandler` the interactive
 * path uses, with the SAME AgentAction catalog, the SAME RLS ceiling, the SAME can() re-auth on
 * writes, and the SAME untrusted-output boundary. From the loop's perspective it is
 * INDISTINGUISHABLE from an interactive run — the only difference is that its `supabase` client is
 * the MINTED owner client (built by mint.ts) rather than a live user's browser JWT client. There is
 * NO automation-only branch inside the loop.
 *
 * The handler + minted client are injected (REC-1) so this compiles + unit-tests under Node/Vitest.
 * We do NOT import agent-chat source that has Deno-only deps at module load — `handler` is passed in.
 */
import type { AutomationRow } from './dispatcher.ts';

/**
 * The agentChatHandler shape fireAutomation drives — a pure async generator of events. Typed
 * structurally (not imported) so this module has no Deno/edge coupling; index.ts passes the real
 * `agentChatHandler` and the real HandlerDeps-shaped `deps`.
 */
export type FireHandler = (
  req: { runId?: string; messages: Array<{ role: 'user'; content: string }>; context?: unknown },
  deps: {
    modelClient: unknown;
    model: string;
    supabase: unknown;
    userId: string;
    signal?: AbortSignal;
    [key: string]: unknown;
  },
) => AsyncIterable<{ runId: string; type: string; payload?: unknown }>;

export interface FireAutomationDeps {
  /** The real agentChatHandler (index.ts injects it; unit tests inject a vi.fn generator). */
  handler: FireHandler;
  /** The MINTED owner client (mint.ts) — the fired run's RLS ceiling is the owner (FR-AAN-017). */
  mintedClient: unknown;
  /** The same vendor-neutral model client the interactive path uses. */
  modelClient: unknown;
  /** Resolved chat-tier model id for the fired run. */
  model: string;
  /** The automation's owner_id — the deputy identity (== automation.owner_id). */
  ownerId: string;
  automation: AutomationRow;
  /**
   * The pre-created run id (auditMint established the thread+run + seq-0 audit event). The handler
   * RESUMES this run so exactly one ordinary run exists per fire (FR-AAN-020) with the audit as its
   * first system event.
   */
  runId: string;
  /** timeout_s AbortSignal (§0) — a coarse wall-clock deadline on top of MAX_TOOL_ROUNDS. */
  signal?: AbortSignal;
  /**
   * Optional extra HandlerDeps passthrough (can, composeEnabled, persistence, startSeq, rateGuard,
   * now) — index.ts constructs these; the fire path threads them opaquely so the fired run gets the
   * EXACT same gates as interactive.
   */
  handlerExtras?: Record<string, unknown>;
}

/**
 * fireAutomation — drive the fired automation through agentChatHandler under the minted owner
 * client, draining the event stream server-side to its terminal status (there is no live client to
 * consume the SSE — the run persists via the ADR-0043 persistence path exactly like an interactive
 * run). Returns the terminal run id (FR-AAN-017/020).
 */
export async function fireAutomation(deps: FireAutomationDeps): Promise<string> {
  const req = {
    runId: deps.runId,
    messages: [{ role: 'user' as const, content: deps.automation.prompt }],
  };

  const handlerDeps = {
    modelClient: deps.modelClient,
    model: deps.model,
    supabase: deps.mintedClient,
    userId: deps.ownerId,
    signal: deps.signal,
    ...(deps.handlerExtras ?? {}),
  };

  // Drain the generator fully server-side — do NOT break early (mirrors index.ts's client-
  // disconnect continuation: the run must reach its durable terminal state).
  for await (const _ev of deps.handler(req, handlerDeps)) {
    // no-op: events persist via the handler's own persistence path (ADR-0043).
    void _ev;
  }

  return deps.runId;
}
