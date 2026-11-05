/**
 * T0.2 — the route-specific request-count harness for `/projects/:id` (Overview, finance lens).
 *
 * WHY THIS EXISTS (plan: docs/plans/2026-11-05-project-detail-read-fanout.md): the project record
 * fired ~22 route-specific reads on mount, most for content that is NOT first paint (VAT
 * editability, stage history behind a closed disclosure, the below-the-fold work-order billing
 * block). Performance is P0 (50-user load); this harness pins the count so every defer step moves
 * it DOWN, measured, never asserted from memory.
 *
 * HOW: mock `@/src/lib/supabase/client` with a RECORDING stub — `from(table)` / `rpc(fn)` return
 * empty-but-valid PostgREST-shaped builders and log one endpoint per awaited request (a request =
 * one builder await, exactly what supabase-js turns into one HTTP call). Mount the real
 * `ProjectDetail` for a Finance user (the worst, most-used lens per the plan), let every query
 * settle, then assert the SET of endpoints and the TOTAL.
 *
 * The assertion is updated per defer step (each step's commit first flips the expectation — red —
 * then removes the read — green), so the file is the running before/after record of the fan-out work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const stub = vi.hoisted(() => {
  type Endpoint = { kind: 'table' | 'write' | 'rpc'; label: string };

  /**
   * An IntersectionObserver stub that NEVER reports an intersection — the below-the-fold block's
   * viewport reality in a headless mount (AC-PERF-003: the mount fires none of its reads). A test
   * that needs the "user scrolled near" moment calls trigger(true) on the instance.
   */
  class NeverNearIntersectionObserver {
    static instances: NeverNearIntersectionObserver[] = [];
    readonly options: IntersectionObserverInit | undefined;
    private readonly callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.callback = callback;
      this.options = options;
      NeverNearIntersectionObserver.instances.push(this);
    }
    observe() { /* placeholder stays invisible to the callback */ }
    unobserve() { /* single-target wrapper */ }
    disconnect() { /* no-op in the stub */ }
    takeRecords(): IntersectionObserverEntry[] { return []; }
    trigger(isIntersecting: boolean) {
      this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }

  /** The on-hand project row the stub resolves for the `projects` single read (`getProject`).
   * The id is a REAL UUID because the money parsers (isProjectFinances) demand one and match it
   * against the route's :projectId — the counted case is a genuine record id. */
  const PROJECT_ID = '6a2cf7e2-1c3b-4a5d-9e8f-0a1b2c3d4e5f';
  const PROJECT_ROW = {
    id: PROJECT_ID,
    name: 'Perf Probe Project',
    code: 'PP-1',
    short_name: null,
    status: 'Ongoing Project',
    currency: 'USD',
    contract_value: 1_000_000,
    contract_date: '2026-01-15',
    customer_contract_ref: null,
    start_date: '2026-01-02',
    end_date: '2026-12-18',
    last_update: '2026-11-01T08:00:00Z',
    tax_rate: null,
    tax_treatment: null,
    tax_amount: null,
    tax_base_numerator: 1,
    tax_base_denominator: 1,
    subject_to_vat: true,
    client_id: null,
    end_client_id: null,
    project_manager_id: null,
    contract_value_set_by: null,
    org_id: 'org-1',
    client: null,
    end_client: null,
    pm: null,
  };

  /** Single-row tables the mount path resolves: the page needs these to leave their loading states. */
  const SINGLE_ROWS: Record<string, unknown> = {
    projects: PROJECT_ROW,
    organizations: { default_currency: 'USD', default_timezone: 'Asia/Jakarta' },
  };

  /**
   * One visible budget version, so `listBudgetVersions` runs its full fan-out (#10–#13 of the
   * plan's inventory: versions + lines + editors + read-totals). An empty versions list would
   * short-circuit (the DAL returns [] before the other three reads) and under-count the baseline.
   */
  const TABLE_ROWS: Record<string, unknown[]> = {
    budget_versions: [
      { id: 'bv-1', project_id: PROJECT_ID, version: 1, status: 'Active', currency: 'USD' },
    ],
  };

  /**
   * RPC results. Default is the empty list; the entries here are the payloads the page's parsers
   * DEMAND before the query settles successfully — an errored query refetches when a later
   * observer mounts (an error is never "fresh"), which would double-count endpoints the real
   * system fires once. With these, every mount-path query resolves the way it does against the
   * real database on an empty/quiet project.
   */
  const RPC_RESULTS: Record<string, unknown> = {
    get_project_vat_editability: { eligible: true, reason: null, hasInvoices: false },
    get_project_finances: {
      project_id: PROJECT_ID,
      contract_invoiced: '0.00',
      remaining_to_invoice: '1000000.00',
      invoices: [],
      budget: null,
      actuals: { currency: null, as_of: null, total: '0.00', excludes_restricted_rows: true, categories: [] },
    },
    // get_project_billing: null is a VALID summary ("invisible project" / nothing billable) and
    // every consumer renders it without an error, so the default-[] entry is not needed here.
    get_project_billing: null,
    org_reads_erp_ledger: false,
    budget_version_read_totals: [{ version_id: 'bv-1', total: 1000 }],
    // Step 3: the one read that carries every Overview summary (AC-PERF-009). Same empty-but-valid
    // values the per-endpoint stubs above return, in the RPC's own row shape.
    get_project_overview_read: [{
      project_id: PROJECT_ID,
      finances: {
        project_id: PROJECT_ID,
        contract_invoiced: '0.00',
        remaining_to_invoice: '1000000.00',
        invoices: [],
        budget: null,
        actuals: { currency: null, as_of: null, total: '0.00', excludes_restricted_rows: true, categories: [] },
      },
      billing: null,
      boq_items: [],
      budget_versions: [],
      committed_spend: [],
      external_domain_ownership: [],
      reads_erp_ledger: false,
      milestones: [],
      comment_count: 0,
      org_default_currency: 'USD',
      org_default_timezone: 'Asia/Jakarta',
    }],
  };

  const endpoints: Endpoint[] = [];

  /**
   * A PostgREST-shaped chainable+thenable builder. Every method returns the same builder
   * (PostgrestBuilder is immutable-ish but the stub only needs call-shape fidelity); awaiting it
   * records ONE endpoint and resolves an empty-but-valid payload. Writes are recorded under a
   * distinct kind so a mount that writes fails the expected-set assertion loudly.
   */
  function tableBuilder(table: string, op: 'read' | 'insert' | 'update' | 'upsert' | 'delete') {
    const state = { single: false, settled: false };
    const payload = () => {
      if (op !== 'read') return { data: null, error: null };
      if (state.single) return { data: SINGLE_ROWS[table] ?? null, error: null };
      return { data: (TABLE_ROWS[table] ?? []) as unknown[], error: null };
    };
    const builder: Record<string, unknown> = {
      // filter / shape chainables — shape-only fidelity is enough for request counting
      select: () => builder,
      eq: () => builder,
      neq: () => builder,
      gt: () => builder,
      gte: () => builder,
      lt: () => builder,
      lte: () => builder,
      like: () => builder,
      ilike: () => builder,
      is: () => builder,
      in: () => builder,
      contains: () => builder,
      containedBy: () => builder,
      or: () => builder,
      not: () => builder,
      filter: () => builder,
      textSearch: () => builder,
      returns: () => builder,
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      abortSignal: () => builder,
      throwOnError: () => builder,
      csv: () => builder,
      single: () => { state.single = true; return builder; },
      maybeSingle: () => { state.single = true; return builder; },
      // write terminators (chain off the same builder)
      insert: () => builder,
      update: () => builder,
      upsert: () => builder,
      delete: () => builder,
      then: (
        onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => {
        if (!state.settled) {
          state.settled = true;
          endpoints.push({ kind: op === 'read' ? 'table' : 'write', label: `${op}:${table}` });
        }
        return Promise.resolve(payload()).then(onFulfilled, onRejected);
      },
      catch: (onRejected?: ((reason: unknown) => unknown) | null) =>
        Promise.resolve(payload()).catch(onRejected),
      finally: (onFinally?: (() => void) | null) => Promise.resolve(payload()).finally(onFinally),
    };
    return builder;
  }

  function rpcBuilder(fn: string) {
    const state = { settled: false };
    const builder: Record<string, unknown> = {
      // paged rpc reads (fetchAllPages) chain .select/.order/.range onto the rpc builder
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: () => builder,
      limit: () => builder,
      abortSignal: () => builder,
      throwOnError: () => builder,
      then: (
        onFulfilled?: ((value: { data: unknown; error: unknown }) => unknown) | null,
        onRejected?: ((reason: unknown) => unknown) | null,
      ) => {
        if (!state.settled) {
          state.settled = true;
          endpoints.push({ kind: 'rpc', label: `rpc:${fn}` });
        }
        const data = fn in RPC_RESULTS ? RPC_RESULTS[fn] : [];
        return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
      },
      catch: (onRejected?: ((reason: unknown) => unknown) | null) => {
        const data = fn in RPC_RESULTS ? RPC_RESULTS[fn] : [];
        return Promise.resolve({ data, error: null }).catch(onRejected);
      },
      finally: (onFinally?: (() => void) | null) => {
        const data = fn in RPC_RESULTS ? RPC_RESULTS[fn] : [];
        return Promise.resolve({ data, error: null }).finally(onFinally);
      },
    };
    return builder;
  }

  const client = {
    from: (table: string) => tableBuilder(table, 'read'),
    rpc: (fn: string) => rpcBuilder(fn),
    // The mount path never touches auth/functions/channels (auth comes from AuthContext), but the
    // client must not explode if a surface reaches for them.
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => ({ on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) }),
    removeChannel: () => {},
  };

  return { endpoints, client, IO: NeverNearIntersectionObserver };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: stub.client }));

import ProjectDetail from '../ProjectDetail';

/** The finance-lens user the plan counts (Admin/Exec/Finance/PM all land on the money lens). */
const financeAuth = {
  session: null,
  currentUser: {
    id: 'user-1',
    org_id: 'org-1',
    role: 'Finance',
    email: 'finance@acme.test',
    full_name: 'Finance User',
    manager_id: null,
  },
  role: 'Finance',
  loading: false,
  profileError: null,
  profileErrorKind: null,
  signInWithPassword: async () => ({ error: null }),
  signInWithMagicLink: async () => ({ error: null }),
  signInWithMicrosoft: async () => ({ error: null }),
  requestPasswordReset: async () => ({ error: null }),
  updatePassword: async () => ({ error: null }),
  resendEmailConfirmation: async () => ({ error: null }),
  signOut: async () => undefined,
  refreshCurrentUser: async () => ({ error: null }),
} as unknown as AuthContextValue;

function renderProjectDetail(): QueryClient {
  // Mirror the app's shared client (src/lib/queryClient.ts, ADR-0005): staleTime 30s is what
  // dedupes a read shared by several mount points into ONE request. Only `retry` differs: a
  // retried failed read would double-count endpoints in the log, so the harness retries never.
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 300_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
      mutations: { retry: false },
    },
  });
  render(
    <AuthContext.Provider value={financeAuth}>
      <ImpersonationProvider realRole="Finance">
        <QueryClientProvider client={client}>
          <ToastProvider>
            <MemoryRouter initialEntries={['/projects/6a2cf7e2-1c3b-4a5d-9e8f-0a1b2c3d4e5f']}>
              <Routes>
                <Route path="/projects/:projectId/:tab?" element={<ProjectDetail />} />
              </Routes>
            </MemoryRouter>
          </ToastProvider>
        </QueryClientProvider>
      </ImpersonationProvider>
    </AuthContext.Provider>,
  );
  return client;
}

/** Let the query tree drain: return once the endpoint log has been stable for two consecutive ticks. */
async function settleRequests(): Promise<void> {
  await screen.findByRole('tablist', { name: /project sections/i });
  let stable = 0;
  for (let i = 0; i < 100 && stable < 2; i++) {
    const before = stub.endpoints.length;
    await new Promise((resolve) => setTimeout(resolve, 10));
    stable = stub.endpoints.length === before ? stable + 1 : 0;
  }
}

beforeEach(() => {
  stub.endpoints.length = 0;
  // Fresh observer bookkeeping per test: the static instance array would otherwise hand the
  // intersect test a STALE (disconnected) observer from the previous render.
  stub.IO.instances.length = 0;
});

afterEach(() => {
  cleanup();
});

const endpointLabels = (): string[] => stub.endpoints.map((e) => e.label);

describe('ProjectDetail mount request count (AC-PERF-009 harness, plan T0.2)', () => {
  it('fires exactly the measured endpoint set on Overview mount, total 8 (Steps 1 and 3)', async () => {
    vi.stubGlobal('IntersectionObserver', stub.IO);
    renderProjectDetail();
    await settleRequests();

    // The MEASURED baseline on current dev (this stub, finance lens, empty-but-valid payloads).
    // The plan's static inventory of 22 route-specific reads sat inside the old-dev measurement
    // of 25; on dev since #1891 the budget fan-out is ONE rpc read, and this measurement is 22:
    //   · the plan's 22 items minus the 3 budget-fan-out reads (#10–13) plus the single
    //     budget_version_read (#1891 = the plan's Step 2, already landed), and
    //   · two in-tree consumers the inventory did not itemize: ProjectMatchReview (via
    //     ProjectErpLink in the header/rail) re-reads the project row under its own key and reads
    //     the org's ERP binding; the Overview foot's survey eligibility resolves org features.
    // Step-1 deltas (1a/1b/1c) each remove exactly the deferred reads; totals shift down from here.
    // Step 3 (AC-PERF-009): the finance-lens mount is the plan's five route reads (project, overview read,
    // invoices, tasks, procurements) plus three in-tree consumers the plan did not itemize.
    expect(endpointLabels().sort()).toEqual(
      [
        'read:projects', // useProject
        'read:projects', // the ERP match-review context re-reads the record under its own key
        'rpc:get_project_overview_read', // finances, billing, BoQ, budget, committed spend, ownership, ledger, milestones, comment count, fx
        'read:sales_invoices',
        'read:tasks',
        'read:procurements',
        'read:external_org_bindings', // ERP match-review context: the org binding check
        'rpc:resolved_org_features', // Overview-foot survey eligibility
      ].sort(),
    );
    expect(endpointLabels()).toHaveLength(8);
  });

  it('AC-PERF-003: the work-order reads fire exactly once when the block nears the viewport', async () => {
    vi.stubGlobal('IntersectionObserver', stub.IO);
    renderProjectDetail();
    await settleRequests();
    expect(endpointLabels().filter((label) => label.startsWith('read:work_order') || label === 'read:work_orders')).toEqual([]);

    // The user scrolls: the block enters the 300px approach margin and mounts.
    act(() => stub.IO.instances[0].trigger(true));
    await vi.waitFor(() => {
      const labels = endpointLabels().filter((label) => label.startsWith('read:work_order'));
      expect(labels.sort()).toEqual(['read:work_order_billing', 'read:work_order_uninvoiced_acceptance', 'read:work_orders']);
    });
    // Exactly once — let everything drain, then re-check.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(endpointLabels().filter((label) => label.startsWith('read:work_order'))).toHaveLength(3);
  });
});
