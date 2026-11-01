/**
 * The Odoo connection-state machine (FR-ODC-030/031/034, plan §2.6). Pure: the sweep, re-check and activation feed it
 * probe outcomes and store the record in binding `config.connection`; the browser only reads it.
 */
import type { OdooErrorClass } from './client.ts';

export type ConnectionStateName = 'not-activated' | 'healthy' | 'degraded' | 'unreachable' | 'credential-rejected' | 'credential-expiring' | 'disconnected';
export interface ConnectionRecord {
  state: ConnectionStateName;
  failures: number;
  last_ok_at: string | null;
  last_checked_at: string | null;
  error_class: OdooErrorClass | null;
  missing: string[];
}
export type ProbeOutcome = { ok: true; missing: string[] } | { ok: false; errorClass: OdooErrorClass };

export const UNREACHABLE_AFTER = 3;
export const EXPIRY_WARNING_DAYS = 14;
/** Network trouble that may pass by itself; anything else needs an admin. */
const TRANSIENT: ReadonlySet<OdooErrorClass> = new Set(['unreachable', 'timeout', 'tls', 'server-error', 'destination-refused']);
export const INITIAL_CONNECTION: ConnectionRecord = { state: 'not-activated', failures: 0, last_ok_at: null, last_checked_at: null, error_class: null, missing: [] };

export function nextConnection(
  prev: ConnectionRecord,
  o: ProbeOutcome,
  ctx: { now: Date; keyExpiresOn: string | null; activated: boolean; disconnected: boolean },
): ConnectionRecord {
  const at = ctx.now.toISOString();
  if (ctx.disconnected) return { ...prev, state: 'disconnected', last_checked_at: at };
  if (!ctx.activated) return { ...prev, state: 'not-activated', last_checked_at: at };
  if (o.ok) {
    const expiring = ctx.keyExpiresOn !== null && Date.parse(ctx.keyExpiresOn) - ctx.now.getTime() <= EXPIRY_WARNING_DAYS * 86_400_000;
    const state = o.missing.length ? 'degraded' : expiring ? 'credential-expiring' : 'healthy';
    return { state, failures: 0, last_ok_at: at, last_checked_at: at, error_class: null, missing: o.missing };
  }
  if (!TRANSIENT.has(o.errorClass)) return { ...prev, state: 'credential-rejected', failures: 0, last_checked_at: at, error_class: o.errorClass };
  const failures = prev.failures + 1;
  return { ...prev, failures, state: failures >= UNREACHABLE_AFTER ? 'unreachable' : prev.state, last_checked_at: at, error_class: o.errorClass };
}

/** FR-ODC-034 / PQ-7: a disconnected or not-activated binding never shows a stored state; a good state older than two sweep intervals shows as `unverified`. Browser-only, never stored. */
export function displayedConnection(
  rec: ConnectionRecord | null,
  now: Date,
  binding: { status: string; activated: boolean },
  sweepIntervalMs = 300_000,
): ConnectionStateName | 'unverified' {
  // The stored record outlives a disconnect or a reconnect; the binding row decides these two before it is read.
  if (binding.status !== 'active') return 'disconnected';
  if (!binding.activated || !rec) return 'not-activated';
  const stale = !rec.last_checked_at || now.getTime() - Date.parse(rec.last_checked_at) > 2 * sweepIntervalMs;
  return stale && ['healthy', 'credential-expiring', 'degraded'].includes(rec.state) ? 'unverified' : rec.state;
}

/** The binding-config key the S8 first-send step writes and the setup checklist reads; both sides import this name. */
export const SENDS_FINISHED_KEY = 'sends_finished_at';
