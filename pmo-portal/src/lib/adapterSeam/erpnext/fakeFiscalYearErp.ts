/**
 * A fake ERPNext holding fiscal years, modelled on the real doctype: years have a name, start and end dates, a disabled flag,
 * and a `companies` child table (`Fiscal Year Company`) where each row points at one Company. A year with no child rows is
 * global (covers every company).
 */
import type { ErpClientDeps } from './client.ts';

export interface FakeYear {
  name: string;
  start: string;
  end: string;
  companies: string[];
  disabled?: boolean;
}

type Filter = [string, string, unknown] | [string, string, string, unknown];

const KNOWN_COMPANIES_DEFAULT = ['Acme Corp', 'Test Co', 'Other Co'];

function ok(json: unknown): Response {
  return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
}

function frappeError(status: number, excType: string, message: string): Response {
  return new Response(JSON.stringify({
    exc_type: excType,
    _server_messages: JSON.stringify([JSON.stringify({ message, title: 'Message' })]),
    _error_message: message,
  }), { status, headers: { 'content-type': 'application/json' } });
}

function oneYearOn(start: string): string {
  const [y, m, d] = start.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y + 1, m, 0)).getUTCDate();
  const next = new Date(Date.UTC(y + 1, m - 1, Math.min(d, lastDay)));
  next.setUTCDate(next.getUTCDate() - 1);
  return next.toISOString().slice(0, 10);
}

function toDoc(y: FakeYear) {
  return {
    name: y.name, year: y.name, year_start_date: y.start, year_end_date: y.end, disabled: y.disabled ? 1 : 0,
    is_short_year: 0, companies: y.companies.map((company, i) => ({ company, idx: i + 1, parent: y.name, parenttype: 'Fiscal Year', parentfield: 'companies' })),
  };
}

/** `version` picks the overlap rules: v15 (default) or the looser v16 (`__fixtures__/fiscalYear.json` `v16` block). */
export function fakeFiscalYearErp(seed: FakeYear[] = [], opts: { companies?: string[]; host?: string; version?: 15 | 16 } = {}) {
  const v16 = opts.version === 16;
  const years: FakeYear[] = seed.map((y) => ({ ...y, companies: [...y.companies] }));
  const known = opts.companies ?? KNOWN_COMPANIES_DEFAULT;
  const writes: Array<Record<string, unknown>> = [];
  const calls: Array<{ method: string; path: string }> = [];
  let denyCreate = false;
  let denyRead = false;
  let armed: 'lost-response' | 'transport' | null = null;

  const matches = (y: FakeYear, filters: Filter[]) => filters.every((f) => {
    if (f.length === 4) {
      const [doctype, field, op, value] = f as [string, string, string, unknown];
      return doctype === 'Fiscal Year Company' && field === 'company' && op === '=' && y.companies.includes(String(value));
    }
    const [field, op, value] = f as [string, string, unknown];
    const doc = toDoc(y) as Record<string, unknown>;
    const v = doc[field];
    if (op === '<=') return String(v) <= String(value);
    if (op === '>=') return String(v) >= String(value);
    if (op === '=') return v === value || String(v) === String(value);
    throw new Error(`fake Fiscal Year: unsupported filter ${JSON.stringify(f)}`);
  });

  const create = (body: Record<string, unknown>): Response => {
    if (denyCreate) {
      return new Response(JSON.stringify({
        exc_type: 'PermissionError',
        _server_messages: JSON.stringify([JSON.stringify({ message: 'User <strong><api-user></strong> does not have doctype access via role permission for document <strong>Fiscal Year</strong>', title: 'Message' })]),
        _error_message: 'No permission for Fiscal Year',
      }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    const name = typeof body.year === 'string' ? body.year : '';
    const start = String(body.year_start_date ?? '');
    const end = String(body.year_end_date ?? '');
    const companies = (Array.isArray(body.companies) ? body.companies : []).map((r) => String((r as { company?: unknown }).company));
    if (!name) return frappeError(417, 'ValidationError', 'Year Name is required');
    if (end < start) return frappeError(417, 'InvalidDates', '<strong>Year End Date</strong> must be after <strong>Year Start Date</strong>');
    if (body.is_short_year !== 1 && oneYearOn(start) !== end) return frappeError(417, 'InvalidDates', 'Fiscal Year End Date should be one year after Fiscal Year Start Date');
    if (years.some((y) => y.name === name)) return frappeError(409, 'DuplicateEntryError', `Fiscal Year <strong>${name}</strong> already exists`);
    const unknown = companies.findIndex((c) => !known.includes(c));
    if (unknown >= 0) return frappeError(417, 'LinkValidationError', `Could not find Row #${unknown + 1}: Company: ${companies[unknown]}`);
    const overlapping = (y: FakeYear) => frappeError(409, 'NameError', `Year start date or end date is overlapping with ${y.name}. To avoid please set company`);
    const sharesNamed = (y: FakeYear) => companies.some((c) => y.companies.includes(c));
    for (const y of years) if (y.start === start && y.end === end && sharesNamed(y)) return overlapping(y);
    for (const y of v16 ? years : []) {
      if (y.disabled && y.companies.length === 0 && y.start === start && y.end === end) return frappeError(417, 'ValidationError', `Fiscal Year Start Date and Fiscal Year End Date are already set in Fiscal Year ${y.name}`);
    }
    for (const y of v16 ? [] : years) {
      if (y.start === start && y.end === end) return frappeError(417, 'ValidationError', `Fiscal Year Start Date and Fiscal Year End Date are already set in Fiscal Year ${y.name}`);
    }
    for (const y of years) {
      const overlaps = y.start <= end && start <= y.end;
      if (overlaps && (companies.length === 0 || sharesNamed(y))) return overlapping(y);
    }
    const made: FakeYear = { name, start, end, companies };
    years.push(made);
    return ok({ data: toDoc(made) });
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? 'GET';
    calls.push({ method, path: u.pathname + u.search });
    const base = '/api/resource/Fiscal%20Year';
    if (method === 'POST' && u.pathname === base) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push(body);
      const fault = armed;
      armed = null;
      if (fault === 'transport') throw new TypeError('network down');
      const res = create(body);
      if (fault === 'lost-response') throw new TypeError('connection reset after the request was sent');
      return res;
    }
    if (method !== 'GET') throw new Error(`fake Fiscal Year: unexpected ${method} ${u.pathname}`);
    if (denyRead) return frappeError(403, 'PermissionError', 'No permission to read <strong>Fiscal Year</strong>');
    if (u.pathname === base) {
      const filters = JSON.parse(u.searchParams.get('filters') ?? '[]') as Filter[];
      const fields = JSON.parse(u.searchParams.get('fields') ?? '["name"]') as string[];
      const rows = years.filter((y) => matches(y, filters)).map((y) => {
        const doc = toDoc(y) as Record<string, unknown>;
        return Object.fromEntries(fields.map((f) => [f, doc[f]]));
      });
      return ok({ data: rows });
    }
    if (u.pathname.startsWith(`${base}/`)) {
      const name = decodeURIComponent(u.pathname.slice(base.length + 1));
      const y = years.find((row) => row.name === name);
      return y ? ok({ data: toDoc(y) }) : frappeError(404, 'DoesNotExistError', `Fiscal Year ${name} not found`);
    }
    throw new Error(`fake Fiscal Year: unexpected path ${u.pathname}`);
  }) as typeof fetch;

  const client: ErpClientDeps = { fetchImpl, apiKey: 'key', apiSecret: 'secret', baseUrl: `https://${opts.host ?? 'erp.test'}`, maxRetries: 0 };
  return {
    client,
    fetchImpl,
    seed: (y: FakeYear) => { years.push({ ...y, companies: [...y.companies] }); },
    years: () => years.map((y) => ({ ...y, companies: [...y.companies] })),
    writes: () => writes.map((w) => ({ ...w })),
    calls: () => [...calls],
    denyCreate: () => { denyCreate = true; },
    denyRead: () => { denyRead = true; },
    failNextWrite: (fault: 'lost-response' | 'transport') => { armed = fault; },
  };
}
