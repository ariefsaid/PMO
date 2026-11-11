import { erpnextRequest, type ErpClientDeps } from './client.ts';

/** Server-derived binding and validated publication context. It is not a fresh observation. */
export interface StatementCheckContext {
  bindingId: string;
  activatedAt: string;
  company: string;
  profile: string;
  fingerprint: string;
}
interface Top { name: string; modified: string }
export interface StatementHintObservation {
  version: 1;
  context: StatementCheckContext;
  sources: Array<{ source: string; top: Top | null }>;
}
export interface StatementCheckInput {
  context: StatementCheckContext;
  previous: StatementHintObservation | null;
  signal?: AbortSignal;
  deadlineAtMs?: number;
}
export type StatementChangeResult =
  | { status: 'changed'; reason: 'source_hint_changed'; observation: StatementHintObservation }
  | { status: 'unknown'; reason: 'first_observation'; observation: StatementHintObservation }
  | { status: 'unknown'; reason: 'context_mismatch' | 'invalid_response' | 'request_failed' | 'cancelled' | 'ambiguous_hint' }
  | { status: 'unknown'; reason: 'unverified_dependencies'; hint: 'no_observed_change'; observation: StatementHintObservation };

// These are only candidate company-scoped hints. Other report dependencies and complete
// role visibility have not been established; equality cannot clear pending work.
const SOURCES = ['GL Entry', 'Account', 'Period Closing Voucher'] as const;
const TIMEOUT_MS = 10_000;
function validText(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) return false;
  return [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
}
function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) return false;
  const iso = value.replace(' ', 'T');
  const date = new Date(`${iso}Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 19) === iso.slice(0, 19);
}
function parseTop(body: unknown): Top | null | undefined {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
  const envelope = body as Record<string, unknown>;
  if ('exc' in envelope || 'exc_type' in envelope || '_server_messages' in envelope) return undefined;
  const rows = envelope.message;
  if (!Array.isArray(rows) || rows.length > 1) return undefined;
  if (rows.length === 0) return null;
  const row: unknown = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const { name, modified } = row as Record<string, unknown>;
  return validText(name) && validTimestamp(modified) ? { name, modified } : undefined;
}
function comparableTimestamp(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return `${whole}.${fraction.padEnd(6, '0')}`;
}
function sameContext(a: StatementCheckContext, b: StatementCheckContext): boolean {
  return a.bindingId === b.bindingId && a.activatedAt === b.activatedAt && a.company === b.company && a.profile === b.profile && a.fingerprint === b.fingerprint;
}

function readPrevious(value: unknown): StatementHintObservation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1 || !candidate.context || typeof candidate.context !== 'object' || Array.isArray(candidate.context) || !Array.isArray(candidate.sources) || candidate.sources.length !== SOURCES.length) return undefined;
  const seen = new Set<string>();
  for (let i = 0; i < candidate.sources.length; i += 1) {
    if (!(i in candidate.sources)) return undefined;
    const entry: unknown = candidate.sources[i];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const { source, top } = entry as Record<string, unknown>;
    if (typeof source !== 'string' || !(SOURCES as readonly string[]).includes(source) || seen.has(source)) return undefined;
    seen.add(source);
    if (top !== null) {
      if (!top || typeof top !== 'object' || Array.isArray(top)) return undefined;
      const item = top as Record<string, unknown>;
      if (!validText(item.name) || !validTimestamp(item.modified)) return undefined;
    }
  }
  return candidate as unknown as StatementHintObservation;
}

/** Diagnostic candidate hints only: neither complete coverage nor a cursor. */
export async function checkStatementChanges(client: ErpClientDeps, input: StatementCheckInput): Promise<StatementChangeResult> {
  const cancelled = (): StatementChangeResult => ({ status: 'unknown', reason: 'cancelled' });
  if (input.signal?.aborted || (input.deadlineAtMs !== undefined && input.deadlineAtMs <= Date.now())) return cancelled();
  if (!input.context || ![input.context.bindingId, input.context.activatedAt, input.context.company, input.context.profile, input.context.fingerprint].every(validText) || input.context.profile !== '16.33.0/16.31.0') return { status: 'unknown', reason: 'context_mismatch' };
  const previous = input.previous === null ? null : readPrevious(input.previous);
  if (previous === undefined) return { status: 'unknown', reason: 'ambiguous_hint' };
  if (previous && !sameContext(input.context, previous.context)) return { status: 'unknown', reason: 'context_mismatch' };
  const deadlineAtMs = Math.min(input.deadlineAtMs ?? Infinity, Date.now() + TIMEOUT_MS);
  const remaining = deadlineAtMs - Date.now();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  if (input.signal?.aborted) onAbort();
  const timer = setTimeout(onAbort, Math.max(0, remaining));
  const boundedClient: ErpClientDeps = { ...client, maxRetries: 0, timeoutMs: Math.max(1, remaining) };
  try {
    let changed = false;
    const sources: StatementHintObservation['sources'] = [];
    for (const source of SOURCES) {
      if (controller.signal.aborted) return cancelled();
      const params = new URLSearchParams({ doctype: source, fields: JSON.stringify(['name', 'modified']), filters: JSON.stringify([['company', '=', input.context.company]]), order_by: 'modified desc, name desc', limit_page_length: '1' });
      const body = await erpnextRequest(boundedClient, { method: 'GET', path: `/api/method/frappe.client.get_list?${params}`, maxResponseBytes: 8192, safeDiagnostic: true, signal: controller.signal, deadlineAtMs });
      if (controller.signal.aborted) return cancelled();
      const top = parseTop(body);
      if (top === undefined) return { status: 'unknown', reason: 'invalid_response' };
      sources.push({ source, top });
      if (previous) {
        const old = previous.sources.find(entry => entry.source === source)!.top;
        if (top && old) {
          const currentTime = comparableTimestamp(top.modified);
          const oldTime = comparableTimestamp(old.modified);
          if (currentTime < oldTime || (currentTime === oldTime && top.name !== old.name)) return { status: 'unknown', reason: 'ambiguous_hint' };
          if (currentTime > oldTime) changed = true;
        } else if (top !== old) changed = true;
      }
    }
    const observation: StatementHintObservation = { version: 1, context: { ...input.context }, sources };
    if (!previous) return { status: 'unknown', reason: 'first_observation', observation };
    return changed ? { status: 'changed', reason: 'source_hint_changed', observation } : { status: 'unknown', reason: 'unverified_dependencies', hint: 'no_observed_change', observation };
  } catch {
    return controller.signal.aborted || Date.now() >= deadlineAtMs ? cancelled() : { status: 'unknown', reason: 'request_failed' };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onAbort);
  }
}
