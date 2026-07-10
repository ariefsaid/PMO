/**
 * Shared pending-push behavior — state names + transitions + error surface — for synchronous
 * write-through on externally-owned domains (FR-EAS-060..063, AC-EAS-060/061/062). NOT a component: a
 * reusable state machine that any surface composes. Relative imports only (Deno-importable).
 */
import { AppError } from '../appError';

export type PendingPushStatus = 'idle' | 'pushing' | 'pushed' | 'push-failed';

export interface PendingPushState {
  status: PendingPushStatus;
  error: { headline: string; detail: string } | null;
}

export const IDLE_PENDING_PUSH: PendingPushState = { status: 'idle', error: null };

export function beginPush(_state: PendingPushState): PendingPushState {
  return { status: 'pushing', error: null };
}
export function completePush(_state: PendingPushState): PendingPushState {
  return { status: 'pushed', error: null };
}
export function failPush(_state: PendingPushState, err: unknown): PendingPushState {
  return { status: 'push-failed', error: classifyExternalError(err) };
}

export type WriteOutcome = { ok: true } | { ok: false; err: unknown };

export function pendingPushAfterWrite(route: 'pmo' | 'external', outcome: WriteOutcome): PendingPushState {
  if (route === 'pmo') return IDLE_PENDING_PUSH;
  return outcome.ok
    ? completePush(beginPush(IDLE_PENDING_PUSH))
    : failPush(beginPush(IDLE_PENDING_PUSH), outcome.err);
}

export function classifyExternalError(err: unknown): { headline: string; detail: string } {
  const detail = err instanceof Error ? err.message : 'An error occurred';
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : undefined;
  if (code === 'external-unreachable') {
    return { headline: 'external system unreachable — try again', detail };
  }
  if (code === 'commit-rejected') {
    return { headline: 'The external system rejected the change.', detail };
  }
  return { headline: 'Push failed', detail };
}

export { AppError };
