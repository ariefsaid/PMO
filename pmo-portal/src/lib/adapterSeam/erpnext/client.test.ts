/**
 * AC-ENA-011 — erpnext/client.ts: token auth, exc_type/_server_messages classifier (incl. the
 * 500-TypeError non-retryable bucket), 429/Retry-After backoff with a no-blind-retry guard for
 * non-idempotent POSTs. Every call injects `fetchImpl` — no real ERPNext bench is ever required.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createDoc,
  callMethod,
  erpnextRequest,
  ErpError,
  getDoc,
  submitDoc,
  cancelDoc,
  updateDoc,
  unwrapFrappeDoc,
  escapeLikePattern,
  listDocNamesByAnchor,
  ERP_REQUEST_TIMEOUT_MS,
  ERP_QUARANTINE_WINDOW_MS,
  type ErpClientDeps,
} from './client.ts';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

/** Escapes a literal for embedding in a RegExp source. */
function reLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Minimal SQL `LIKE` semantics with the DEFAULT backslash escape character (MariaDB and Postgres
 * agree here): `%` = any run, `_` = exactly one char, `\x` = the literal `x`. Used to prove the
 * probe's pattern against a REAL matcher rather than only asserting the query string.
 */
function likeMatches(pattern: string, value: string): boolean {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      i += 1;
      re += next === undefined ? reLiteral('\\') : reLiteral(next);
      continue;
    }
    if (ch === '%') { re += '[\\s\\S]*'; continue; }
    if (ch === '_') { re += '[\\s\\S]'; continue; }
    re += reLiteral(ch);
  }
  return new RegExp(`^${re}$`).test(value);
}

/** A fake Frappe list endpoint that evaluates `like` filters with REAL LIKE semantics. */
function likeAwareFetch(docs: Array<Record<string, string>>) {
  return async (url: string): Promise<Response> => {
    const raw = new URL(url).searchParams.get('filters');
    const filters = JSON.parse(raw ?? '[]') as Array<[string, string, string]>;
    const matched = docs.filter((doc) =>
      filters.every(([field, op, value]) => (op === 'like' ? likeMatches(value, doc[field] ?? '') : doc[field] === value)),
    );
    return jsonResponse(200, { data: matched.map((d) => ({ name: d.name })) });
  };
}

/** A fetch that never settles until its `AbortSignal` fires — models a hung-but-alive ERP POST. */
function hangingFetch(): (url: string, init?: RequestInit) => Promise<Response> {
  return (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return; // no deadline wired → hangs forever (the RED state)
      if (signal.aborted) reject(signal.reason ?? new Error('aborted'));
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
    });
}

/** Types the mock's inferred call signature as `(url, init)` (matching `typeof fetch`) so
 *  `.mock.calls[n]` destructures correctly — same idiom as clickup/commands.test.ts. */
function fetchDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): ErpClientDeps {
  return {
    apiKey: 'a-key',
    apiSecret: 'a-secret',
    baseUrl: 'https://erp.example.com',
    sleep: vi.fn(async () => {}),
    fetchImpl: vi.fn(fetchImpl) as unknown as typeof fetch,
  };
}

describe('erpnext/client', () => {
  it('AC-ENA-011 sends Authorization: token <key>:<secret> and URL-encodes doctype spaces', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { name: 'ACC-PINV-2026-00001' }));
    await createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' });
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://erp.example.com/api/resource/Purchase%20Invoice');
    expect((init.headers as Record<string, string>).Authorization).toBe('token a-key:a-secret');
  });

  it('AC-ENA-011 maps 417 exc_type=MandatoryError to commit-rejected', async () => {
    const deps = fetchDeps(async () =>
      jsonResponse(417, { exc_type: 'MandatoryError', _server_messages: JSON.stringify([JSON.stringify({ message: 'supplier_name is mandatory' })]) }),
    );
    await expect(createDoc(deps, 'Supplier', {})).rejects.toMatchObject({ name: 'ErpError', code: 'commit-rejected' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('AC-ENA-011 maps 417 exc_type=LinkExistsError (cancel blocked) to commit-rejected', async () => {
    const deps = fetchDeps(async () => jsonResponse(417, { exc_type: 'LinkExistsError', _server_messages: '["blocked by Purchase Receipt"]' }));
    await expect(cancelDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001')).rejects.toMatchObject({ code: 'commit-rejected' });
  });

  it('AC-ENA-011 maps 404 exc_type=DoesNotExistError to commit-rejected', async () => {
    const deps = fetchDeps(async () =>
      jsonResponse(404, { exc_type: 'DoesNotExistError', exception: 'frappe.exceptions.DoesNotExistError: Supplier None not found' }),
    );
    await expect(createDoc(deps, 'Purchase Invoice', {})).rejects.toMatchObject({ code: 'commit-rejected', status: 404 });
  });

  it('AC-ENA-011/FR-ENA-042 maps a raw 500 TypeError body to the distinct non-retryable commit-rejected bucket', async () => {
    const deps = fetchDeps(async () =>
      jsonResponse(500, { exception: "TypeError: unsupported operand type(s) for -: 'NoneType' and 'float'" }),
    );
    let caught: ErpError | undefined;
    try {
      await createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' });
    } catch (err) {
      caught = err as ErpError;
    }
    expect(caught).toBeInstanceOf(ErpError);
    expect(caught?.code).toBe('commit-rejected');
    expect(caught?.retryable).toBe(false);
    // never blindly retried — a single POST attempt, even though 500 is normally transient.
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('AC-ENA-011 retries a 429 honoring Retry-After, then succeeds (idempotent GET)', async () => {
    let call = 0;
    const deps = fetchDeps(async () => {
      call += 1;
      return call === 1
        ? jsonResponse(429, { exc_type: 'RateLimitExceededError' }, { 'Retry-After': '1' })
        : jsonResponse(200, { name: 'Spike Supplier' });
    });
    const result = await erpnextRequest(deps, { method: 'GET', path: '/api/resource/Supplier/Spike%20Supplier' });
    expect(result).toEqual({ name: 'Spike Supplier' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledWith(1000);
  });

  it('AC-ENA-011 an exhausted 5xx (idempotent GET) surfaces external-unreachable', async () => {
    const deps = fetchDeps(async () => jsonResponse(503, { exception: 'Service Unavailable' }));
    await expect(erpnextRequest(deps, { method: 'GET', path: '/api/resource/Supplier/X' })).rejects.toMatchObject({
      code: 'external-unreachable',
    });
    // bounded retry budget (default 3) — not infinite
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('FR-ENA-042 no-blind-retry guard: a non-idempotent POST on a retryable transport failure never re-POSTs', async () => {
    const deps = fetchDeps(async () => {
      throw new Error('network reset');
    });
    await expect(createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' })).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('FR-ENA-042 no-blind-retry guard: a non-idempotent POST on a retryable 5xx never re-POSTs', async () => {
    const deps = fetchDeps(async () => jsonResponse(503, { exception: 'temporarily unavailable' }));
    await expect(createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' })).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('getDoc/submitDoc/cancelDoc build the expected resource paths + docstatus bodies', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { name: 'PUR-ORD-2026-00001', docstatus: 1 }));
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;

    await getDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001');
    expect(fetchMock.mock.calls[0][0]).toBe('https://erp.example.com/api/resource/Purchase%20Order/PUR-ORD-2026-00001');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('GET');

    await submitDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001');
    const submitInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(submitInit.method).toBe('PUT');
    expect(JSON.parse(submitInit.body as string)).toEqual({ docstatus: 1 });

    await cancelDoc(deps, 'Purchase Order', 'PUR-ORD-2026-00001');
    const cancelInit = fetchMock.mock.calls[2][1] as RequestInit;
    expect(cancelInit.method).toBe('PUT');
    expect(JSON.parse(cancelInit.body as string)).toEqual({ docstatus: 2 });
  });

  it('callMethod GETs /api/method/<rpc>', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { erpnext: { version: '15.94.3' } }));
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const result = await callMethod(deps, 'frappe.utils.change_log.get_versions');
    expect(fetchMock.mock.calls[0][0]).toBe('https://erp.example.com/api/method/frappe.utils.change_log.get_versions');
    expect(result).toEqual({ erpnext: { version: '15.94.3' } });
  });

  it('FR-ENA-014 awaits an injected rate limiter once per attempt (worker-pool-sized token bucket, off by default)', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { name: 'X' }));
    const acquire = vi.fn(async () => {});
    await createDoc({ ...deps, rateLimiter: { acquire } }, 'Purchase Invoice', { supplier: 'Acme' });
    expect(acquire).toHaveBeenCalledTimes(1);
  });

  // task 3.3: a non-submittable doctype (a party — Supplier/Customer has no docstatus lifecycle)
  // update is a plain field PUT, carrying no `docstatus` (unlike submitDoc/cancelDoc).
  it('updateDoc PUTs /api/resource/<DocType>/<name> with the given field patch, no docstatus', async () => {
    const deps = fetchDeps(async () => jsonResponse(200, { name: 'Spike Supplier', supplier_name: 'Spike Supplier Renamed' }));
    const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
    await updateDoc(deps, 'Supplier', 'Spike Supplier', { supplier_name: 'Spike Supplier Renamed' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://erp.example.com/api/resource/Supplier/Spike%20Supplier');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ supplier_name: 'Spike Supplier Renamed' });
  });

  // Task 6.4 fix-round (live-bench-discovered 2026-07-12): every real Frappe `/api/resource/<DocType>`
  // single-doc response (POST create / GET single / PUT update-submit-cancel) is WRAPPED in a `{data:
  // {...fields}}` envelope — confirmed against the real ERPNext v15 bench, never observed by any prior
  // unit test because no e2e reached a real HTTP round-trip before task 6.4 wired the money outbox.
  // `unwrapFrappeDoc` is a SAFE, additive, non-breaking unwrap: it unwraps ONLY when a `.data` object
  // key is present (the real envelope shape), and passes a body through UNCHANGED when it is already
  // flat (every existing test's mocked `fetchImpl` response, across every slice) — so no existing test
  // fixture needs updating.
  describe('unwrapFrappeDoc (task 6.4 fix-round — the real Frappe {data:{...}} envelope)', () => {
    it('unwraps a real Frappe single-doc envelope {data:{...fields}}', () => {
      expect(unwrapFrappeDoc({ data: { name: 'PUR-ORD-2026-00001', docstatus: 1 } })).toEqual({
        name: 'PUR-ORD-2026-00001',
        docstatus: 1,
      });
    });

    it('passes a body through UNCHANGED when it has no .data key (every existing mocked test fixture)', () => {
      expect(unwrapFrappeDoc({ name: 'PUR-ORD-2026-00001', docstatus: 1 })).toEqual({
        name: 'PUR-ORD-2026-00001',
        docstatus: 1,
      });
    });

    it('does NOT unwrap when .data is an array (the list-query shape, a different endpoint entirely)', () => {
      const body = { data: [{ name: 'PUR-ORD-2026-00001' }] };
      expect(unwrapFrappeDoc(body)).toBe(body);
    });

    it('passes null/non-object bodies through unchanged (never throws)', () => {
      expect(unwrapFrappeDoc(null)).toBeNull();
      expect(unwrapFrappeDoc(undefined)).toBeUndefined();
    });
  });

  // ── Luna BLOCK 1 (money path): recovery must never adopt the WRONG ERP document ────────────────
  // The anchor probe interpolates the caller-supplied idempotency key into a Frappe `LIKE` pattern.
  // Unescaped, a key carrying `%`/`_` becomes a WILDCARD and the recovery path adopts (and can then
  // submit/cancel) somebody else's money document. The key must only ever match ITSELF, literally.
  describe('escapeLikePattern (ADR-0058 §3 anchor probe — wildcard-injection guard)', () => {
    it('escapes %, _ and the backslash escape character itself', () => {
      expect(escapeLikePattern('a%b_c')).toBe('a\\%b\\_c');
      expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
      expect(escapeLikePattern('plain-uuid-1234')).toBe('plain-uuid-1234');
    });

    it('leaves an ordinary UUID key byte-for-byte unchanged (no behavior change for real keys)', () => {
      const uuid = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
      expect(escapeLikePattern(uuid)).toBe(uuid);
    });
  });

  describe('listDocNamesByAnchor wildcard-injection guard (Luna BLOCK 1)', () => {
    it('a key containing % and _ matches ONLY its own document, never a wildcard-matched decoy', async () => {
      const docs = [
        { name: 'PI-OWN', remarks: 'a%b_c' },        // the doc actually stamped with the key
        { name: 'PI-DECOY', remarks: 'aZZZbQc' },    // matches `%a%b_c%` ONLY if % / _ stay wildcards
      ];
      const deps = fetchDeps(likeAwareFetch(docs));
      const names = await listDocNamesByAnchor(deps, 'Purchase Invoice', 'remarks', 'a%b_c', 5);
      expect(names).toEqual(['PI-OWN']);
    });

    it('a key containing a backslash matches its own document (the escape char is itself escaped)', async () => {
      const docs = [
        { name: 'PI-BS', remarks: 'a\\b' },
        { name: 'PI-BS-DECOY', remarks: 'aXb' },
      ];
      const deps = fetchDeps(likeAwareFetch(docs));
      const names = await listDocNamesByAnchor(deps, 'Purchase Invoice', 'remarks', 'a\\b', 5);
      expect(names).toEqual(['PI-BS']);
    });

    it('sends the ESCAPED pattern in the filters query string', async () => {
      const deps = fetchDeps(async () => jsonResponse(200, { data: [] }));
      await listDocNamesByAnchor(deps, 'Purchase Invoice', 'remarks', 'a%b_c');
      const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
      const filters = new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('filters');
      expect(JSON.parse(filters!)).toEqual([['remarks', 'like', '%a\\%b\\_c%']]);
    });
  });

  // ── Luna BLOCK 5 (money path): a hung POST must never race its own recovery ────────────────────
  describe('request deadline (Luna BLOCK 5 — no unbounded POST vs. the 5-minute quarantine reclaim)', () => {
    it('the default deadline is strictly shorter than the quarantine reclaim window, with real settle margin', () => {
      expect(ERP_REQUEST_TIMEOUT_MS).toBeLessThan(ERP_QUARANTINE_WINDOW_MS);
      // ≥2 minutes of settle time between the abort and the earliest possible reissue, so a POST that
      // still commits server-side becomes probe-visible before recovery could ever re-POST it.
      expect(ERP_QUARANTINE_WINDOW_MS - ERP_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    });

    it('aborts a hung POST at the deadline and surfaces external-unreachable — with NO re-POST', async () => {
      const deps = { ...fetchDeps(hangingFetch()), timeoutMs: 20 };
      await expect(createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' })).rejects.toMatchObject({
        name: 'ErpError',
        code: 'external-unreachable',
      });
      // FR-ENA-042: a non-idempotent POST gets exactly one attempt, deadline or not.
      expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('passes an AbortSignal to fetch on every request', async () => {
      const deps = fetchDeps(async () => jsonResponse(200, { name: 'X' }));
      await createDoc(deps, 'Purchase Invoice', { supplier: 'Acme' });
      const fetchMock = deps.fetchImpl as unknown as ReturnType<typeof vi.fn>;
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      expect(init.signal).toBeInstanceOf(AbortSignal);
      // the deadline timer is cleared on a settled request — the signal must NOT be left aborted.
      expect((init.signal as AbortSignal).aborted).toBe(false);
    });

    it('an idempotent GET whose deadline fires is retried within the normal budget, then classified', async () => {
      let calls = 0;
      const deps: ErpClientDeps = {
        ...fetchDeps(async (url, init) => {
          calls += 1;
          if (calls === 1) return hangingFetch()(url, init);
          return jsonResponse(200, { name: 'Spike Supplier' });
        }),
        timeoutMs: 20,
      };
      const result = await getDoc(deps, 'Supplier', 'Spike Supplier');
      expect(result).toEqual({ name: 'Spike Supplier' });
      expect(calls).toBe(2);
    });
  });
});
