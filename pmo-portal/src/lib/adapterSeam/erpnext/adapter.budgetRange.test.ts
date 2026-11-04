import { describe, expect, it, vi } from 'vitest';
import { budgetRangeIdentity } from './budgetAccountIdentity';
import { createErpAdapter } from './adapter';
import { DOCTYPE_BODIES } from './doctypeBodies';
import { dispatchMoneyWrite, type DispatchMoneyOutboxDeps, type OutboxRow } from '../dispatch';

const VERSION = '44444444-4444-4444-8444-444444444444';
const OUTBOX = '55555555-5555-4555-8555-555555555555';
const COMPANY = 'Test Co';
const PROJECT = 'ERP-PROJ';
const ACCOUNT = 'COGS';
const YEARS = [
  { name: 'FY/Alpha', start: '2026-04-01', end: '2027-03-31' },
  { name: 'FY:Beta', start: '2027-04-01', end: '2028-03-31' },
];
const IDENTITY = budgetRangeIdentity(VERSION, YEARS[0]!.name, YEARS[1]!.name, ACCOUNT);
const EXPECTED_ROWS = [
  { start_date: YEARS[0]!.start, end_date: YEARS[0]!.end, amount: 50.01, percent: 50.005 },
  { start_date: YEARS[1]!.start, end_date: YEARS[1]!.end, amount: 50, percent: 49.995 },
];

function harness(options: {
  recoveryState?: Record<string, unknown> | null;
  failAdvanceStage?: string;
  createdDocOverride?: Record<string, unknown>;
  getDocOverride?: Record<string, unknown>;
  putOutcome?: 'success' | 'accept-then-timeout' | 'timeout-before-accept';
  putDistributionOverride?: Array<Record<string, unknown>>;
  submitOutcome?: 'success' | 'accept-then-timeout' | 'timeout-before-accept' | 'cancelled';
  cancelOutcome?: 'success' | 'accept-then-timeout' | 'timeout-before-accept';
  timeoutMs?: number;
  fetchThroughGlobal?: boolean;
  pauseDistributionPut?: boolean;
  predecessor?: { name: string; modified: string; company?: string; project?: string; account?: string };
} = {}) {
  const calls: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
  const stageCalls: Array<{ expected: string | null; next: Record<string, unknown> }> = [];
  let durableState = options.recoveryState ?? null;
  let doc: Record<string, unknown> | null = null;
  const docs = new Map<string, Record<string, unknown>>();
  let putOutcome = options.putOutcome ?? 'success';
  let submitOutcome = options.submitOutcome ?? 'success';
  let cancelOutcome = options.cancelOutcome ?? 'success';
  let completeRemoteDistributionPut: (() => void) | null = null;
  let remoteDistributionPutPending = false;
  let distributionPutCallerAborted = false;
  let distributionPutCount = 0;
  let durableGeneration = 0;
  if (options.predecessor) {
    docs.set(options.predecessor.name, {
      name: options.predecessor.name,
      owner: 'api-user',
      modified_by: 'api-user',
      modified: options.predecessor.modified,
      docstatus: 1,
      company: options.predecessor.company ?? COMPANY,
      project: options.predecessor.project ?? PROJECT,
      budget_against: 'Project',
      account: options.predecessor.account ?? ACCOUNT,
      from_fiscal_year: YEARS[0]!.name,
      to_fiscal_year: YEARS[1]!.name,
      budget_amount: 90,
      budget_distribution: [
        { start_date: YEARS[0]!.start, end_date: YEARS[0]!.end, amount: 40, percent: 44.4444 },
        { start_date: YEARS[1]!.start, end_date: YEARS[1]!.end, amount: 50, percent: 55.5556 },
      ],
    });
  }

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    calls.push({ method, path: `${url.pathname}${url.search}`, body });

    if (url.pathname === '/api/method/frappe.auth.get_logged_user') {
      return Response.json({ message: 'api-user' });
    }
    if (method === 'POST' && url.pathname === '/api/resource/Budget') {
      doc = {
        name: 'BUD-RANGE-1', owner: 'api-user', modified_by: 'api-user', modified: '2026-11-04 10:00:00', docstatus: 0,
        ...body,
        ...options.createdDocOverride,
      };
      docs.set(String(doc.name), doc);
      return Response.json({ data: { name: doc.name } });
    }
    if (method === 'PUT' && url.pathname.startsWith('/api/resource/Budget/')) {
      const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      if (body?.budget_distribution) distributionPutCount += 1;
      if (options.pauseDistributionPut && body?.budget_distribution && distributionPutCount === 1) {
        remoteDistributionPutPending = true;
        return await new Promise<Response>((resolve, reject) => {
          let callerSettled = false;
          const signal = init?.signal;
          const onAbort = () => {
            callerSettled = true;
            distributionPutCallerAborted = true;
            reject(new DOMException('request aborted by client deadline', 'AbortError'));
          };
          signal?.addEventListener('abort', onAbort, { once: true });
          completeRemoteDistributionPut = () => {
            doc = { ...doc!, budget_distribution: body.budget_distribution, modified: '2026-11-04 10:01:00' };
            docs.set(String(doc.name), doc);
            remoteDistributionPutPending = false;
            if (!callerSettled) resolve(Response.json({ data: doc }));
          };
        });
      }
      if (body?.docstatus === 2) {
        const prior = docs.get(name)!;
        if (cancelOutcome !== 'timeout-before-accept') {
          docs.set(name, { ...prior, docstatus: 2, modified: '2026-11-04 10:00:30', modified_by: 'api-user' });
        }
        if (cancelOutcome !== 'success') {
          const outcome = cancelOutcome;
          cancelOutcome = 'success';
          if (outcome === 'timeout-before-accept') throw new Error('simulated cancel timeout before acceptance');
          throw new Error('simulated cancel timeout after acceptance');
        }
        return Response.json({ data: docs.get(name) });
      }
      if (putOutcome !== 'timeout-before-accept' && body?.budget_distribution) {
        const rows = options.putDistributionOverride ?? body.budget_distribution;
        doc = { ...doc!, budget_distribution: rows, modified: '2026-11-04 10:01:00' };
        docs.set(String(doc.name), doc);
      }
      if (putOutcome !== 'success') {
        const outcome = putOutcome;
        putOutcome = 'success';
        if (outcome === 'timeout-before-accept') throw new Error('simulated PUT timeout before acceptance');
        throw new Error('simulated PUT timeout after acceptance');
      }
      return Response.json({ data: doc });
    }
    if (method === 'POST' && url.pathname === '/api/method/frappe.client.submit') {
      if (submitOutcome === 'cancelled') {
        doc = { ...(body?.doc as Record<string, unknown>), docstatus: 2, modified: '2026-11-04 10:02:00' };
        docs.set(String(doc.name), doc);
        return Response.json({ message: doc });
      }
      if (submitOutcome !== 'timeout-before-accept') {
        doc = { ...(body?.doc as Record<string, unknown>), docstatus: 1, modified: '2026-11-04 10:02:00' };
        docs.set(String(doc.name), doc);
      }
      if (submitOutcome !== 'success') {
        const outcome = submitOutcome;
        submitOutcome = 'success';
        if (outcome === 'timeout-before-accept') throw new Error('simulated submit timeout before acceptance');
        throw new Error('simulated submit timeout after acceptance');
      }
      return Response.json({ message: doc });
    }
    if (method === 'GET' && url.pathname.startsWith('/api/resource/Budget/')) {
      const name = decodeURIComponent(url.pathname.split('/').pop() ?? '');
      const target = docs.get(name);
      if (!target) return new Response(JSON.stringify({ message: 'DoesNotExistError' }), { status: 404 });
      return Response.json({ data: { ...target, ...options.getDocOverride } });
    }
    return new Response(JSON.stringify({ message: `unexpected request ${method} ${url.pathname}` }), { status: 404 });
  });

  const adapter = createErpAdapter({
    client: {
      fetchImpl: options.fetchThroughGlobal
        ? ((input, init) => globalThis.fetch(input, init)) as typeof fetch
        : fetchImpl as typeof fetch,
      apiKey: 'key', apiSecret: 'secret', baseUrl: 'https://erp.test', timeoutMs: options.timeoutMs,
    },
    doctypeBodies: DOCTYPE_BODIES,
    ctx: {
      refs: { project: PROJECT, self: options.predecessor?.name ?? null },
      config: { company: COMPANY, category_account_map: [{ category: 'Construction', erp_account: ACCOUNT }] },
      versionMajor: 16,
      budgetAccount: { intent: 'ensure', predecessor: options.predecessor?.name ?? null },
    },
    budgetRangeOutbox: {
      read: vi.fn(async (attempt: { generation: number }) => {
        durableGeneration = Math.max(durableGeneration, attempt.generation);
        return durableState;
      }),
      advance: vi.fn(async (attempt: { generation: number }, expected: string | null, next: Record<string, unknown>) => {
        if (attempt.generation !== durableGeneration || (durableState?.stage ?? null) !== expected) return false;
        stageCalls.push({ expected, next });
        if (options.failAdvanceStage === next.stage) return false;
        durableState = next;
        return true;
      }),
    },
  } as never);

  const command = {
    domain: 'budget',
    operation: 'create',
    commitDeadlineAtMs: Date.now() + 60_000,
    idempotencyKey: `bud16:${IDENTITY}:1793779200000`,
    outboxCommit: { id: OUTBOX, generation: 1, payloadDigest: 'a'.repeat(64), identity: IDENTITY },
    record: {
      id: VERSION,
      erp_doc_kind: 'budget',
      budget_mode: 'whole_project',
      projectId: 'project-id',
      fiscal_year: YEARS[0]!.name,
      to_fiscal_year: YEARS[1]!.name,
      fiscal_years: YEARS,
      year_amounts: [
        { year: YEARS[0]!.name, amount: '50.01' },
        { year: YEARS[1]!.name, amount: '50.00' },
      ],
      line_items: [{ category: 'Construction', budgeted_amount: '100.01' }],
      erp_account: ACCOUNT,
      budget_intent: 'ensure',
      budget_predecessor: options.predecessor?.name ?? null,
      ...(options.predecessor ? { budget_predecessor_modified: options.predecessor.modified } : {}),
      outbox_identity: IDENTITY,
      project_start_date: '2026-07-01',
      project_end_date: '2028-01-31',
      activated_at: '2026-11-04T00:00:00Z',
    },
  };

  return {
    adapter, command, calls, stageCalls, fetchImpl,
    get durableState() { return durableState; }, get doc() { return doc; },
    get remoteDistributionPutPending() { return remoteDistributionPutPending; },
    get distributionPutCallerAborted() { return distributionPutCallerAborted; },
    completeRemoteDistributionPut: () => completeRemoteDistributionPut?.(),
  };
}

function rangeDispatchOutbox() {
  const row: { value: OutboxRow | null; updatedAt: number; reconcileAfter: number | null } = {
    value: null, updatedAt: Date.now(), reconcileAfter: null,
  };
  const copy = () => row.value ? { ...row.value } : null;
  const deps: DispatchMoneyOutboxDeps = {
    async readOutbox() { return copy(); },
    async insertOutboxPending(domain, pmoRecordId, idempotencyKey) {
      row.value = {
        id: OUTBOX, domain, pmoRecordId, idempotencyKey, state: 'pending',
        externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: 'a'.repeat(64),
      };
      row.updatedAt = Date.now();
      return copy()!;
    },
    async claimOutboxForCommit() {
      const eligible = row.value?.state === 'pending' || row.value?.state === 'failed' ||
        (row.value?.state === 'quarantined' && row.reconcileAfter !== null && Date.now() >= row.reconcileAfter);
      if (!row.value || !eligible) return null;
      row.value.state = 'committing';
      row.value.claimGeneration += 1;
      row.updatedAt = Date.now();
      return copy();
    },
    async quarantineCommitting() {
      if (!row.value || row.value.state !== 'committing' || Date.now() - row.updatedAt <= 60_000) return null;
      row.value.state = 'quarantined';
      row.value.claimGeneration += 1;
      row.reconcileAfter = Date.now() + 5 * 60_000;
      row.updatedAt = Date.now();
      return copy();
    },
    async markOutboxCommitted(id, externalRecordId, canonical, generation) {
      if (!row.value || row.value.id !== id || row.value.claimGeneration !== generation) return 0;
      row.value.state = 'committed';
      row.value.externalRecordId = externalRecordId;
      row.value.canonical = canonical;
      return 1;
    },
    async recordOutboxRef(id, generation) {
      return row.value?.id === id && row.value.claimGeneration === generation && row.value.state === 'committed' ? 1 : 0;
    },
    async confirmOutbox(id, generation) {
      if (!row.value || row.value.id !== id || row.value.claimGeneration !== generation || row.value.state !== 'committed') return 0;
      row.value.state = 'confirmed';
      return 1;
    },
    async markOutboxHeld(id, _reason, generation) {
      if (!row.value || row.value.id !== id || row.value.claimGeneration !== generation || row.value.state !== 'committing') return 0;
      row.value.state = 'held';
      return 1;
    },
    reissueOnInconclusiveAbsence: false,
    async markOutboxFailed(id, _error, generation) {
      if (!row.value || row.value.id !== id || row.value.claimGeneration !== generation) return 0;
      row.value.state = 'failed';
      return 1;
    },
    async probeByRemarksKey() { return null; },
    async backoff() { await new Promise((resolve) => setTimeout(resolve, 1)); },
  };
  return {
    deps,
    get value() { return row.value; },
    expireClaim() { row.updatedAt = Date.now() - 60_001; },
    elapseWindow() { row.reconcileAfter = Date.now() - 1; },
  };
}

describe('whole-project range Budget durability', () => {
  it('AC-010 creates, witnesses, writes and submits the exact approved dated vector', async () => {
    const h = harness();
    const result = await h.adapter.commit(h.command as never);

    expect(h.calls.map((call) => `${call.method} ${call.path.split('?')[0]}`)).toEqual([
      'GET /api/method/frappe.auth.get_logged_user',
      'POST /api/resource/Budget',
      'GET /api/resource/Budget/BUD-RANGE-1',
      'GET /api/resource/Budget/BUD-RANGE-1',
      'PUT /api/resource/Budget/BUD-RANGE-1',
      'GET /api/resource/Budget/BUD-RANGE-1',
      'GET /api/resource/Budget/BUD-RANGE-1',
      'POST /api/method/frappe.client.submit',
      'GET /api/resource/Budget/BUD-RANGE-1',
    ]);
    expect(h.calls.find((call) => call.method === 'PUT')?.body).toEqual({ budget_distribution: EXPECTED_ROWS });
    expect(h.calls.find((call) => call.method === 'POST' && call.path === '/api/resource/Budget')?.body)
      .not.toHaveProperty('budget_distribution');
    expect(h.calls.find((call) => call.path === '/api/method/frappe.client.submit')?.body?.doc)
      .toMatchObject({ name: 'BUD-RANGE-1', docstatus: 0, budget_distribution: EXPECTED_ROWS });
    expect(h.stageCalls.map(({ expected, next }) => [expected, next.stage])).toEqual([
      [null, 'post_started'],
      ['post_started', 'draft_witnessed'],
      ['draft_witnessed', 'distribution_put_started'],
      ['distribution_put_started', 'distribution_saved'],
      ['distribution_saved', 'submit_started'],
      ['submit_started', 'submitted'],
    ]);
    expect(result.externalRecordId).toBe('BUD-RANGE-1');
    expect(result.canonical).toMatchObject({ id: VERSION, erp_budget_name: 'BUD-RANGE-1', erp_docstatus: 1 });
  });

  it('preserves an approved zero-year amount as an explicit dated ERP row', async () => {
    const h = harness();
    const command = structuredClone(h.command);
    command.record.year_amounts = [
      { year: YEARS[0]!.name, amount: '100.01' },
      { year: YEARS[1]!.name, amount: '0.00' },
    ];
    await h.adapter.commit(command as never);

    expect(h.calls.find((call) => call.method === 'PUT')?.body?.budget_distribution).toEqual([
      { start_date: YEARS[0]!.start, end_date: YEARS[0]!.end, amount: 100.01, percent: 100 },
      { start_date: YEARS[1]!.start, end_date: YEARS[1]!.end, amount: 0, percent: 0 },
    ]);
    expect((h.doc?.budget_distribution as unknown[])).toHaveLength(2);
  });

  it('holds when ERP saves a different year vector with the same total', async () => {
    const h = harness({ putDistributionOverride: [
      { start_date: YEARS[0]!.start, end_date: YEARS[0]!.end, amount: 60, percent: 60 },
      { start_date: YEARS[1]!.start, end_date: YEARS[1]!.end, amount: 40.01, percent: 40 },
    ] });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
    expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(h.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(0);
  });

  it('cancels and reads back the exact same-range predecessor before posting an amendment', async () => {
    const h = harness({ predecessor: { name: 'BUD-RANGE-OLD', modified: '2026-11-03 10:00:00' } });
    await h.adapter.commit(h.command as never);

    const cancelIndex = h.calls.findIndex((call) => call.method === 'PUT' && call.body?.docstatus === 2);
    const cancelReadbackIndex = h.calls.findIndex((call, index) => index > cancelIndex
      && call.method === 'GET' && call.path.endsWith('/BUD-RANGE-OLD'));
    const replacementPostIndex = h.calls.findIndex((call) => call.method === 'POST' && call.path === '/api/resource/Budget');
    expect(cancelIndex).toBeGreaterThan(-1);
    expect(cancelReadbackIndex).toBeGreaterThan(cancelIndex);
    expect(replacementPostIndex).toBeGreaterThan(cancelReadbackIndex);
    expect(h.calls[replacementPostIndex]?.body?.amended_from).toBe('BUD-RANGE-OLD');
    expect(h.stageCalls.map(({ expected, next }) => [expected, next.stage]).slice(0, 3)).toEqual([
      [null, 'cancel_started'], ['cancel_started', 'cancelled'], ['cancelled', 'post_started'],
    ]);
  });

  it('recovers an accepted predecessor cancellation by exact status readback without cancelling twice', async () => {
    const h = harness({
      predecessor: { name: 'BUD-RANGE-OLD', modified: '2026-11-03 10:00:00' },
      cancelOutcome: 'accept-then-timeout',
    });
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    h.command.outboxCommit.generation = 2;
    await h.adapter.commit(h.command as never);

    expect(h.calls.filter((call) => call.method === 'PUT' && call.body?.docstatus === 2)).toHaveLength(1);
    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
  });

  it('holds an unresolved predecessor cancellation across reclaim when ERP still shows the pre-write state', async () => {
    const h = harness({
      predecessor: { name: 'BUD-RANGE-OLD', modified: '2026-11-03 10:00:00' },
      cancelOutcome: 'timeout-before-accept',
    });
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    h.command.outboxCommit.generation = 2;
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });

    expect(h.calls.filter((call) => call.method === 'PUT' && call.body?.docstatus === 2)).toHaveLength(1);
  });

  it('refuses a predecessor whose modified witness or project does not match before cancellation', async () => {
    const cases = [
      { predecessor: { name: 'BUD-RANGE-OLD', modified: '2026-11-03 10:00:00' }, commandModified: '2026-11-02 10:00:00' },
      { predecessor: { name: 'BUD-RANGE-OLD', modified: '2026-11-03 10:00:00', project: 'OTHER-PROJECT' }, commandModified: undefined },
    ];
    for (const scenario of cases) {
      const h = harness({ predecessor: scenario.predecessor });
      if (scenario.commandModified) h.command.record.budget_predecessor_modified = scenario.commandModified;
      await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
      expect(h.calls.filter((call) => call.method === 'PUT' && call.body?.docstatus === 2)).toHaveLength(0);
      expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(0);
    }
  });

  it('does not POST when the durable pre-POST stage cannot be claimed', async () => {
    const h = harness({ failAdvanceStage: 'post_started' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
    expect(h.calls.some((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toBe(false);
  });

  it('never repeats a POST when ERP accepted it but the draft witness could not be saved', async () => {
    const h = harness({ failAdvanceStage: 'draft_witnessed' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
    expect(h.durableState?.stage).toBe('post_started');
    h.command.outboxCommit.generation = 2;
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });

    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('holds a returned draft with the wrong ERP identity, status, or author before any next write', async () => {
    const incorrectDrafts: Array<Record<string, unknown>> = [
      { company: 'Other Co' },
      { project: 'Other Project' },
      { account: 'Other Account' },
      { from_fiscal_year: 'FY-Other' },
      { to_fiscal_year: 'FY-Other' },
      { docstatus: 1 },
      { owner: 'desk-user' },
    ];
    for (const createdDocOverride of incorrectDrafts) {
      const h = harness({ createdDocOverride });
      await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
      expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
      expect(h.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(0);
    }
    const wrongReturnedName = harness({ getDocOverride: { name: 'OTHER-BUDGET' } });
    await expect(wrongReturnedName.adapter.commit(wrongReturnedName.command as never))
      .rejects.toMatchObject({ code: 'command-held' });
    expect(wrongReturnedName.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  it('stops before each next ERP write when a generation-fenced stage advance fails', async () => {
    const beforeDistribution = harness({ failAdvanceStage: 'distribution_put_started' });
    await expect(beforeDistribution.adapter.commit(beforeDistribution.command as never))
      .rejects.toMatchObject({ code: 'command-held' });
    expect(beforeDistribution.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(beforeDistribution.calls.filter((call) => call.method === 'PUT')).toHaveLength(0);

    const beforeSubmit = harness({ failAdvanceStage: 'submit_started' });
    await expect(beforeSubmit.adapter.commit(beforeSubmit.command as never)).rejects.toMatchObject({ code: 'command-held' });
    expect(beforeSubmit.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(beforeSubmit.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(0);
  });

  it('refuses a stale identity or payload digest before any ERP call', async () => {
    const h = harness({ recoveryState: {
      stage: 'draft_witnessed', identity: 'other-range-identity', payloadDigest: 'b'.repeat(64),
    } });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
    expect(h.calls).toHaveLength(0);
  });

  it('recovers an accepted distribution PUT by readback without creating or writing twice', async () => {
    const h = harness({ putOutcome: 'accept-then-timeout' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(h.durableState?.stage).toBe('distribution_put_started');
    h.command.outboxCommit.generation = 2;
    const result = await h.adapter.commit(h.command as never);

    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(result.canonical).toMatchObject({ erp_budget_name: 'BUD-RANGE-1', erp_docstatus: 1 });
  });

  it('holds an unaccepted distribution PUT across reclaim while ERP still shows the pre-write state', async () => {
    const h = harness({ putOutcome: 'timeout-before-accept' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
    expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    h.command.outboxCommit.generation = 2;
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });

    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it('holds instead of retrying a distribution PUT after the witnessed document changed', async () => {
    const h = harness({ putOutcome: 'timeout-before-accept' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    h.doc!.modified = '2026-11-04 10:00:30';
    h.command.outboxCommit.generation = 2;
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });

    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(h.calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
  });

  it('recovers a submit accepted by ERP through docstatus 1 readback without resubmitting', async () => {
    const h = harness({ submitOutcome: 'accept-then-timeout' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    expect(h.durableState?.stage).toBe('submit_started');
    h.command.outboxCommit.generation = 2;
    const result = await h.adapter.commit(h.command as never);

    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(h.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(1);
    expect(result.canonical).toMatchObject({ erp_budget_name: 'BUD-RANGE-1', erp_docstatus: 1 });
  });

  it('holds an unaccepted submit across reclaim while ERP still shows the exact draft', async () => {
    const h = harness({ submitOutcome: 'timeout-before-accept' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });
    expect(h.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(1);
    h.command.outboxCommit.generation = 2;
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });

    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(h.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(1);
  });

  it('AC-010 holds a concurrent reclaimed range write until remote completion is established', async () => {
    const h = harness({ timeoutMs: 2_000, fetchThroughGlobal: true, pauseDistributionPut: true });
    const originalFetch = globalThis.fetch;
    const outbox = rangeDispatchOutbox();
    vi.stubGlobal('fetch', h.fetchImpl);
    try {
      const dispatch = () => dispatchMoneyWrite({
        adapter: h.adapter,
        command: h.command as never,
        writeReadModel: vi.fn(),
        recordExternalRef: vi.fn(),
        money: outbox.deps,
        outboxRecordId: IDENTITY,
      });
      const first = dispatch();
      const firstOutcome = first.then(() => null, (error: unknown) => error);
      await vi.waitFor(() => expect(h.remoteDistributionPutPending).toBe(true));
      expect(outbox.value?.state).toBe('committing');
      outbox.expireClaim();
      await expect(dispatch()).rejects.toMatchObject({ code: 'external-unreachable' });
      expect(outbox.value?.state).toBe('quarantined');
      outbox.elapseWindow();
      expect(h.remoteDistributionPutPending).toBe(true);
      // The first dispatch is still awaiting its remote write while the reclaimer claims it.
      await expect(dispatch()).rejects.toMatchObject({ code: 'command-held' });
      expect(outbox.value?.state).toBe('held');
      expect(h.calls.filter((call) => call.method === 'PUT' && call.body?.budget_distribution)).toHaveLength(1);
      expect(h.remoteDistributionPutPending).toBe(true);
      await vi.waitFor(() => expect(h.distributionPutCallerAborted).toBe(true), { timeout: 2_500 });
      await expect(firstOutcome).resolves.toMatchObject({ code: 'external-unreachable' });

      h.completeRemoteDistributionPut();
      expect(h.remoteDistributionPutPending).toBe(false);
      await expect(dispatch()).rejects.toMatchObject({ code: 'command-held' });
      expect(outbox.value?.state).toBe('held');
      expect(h.calls.filter((call) => call.method === 'PUT' && call.body?.budget_distribution)).toHaveLength(1);
      expect(h.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not repeat submit if the witnessed draft was cancelled during an uncertain submit', async () => {
    const h = harness({ submitOutcome: 'cancelled' });

    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'external-unreachable' });
    h.command.outboxCommit.generation = 2;
    await expect(h.adapter.commit(h.command as never)).rejects.toMatchObject({ code: 'command-held' });

    expect(h.calls.filter((call) => call.method === 'POST' && call.path === '/api/resource/Budget')).toHaveLength(1);
    expect(h.calls.filter((call) => call.path === '/api/method/frappe.client.submit')).toHaveLength(1);
  });
});
