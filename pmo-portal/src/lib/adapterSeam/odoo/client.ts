/**
 * The Odoo JSON-2 client (bed report §1: `POST /json/2/<model>/<method>`, bearer key, JSON error bodies). Odoo
 * vocabulary stays inside adapterSeam/odoo/** (NFR-ODC-009). Relative imports only so the seam stays Deno-importable.
 */
export type OdooErrorClass =
  | 'unreachable' | 'timeout' | 'tls' | 'not-odoo' | 'no-json2' | 'database-not-found'
  | 'key-rejected' | 'access-denied' | 'missing-model' | 'validation' | 'server-error' | 'destination-refused';

/** A classified failure (AC-ODC-002). The message is fixed text: never the upstream body or the key (FR-ODC-002). */
export class OdooError extends Error {
  constructor(readonly errorClass: OdooErrorClass, readonly status?: number) {
    super(`odoo request failed: ${errorClass}`);
    this.name = 'OdooError';
  }
}

export const ODOO_CALL_TIMEOUT_MS = 15_000;

export interface OdooClientDeps {
  baseUrl: string;
  apiKey: string;
  /** Always sent: optional on a single-database host, required on a multi-database one (bed §1, V2 open). */
  database: string;
  fetchImpl: typeof fetch;
  deadlineMs?: number;
  /** Waits for a request slot before each call (S3 adds the pacer). */
  pace?: () => Promise<void>;
}

export type OdooCall = <T>(model: string, method: string, body?: Record<string, unknown>) => Promise<T>;

function transportClass(err: unknown): OdooErrorClass {
  if (err instanceof DOMException && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'timeout';
  const msg = err instanceof Error ? err.message : '';
  if (/not permitted/i.test(msg)) return 'destination-refused';
  if (/certificate|tls|ssl/i.test(msg)) return 'tls';
  return 'unreachable';
}

async function httpClass(res: Response): Promise<OdooErrorClass> {
  if (res.status >= 300 && res.status < 400) return 'not-odoo';
  const body = (await res.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name : '';
  if (res.status === 401) return 'key-rejected';
  if (res.status === 403) return 'access-denied';
  // ponytail: the database-not-found discriminator is provisional until the bed records a multi-db host's 404 (V2).
  if (res.status === 404) return body ? (/database/i.test(name) ? 'database-not-found' : 'missing-model') : 'no-json2';
  if (res.status === 422) return 'validation';
  return 'server-error';
}

export async function odooCall<T>(deps: OdooClientDeps, model: string, method: string, body: Record<string, unknown> = {}): Promise<T> {
  await deps.pace?.();
  let res: Response;
  try {
    res = await deps.fetchImpl(`${deps.baseUrl.replace(/\/$/, '')}/json/2/${model}/${method}`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `bearer ${deps.apiKey}`, 'X-Odoo-Database': deps.database, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(deps.deadlineMs ?? ODOO_CALL_TIMEOUT_MS),
    });
  } catch (err) {
    throw new OdooError(transportClass(err));
  }
  if (!res.ok || res.status >= 300) throw new OdooError(await httpClass(res), res.status);
  try { return (await res.json()) as T; } catch { throw new OdooError('not-odoo', res.status); }
}

export const bindCall = (deps: OdooClientDeps): OdooCall => (model, method, body) => odooCall(deps, model, method, body);
