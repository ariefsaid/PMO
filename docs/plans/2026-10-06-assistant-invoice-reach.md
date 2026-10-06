# Plan: Assistant invoice reach — "what's overdue?" and "invoice this" (#787)

- **Spec:** `docs/specs/assistant-invoice-reach.spec.md` (AC-AIN-001..017, proposed DD-AIN-1..9)
- **ADR:** `docs/adr/0079-agent-coarse-tools-server-resolved-proposals.md` (0077 is skipped: a gap before 0078
  that another branch may hold)
- **Migration:** none (no 0248). Every fact needed is already readable under the caller's JWT.
- **Size:** M–L · 30 tasks · three slices (§2)

---

## 0. Design (brainstormed one decision at a time)

**D1 — Tool granularity.** The live model (deepseek-v4-flash) is a weak tool-selector. One coarse tool per
journey: `whats_overdue` (read, no arguments) and `draft_invoice` (confirm-gated write). The server does the
multi-step work. Rejected: adding `sales_invoices`/`work_orders` to `query_entity` plus a thin create — that is the
multi-call plan the model drops (ADR-0079 Alternatives).

**D2 — Overdue data flow.** `whats_overdue.run(ctx)` → caller-JWT reads: profile zone + org locale + Revenue
feature (parallel) → PM's managed project ids (PM only) → overdue tasks (1–2 queries, ≤51 rows each) → project
and person names (parallel) → Unpaid invoices (≤201 rows, oldest first) filtered by `deriveArDueDate` → render
markdown. Returns `{ markdown, receipt }`. The handler shows `markdown` verbatim and gives the model `receipt`
(ADR-0079 §3). Roles and feature gate per DD-AIN-2.

**D3 — Draft data flow.**
```
model → draft_invoice {workOrder|milestone, project?, amount?, itemCode?}
  validate (shape) → prepare (caller JWT): role → Revenue on → revenue owned by ERPNext → project → source
    → client + client's ERPNext link → amount before tax → item → { prepared draft, summary }
  → needs-approval chip (summary ≤120 chars; structuredArgs = prepared draft)        [stream ends]
user Approve → re-POST (client replays structuredArgs as the tool input)
  → handleDecision: validatePrepared (allow-list rebuild) → profiles re-read → can('create','salesInvoice')
  → run: functions.invoke('adapter-dispatch', {domain:'revenue', operation:'create', record, idempotencyKey})
       with the CALLER's JWT → every existing server gate → ERPNext Draft authored by the caller
```
Identity (`commandId`, `idempotencyKey`) is minted in `prepare` and travels inside the prepared draft, so an approve
retry reuses it (the outbox de-dupes) and the persistence journal hash is stable.

**D4 — Reuse, no forks.** `deriveArDueDate` (due-date rule) imported as-is (pure). `normalizeTaxAmount` moved to a
dependency-free leaf `src/lib/taxNormalize.ts` (re-exported; no behaviour change) so Deno can import it. The SI
create record built by one leaf `salesInvoiceCreateFields` used by both the FE repository and the agent. The inline
`agentCan` in `agent-chat/index.ts` extracted to `agentCan.ts` so it is unit-tested.

**D5 — Error handling.** Every refusal from `prepare` is a structured tool result the model can act on
(`{error, needs?, candidates?}`; candidates are `{id,label}` — exactly `ask_user`'s option shape). Dispatch errors
read the edge fn's JSON `message`; a 25 s timeout reports "check Sales Invoices before asking again". `whats_overdue`
has an 8 s overall timeout and returns a plain error.

**D6 — Security.** Caller JWT only (no `service_role` anywhere new). RLS stays the read authority; `adapter-dispatch`
stays the write authority. Markdown-escape every user string in rendered text. Strip `% _ * \` from search terms
before `ilike`. Allow-list rebuild of replayed args. `operation` hard-coded to `create` (mutation-checked). A prepared
action always chips. A server switch (`AGENT_INVOICE_DRAFTS=false`) removes the tool without a redeploy.

**D7 — Testing.** Vitest for every deterministic AC (tool logic + handler flow with a recording fake client and a
scripted model). Eval (ADR-0052) for the real-model AC-AIN-003, proposal-only. No pgTAP (no DB change), no new e2e
(edge fns don't run in the e2e stack; chip + markdown rendering already covered).

**Scaling risks surfaced (not fixed here):**
- Overdue invoices are filtered in app code over the oldest ≤200 Unpaid rows; a large org gets a truncated list
  (flagged in the answer). Fix when needed: a security-invoker SQL function deriving due dates + index
  `(org_id, status, invoice_date)`.
- PM scope reads ≤500 managed project ids and passes them in `in(...)`; fine for one client, revisit past ~1k
  projects per PM.
- `whats_overdue` makes 6–8 small reads per call with no caching. Acceptable at chat frequency.

**Duplicate logic surfaced:** the SI create record shape (FE repo vs agent → one leaf, Task B2); the revenue role
lists (`policy.ts`, `authGuard.ts`, `agentRoles.ts` → drift tests, Task A1); `agentCan` hand-coded in `index.ts`
(→ module + tests, Task B3).

---

## 1. File map

New (edge fn, Deno + Vitest-importable, relative `.ts` imports, no `@/` alias):
- `supabase/functions/agent-chat/agentFormat.ts` — escape, dates, money, locale (leaf)
- `supabase/functions/agent-chat/looseClient.ts` — structural client type + read helpers (leaf)
- `supabase/functions/agent-chat/overdue.ts` — `whats_overdue`
- `supabase/functions/agent-chat/draftInvoice.ts` — `draft_invoice`
- `supabase/functions/agent-chat/agentCan.ts` — the agent's `can()` preflight

New (pmo-portal):
- `pmo-portal/src/lib/taxNormalize.ts` — leaf: `isTaxTreatment`, `decimalUnits`, `normalizeTaxAmount`
- `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts` — leaf: `salesInvoiceCreateFields`
- `pmo-portal/src/lib/agent/testing/fakeSupabase.ts` — recording fake client (tests only)
- `pmo-portal/src/lib/agent/testing/draftInvoiceFixtures.ts` — shared draft-invoice fixtures (tests only; test
  files never import other test files)
- tests: `src/lib/agent/{agentFormat,looseClient,overdue,handlerOverdue,agentCan,draftInvoice.request,draftInvoice.prepare,draftInvoice.run,handlerDraftInvoice}.test.ts`,
  `src/lib/taxNormalize.test.ts`, `src/lib/adapterSeam/erpnext/salesInvoiceCommand.test.ts`,
  `pages/__tests__/SalesInvoices.deepLink.test.tsx`
- `pmo-portal/evals/cases/invoice-reach.eval.ts`

Edited: `pmo-portal/src/auth/agentRoles.ts` (+test), `pmo-portal/src/lib/agent/runtime/port.ts`,
`supabase/functions/agent-chat/{schema,handler,prompt,index}.ts`, `pmo-portal/src/lib/taxTreatment.ts`,
`pmo-portal/src/lib/repositories/index.ts`, `pmo-portal/pages/SalesInvoices.tsx`,
`pmo-portal/evals/harness/{scorers,runEval}.ts` (+`scorers.test.ts`), `pmo-portal/evals/README.md`,
`pmo-portal/src/lib/agent/prompt.experience.test.ts`.

---

## 2. Slices and executor routing (decided before the build — `docs/factory-workflow.md`)

| Slice | Tasks | Executor | Why |
|---|---|---|---|
| **A — read journey + shared seams** | A1–A13 | **SSSF ADW** (`adws/adw_simple_sdlc.py`) | Read-only, RLS-scoped, no money write, bounded. A11 is a one-line state seed on an existing page. |
| **B — draft-invoice write** | B1–B15 | **Director-dispatched** (money path) | Agent write into sales invoices; SoD-adjacent |
| **C — gate + eval** | C1–C2 | Director | Needs the owner-approved deploy and the eval org |

B depends on A2 (port types), A3/A4 (leaves), A5 (fake client), A9 (handler registration + `stepLabel`), A10
(`overdueSkill` in the prompt), A12 (scorer). Own worktree per slice off `dev`; PR A first, B rebased on A.

Run every command from the worktree root. Vitest commands run in `pmo-portal/`.

---

## 3. Tasks

### Slice A

#### A1 — Revenue role sets for the agent (drift-guarded)
**Files:** `pmo-portal/src/auth/agentRoles.ts`, `pmo-portal/src/auth/agentRoles.test.ts` · **Covers:** AC-AIN-004, AC-AIN-007 (role sets)

Step 1 — failing test: extend the first import of `agentRoles.test.ts` to
`import { AGENT_MASTER_DATA_ROLES, AGENT_DELIVERY_WITH_ENGINEER_ROLES, AGENT_REVENUE_VIEW_ROLES, AGENT_REVENUE_WRITE_ROLES } from './agentRoles';`
and append:
```ts
import { moneyWriteRolesForDomain } from '../../../supabase/functions/adapter-dispatch/authGuard';

describe('agentRoles — revenue sets (#787)', () => {
  it('AC-AIN-004 AGENT_REVENUE_VIEW_ROLES matches policy view salesInvoice', () => {
    const allow = ALL_ROLES.filter((r) => can('view', 'salesInvoice', { realRole: r }));
    expect(AGENT_REVENUE_VIEW_ROLES.slice().sort()).toEqual(allow.slice().sort());
  });
  it('AC-AIN-007 AGENT_REVENUE_WRITE_ROLES matches policy create salesInvoice AND the dispatch guard', () => {
    const allow = ALL_ROLES.filter((r) => can('create', 'salesInvoice', { realRole: r }));
    expect(AGENT_REVENUE_WRITE_ROLES.slice().sort()).toEqual(allow.slice().sort());
    expect(AGENT_REVENUE_WRITE_ROLES.slice().sort()).toEqual([...moneyWriteRolesForDomain('revenue')].sort());
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/auth/agentRoles.test.ts)` → FAIL (exports missing).

Step 3 — append to `agentRoles.ts`:
```ts
/** Roles that may VIEW sales invoices (salesInvoice.view in policy.ts) — gates the invoice half of
 *  whats_overdue (#787, DD-AIN-2). UX scoping only; RLS is the read authority. */
export const AGENT_REVENUE_VIEW_ROLES: string[] = ['Admin', 'Executive', 'Project Manager', 'Finance'];

/** Roles that may RAISE a sales invoice (salesInvoice.create in policy.ts, and adapter-dispatch's
 *  REVENUE_WRITE_ROLES — the enforcement authority). draft_invoice preflight (#787, DD-AIN-3). */
export const AGENT_REVENUE_WRITE_ROLES: string[] = ['Admin', 'Finance'];
```
Step 4 — same command → PASS.

#### A2 — Port types: caller role on the deputy context; `prepare` / `validatePrepared`
**Files:** `pmo-portal/src/lib/agent/runtime/port.ts` · **Covers:** enables AC-AIN-002/004 (type-only)

Step 1/2 — no runtime behaviour; the typecheck is the test.
Step 3 — in `port.ts`, replace the `DeputyContext` interface, add `PrepareResult`, and add two optional members to
`AgentAction` (after `needsApproval`):
```ts
export interface DeputyContext {
  jwt: string;
  userId: string;
  orgId: string;
  supabase: SupabaseLike;
  /** #787 / ADR-0079: the caller's role as read under their own JWT at turn start (profiles.role). A scoping and
   *  UX input for coarse tools — never an authority (RLS and the served write path are). */
  role?: string | null;
}

/** ADR-0079 §2: what an async `prepare` returns. `value` becomes the chip's structuredArgs; `summary` its text. */
export type PrepareResult =
  | { ok: true; value: object; summary: string }
  | { ok: false; error: Record<string, unknown> };
```
```ts
  /**
   * ADR-0079 §2: optional async resolution of a confirm action's proposal, run under the deputy context AFTER
   * `validate` and BEFORE the chip. An action with `prepare` ALWAYS shows the chip.
   */
  prepare?: (input: unknown, ctx: DeputyContext) => Promise<PrepareResult>;
  /** ADR-0079 §2: validates the REPLAYED prepared value on approve (an allow-list rebuild of `prepare`'s value). */
  validatePrepared?: (input: unknown) => { ok: true; value: unknown } | { ok: false; error: string };
```
Change the `NeedsApprovalPayload.structuredArgs` doc comment to
`/** Validated tool input — or, for an action with \`prepare\`, the server-resolved record (ADR-0079). */`.

Step 4 — `(cd pmo-portal && npm run typecheck)` → 0 errors.

#### A3 — Formatting leaf (escape, zone date, money)
**Files:** `supabase/functions/agent-chat/agentFormat.ts`, `pmo-portal/src/lib/agent/agentFormat.test.ts` · **Covers:** AC-AIN-012, FR-AIN-002

Step 1 — failing test `agentFormat.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import {
  daysBetween, escapeMarkdownText, formatMoney, formatShortDate, isMoney, isoDateInZone, resolveNumberLocale,
} from '../../../../supabase/functions/agent-chat/agentFormat';

describe('agentFormat (#787)', () => {
  it('AC-AIN-012 a link-shaped name is escaped to plain text', () => {
    expect(escapeMarkdownText('[x](https://evil.example)')).toBe('\\[x\\]\\(https://evil.example\\)');
    expect(escapeMarkdownText('a*b_c<script>')).toBe('a\\*b\\_c\\<script\\>');
    expect(escapeMarkdownText('line1\nline2')).toBe('line1 line2');
    expect(escapeMarkdownText('x'.repeat(300))).toHaveLength(200);
  });
  it('FR-AIN-002 today is the calendar date in the given zone', () => {
    const now = new Date('2026-10-05T18:00:00Z');
    expect(isoDateInZone(now, 'Asia/Jakarta')).toBe('2026-10-06');
    expect(isoDateInZone(now, 'UTC')).toBe('2026-10-05');
    expect(isoDateInZone(now, 'Not/AZone')).toBe('2026-10-05');
  });
  it('days, short dates, money, locale, money predicate', () => {
    expect(daysBetween('2026-10-01', '2026-10-06')).toBe(5);
    expect(formatShortDate('2026-10-02')).toBe('2 Oct');
    expect(formatMoney(1500.5, 'USD', 'en-US')).toBe('$1,500.50');
    expect(formatMoney(1, 'NOT', 'en-US')).toBe('NOT 1.00');
    expect(resolveNumberLocale({ default_number_locale: null, default_locale: 'id-ID' })).toBe('id-ID');
    expect(resolveNumberLocale(null)).toBe('en-US');
    expect(isMoney(1000000)).toBe(true);
    expect(isMoney(10.005)).toBe(false);
    expect(isMoney(0)).toBe(false);
    expect(isMoney(1e12)).toBe(false);
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/agentFormat.test.ts)` → FAIL (module missing).

Step 3 — create `agentFormat.ts`:
```ts
/**
 * agentFormat.ts — pure helpers for SERVER-composed agent text (#787, ADR-0079 §3). Leaf module: no imports,
 * so it can never join an import cycle (see readEntities.ts's header for the boot crash that rule prevents).
 */

/** Characters that change meaning inside inline markdown. Escaping them makes user-authored text (a task,
 *  project, person or customer name) render as TEXT — never a link, emphasis, code span or raw HTML. */
const MD_INLINE = /[\\`*_{}[\]()#+!<>|~]/g;

export function escapeMarkdownText(raw: string, max = 200): string {
  return raw.replace(/[\r\n]+/g, ' ').slice(0, max).replace(MD_INLINE, (c) => `\\${c}`);
}

/** Today's calendar date (YYYY-MM-DD) in an IANA zone; an unknown zone falls back to UTC. */
export function isoDateInZone(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Whole days from `fromIso` to `toIso` (both YYYY-MM-DD). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** "2 Oct" — English month words to match the English labels (DD-AIN-7); a date-only value never shifts by zone. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`));
}

/** Money in the org's number locale and the record's OWN currency (OD-CR-5) — never converted. */
export function formatMoney(amount: number, currency: string, numberLocale: string): string {
  try {
    return new Intl.NumberFormat(numberLocale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** The org's number locale: its explicit setting, else its UI locale, else en-US (0198: NULL = derive). */
export function resolveNumberLocale(
  org: { default_number_locale?: string | null; default_locale?: string | null } | null,
): string {
  return org?.default_number_locale || org?.default_locale || 'en-US';
}

/** A positive scale-2 money amount below the numeric(14,2) ceiling. */
export function isMoney(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e12 && Number(n.toFixed(2)) === n;
}
```
Step 4 — same command → PASS.

#### A4 — Loose client leaf (structural client, reads, timeout, `ilike` safety)
**Files:** `supabase/functions/agent-chat/looseClient.ts`, `pmo-portal/src/lib/agent/looseClient.test.ts` · **Covers:** NFR-AIN-SEC-002

Step 1 — failing test `looseClient.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { asFunctions, readOne, readRows, toLikeTerm, withTimeout } from '../../../../supabase/functions/agent-chat/looseClient';

describe('looseClient (#787)', () => {
  it('NFR-AIN-SEC-002 strips PostgREST pattern characters from a search term', () => {
    expect(toLikeTerm('WO-1%_*\\x')).toBe('WO-1 x');
    expect(toLikeTerm('  a   b ')).toBe('a b');
  });
  it('reads rows / one, and throws on a db error without echoing data', async () => {
    expect(await readRows(Promise.resolve({ data: [{ a: 1 }], error: null }))).toEqual([{ a: 1 }]);
    expect(await readRows(Promise.resolve({ data: null, error: null }))).toEqual([]);
    expect(await readOne(Promise.resolve({ data: { a: 1 }, error: null }))).toEqual({ a: 1 });
    await expect(readRows(Promise.resolve({ data: null, error: { code: '42501', message: 'x' } }))).rejects.toThrow('read failed (42501)');
  });
  it('asFunctions finds a functions.invoke client, else null', () => {
    expect(asFunctions({ functions: { invoke: vi.fn() } })).not.toBeNull();
    expect(asFunctions({ from: vi.fn() })).toBeNull();
  });
  it('withTimeout rejects after the deadline', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise(() => {}), 1000);
    const assertion = expect(p).rejects.toThrow('timeout');
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    vi.useRealTimers();
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/looseClient.test.ts)` → FAIL.

Step 3 — create `looseClient.ts`:
```ts
/**
 * looseClient.ts — the minimal structural view of the caller-JWT Supabase client that the coarse agent tools
 * need (filters, ordering, maybeSingle, functions.invoke). Leaf module. The real client is a superset; tests
 * pass a recording fake. Same precedent as erpSnapshots.ts's LooseSnapshotQuery. NEVER a service_role client:
 * tools only ever receive ctx.supabase (the deputy client).
 */
export interface LooseResult {
  data: unknown;
  error: { code?: string; message?: string } | null;
}
export interface LooseQuery extends PromiseLike<LooseResult> {
  eq(column: string, value: unknown): LooseQuery;
  in(column: string, values: readonly unknown[]): LooseQuery;
  lt(column: string, value: string): LooseQuery;
  is(column: string, value: null): LooseQuery;
  ilike(column: string, pattern: string): LooseQuery;
  order(column: string, opts?: { ascending?: boolean }): LooseQuery;
  limit(n: number): LooseQuery;
  maybeSingle(): PromiseLike<LooseResult>;
}
export interface LooseClient {
  from(table: string): { select(columns: string): LooseQuery };
}
export interface FunctionsClient {
  functions: { invoke(name: string, opts: { body: unknown }): Promise<{ data: unknown; error: unknown }> };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asLoose(client: unknown): LooseClient {
  return client as LooseClient;
}

export function asFunctions(client: unknown): FunctionsClient | null {
  const fns = (client as { functions?: { invoke?: unknown } } | null)?.functions;
  return fns && typeof fns.invoke === 'function' ? (client as FunctionsClient) : null;
}

export async function readRows<T>(q: PromiseLike<LooseResult>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(`read failed${error.code ? ` (${error.code})` : ''}`);
  return (Array.isArray(data) ? data : []) as T[];
}

export async function readOne<T>(q: PromiseLike<LooseResult>): Promise<T | null> {
  const { data, error } = await q;
  if (error) throw new Error(`read failed${error.code ? ` (${error.code})` : ''}`);
  return (data ?? null) as T | null;
}

export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    Promise.resolve(p).finally(() => clearTimeout(timer)),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]);
}

/** A user/model term made safe for PostgREST `ilike`: its wildcards (% _ *) and escape (\) are removed. */
export function toLikeTerm(raw: string): string {
  return raw.replace(/[%_*\\]/g, ' ').replace(/\s+/g, ' ').trim();
}
```
Step 4 — same command → PASS.

#### A5 — Recording fake client (test helper) + `WHATS_OVERDUE_SCHEMA`
**Files:** `pmo-portal/src/lib/agent/testing/fakeSupabase.ts`, `supabase/functions/agent-chat/schema.ts` · **Covers:** test seam for A6–B14

Step 1 — create `fakeSupabase.ts` (exercised by A6 onward; no test of its own):
```ts
/** Recording fake of the caller-JWT Supabase client for the #787 coarse-tool + handler tests. Every terminal
 *  (await / single / maybeSingle) records {table, columns, ops} and asks `respond` for the result. */
import { vi } from 'vitest';

export interface FakeCall {
  table: string;
  columns: string;
  ops: Array<[string, ...unknown[]]>;
  terminal: 'then' | 'single' | 'maybeSingle';
}
export type Responder = (call: FakeCall) => { data: unknown; error: unknown };
export type Invoker = (name: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }>;

export function fakeSupabase(respond: Responder, invoke?: Invoker) {
  const calls: FakeCall[] = [];
  const from = (table: string) => ({
    select(columns: string) {
      const ops: FakeCall['ops'] = [];
      const finish = (terminal: FakeCall['terminal']) => {
        const call: FakeCall = { table, columns, ops, terminal };
        calls.push(call);
        return Promise.resolve(respond(call));
      };
      const chain: Record<string, unknown> = {};
      for (const op of ['eq', 'in', 'lt', 'is', 'ilike', 'order', 'limit']) {
        chain[op] = (...args: unknown[]) => {
          ops.push([op, ...args]);
          return chain;
        };
      }
      chain.single = () => finish('single');
      chain.maybeSingle = () => finish('maybeSingle');
      chain.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => finish('then').then(ok, fail);
      return chain;
    },
  });
  const invokeSpy = vi.fn(invoke ?? (async () => ({ data: null, error: { message: 'no functions in this fake' } })));
  const client = { from, rpc: vi.fn(async () => ({ data: null, error: null })), functions: { invoke: invokeSpy } };
  return { client, calls, invoke: invokeSpy };
}

/** The recorded filter ops of every call on `table`, in call order. */
export const opsOf = (calls: FakeCall[], table: string) => calls.filter((c) => c.table === table).map((c) => c.ops);
```
Step 3 — append to `schema.ts`:
```ts
/** whats_overdue (#787, ADR-0079 §1) — deliberately NO arguments: one call, nothing for a weak model to get wrong. */
export const WHATS_OVERDUE_SCHEMA = {
  type: 'object' as const,
  required: [] as string[],
  additionalProperties: false,
  properties: {},
};
```
Step 4 — `(cd pmo-portal && npm run typecheck)` → 0 errors.

#### A6 — `whats_overdue` facts: task scoping by role
**Files:** `supabase/functions/agent-chat/overdue.ts`, `pmo-portal/src/lib/agent/overdue.test.ts` · **Covers:** AC-AIN-004, AC-AIN-005 (tasks), FR-AIN-003

Step 1 — failing test `overdue.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadOverdueFacts } from '../../../../supabase/functions/agent-chat/overdue';
import { fakeSupabase, opsOf, type FakeCall } from './testing/fakeSupabase';

const NOW = new Date('2026-10-05T18:00:00Z'); // 2026-10-06 in Asia/Jakarta
const P1 = '11111111-1111-4111-8111-111111111111';
const ctx = (role: string, client: unknown) =>
  ({ jwt: '', userId: 'u-me', orgId: 'org-1', role, supabase: client as never });

type Rows = Partial<Record<string, (c: FakeCall) => unknown>>;
function world(rows: Rows = {}) {
  return (c: FakeCall) => {
    const hit = rows[c.table];
    if (hit) return { data: hit(c), error: null };
    switch (c.table) {
      case 'profiles': return { data: c.columns === 'timezone' ? { timezone: 'Asia/Jakarta' } : [], error: null };
      case 'organizations': return { data: { default_timezone: 'UTC', default_locale: 'en-US', default_number_locale: 'en-US' }, error: null };
      case 'org_features': return { data: { enabled: true }, error: null };
      default: return { data: [], error: null };
    }
  };
}

describe('loadOverdueFacts — tasks (#787)', () => {
  it('AC-AIN-004 an Engineer gets only their own open, past-due, live tasks', async () => {
    const { client, calls } = fakeSupabase(world());
    await loadOverdueFacts(ctx('Engineer', client), NOW);
    expect(opsOf(calls, 'tasks')).toHaveLength(1);
    const [ops] = opsOf(calls, 'tasks');
    expect(ops).toContainEqual(['eq', 'assignee_id', 'u-me']);
    expect(ops).toContainEqual(['in', 'status', ['To Do', 'In Progress', 'Blocked']]);
    expect(ops).toContainEqual(['lt', 'end_date', '2026-10-06']);
    expect(ops).toContainEqual(['is', 'tombstoned_at', null]);
    expect(ops).toContainEqual(['is', 'archived_at', null]);
    expect(ops).toContainEqual(['limit', 51]);
  });

  it('AC-AIN-005 a PM gets tasks on projects they manage plus their own, de-duplicated, oldest first', async () => {
    const tA = { id: 't-a', name: 'A', end_date: '2026-10-03', project_id: P1, assignee_id: 'u-me' };
    const tB = { id: 't-b', name: 'B', end_date: '2026-10-01', project_id: P1, assignee_id: 'u-2' };
    const { client, calls } = fakeSupabase(world({
      projects: (c) => (c.columns === 'id' ? [{ id: P1 }] : [{ id: P1, name: 'Harbor' }]),
      tasks: (c) => (c.ops.some((o) => o[0] === 'eq' && o[1] === 'assignee_id') ? [tA] : [tA, tB]),
    }));
    const facts = await loadOverdueFacts(ctx('Project Manager', client), NOW);
    expect(opsOf(calls, 'projects')[0]).toContainEqual(['eq', 'project_manager_id', 'u-me']);
    expect(opsOf(calls, 'tasks').some((ops) => ops.some((o) => o[0] === 'in' && o[1] === 'project_id'))).toBe(true);
    expect(facts.tasks.map((t) => t.id)).toEqual(['t-b', 't-a']);
    expect(facts.tasks[0]).toMatchObject({ projectName: 'Harbor', dueDate: '2026-10-01', daysOverdue: 5 });
  });

  it('Finance sees the whole org (no scope filter) and today follows the profile zone', async () => {
    const { client, calls } = fakeSupabase(world());
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    const [ops] = opsOf(calls, 'tasks');
    expect(ops.some((o) => o[1] === 'assignee_id' || o[1] === 'project_id')).toBe(false);
    expect(facts.asOf).toBe('2026-10-06');
  });

  it('flags truncation past the 50-row cap', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `t-${i}`, name: 'x', end_date: '2026-10-01', project_id: null, assignee_id: null }));
    const { client } = fakeSupabase(world({ tasks: () => many }));
    const facts = await loadOverdueFacts(ctx('Admin', client), NOW);
    expect(facts.tasks).toHaveLength(50);
    expect(facts.tasksTruncated).toBe(true);
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/overdue.test.ts)` → FAIL (module missing).

Step 3 — create `overdue.ts`:
```ts
/**
 * whats_overdue — the ONE coarse read tool for "what's overdue?" (#787, ADR-0079 §1).
 *
 * Why one tool: the deployed model is a weak tool-selector, and the fine-grained route (tasks need a project
 * filter → one read per project → an invoice read → due-date arithmetic) is exactly the multi-call plan it does
 * not make. This module does the whole read under the CALLER's JWT (ctx.supabase — RLS is the row authority;
 * never service_role) and returns a server-rendered answer the handler shows verbatim (ADR-0079 §3).
 */
import type { DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { asLoose, readOne, readRows, type LooseClient, type LooseQuery } from './looseClient.ts';
import { daysBetween, isoDateInZone, resolveNumberLocale } from './agentFormat.ts';

export const OVERDUE_TASK_CAP = 50;
export const OVERDUE_INVOICE_SCAN_CAP = 200;
const OPEN_TASK_STATUSES = ['To Do', 'In Progress', 'Blocked'] as const;

interface TaskRow { id: string; name: string; end_date: string; project_id: string | null; assignee_id: string | null }

export interface OverdueTask {
  id: string; name: string; projectId: string | null; projectName: string | null;
  assigneeName: string | null; dueDate: string; daysOverdue: number;
}
export interface OverdueInvoice {
  id: string; siNumber: string | null; customerName: string | null; outstanding: number | null;
  currency: string; taxTreatment: string; dueDate: string; daysOverdue: number;
}
export interface OverdueFacts {
  asOf: string;
  numberLocale: string;
  tasks: OverdueTask[];
  tasksTruncated: boolean;
  /** null = not shown (role may not view invoices, or Revenue is off) — DD-AIN-2. */
  invoices: OverdueInvoice[] | null;
  invoicesTruncated: boolean;
}

const unique = (xs: Array<string | null>): string[] => [...new Set(xs.filter((x): x is string => !!x))];

export async function loadOverdueFacts(ctx: DeputyContext, now: Date): Promise<OverdueFacts> {
  const sb: LooseClient = asLoose(ctx.supabase);
  const role = ctx.role ?? null;
  const [profile, org, feature] = await Promise.all([
    readOne<{ timezone: string | null }>(sb.from('profiles').select('timezone').eq('id', ctx.userId).maybeSingle()),
    readOne<{ default_timezone: string | null; default_locale: string | null; default_number_locale: string | null }>(
      sb.from('organizations').select('default_timezone, default_locale, default_number_locale').eq('id', ctx.orgId).maybeSingle(),
    ),
    readOne<{ enabled: boolean }>(sb.from('org_features').select('enabled').eq('feature_key', 'revenue').maybeSingle()),
  ]);
  // FR-AIN-002 / DD-AIN-1: "today" in the caller's own zone, else the org's, else UTC.
  const asOf = isoDateInZone(now, profile?.timezone || org?.default_timezone || 'UTC');

  // DD-AIN-2: a PM's "their projects" = the projects they manage (plus anything assigned to them).
  const managedIds: string[] | null = role === 'Project Manager'
    ? (await readRows<{ id: string }>(
        sb.from('projects').select('id').eq('project_manager_id', ctx.userId).is('archived_at', null).limit(500),
      )).map((p) => p.id)
    : null;

  const overdueTasks = (scope: (q: LooseQuery) => LooseQuery) =>
    readRows<TaskRow>(
      scope(
        sb.from('tasks').select('id, name, end_date, project_id, assignee_id')
          .in('status', OPEN_TASK_STATUSES).lt('end_date', asOf).is('tombstoned_at', null).is('archived_at', null),
      ).order('end_date', { ascending: true }).limit(OVERDUE_TASK_CAP + 1),
    );

  let taskRows: TaskRow[];
  if (role === 'Engineer') {
    taskRows = await overdueTasks((q) => q.eq('assignee_id', ctx.userId));
  } else if (role === 'Project Manager') {
    const ids = managedIds ?? [];
    const [mine, managed] = await Promise.all([
      overdueTasks((q) => q.eq('assignee_id', ctx.userId)),
      ids.length ? overdueTasks((q) => q.in('project_id', ids)) : Promise.resolve([] as TaskRow[]),
    ]);
    const byId = new Map([...mine, ...managed].map((t) => [t.id, t]));
    taskRows = [...byId.values()].sort((a, b) => a.end_date.localeCompare(b.end_date));
  } else {
    taskRows = await overdueTasks((q) => q);
  }
  const tasksTruncated = taskRows.length > OVERDUE_TASK_CAP;
  taskRows = taskRows.slice(0, OVERDUE_TASK_CAP);

  const projectIds = unique(taskRows.map((t) => t.project_id));
  const assigneeIds = unique(taskRows.map((t) => t.assignee_id));
  const [projects, people] = await Promise.all([
    projectIds.length
      ? readRows<{ id: string; name: string }>(sb.from('projects').select('id, name').in('id', projectIds))
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    assigneeIds.length
      ? readRows<{ id: string; full_name: string | null }>(sb.from('profiles').select('id, full_name').in('id', assigneeIds))
      : Promise.resolve([] as Array<{ id: string; full_name: string | null }>),
  ]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const personName = new Map(people.map((p) => [p.id, p.full_name]));
  const tasks: OverdueTask[] = taskRows.map((t) => ({
    id: t.id,
    name: t.name,
    projectId: t.project_id,
    projectName: t.project_id ? projectName.get(t.project_id) ?? null : null,
    assigneeName: t.assignee_id ? personName.get(t.assignee_id) ?? null : null,
    dueDate: t.end_date,
    daysOverdue: daysBetween(t.end_date, asOf),
  }));

  const invoices: OverdueInvoice[] | null = null;
  const invoicesTruncated = false;
  void feature;
  return { asOf, numberLocale: resolveNumberLocale(org), tasks, tasksTruncated, invoices, invoicesTruncated };
}
```
Step 4 — same command → PASS.

#### A7 — `whats_overdue` facts: overdue invoices (same due-date rule as the Sales Invoices page)
**Files:** `supabase/functions/agent-chat/overdue.ts`, `pmo-portal/src/lib/agent/overdue.test.ts` · **Covers:** AC-AIN-013, AC-AIN-006, AC-AIN-005 (invoices), AC-AIN-004 (no invoice read), FR-AIN-004/005

Step 1 — append to `overdue.test.ts`:
```ts
describe('loadOverdueFacts — invoices (#787)', () => {
  const inv = (si: string, date: string, terms: number | null) => ({
    id: si, si_number: si, invoice_date: date, erp_outstanding_amount: 100, currency: 'IDR',
    tax_treatment: 'inclusive', project_id: P1, companies: { name: 'PT Client', erp_payment_terms_days: terms },
  });

  it('AC-AIN-013 overdue = Unpaid and due before today, by deriveArDueDate', async () => {
    const { client, calls } = fakeSupabase(world({
      sales_invoices: () => [inv('SI-1', '2026-09-01', 30), inv('SI-2', '2026-09-20', 30), inv('SI-3', '2026-08-20', null)],
    }));
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    expect(opsOf(calls, 'sales_invoices')[0]).toContainEqual(['eq', 'status', 'Unpaid']);
    expect(facts.invoices?.map((i) => [i.siNumber, i.dueDate, i.daysOverdue])).toEqual([
      ['SI-3', '2026-09-19', 17],
      ['SI-1', '2026-10-01', 5],
    ]);
  });

  it('AC-AIN-006 Revenue off → no invoice read, no invoice section', async () => {
    const { client, calls } = fakeSupabase(world({ org_features: () => ({ enabled: false }) }));
    const facts = await loadOverdueFacts(ctx('Finance', client), NOW);
    expect(calls.some((c) => c.table === 'sales_invoices')).toBe(false);
    expect(facts.invoices).toBeNull();
  });

  it('AC-AIN-004 an Engineer never triggers an invoice read', async () => {
    const { client, calls } = fakeSupabase(world());
    const facts = await loadOverdueFacts(ctx('Engineer', client), NOW);
    expect(calls.some((c) => c.table === 'sales_invoices')).toBe(false);
    expect(facts.invoices).toBeNull();
  });

  it('AC-AIN-005 a PM sees invoices on managed projects only; none managed → empty, no read', async () => {
    const managed = fakeSupabase(world({ projects: (c) => (c.columns === 'id' ? [{ id: P1 }] : []) }));
    await loadOverdueFacts(ctx('Project Manager', managed.client), NOW);
    expect(opsOf(managed.calls, 'sales_invoices')[0]).toContainEqual(['in', 'project_id', [P1]]);

    const none = fakeSupabase(world({ projects: () => [] }));
    const facts = await loadOverdueFacts(ctx('Project Manager', none.client), NOW);
    expect(none.calls.some((c) => c.table === 'sales_invoices')).toBe(false);
    expect(facts.invoices).toEqual([]);
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/overdue.test.ts)` → FAIL (invoices null).

Step 3 — in `overdue.ts`: add imports
```ts
import { deriveArDueDate } from '../../../pmo-portal/src/lib/repositories/revenueDisplay.ts';
import { AGENT_REVENUE_VIEW_ROLES } from '../../../pmo-portal/src/auth/agentRoles.ts';
```
add under `TaskRow`:
```ts
interface InvoiceRow {
  id: string; si_number: string | null; invoice_date: string | null; erp_outstanding_amount: number | null;
  currency: string; tax_treatment: string; project_id: string | null;
  companies: { name: string | null; erp_payment_terms_days: number | null } | null;
}
```
and replace the three lines `const invoices: OverdueInvoice[] | null = null;` / `const invoicesTruncated = false;` /
`void feature;` with:
```ts
  // DD-AIN-2: invoices only for a role that may view them, in an org with Revenue on.
  let invoices: OverdueInvoice[] | null = null;
  let invoicesTruncated = false;
  if (feature?.enabled === true && role !== null && AGENT_REVENUE_VIEW_ROLES.includes(role)) {
    if (managedIds && managedIds.length === 0) {
      invoices = [];
    } else {
      let q = sb.from('sales_invoices')
        .select('id, si_number, invoice_date, erp_outstanding_amount, currency, tax_treatment, project_id, companies!sales_invoices_customer_id_fkey(name, erp_payment_terms_days)')
        .eq('status', 'Unpaid');
      if (managedIds) q = q.in('project_id', managedIds);
      const scanned = await readRows<InvoiceRow>(
        q.order('invoice_date', { ascending: true }).limit(OVERDUE_INVOICE_SCAN_CAP + 1),
      );
      const overdue: OverdueInvoice[] = [];
      for (const row of scanned.slice(0, OVERDUE_INVOICE_SCAN_CAP)) {
        // DD-AIN-1: the SAME due-date rule the Sales Invoices "Due" column renders (FR-SAR-141, AC-SAR-051).
        const due = deriveArDueDate(row.invoice_date, row.companies?.erp_payment_terms_days ?? null, null);
        if (!due || due >= asOf) continue;
        overdue.push({
          id: row.id, siNumber: row.si_number, customerName: row.companies?.name ?? null,
          outstanding: row.erp_outstanding_amount, currency: row.currency, taxTreatment: row.tax_treatment,
          dueDate: due, daysOverdue: daysBetween(due, asOf),
        });
      }
      overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      invoicesTruncated = scanned.length > OVERDUE_INVOICE_SCAN_CAP || overdue.length > OVERDUE_TASK_CAP;
      invoices = overdue.slice(0, OVERDUE_TASK_CAP);
    }
  }
```
Step 4 — same command → PASS.

#### A8 — Render the answer; `runWhatsOverdue`; the action
**Files:** `supabase/functions/agent-chat/overdue.ts`, `pmo-portal/src/lib/agent/overdue.test.ts` · **Covers:** FR-AIN-006/007/008, AC-AIN-012 (in context), NFR-AIN-PERF-001

Step 1 — change the `overdue.test.ts` import to
`import { loadOverdueFacts, renderOverdueMarkdown, runWhatsOverdue, type OverdueFacts } from '../../../../supabase/functions/agent-chat/overdue';`
and append:
```ts
describe('renderOverdueMarkdown / runWhatsOverdue (#787)', () => {
  const base: OverdueFacts = {
    asOf: '2026-10-06', numberLocale: 'en-US', tasksTruncated: false, invoicesTruncated: false,
    tasks: [{ id: 't-1', name: '[x](https://evil.example)', projectId: P1, projectName: 'Harbor', assigneeName: 'Budi', dueDate: '2026-10-02', daysOverdue: 4 }],
    invoices: [{ id: 'si-1', siNumber: 'ACC-SINV-2026-00012', customerName: 'PT Client', outstanding: 1500.5, currency: 'USD', taxTreatment: 'inclusive', dueDate: '2026-10-01', daysOverdue: 5 }],
  };

  it('FR-AIN-007 links tasks to the project Tasks tab and invoices to the filtered list; escapes names', () => {
    const md = renderOverdueMarkdown(base);
    expect(md).toContain('**Overdue as of 6 Oct** — 1 task, 1 invoice');
    expect(md).toContain(`[\\[x\\]\\(https://evil.example\\)](/projects/${P1}/tasks) — Harbor · due 2 Oct (4 days late) · Budi`);
    expect(md).toContain('[ACC-SINV-2026-00012](/sales-invoices?q=ACC-SINV-2026-00012) — PT Client · $1,500.50 outstanding (incl. tax) · due 1 Oct (5 days late)');
  });

  it('caps each section at 10 rows and says how many more', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ ...base.tasks[0], id: `t-${i}`, name: `T${i}` }));
    const md = renderOverdueMarkdown({ ...base, tasks, invoices: null });
    expect(md.match(/^- \[T/gm)).toHaveLength(10);
    expect(md).toContain('- …and 2 more');
    expect(md).not.toContain('**Invoices**');
    expect(md).toContain('— 12 tasks');
  });

  it('says plainly when nothing is overdue', () => {
    expect(renderOverdueMarkdown({ ...base, tasks: [], invoices: [] })).toBe('**Overdue as of 6 Oct** — nothing is overdue.');
  });

  it('FR-AIN-006 run returns the markdown plus a receipt without the list', async () => {
    const { client } = fakeSupabase(world({ tasks: () => [{ id: 't-1', name: 'Pour', end_date: '2026-10-02', project_id: P1, assignee_id: null }] }));
    const out = await runWhatsOverdue({}, ctx('Engineer', client), NOW);
    expect(out).toMatchObject({ receipt: { ok: true, overdueTasks: 1, overdueInvoices: null } });
    expect(JSON.stringify((out as { receipt: unknown }).receipt)).not.toContain('Pour');
  });

  it('a read failure becomes a plain error, never a partial list', async () => {
    const ok = world();
    const { client } = fakeSupabase((c) => (c.table === 'tasks' ? { data: null, error: { code: '42501' } } : ok(c)));
    expect(await runWhatsOverdue({}, ctx('Engineer', client), NOW)).toEqual({ error: 'whats_overdue could not read the overdue items right now.' });
  });
});
```
Step 2 — same command → FAIL (exports missing).

Step 3 — in `overdue.ts`, set the imports to:
```ts
import type { AgentAction, DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';
import { deriveArDueDate } from '../../../pmo-portal/src/lib/repositories/revenueDisplay.ts';
import { AGENT_REVENUE_VIEW_ROLES } from '../../../pmo-portal/src/auth/agentRoles.ts';
import { WHATS_OVERDUE_SCHEMA } from './schema.ts';
import { asLoose, readOne, readRows, withTimeout, UUID_RE, type LooseClient, type LooseQuery } from './looseClient.ts';
import { daysBetween, escapeMarkdownText, formatMoney, formatShortDate, isoDateInZone, resolveNumberLocale } from './agentFormat.ts';
```
and append:
```ts
export const OVERDUE_LIST_SHOWN = 10;
export const OVERDUE_TIMEOUT_MS = 8000;

export interface OverdueAnswer {
  markdown: string;
  receipt: {
    ok: true; asOf: string; overdueTasks: number; overdueInvoices: number | null;
    tasksTruncated: boolean; invoicesTruncated: boolean; note: string;
  };
}

const count = (n: number, more: boolean, one: string, many: string) =>
  `${n}${more ? '+' : ''} ${n === 1 && !more ? one : many}`;
const late = (d: number) => `${d} ${d === 1 ? 'day' : 'days'} late`;
const basis = (t: string) => (t === 'inclusive' ? 'incl. tax' : t === 'exclusive' ? 'excl. tax' : '');
/** A query value safe inside a markdown link destination (parentheses would end it early). */
const hrefParam = (v: string) => encodeURIComponent(v).replace(/\(/g, '%28').replace(/\)/g, '%29');

/** DD-AIN-7: the deterministic, server-written answer. Every user-authored string is escaped (FR-AIN-008). */
export function renderOverdueMarkdown(f: OverdueFacts): string {
  const head = `**Overdue as of ${formatShortDate(f.asOf)}**`;
  if (f.tasks.length === 0 && (f.invoices === null || f.invoices.length === 0)) return `${head} — nothing is overdue.`;
  const counts = [count(f.tasks.length, f.tasksTruncated, 'task', 'tasks')];
  if (f.invoices) counts.push(count(f.invoices.length, f.invoicesTruncated, 'invoice', 'invoices'));
  const lines = [`${head} — ${counts.join(', ')}`];

  if (f.tasks.length) {
    lines.push('', '**Tasks**');
    for (const t of f.tasks.slice(0, OVERDUE_LIST_SHOWN)) {
      const name = escapeMarkdownText(t.name);
      const title = t.projectId && UUID_RE.test(t.projectId) ? `[${name}](/projects/${t.projectId}/tasks)` : name;
      const where = t.projectName ? ` — ${escapeMarkdownText(t.projectName)}` : '';
      const who = t.assigneeName ? ` · ${escapeMarkdownText(t.assigneeName)}` : '';
      lines.push(`- ${title}${where} · due ${formatShortDate(t.dueDate)} (${late(t.daysOverdue)})${who}`);
    }
    const rest = f.tasks.length - Math.min(f.tasks.length, OVERDUE_LIST_SHOWN);
    if (rest > 0 || f.tasksTruncated) lines.push(`- …and ${rest}${f.tasksTruncated ? '+' : ''} more`);
  }

  if (f.invoices && f.invoices.length) {
    lines.push('', '**Invoices**');
    for (const i of f.invoices.slice(0, OVERDUE_LIST_SHOWN)) {
      const label = escapeMarkdownText(i.siNumber ?? 'Invoice');
      const href = i.siNumber ? `/sales-invoices?q=${hrefParam(i.siNumber)}` : '/sales-invoices';
      const who = i.customerName ? ` — ${escapeMarkdownText(i.customerName)}` : '';
      const b = basis(i.taxTreatment);
      const money = i.outstanding !== null
        ? ` · ${formatMoney(i.outstanding, i.currency, f.numberLocale)} outstanding${b ? ` (${b})` : ''}`
        : '';
      lines.push(`- [${label}](${href})${who}${money} · due ${formatShortDate(i.dueDate)} (${late(i.daysOverdue)})`);
    }
    const rest = f.invoices.length - Math.min(f.invoices.length, OVERDUE_LIST_SHOWN);
    if (rest > 0 || f.invoicesTruncated) lines.push(`- …and ${rest}${f.invoicesTruncated ? '+' : ''} more on [Sales Invoices](/sales-invoices)`);
  }
  return lines.join('\n');
}

export async function runWhatsOverdue(
  _input: unknown,
  ctx: DeputyContext,
  now: Date = new Date(),
): Promise<OverdueAnswer | { error: string }> {
  try {
    const facts = await withTimeout(loadOverdueFacts(ctx, now), OVERDUE_TIMEOUT_MS);
    return {
      markdown: renderOverdueMarkdown(facts),
      receipt: {
        ok: true,
        asOf: facts.asOf,
        overdueTasks: facts.tasks.length,
        overdueInvoices: facts.invoices ? facts.invoices.length : null,
        tasksTruncated: facts.tasksTruncated,
        invoicesTruncated: facts.invoicesTruncated,
        note: 'The overdue list is already shown to the user. Reply with at most one short sentence; do not repeat the list.',
      },
    };
  } catch {
    return { error: 'whats_overdue could not read the overdue items right now.' };
  }
}

export const whatsOverdueAction: AgentAction = {
  name: 'whats_overdue',
  description:
    "One call: the user's overdue tasks across their projects, plus overdue invoices when their role may see invoices. The list is shown to the user automatically.",
  inputSchema: WHATS_OVERDUE_SCHEMA,
  surfaces: ['agent'],
  confirm: false,
  run: (input: unknown, ctx: DeputyContext) => runWhatsOverdue(input, ctx),
};
```
Step 4 — same command → PASS.

#### A9 — Handler: register `whats_overdue`, pass the caller role, show rendered answers verbatim
**Files:** `supabase/functions/agent-chat/handler.ts`, `pmo-portal/src/lib/agent/handlerOverdue.test.ts` · **Covers:** **AC-AIN-001 (owning)**, FR-AIN-006

Step 1 — failing test `handlerOverdue.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentChatHandler, type HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import { fakeSupabase, type FakeCall } from './testing/fakeSupabase';

const P1 = '11111111-1111-4111-8111-111111111111';
async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; }
const toolCall = (name: string, args: object) => ({
  finish_reason: 'tool_calls', usage: {}, model: 'm',
  message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
});
const stop = (text: string) => ({ finish_reason: 'stop', usage: {}, model: 'm', message: { role: 'assistant', content: text } });

function respond(c: FakeCall) {
  if (c.table === 'profiles' && c.columns === 'org_id, role') return { data: { org_id: 'org-1', role: 'Finance' }, error: null };
  if (c.table === 'profiles' && c.columns === 'timezone') return { data: { timezone: 'Asia/Jakarta' }, error: null };
  if (c.table === 'profiles') return { data: [{ id: 'u-2', full_name: 'Budi' }], error: null };
  if (c.table === 'organizations') return { data: { default_timezone: 'Asia/Jakarta', default_locale: 'en-US', default_number_locale: 'id-ID' }, error: null };
  if (c.table === 'org_features') return { data: { enabled: true }, error: null };
  if (c.table === 'tasks') return { data: [{ id: 't-1', name: 'Pour foundation', end_date: '2026-10-02', project_id: P1, assignee_id: 'u-2' }], error: null };
  if (c.table === 'projects') return { data: [{ id: P1, name: 'Harbor Tower' }], error: null };
  if (c.table === 'sales_invoices') return { data: [{ id: 'si-1', si_number: 'ACC-SINV-2026-00012', invoice_date: '2026-09-01', erp_outstanding_amount: 850000000, currency: 'IDR', tax_treatment: 'inclusive', project_id: P1, companies: { name: 'PT Client', erp_payment_terms_days: 30 } }], error: null };
  return { data: null, error: null };
}

describe('whats_overdue through the handler (#787)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T03:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it('AC-AIN-001 shows the overdue tasks and invoices with links; the model receives only the receipt', async () => {
    const { client } = fakeSupabase(respond);
    const create = vi.fn().mockResolvedValueOnce(toolCall('whats_overdue', {})).mockResolvedValueOnce(stop('Two things need you.'));
    const deps: HandlerDeps = {
      modelClient: { create }, model: 'm', userId: 'u-fin', can: () => true,
      supabase: client as unknown as HandlerDeps['supabase'],
    };
    const events = await collect(agentChatHandler({ messages: [{ role: 'user', content: "What's overdue this week?" }] }, deps));

    const text = events.filter((e) => e.type === 'assistant').map((e) => e.text).join('\n');
    expect(text).toContain('— 1 task, 1 invoice');
    expect(text).toContain(`[Pour foundation](/projects/${P1}/tasks) — Harbor Tower · due 2 Oct (4 days late) · Budi`);
    expect(text).toContain('[ACC-SINV-2026-00012](/sales-invoices?q=ACC-SINV-2026-00012) — PT Client');

    const toolMsg = create.mock.calls[1][0].messages.at(-1);
    expect(toolMsg.role).toBe('tool');
    expect(JSON.parse(toolMsg.content)).toMatchObject({ ok: true, overdueTasks: 1, overdueInvoices: 1 });
    expect(toolMsg.content).not.toContain('Pour foundation');
    expect(events.some((e) => (e.payload as { label?: string } | undefined)?.label === "Checking what's overdue…")).toBe(true);
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/handlerOverdue.test.ts)` → FAIL (unknown action).

Step 3 — edits in `handler.ts`:
1. Import: `import { whatsOverdueAction } from './overdue.ts';`
2. `BASE_ACTIONS`: insert `whatsOverdueAction,` directly after `queryEntityAction,`.
3. `stepLabel`: add before `default:`
   ```ts
    case 'whats_overdue': return "Checking what's overdue…";
    case 'draft_invoice': return 'Preparing a draft invoice…';
   ```
4. Add above `// ── Event builders`:
   ```ts
   /** ADR-0079 §3: a coarse read tool's server-rendered answer — shown to the user verbatim; the model gets only
    *  `receipt`, so links and figures never depend on the model copying them. */
   export function isRenderedAnswer(r: unknown): r is { markdown: string; receipt: object } {
     if (!r || typeof r !== 'object') return false;
     const o = r as { markdown?: unknown; receipt?: unknown };
     return typeof o.markdown === 'string' && typeof o.receipt === 'object' && o.receipt !== null;
   }
   ```
5. In `runToolLoop`'s serial read branch (`// ── Read action (confirm:false) — dispatch immediately`), keep the
   `query_entity` widget block, and replace the following `yield emit('tool', …)` and `messages.push({…})` with:
   ```ts
      const rendered = isRenderedAnswer(toolResult) ? toolResult : null;
      const modelResult = rendered ? rendered.receipt : toolResult;
      yield emit('tool', { payload: { name: toolName, input: toolInput, result: modelResult } });
      if (rendered) yield emit('assistant', { text: rendered.markdown });

      // Append the single tool-result message for the next round (FR-MC-006).
      messages.push({ role: 'tool', tool_call_id: toolId, name: toolName, content: JSON.stringify(modelResult) });
   ```
6. In `agentChatHandlerInner`'s `deputyCtx` literal add `role: initialRole,` after `orgId,`.

Step 4 — `(cd pmo-portal && npx vitest run src/lib/agent/handlerOverdue.test.ts src/lib/agent/agentChatHandler.test.ts src/lib/agent/agentChatHandler.compose.test.ts src/lib/agent/handlerApprovals.test.ts)` → PASS.

#### A10 — Prompt: route "overdue" to `whats_overdue`
**Files:** `supabase/functions/agent-chat/prompt.ts`, `pmo-portal/src/lib/agent/prompt.experience.test.ts` · **Covers:** AC-AIN-017 (overdue half), FR-AIN-010

Step 1 — append to `prompt.experience.test.ts`:
```ts
it('AC-AIN-017 prompt routes "overdue" to whats_overdue, never to a tasks read', () => {
  const p = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, 'Finance');
  expect(p).toContain('- whats_overdue —');
  expect(p).toMatch(/### overdue — Use when the user asks what is overdue/);
  expect(p).toMatch(/"overdue"[^\n]*→ call `whats_overdue`/);
  expect(p).not.toMatch(/"overdue"[^\n]*→ query `tasks`/);
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/prompt.experience.test.ts)` → FAIL.

Step 3 — `prompt.ts`:
1. In `toolIndexLines`, after the `query_entity` line add:
   ```ts
    '- whats_overdue — ONE call answers "what\'s overdue?": the user\'s overdue tasks across their projects, plus overdue invoices when their role may see invoices. The list is shown to the user for you.',
   ```
2. Before `const composeSkill`, add:
   ```ts
  const overdueSkill = `

### overdue — Use when the user asks what is overdue, late, past due or behind
Call \`whats_overdue\` (no arguments). ONE call covers every project the user works on plus overdue invoices — do NOT query \`tasks\` project by project for this. The list is displayed to the user automatically; afterwards add at most one short sentence and do not repeat the list.`;
   ```
3. In the returned template, replace `\n\n### map-questions-to-entities` with `${overdueSkill}\n\n### map-questions-to-entities`.
4. In the tasks mapping bullet, delete `, "overdue"`, and insert directly above that bullet:
   ```
   - "overdue", "late", "past due", "behind", "what's slipping" → call \`whats_overdue\` (one call, no arguments) — never query_entity for this.
   ```
Step 4 — same command → PASS (every AC-AXP test stays green — no new text contains "notify" or a UUID).

#### A11 — Sales Invoices opens filtered by `?q=`
**Files:** `pmo-portal/pages/SalesInvoices.tsx`, `pmo-portal/pages/__tests__/SalesInvoices.deepLink.test.tsx` · **Covers:** AC-AIN-015, FR-AIN-009

Step 1 — failing test: copy `SalesInvoices.dueDate.test.tsx` lines 1–96 (imports, hoisted fixture, the four
`vi.mock` blocks, the component import) into `SalesInvoices.deepLink.test.tsx` (drop the unused `formatDateOnly`
and `Role` imports), then add:
```tsx
const renderAt = (url: string) =>
  render(
    <ImpersonationProvider realRole="Finance">
      <MemoryRouter initialEntries={[url]}>
        <ToastProvider>
          <SalesInvoices />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('SalesInvoices — deep link (#787)', () => {
  it('AC-AIN-015 ?q= seeds the search and filters the list to that invoice', () => {
    renderAt('/sales-invoices?q=ACC-SINV-2026-00002');
    expect(screen.getByDisplayValue('ACC-SINV-2026-00002')).toBeInTheDocument();
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('ACC-SINV-2026-00002');
    expect(table).not.toContain('ACC-SINV-2026-00001');
  });
  it('no ?q= → empty search, both invoices', () => {
    renderAt('/sales-invoices');
    const table = screen.getByRole('table').textContent ?? '';
    expect(table).toContain('ACC-SINV-2026-00001');
    expect(table).toContain('ACC-SINV-2026-00002');
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.deepLink.test.tsx)` → FAIL.

Step 3 — `SalesInvoices.tsx`: change `import { useNavigate } from 'react-router';` to
`import { useNavigate, useSearchParams } from 'react-router';`, and replace `const [search, setSearch] = useState('');` with:
```tsx
  // #787 (AC-AIN-015): the assistant links an overdue invoice as /sales-invoices?q=<number>; seed the search
  // from it once on mount. Typing afterwards is local state as before (the URL is not kept in sync).
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '');
```
Step 4 — `(cd pmo-portal && npx vitest run pages/__tests__/SalesInvoices.deepLink.test.tsx pages/__tests__/SalesInvoices.dueDate.test.tsx)` → PASS.

#### A12 — Eval harness: proposal scorer + repeated runs with a pass bar
**Files:** `pmo-portal/evals/harness/scorers.ts`, `pmo-portal/evals/harness/scorers.test.ts`, `pmo-portal/evals/harness/runEval.ts` · **Covers:** AC-AIN-003 (harness), NFR-AIN-QUAL-001

Step 1 — extend the `scorers.test.ts` import with `proposesAction, summarizeRuns` and append:
```ts
describe('proposesAction / summarizeRuns (#787)', () => {
  const run = (payload: object) => ({ toolCalls: [], answerText: '', events: [{ id: 'e', runId: 'r', type: 'status', createdAt: '', payload }] }) as never;
  it('passes on a needs-approval proposal for the named action and checks its args', async () => {
    const r = run({ status: 'needs-approval', actionName: 'draft_invoice', structuredArgs: { items: [{ rate: 5 }] } });
    expect((await proposesAction('draft_invoice')(r)).pass).toBe(true);
    expect((await proposesAction('draft_invoice', (a) => (a.items as Array<{ rate: number }>)[0].rate === 5)(r)).pass).toBe(true);
    expect((await proposesAction('draft_invoice', () => false)(r)).pass).toBe(false);
    expect((await proposesAction('create_activity')(r)).pass).toBe(false);
  });
  it('summarizeRuns applies the minimum-passes bar', () => {
    expect(summarizeRuns([true, true, false], 2)).toEqual({ pass: true, passes: 2, runs: 3 });
    expect(summarizeRuns([true, false, false], 2)).toEqual({ pass: false, passes: 1, runs: 3 });
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run evals/harness/scorers.test.ts)` → FAIL.

Step 3 — append to `scorers.ts`:
```ts
/**
 * `proposesAction(name, check?)` — passes iff the run ended in a `needs-approval` proposal for `name` (and, when
 * given, `check(structuredArgs)` holds). A confirm action emits no `tool` event until approved, so `usesTool`
 * cannot see a proposal — this scorer can. Free (no model call). #787 / AC-AIN-003.
 */
export function proposesAction(name: string, check?: (args: Record<string, unknown>) => boolean): Scorer {
  return (run) => {
    const proposal = run.events.find((e) => {
      const p = e.payload as { status?: string; actionName?: string } | undefined;
      return e.type === 'status' && p?.status === 'needs-approval' && p.actionName === name;
    });
    if (!proposal) {
      return { pass: false, reason: `expected a needs-approval proposal for "${name}"; tools: [${run.toolCalls.map((t) => t.name).join(', ') || 'none'}]` };
    }
    const args = (proposal.payload as { structuredArgs?: Record<string, unknown> }).structuredArgs ?? {};
    if (check && !check(args)) return { pass: false, reason: `proposal for "${name}" did not carry the expected arguments` };
    return { pass: true, reason: `run proposed "${name}"` };
  };
}

/** Repeated-run bar: a case passes iff at least `minPasses` of its runs passed (NFR-AIN-QUAL-001). */
export function summarizeRuns(results: boolean[], minPasses: number): { pass: boolean; passes: number; runs: number } {
  const passes = results.filter(Boolean).length;
  return { pass: passes >= minPasses, passes, runs: results.length };
}
```
In `runEval.ts`: add to `EvalCase` after `expect`:
```ts
  /** Repeat the case this many times (default 1). */
  runs?: number;
  /** Minimum passing runs (default = runs). */
  minPasses?: number;
```
add `summarizeRuns` to the `./scorers` import, and replace the non-skipped `it(c.name, async () => { … });` with:
```ts
      const runs = c.runs ?? 1;
      it(c.name, async () => {
        const results: boolean[] = [];
        const failures: string[] = [];
        for (let i = 0; i < runs; i++) {
          const run = await runEvalCase(c);
          const { pass, reasons } = await runScorers(c.expect, run);
          results.push(pass);
          if (!pass) failures.push(`run ${i + 1}: ${reasons.join(' | ')}`);
        }
        const verdict = summarizeRuns(results, c.minPasses ?? runs);
        expect(verdict.pass, `passed ${verdict.passes}/${verdict.runs} (need ${c.minPasses ?? runs}). ${failures.slice(0, 3).join(' || ')}`).toBe(true);
      }, runs * 60_000);
```
Step 4 — `(cd pmo-portal && npx vitest run evals/harness/scorers.test.ts && npm run typecheck)` → PASS.

#### A13 — Eval case: the overdue journey; fixture contract
**Files:** `pmo-portal/evals/cases/invoice-reach.eval.ts`, `pmo-portal/evals/README.md` · **Covers:** AC-AIN-003 (overdue)

Step 1/3 — create `invoice-reach.eval.ts`:
```ts
/**
 * #787 — assistant invoice reach, against the DEPLOYED agent (ADR-0052). Proposal-only: no case approves, so an
 * eval run never creates an ERP document (DD-AIN-9). Fixture contract: evals/README.md § "Invoice-reach fixture".
 */
import { contains, usesTool } from '../harness/scorers';
import { defineEvalSuite, runEvalSuite } from '../harness/runEval';

const RUNS = 10;
const MIN_PASSES = 9; // DD-AIN-9 — owner question 1

export default runEvalSuite(
  defineEvalSuite({
    name: 'assistant invoice reach (#787)',
    cases: [
      {
        name: 'AC-AIN-003 AC-AIN-001 "what\'s overdue this week" → whats_overdue with task + invoice links',
        prompt: "What's overdue this week?",
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [
          usesTool('whats_overdue'),
          contains(/\]\(\/projects\/[0-9a-f-]{36}\/tasks\)/i),
          contains(/\]\(\/sales-invoices\?q=[^)]+\)/),
        ],
      },
    ],
  }),
);
```
Append to `evals/README.md`:
```md
## Invoice-reach fixture (#787)

`evals/cases/invoice-reach.eval.ts` expects the eval test user to be a **Finance** user in an org where:
Revenue is switched on; revenue is owned by an ERPNext binding whose catalogue has exactly **one** sales item;
there is ≥1 open task past its end date on a project, and ≥1 Unpaid invoice past its due date; work order
`WO-EVAL-0001` is **Issued**, tax-exclusive, value 1,000,000.00; project `EVAL-P1` has ≥2 milestones.
The suite only proposes — it never approves — so it never creates an ERP document.
```
Step 2/4 — `(cd pmo-portal && npx vitest run --config vitest.eval.config.ts evals/cases/invoice-reach.eval.ts)`
without the eval env → the case reports **skipped**, exit 0 (graceful-skip contract); `npm run typecheck` → 0.

### Slice B

#### B1 — Tax re-basing as a dependency-free leaf (no behaviour change)
**Files:** `pmo-portal/src/lib/taxNormalize.ts`, `pmo-portal/src/lib/taxTreatment.ts`, `pmo-portal/src/lib/taxNormalize.test.ts` · **Covers:** AC-AIN-014 (enabler)

Step 1 — failing test `taxNormalize.test.ts`:
```ts
import { expect, it } from 'vitest';
import { normalizeTaxAmount } from './taxNormalize';
import { normalizeTaxAmount as viaTaxTreatment } from './taxTreatment';

it('AC-AIN-014 inclusive 1,110,000 with 110,000 tax re-bases to 1,000,000 before tax; one implementation', () => {
  expect(normalizeTaxAmount(1_110_000, 110_000, 'inclusive', 'exclusive')).toBe(1_000_000);
  expect(normalizeTaxAmount(1_000_000, 110_000, 'exclusive', 'exclusive')).toBe(1_000_000);
  expect(normalizeTaxAmount(10, 20, 'inclusive', 'exclusive')).toBeNull();
  expect(viaTaxTreatment).toBe(normalizeTaxAmount);
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/taxNormalize.test.ts)` → FAIL.

Step 3 — create `src/lib/taxNormalize.ts` by **moving** (cut, not copy) from `taxTreatment.ts`, verbatim:
`isTaxTreatment` (with its doc comment), `decimalUnits` (now `export function decimalUnits`), and
`normalizeTaxAmount` (with its doc comment), under the header:
```ts
/**
 * taxNormalize.ts — the read-only tax re-basing, as a dependency-free LEAF so the agent edge function (Deno) can
 * import it (#787). Moved verbatim from taxTreatment.ts, which re-exports it — one implementation, two importers.
 */
```
In `taxTreatment.ts` add after the existing imports:
```ts
import { decimalUnits, isTaxTreatment, normalizeTaxAmount } from './taxNormalize';
export { isTaxTreatment, normalizeTaxAmount };
```
Step 4 — `(cd pmo-portal && npx vitest run src/lib/taxNormalize.test.ts src/lib/taxTreatment.normalization.test.ts && npm run typecheck)` → PASS.

#### B2 — One builder for the sales-invoice create record (FE + agent)
**Files:** `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts`, `.../salesInvoiceCommand.test.ts`, `pmo-portal/src/lib/repositories/index.ts` · **Covers:** FR-AIN-025 (one command shape)

Step 1 — failing test `salesInvoiceCommand.test.ts`:
```ts
import { expect, it } from 'vitest';
import { salesInvoiceCreateFields } from './salesInvoiceCommand';

it('FR-AIN-025 builds the create record the dispatch expects, adding only erp_doc_kind', () => {
  const items = [{ item_code: 'SVC', qty: 1, rate: 100 }];
  expect(salesInvoiceCreateFields({ customerId: 'c', projectId: 'p', items }))
    .toEqual({ customerId: 'c', projectId: 'p', items, erp_doc_kind: 'sales-invoice' });
  expect(salesInvoiceCreateFields({ customerId: 'c', items, reference_number: 'PO-1' }))
    .toEqual({ customerId: 'c', items, reference_number: 'PO-1', erp_doc_kind: 'sales-invoice' });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/salesInvoiceCommand.test.ts)` → FAIL.

Step 3 — create `salesInvoiceCommand.ts`:
```ts
/**
 * salesInvoiceCommand.ts — the ONE builder of a sales-invoice CREATE command's fields, shared by the FE
 * repository (revenue.createInvoice) and the agent's draft_invoice (#787, ADR-0079 §4), so the two clients of
 * the money path can never send different shapes. Leaf (no imports): Deno-importable. The caller adds `id`.
 */
export interface SalesInvoiceLine { item_code: string; qty: number; rate: number; description?: string }
export interface SalesInvoiceCreateInput {
  customerId: string;
  projectId?: string | null;
  items: SalesInvoiceLine[];
  /** Client PO / contract ref (→ ERPNext po_no). Omit to let the dispatch fall back to the work order / project. */
  reference_number?: string | null;
}
export function salesInvoiceCreateFields(input: SalesInvoiceCreateInput): Record<string, unknown> {
  return { ...input, erp_doc_kind: 'sales-invoice' };
}
```
In `repositories/index.ts` add `import { salesInvoiceCreateFields } from '@/src/lib/adapterSeam/erpnext/salesInvoiceCommand';`
and change `dispatchCreate('revenue', { ...input, erp_doc_kind: 'sales-invoice' }, intent)` to
`dispatchCreate('revenue', salesInvoiceCreateFields(input), intent)`.

Step 4 — `(cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/salesInvoiceCommand.test.ts src/lib/repositories/revenue.external.test.ts src/lib/repositories/commandIntent.test.ts)` → PASS.

#### B3 — `agentCan` as a tested module, with the sales-invoice rule
**Files:** `supabase/functions/agent-chat/agentCan.ts`, `supabase/functions/agent-chat/index.ts`, `pmo-portal/src/lib/agent/agentCan.test.ts` · **Covers:** AC-AIN-010 (preflight)

Step 1 — failing test `agentCan.test.ts`:
```ts
import { expect, it } from 'vitest';
import { agentCan } from '../../../../supabase/functions/agent-chat/agentCan';

it('AC-AIN-010 salesInvoice create is Finance/Admin only', () => {
  expect(agentCan('create', 'salesInvoice', { realRole: 'Finance' })).toBe(true);
  expect(agentCan('create', 'salesInvoice', { realRole: 'Admin' })).toBe(true);
  for (const r of ['Project Manager', 'Executive', 'Engineer']) expect(agentCan('create', 'salesInvoice', { realRole: r })).toBe(false);
  expect(agentCan('create', 'salesInvoice', { realRole: null })).toBe(false);
});
it('the two shipped rules are unchanged; anything else is denied', () => {
  expect(agentCan('create', 'contactActivity', { realRole: 'Project Manager' })).toBe(true);
  expect(agentCan('create', 'contactActivity', { realRole: 'Engineer' })).toBe(false);
  expect(agentCan('edit', 'taskStatus', { realRole: 'Engineer' })).toBe(true);
  expect(agentCan('edit', 'taskStatus', { realRole: 'Finance' })).toBe(false);
  expect(agentCan('transition', 'salesInvoice', { realRole: 'Finance' })).toBe(false);
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/agentCan.test.ts)` → FAIL.

Step 3 — create `agentCan.ts`:
```ts
/**
 * agentCan.ts — the agent's deputy-reauth preflight (FR-AW-010), extracted from index.ts so it is unit-tested.
 * UX-only (ADR-0016): RLS and adapter-dispatch are the authorities. Role sets come from agentRoles.ts, which is
 * drift-guarded against policy.ts and authGuard.ts.
 */
import {
  AGENT_MASTER_DATA_ROLES,
  AGENT_DELIVERY_WITH_ENGINEER_ROLES,
  AGENT_REVENUE_WRITE_ROLES,
} from '../../../pmo-portal/src/auth/agentRoles.ts';

export function agentCan(action: string, entity: string, ctx: { realRole: string | null }): boolean {
  const role = ctx.realRole;
  if (!role) return false;
  if (entity === 'contactActivity' && action === 'create') return AGENT_MASTER_DATA_ROLES.includes(role);
  if (entity === 'taskStatus' && action === 'edit') return AGENT_DELIVERY_WITH_ENGINEER_ROLES.includes(role);
  if (entity === 'salesInvoice' && action === 'create') return AGENT_REVENUE_WRITE_ROLES.includes(role);
  return false;
}
```
In `index.ts`: delete the `AGENT_MASTER_DATA_ROLES`/`AGENT_DELIVERY_WITH_ENGINEER_ROLES` import, the two `Set`s and
the inline `agentCan`; add `import { agentCan } from './agentCan.ts';` (the `can: agentCan` field is unchanged).

Step 4 — `(cd pmo-portal && npx vitest run src/lib/agent/agentCan.test.ts) && bash scripts/deno-typecheck-edge-fns.sh` → PASS.

#### B4 — `draft_invoice` request schema + validation
**Files:** `supabase/functions/agent-chat/schema.ts`, `supabase/functions/agent-chat/draftInvoice.ts`, `pmo-portal/src/lib/agent/draftInvoice.request.test.ts` · **Covers:** FR-AIN-020

Step 1 — failing test `draftInvoice.request.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { validateDraftRequest } from '../../../../supabase/functions/agent-chat/draftInvoice';

describe('validateDraftRequest (#787)', () => {
  it('FR-AIN-020 needs exactly one of workOrder / milestone', () => {
    expect(validateDraftRequest({ workOrder: ' WO-1 ' })).toEqual({ ok: true, value: { workOrder: 'WO-1' } });
    expect(validateDraftRequest({ milestone: '2', project: 'P' })).toEqual({ ok: true, value: { milestone: '2', project: 'P' } });
    expect(validateDraftRequest({})).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'a', milestone: 'b' })).toMatchObject({ ok: false });
  });
  it('rejects bad amounts and oversized text', () => {
    expect(validateDraftRequest({ workOrder: 'a', amount: 0 })).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'a', amount: 1.005 })).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'x'.repeat(101) })).toMatchObject({ ok: false });
    expect(validateDraftRequest({ workOrder: 'a', amount: 5_000_000, itemCode: 'SVC' }))
      .toEqual({ ok: true, value: { workOrder: 'a', amount: 5_000_000, itemCode: 'SVC' } });
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/draftInvoice.request.test.ts)` → FAIL.

Step 3 — append to `schema.ts`:
```ts
/** draft_invoice (#787, ADR-0079) — the model's REQUEST; the server resolves it before the chip. */
export const DRAFT_INVOICE_SCHEMA = {
  type: 'object' as const,
  required: [] as string[],
  additionalProperties: false,
  properties: {
    workOrder: { type: 'string' as const, maxLength: 100, description: 'Work order number (e.g. WO-20261001-001) or its title. Give this OR milestone.' },
    milestone: { type: 'string' as const, maxLength: 100, description: 'Milestone name, or its number within the project (e.g. "2"). Give this OR workOrder.' },
    project: { type: 'string' as const, maxLength: 200, description: 'Project id, number, code or name. Use the context-hint id when the user is on a project page.' },
    amount: { type: 'number' as const, exclusiveMinimum: 0, description: 'Amount to invoice BEFORE tax — only if the user stated it. Needed for a milestone.' },
    itemCode: { type: 'string' as const, maxLength: 140, description: 'ERPNext item code — only if the user named or picked one.' },
  },
};
```
Create `draftInvoice.ts`:
```ts
/**
 * draft_invoice — the ONE coarse write tool for "invoice this work order / milestone" (#787, ADR-0079).
 *
 *   request → validate → prepare (server-side resolution under the CALLER's JWT) → chip shows the resolved draft
 *   → approve → validatePrepared (allow-list rebuild of the replayed draft) → run: adapter-dispatch create.
 *
 * It only ever CREATES. A sales invoice created through adapter-dispatch is an ERPNext Draft (docstatus 0)
 * authored by the caller; submitting it is a separate SoD-gated act by a DIFFERENT Finance/Admin user. No code
 * path here sends a transition (NFR-AIN-SEC-003, mutation-checked in draftInvoice.run.test.ts).
 */
import { isMoney } from './agentFormat.ts';

export interface DraftInvoiceRequest {
  workOrder?: string; milestone?: string; project?: string; amount?: number; itemCode?: string;
}

/** undefined/blank → null (absent); non-string or too long → false (invalid). */
function text(v: unknown, max: number): string | null | false {
  if (v === undefined) return null;
  if (typeof v !== 'string') return false;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? false : t;
}

export function validateDraftRequest(
  input: unknown,
): { ok: true; value: DraftInvoiceRequest } | { ok: false; error: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const workOrder = text(i.workOrder, 100);
  const milestone = text(i.milestone, 100);
  const project = text(i.project, 200);
  const itemCode = text(i.itemCode, 140);
  if (workOrder === false || milestone === false || project === false || itemCode === false) {
    return { ok: false, error: 'text fields must be short strings' };
  }
  if (!!workOrder === !!milestone) return { ok: false, error: 'give exactly one of workOrder or milestone' };
  if (i.amount !== undefined && !isMoney(i.amount)) {
    return { ok: false, error: 'amount must be a positive number with at most 2 decimals' };
  }
  return {
    ok: true,
    value: {
      ...(workOrder ? { workOrder } : {}),
      ...(milestone ? { milestone } : {}),
      ...(project ? { project } : {}),
      ...(i.amount !== undefined ? { amount: i.amount as number } : {}),
      ...(itemCode ? { itemCode } : {}),
    },
  };
}
```
Step 4 — same command → PASS.

#### B5 — The prepared draft: allow-list validation and the chip summary; shared fixture `PREPARED`
**Files:** `supabase/functions/agent-chat/draftInvoice.ts`, `pmo-portal/src/lib/agent/testing/draftInvoiceFixtures.ts`, `pmo-portal/src/lib/agent/draftInvoice.request.test.ts` · **Covers:** AC-AIN-011 (unit), FR-AIN-024

Step 1 — create `testing/draftInvoiceFixtures.ts` (grown in B6):
```ts
/** Shared #787 draft-invoice fixtures. Test files import THIS, never each other (importing a test file re-runs its suites). */
import type { DraftInvoicePrepared } from '../../../../../supabase/functions/agent-chat/draftInvoice';

export const P1 = '11111111-1111-4111-8111-111111111111';
export const C1 = '22222222-2222-4222-8222-222222222222';

export const PREPARED: DraftInvoicePrepared = {
  kind: 'prepared-draft-invoice',
  commandId: '00000000-0000-4000-8000-000000000001',
  idempotencyKey: '00000000-0000-4000-8000-000000000002',
  customerId: C1,
  projectId: P1,
  items: [{ item_code: 'SVC', qty: 1, rate: 1_000_000, description: 'WO-20261001-001 — Phase 2 survey' }],
  reference_number: 'PO-778',
  display: { customerName: 'PT Client', projectName: 'Harbor Tower', sourceLabel: 'WO-20261001-001', amountText: 'IDR 1,000,000.00' },
};
```
Append to `draftInvoice.request.test.ts` (extend the import with `validatePreparedDraft, summarizeDraft`; add
`import { PREPARED } from './testing/draftInvoiceFixtures';`):
```ts
describe('validatePreparedDraft / summarizeDraft (#787)', () => {
  it('AC-AIN-011 rebuilds from the allow-list, dropping smuggled fields', () => {
    const forged = { ...PREPARED, verb: 'submit', operation: 'transition', author_user_id: 'x', items: [{ ...PREPARED.items[0], verb: 'submit' }] };
    expect(validatePreparedDraft(forged)).toEqual({ ok: true, value: PREPARED });
  });
  it('refuses a malformed prepared draft', () => {
    expect(validatePreparedDraft({ ...PREPARED, kind: 'x' })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, customerId: 'not-a-uuid' })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, items: [{ ...PREPARED.items[0], qty: 2 }] })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, items: [{ ...PREPARED.items[0], rate: -1 }] })).toMatchObject({ ok: false });
    expect(validatePreparedDraft({ ...PREPARED, items: [] })).toMatchObject({ ok: false });
  });
  it('FR-AIN-024 the summary is ≤120 chars and says Draft / not submitted', () => {
    expect(summarizeDraft(PREPARED)).toBe('Save as Draft: invoice PT Client IDR 1,000,000.00 excl. tax for WO-20261001-001. Not submitted.');
    const long = { ...PREPARED, display: { ...PREPARED.display, customerName: 'C'.repeat(80), sourceLabel: 'S'.repeat(80), amountText: 'A'.repeat(40) } };
    expect(summarizeDraft(long).length).toBeLessThanOrEqual(120);
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/draftInvoice.request.test.ts)` → FAIL.

Step 3 — append to `draftInvoice.ts` (add `import { UUID_RE } from './looseClient.ts';`):
```ts
export interface DraftInvoiceLine { item_code: string; qty: 1; rate: number; description: string }
export interface DraftInvoicePrepared {
  kind: 'prepared-draft-invoice';
  commandId: string;
  idempotencyKey: string;
  customerId: string;
  projectId: string;
  items: [DraftInvoiceLine];
  reference_number: string | null;
  display: { customerName: string; projectName: string; sourceLabel: string; amountText: string };
}

const bad = (error: string) => ({ ok: false as const, error });
const shortText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** ADR-0079 §2: the REPLAYED draft is client-controlled — rebuild it from an allow-list (AC-AIN-011). */
export function validatePreparedDraft(
  input: unknown,
): { ok: true; value: DraftInvoicePrepared } | { ok: false; error: string } {
  const p = (input ?? {}) as Record<string, unknown>;
  if (p.kind !== 'prepared-draft-invoice') return bad('not a prepared draft invoice');
  for (const k of ['commandId', 'idempotencyKey', 'customerId', 'projectId']) {
    if (typeof p[k] !== 'string' || !UUID_RE.test(p[k] as string)) return bad(`${k} must be a uuid`);
  }
  const items = Array.isArray(p.items) ? p.items : [];
  if (items.length !== 1) return bad('exactly one line is required');
  const line = (items[0] ?? {}) as Record<string, unknown>;
  if (!shortText(line.item_code, 140) || !line.item_code.trim()) return bad('item_code is required');
  if (line.qty !== 1) return bad('qty must be 1');
  if (!isMoney(line.rate)) return bad('rate must be a positive amount with at most 2 decimals');
  if (!shortText(line.description, 140)) return bad('description must be at most 140 characters');
  const ref = p.reference_number ?? null;
  if (ref !== null && !shortText(ref, 140)) return bad('reference_number is invalid');
  const d = (p.display ?? {}) as Record<string, unknown>;
  const fields = ['customerName', 'projectName', 'sourceLabel', 'amountText'] as const;
  if (!fields.every((f) => shortText(d[f], 200))) return bad('display is invalid');
  return {
    ok: true,
    value: {
      kind: 'prepared-draft-invoice',
      commandId: p.commandId as string,
      idempotencyKey: p.idempotencyKey as string,
      customerId: p.customerId as string,
      projectId: p.projectId as string,
      items: [{ item_code: (line.item_code as string).trim(), qty: 1, rate: line.rate as number, description: line.description as string }],
      reference_number: ref as string | null,
      display: {
        customerName: d.customerName as string,
        projectName: d.projectName as string,
        sourceLabel: d.sourceLabel as string,
        amountText: d.amountText as string,
      },
    },
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** FR-AIN-024: server-composed chip text, ≤120 chars (ApprovalChip truncates at 120). */
export function summarizeDraft(p: DraftInvoicePrepared): string {
  return `Save as Draft: invoice ${clip(p.display.customerName, 23)} ${clip(p.display.amountText, 22)} excl. tax for ${clip(p.display.sourceLabel, 20)}. Not submitted.`;
}
```
Step 4 — same command → PASS.

#### B6 — `prepare`, step 1: who, and whether invoicing is possible here; shared resolver fixtures
**Files:** `supabase/functions/agent-chat/draftInvoice.ts`, `pmo-portal/src/lib/agent/testing/draftInvoiceFixtures.ts`, `pmo-portal/src/lib/agent/draftInvoice.prepare.test.ts` · **Covers:** AC-AIN-007, FR-AIN-022

Step 1 — append to `testing/draftInvoiceFixtures.ts`:
```ts
import type { FakeCall, Invoker } from './fakeSupabase';

export const WO = { id: '33333333-3333-4333-8333-333333333333', wo_number: 'WO-20261001-001', title: 'Phase 2 survey', project_id: P1, status: 'Issued', order_value: 1_110_000, tax_amount: 110_000, tax_treatment: 'inclusive', currency: 'IDR', client_po_number: 'PO-778' };
export const PROJECT = { id: P1, name: 'Harbor Tower', client_id: C1, currency: 'IDR' };

type Over = Partial<Record<string, (c: FakeCall) => unknown>>;
/** A Finance-ready org: Revenue on, ERPNext-owned revenue, one Issued WO, a project with a linked client. */
export function world(o: Over = {}) {
  return (c: FakeCall) => {
    const hit = o[c.table];
    if (hit) return { data: hit(c), error: null };
    switch (c.table) {
      case 'org_features': return { data: { enabled: true }, error: null };
      case 'external_domain_ownership': return { data: [{ external_tier: 'erpnext' }], error: null };
      case 'work_orders': return { data: [WO], error: null };
      case 'project_milestones': return { data: [{ id: 'm-1', name: 'Design', project_id: P1, sort_order: 1 }, { id: 'm-2', name: 'Foundation', project_id: P1, sort_order: 2 }], error: null };
      case 'projects': return { data: c.terminal === 'maybeSingle' ? PROJECT : [PROJECT], error: null };
      case 'companies': return { data: { name: 'PT Client' }, error: null };
      case 'external_refs': return { data: [{ external_record_id: 'Customer:PT Client' }], error: null };
      case 'organizations': return { data: { default_locale: 'en-US', default_number_locale: 'en-US' }, error: null };
      default: return { data: null, error: null };
    }
  };
}
export const oneItem: Invoker = async (name) =>
  name === 'external-items' ? { data: { items: [{ code: 'SVC', name: 'Services' }] }, error: null } : { data: null, error: { message: 'unexpected' } };
export const ctx = (role: string, client: unknown) => ({ jwt: '', userId: 'u-fin', orgId: 'org-1', role, supabase: client as never });
let seq = 0;
export const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
```
Create `draftInvoice.prepare.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { prepareDraftInvoice } from '../../../../supabase/functions/agent-chat/draftInvoice';
import { fakeSupabase, opsOf } from './testing/fakeSupabase';
import { ctx, newId, oneItem, world } from './testing/draftInvoiceFixtures';

describe('prepareDraftInvoice — gate (#787)', () => {
  it.each(['Project Manager', 'Executive', 'Engineer'])('AC-AIN-007 %s is refused before any lookup', async (role) => {
    const { client, calls, invoke } = fakeSupabase(world(), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx(role, client), newId);
    expect(out).toEqual({ ok: false, error: { error: 'Only Finance or Admin can raise an invoice.' } });
    expect(calls).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('Revenue off → refused', async () => {
    const { client } = fakeSupabase(world({ org_features: () => ({ enabled: false }) }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'x' }, ctx('Finance', client), newId))
      .toEqual({ ok: false, error: { error: 'Invoicing is not turned on for this organisation.' } });
  });
  it('revenue not on ERPNext → refused (#784 not shipped)', async () => {
    const { client, calls } = fakeSupabase(world({ external_domain_ownership: () => [] }), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'x' }, ctx('Admin', client), newId);
    expect(out).toMatchObject({ ok: false, error: { error: expect.stringMatching(/not connected revenue to ERPNext/) } });
    expect(opsOf(calls, 'external_domain_ownership')[0]).toEqual([['eq', 'domain', 'revenue'], ['eq', 'external_tier', 'erpnext'], ['limit', 1]]);
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/draftInvoice.prepare.test.ts)` → FAIL.

Step 3 — in `draftInvoice.ts` add imports
`import type { DeputyContext } from '../../../pmo-portal/src/lib/agent/runtime/port.ts';`,
`import { AGENT_REVENUE_WRITE_ROLES } from '../../../pmo-portal/src/auth/agentRoles.ts';`, and widen the looseClient
import to `asLoose, readOne, readRows, UUID_RE, type LooseClient`; then append:
```ts
export type Candidate = { id: string; label: string };
/** A refusal the model can act on (FR-AIN-023). A type alias (not an interface) so it fits PrepareResult. */
export type PrepareRefusal = { error: string; needs?: 'amount' | 'itemCode' | 'choice'; candidates?: Candidate[] };
export type Resolved<T> = { ok: true; value: T } | { ok: false; error: PrepareRefusal };
export type PrepareOutcome = { ok: true; value: DraftInvoicePrepared; summary: string } | { ok: false; error: PrepareRefusal };

export const refuse = (error: string, needs?: PrepareRefusal['needs'], candidates?: Candidate[]) => ({
  ok: false as const,
  error: { error, ...(needs ? { needs } : {}), ...(candidates?.length ? { candidates: candidates.slice(0, 8) } : {}) } as PrepareRefusal,
});

/** DD-AIN-3: Finance/Admin only; Revenue on; revenue owned by ERPNext (the only create path until #784). */
async function gate(sb: LooseClient, ctx: DeputyContext): Promise<PrepareRefusal | null> {
  if (!ctx.role || !AGENT_REVENUE_WRITE_ROLES.includes(ctx.role)) return { error: 'Only Finance or Admin can raise an invoice.' };
  const [feature, owned] = await Promise.all([
    readOne<{ enabled: boolean }>(sb.from('org_features').select('enabled').eq('feature_key', 'revenue').maybeSingle()),
    readRows<{ external_tier: string }>(
      sb.from('external_domain_ownership').select('external_tier').eq('domain', 'revenue').eq('external_tier', 'erpnext').limit(1),
    ),
  ]);
  if (feature?.enabled !== true) return { error: 'Invoicing is not turned on for this organisation.' };
  if (owned.length === 0) return { error: 'Invoices are raised in ERPNext, and this organisation has not connected revenue to ERPNext yet.' };
  return null;
}

export async function prepareDraftInvoice(
  req: DraftInvoiceRequest,
  ctx: DeputyContext,
  newId: () => string = () => crypto.randomUUID(),
): Promise<PrepareOutcome> {
  const sb = asLoose(ctx.supabase);
  const denied = await gate(sb, ctx);
  if (denied) return { ok: false, error: denied };
  void req;
  void newId;
  return refuse('Not resolvable yet.');
}
```
Step 4 — same command → PASS. (B11 replaces the three lines after `if (denied)`.)

#### B7 — `prepare`: resolve the project term
**Files:** `draftInvoice.ts`, `draftInvoice.prepare.test.ts` · **Covers:** FR-AIN-021/023

Step 1 — append (extend imports: `resolveProject` from draftInvoice; `import { asLoose } from '../../../../supabase/functions/agent-chat/looseClient';`;
`P1, PROJECT` from the fixtures):
```ts
describe('resolveProject (#787)', () => {
  it('a uuid matches by id', async () => {
    const { client, calls } = fakeSupabase(world());
    expect(await resolveProject(asLoose(client), P1)).toEqual({ ok: true, value: PROJECT });
    expect(opsOf(calls, 'projects')[0]).toContainEqual(['eq', 'id', P1]);
  });
  it('an exact project number wins before a name search', async () => {
    const { client, calls } = fakeSupabase(world({ projects: (c) => (c.ops.some((o) => o[1] === 'pmo_project_number') ? [PROJECT] : []) }));
    expect(await resolveProject(asLoose(client), 'PRJ-0001')).toEqual({ ok: true, value: PROJECT });
    expect(calls.some((c) => c.ops.some((o) => o[0] === 'ilike'))).toBe(false);
  });
  it('an ambiguous name returns choice candidates; wildcards are stripped', async () => {
    const two = [PROJECT, { ...PROJECT, id: 'p-2', name: 'Harbor Annex' }];
    const { client, calls } = fakeSupabase(world({ projects: (c) => (c.ops.some((o) => o[0] === 'ilike') ? two : []) }));
    expect(await resolveProject(asLoose(client), 'Harbor%')).toEqual({ ok: false, error: { error: 'Which project?', needs: 'choice', candidates: [{ id: P1, label: 'Harbor Tower' }, { id: 'p-2', label: 'Harbor Annex' }] } });
    expect(calls.at(-1)?.ops).toContainEqual(['ilike', 'name', '%Harbor%']);
  });
  it('no match → plain refusal', async () => {
    const { client } = fakeSupabase(world({ projects: () => [] }));
    expect(await resolveProject(asLoose(client), 'Nope')).toEqual({ ok: false, error: { error: 'No project matches "Nope".' } });
  });
});
```
Step 2 — same command → FAIL.

Step 3 — add `toLikeTerm` to the looseClient import and append:
```ts
export interface ProjectRow { id: string; name: string; client_id: string | null; currency: string }
const PROJECT_COLS = 'id, name, client_id, currency';
const CANDIDATE_LIMIT = 6;

export async function resolveProject(sb: LooseClient, term: string): Promise<Resolved<ProjectRow>> {
  const live = () => sb.from('projects').select(PROJECT_COLS).is('archived_at', null);
  if (UUID_RE.test(term)) {
    const rows = await readRows<ProjectRow>(live().eq('id', term).limit(1));
    return rows[0] ? { ok: true, value: rows[0] } : refuse('That project was not found.');
  }
  for (const column of ['pmo_project_number', 'code']) {
    const rows = await readRows<ProjectRow>(live().eq(column, term).limit(2));
    if (rows.length === 1) return { ok: true, value: rows[0] };
  }
  const like = toLikeTerm(term);
  const rows = like ? await readRows<ProjectRow>(live().ilike('name', `%${like}%`).limit(CANDIDATE_LIMIT)) : [];
  if (rows.length === 1) return { ok: true, value: rows[0] };
  if (rows.length === 0) return refuse(`No project matches "${term}".`);
  return refuse('Which project?', 'choice', rows.map((p) => ({ id: p.id, label: p.name })));
}
```
Step 4 — same command → PASS.

#### B8 — `prepare`: resolve the work order (status rule)
**Files:** `draftInvoice.ts`, `draftInvoice.prepare.test.ts` · **Covers:** AC-AIN-009

Step 1 — append (import `resolveWorkOrder`; `WO` from fixtures):
```ts
describe('resolveWorkOrder (#787)', () => {
  it('matches the number case-insensitively first, scoped to the project when known', async () => {
    const { client, calls } = fakeSupabase(world());
    expect(await resolveWorkOrder(asLoose(client), 'wo-20261001-001%', PROJECT)).toEqual({ ok: true, value: WO });
    expect(opsOf(calls, 'work_orders')[0]).toEqual(expect.arrayContaining([['ilike', 'wo_number', 'wo-20261001-001'], ['eq', 'project_id', P1]]));
  });
  it('falls back to a title search', async () => {
    const { client, calls } = fakeSupabase(world({ work_orders: (c) => (c.ops.some((o) => o[1] === 'title') ? [WO] : []) }));
    expect(await resolveWorkOrder(asLoose(client), 'survey', null)).toEqual({ ok: true, value: WO });
    expect(opsOf(calls, 'work_orders')[1]).toContainEqual(['ilike', 'title', '%survey%']);
  });
  it('AC-AIN-009 two matches → choice candidates', async () => {
    const { client } = fakeSupabase(world({ work_orders: () => [WO, { ...WO, id: 'w2', wo_number: 'WO-2', title: 'B' }] }));
    expect(await resolveWorkOrder(asLoose(client), 'WO', null)).toEqual({ ok: false, error: { error: 'Which work order?', needs: 'choice', candidates: [
      { id: 'WO-20261001-001', label: 'WO-20261001-001 — Phase 2 survey' }, { id: 'WO-2', label: 'WO-2 — B' }] } });
  });
  it.each(['Draft', 'Cancelled'])('AC-AIN-009 a %s work order is refused', async (status) => {
    const { client } = fakeSupabase(world({ work_orders: () => [{ ...WO, status }] }));
    expect(await resolveWorkOrder(asLoose(client), 'WO-20261001-001', null)).toEqual({ ok: false, error: {
      error: `WO-20261001-001 — Phase 2 survey is ${status}; only an Issued or Closed work order can be invoiced.` } });
  });
  it('Closed is invoiceable (DD-AIN-4)', async () => {
    const { client } = fakeSupabase(world({ work_orders: () => [{ ...WO, status: 'Closed' }] }));
    expect(await resolveWorkOrder(asLoose(client), 'WO-20261001-001', null)).toMatchObject({ ok: true });
  });
});
```
Step 2 — same command → FAIL.

Step 3 — add `type LooseQuery` to the looseClient import and append:
```ts
export interface WorkOrderRow {
  id: string; wo_number: string | null; title: string; project_id: string; status: string;
  order_value: number; tax_amount: number; tax_treatment: string; currency: string; client_po_number: string | null;
}
const WO_COLS = 'id, wo_number, title, project_id, status, order_value, tax_amount, tax_treatment, currency, client_po_number';
const INVOICEABLE_WO_STATUSES = ['Issued', 'Closed'];
export const woLabel = (w: WorkOrderRow) => `${w.wo_number ?? 'Work order'} — ${w.title}`;

export async function resolveWorkOrder(sb: LooseClient, term: string, project: ProjectRow | null): Promise<Resolved<WorkOrderRow>> {
  const like = toLikeTerm(term);
  if (!like) return refuse(`No work order matches "${term}".`);
  const scoped = (q: LooseQuery) => (project ? q.eq('project_id', project.id) : q);
  let rows = await readRows<WorkOrderRow>(scoped(sb.from('work_orders').select(WO_COLS).ilike('wo_number', like)).limit(CANDIDATE_LIMIT));
  if (rows.length === 0) {
    rows = await readRows<WorkOrderRow>(scoped(sb.from('work_orders').select(WO_COLS).ilike('title', `%${like}%`)).limit(CANDIDATE_LIMIT));
  }
  if (rows.length === 0) return refuse(`No work order matches "${term}".`);
  if (rows.length > 1) return refuse('Which work order?', 'choice', rows.map((w) => ({ id: w.wo_number ?? w.id, label: woLabel(w) })));
  const wo = rows[0];
  if (!INVOICEABLE_WO_STATUSES.includes(wo.status)) {
    return refuse(`${woLabel(wo)} is ${wo.status}; only an Issued or Closed work order can be invoiced.`);
  }
  return { ok: true, value: wo };
}
```
Step 4 — same command → PASS.

#### B9 — `prepare`: resolve the milestone (name or position)
**Files:** `draftInvoice.ts`, `draftInvoice.prepare.test.ts` · **Covers:** AC-AIN-008 (position half)

Step 1 — append (import `resolveMilestone`):
```ts
describe('resolveMilestone (#787)', () => {
  it('AC-AIN-008 "milestone 2" on a project = the second in project order', async () => {
    const { client, calls } = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(client), 'milestone 2', PROJECT)).toMatchObject({ ok: true, value: { id: 'm-2' } });
    expect(opsOf(calls, 'project_milestones')[0]).toEqual(expect.arrayContaining([['eq', 'project_id', P1], ['order', 'sort_order', { ascending: true }]]));
  });
  it('a position with no project → asks which project', async () => {
    const { client } = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(client), '2', null)).toEqual({ ok: false, error: { error: 'Which project is the milestone on?', needs: 'choice' } });
  });
  it('a position past the end → plain refusal', async () => {
    const { client } = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(client), 'M5', PROJECT)).toEqual({ ok: false, error: { error: 'Harbor Tower has 2 milestones; there is no milestone 5.' } });
  });
  it('a name matches by ilike; two matches → choice', async () => {
    const one = fakeSupabase(world({ project_milestones: () => [{ id: 'm-2', name: 'Foundation', project_id: P1, sort_order: 2 }] }));
    expect(await resolveMilestone(asLoose(one.client), 'Found', null)).toMatchObject({ ok: true, value: { id: 'm-2' } });
    const two = fakeSupabase(world());
    expect(await resolveMilestone(asLoose(two.client), 'n', null)).toMatchObject({ ok: false, error: { needs: 'choice' } });
  });
});
```
Step 2 — same command → FAIL.

Step 3 — append to `draftInvoice.ts`:
```ts
export interface MilestoneRow { id: string; name: string; project_id: string; sort_order: number }
const MS_COLS = 'id, name, project_id, sort_order';
const POSITION_RE = /^(?:m|milestone)?\s*#?\s*(\d{1,3})$/i;

export async function resolveMilestone(sb: LooseClient, term: string, project: ProjectRow | null): Promise<Resolved<MilestoneRow>> {
  const pos = POSITION_RE.exec(term.trim());
  if (pos) {
    if (!project) return refuse('Which project is the milestone on?', 'choice');
    const all = await readRows<MilestoneRow>(
      sb.from('project_milestones').select(MS_COLS).eq('project_id', project.id)
        .order('sort_order', { ascending: true }).order('created_at', { ascending: true }).limit(200),
    );
    const n = Number(pos[1]);
    const m = all[n - 1];
    return m ? { ok: true, value: m } : refuse(`${project.name} has ${all.length} milestones; there is no milestone ${n}.`);
  }
  const like = toLikeTerm(term);
  if (!like) return refuse(`No milestone matches "${term}".`);
  let q = sb.from('project_milestones').select(MS_COLS).ilike('name', `%${like}%`);
  if (project) q = q.eq('project_id', project.id);
  const rows = await readRows<MilestoneRow>(q.limit(CANDIDATE_LIMIT));
  if (rows.length === 1) return { ok: true, value: rows[0] };
  if (rows.length === 0) return refuse(`No milestone matches "${term}".`);
  return refuse('Which milestone?', 'choice', rows.map((m) => ({ id: m.name, label: m.name })));
}
```
Step 4 — same command → PASS.

#### B10 — `prepare`: resolve the ERP item
**Files:** `draftInvoice.ts`, `draftInvoice.prepare.test.ts` · **Covers:** DD-AIN-5, FR-AIN-023

Step 1 — append (import `resolveItem`; `import type { Invoker } from './testing/fakeSupabase';`):
```ts
describe('resolveItem (#787)', () => {
  it('a named item is used without reading the catalogue', async () => {
    const { client, invoke } = fakeSupabase(world(), oneItem);
    expect(await resolveItem(ctx('Finance', client), 'SVC-2')).toEqual({ ok: true, value: 'SVC-2' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('the only sales item is used', async () => {
    const { client, invoke } = fakeSupabase(world(), oneItem);
    expect(await resolveItem(ctx('Finance', client))).toEqual({ ok: true, value: 'SVC' });
    expect(invoke).toHaveBeenCalledWith('external-items', { body: { purpose: 'sales' } });
  });
  it('several items → itemCode candidates; none → refusal; unreadable → asks', async () => {
    const many: Invoker = async () => ({ data: { items: [{ code: 'A', name: 'Alpha' }, { code: 'B', name: 'Beta' }] }, error: null });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), many).client))).toEqual({ ok: false, error: {
      error: 'Which ERPNext item should the invoice use?', needs: 'itemCode', candidates: [{ id: 'A', label: 'A — Alpha' }, { id: 'B', label: 'B — Beta' }] } });
    const none: Invoker = async () => ({ data: { items: [] }, error: null });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), none).client))).toMatchObject({ ok: false, error: { error: expect.stringMatching(/no sales item/) } });
    const broken: Invoker = async () => ({ data: null, error: { message: 'x' } });
    expect(await resolveItem(ctx('Finance', fakeSupabase(world(), broken).client))).toMatchObject({ ok: false, error: { needs: 'itemCode' } });
  });
});
```
Step 2 — same command → FAIL.

Step 3 — add `asFunctions, withTimeout` to the looseClient import and append:
```ts
export const ITEM_CATALOG_TIMEOUT_MS = 10_000;

/** DD-AIN-5: the named item; else the org's only sales item; else ask (candidates are ask_user options). */
export async function resolveItem(ctx: DeputyContext, named?: string): Promise<Resolved<string>> {
  if (named) return { ok: true, value: named }; // adapter-dispatch's item preflight validates it at create time
  const fns = asFunctions(ctx.supabase);
  if (!fns) return refuse('Which ERPNext item should the invoice use?', 'itemCode');
  let items: Array<{ code: string; name: string }> | undefined;
  try {
    const { data, error } = await withTimeout(
      fns.functions.invoke('external-items', { body: { purpose: 'sales' } }),
      ITEM_CATALOG_TIMEOUT_MS,
    );
    items = error ? undefined : (data as { items?: Array<{ code: string; name: string }> } | null)?.items;
  } catch {
    items = undefined;
  }
  if (!items) return refuse('I could not read the ERPNext item list. Which item code should the invoice use?', 'itemCode');
  if (items.length === 0) return refuse('ERPNext has no sales item to bill against. Ask an admin to add one.');
  if (items.length > 1) {
    return refuse('Which ERPNext item should the invoice use?', 'itemCode', items.map((i) => ({ id: i.code, label: `${i.code} — ${i.name}` })));
  }
  return { ok: true, value: items[0].code };
}
```
Step 4 — same command → PASS.

#### B11 — `prepare`: assemble the draft (amount before tax, client link, identity, summary)
**Files:** `draftInvoice.ts`, `draftInvoice.prepare.test.ts` · **Covers:** AC-AIN-014, AC-AIN-008 (amount half), FR-AIN-021/024

Step 1 — append (`C1` from fixtures):
```ts
describe('prepareDraftInvoice — assembled draft (#787)', () => {
  it('AC-AIN-014 a tax-inclusive work order proposes its value before tax, with PO reference and summary', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', client), newId);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.value).toMatchObject({
      kind: 'prepared-draft-invoice', customerId: C1, projectId: P1, reference_number: 'PO-778',
      items: [{ item_code: 'SVC', qty: 1, rate: 1_000_000, description: 'WO-20261001-001 — Phase 2 survey' }],
      display: { customerName: 'PT Client', projectName: 'Harbor Tower', sourceLabel: 'WO-20261001-001' },
    });
    expect(out.value.commandId).not.toBe(out.value.idempotencyKey);
    expect(out.summary).toMatch(/^Save as Draft: invoice PT Client .* excl\. tax for WO-20261001-001\. Not submitted\.$/);
  });
  it('a stated amount wins over the work order value', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    const out = await prepareDraftInvoice({ workOrder: 'WO-20261001-001', amount: 400_000 }, ctx('Admin', client), newId);
    expect(out.ok && out.value.items[0].rate).toBe(400_000);
  });
  it('AC-AIN-008 a milestone without an amount asks for one; with one, proposes it', async () => {
    const { client } = fakeSupabase(world(), oneItem);
    expect(await prepareDraftInvoice({ milestone: '2', project: P1 }, ctx('Finance', client), newId)).toEqual({ ok: false, error: {
      error: "Milestones don't carry an amount yet. How much should this invoice be, before tax?", needs: 'amount' } });
    const out = await prepareDraftInvoice({ milestone: '2', project: P1, amount: 5_000_000 }, ctx('Finance', client), newId);
    expect(out.ok && out.value).toMatchObject({ reference_number: null, items: [{ rate: 5_000_000, description: 'Harbor Tower — Foundation' }] });
  });
  it('a client not linked to ERPNext, or no client, is refused before the chip', async () => {
    const unlinked = fakeSupabase(world({ external_refs: () => [] }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', unlinked.client), newId))
      .toEqual({ ok: false, error: { error: 'PT Client is not linked to ERPNext yet, so an invoice cannot be raised for them.' } });
    const noClient = fakeSupabase(world({ projects: () => ({ ...PROJECT, client_id: null }) }), oneItem);
    expect(await prepareDraftInvoice({ workOrder: 'WO-20261001-001' }, ctx('Finance', noClient.client), newId))
      .toEqual({ ok: false, error: { error: 'Harbor Tower has no client, so there is no one to invoice.' } });
  });
});
```
Step 2 — same command → FAIL.

Step 3 — add imports `import { normalizeTaxAmount } from '../../../pmo-portal/src/lib/taxNormalize.ts';` and widen the
agentFormat import to `formatMoney, isMoney, resolveNumberLocale`; in `prepareDraftInvoice` replace
`void req;` / `void newId;` / `return refuse('Not resolvable yet.');` with:
```ts
  let project: ProjectRow | null = null;
  if (req.project) {
    const p = await resolveProject(sb, req.project);
    if (!p.ok) return p;
    project = p.value;
  }

  type Source = { kind: 'workOrder'; wo: WorkOrderRow } | { kind: 'milestone'; ms: MilestoneRow };
  let source: Source;
  if (req.workOrder) {
    const r = await resolveWorkOrder(sb, req.workOrder, project);
    if (!r.ok) return r;
    source = { kind: 'workOrder', wo: r.value };
  } else {
    const r = await resolveMilestone(sb, req.milestone ?? '', project);
    if (!r.ok) return r;
    source = { kind: 'milestone', ms: r.value };
  }
  const sourceProjectId = source.kind === 'workOrder' ? source.wo.project_id : source.ms.project_id;
  if (!project || project.id !== sourceProjectId) {
    project = await readOne<ProjectRow>(sb.from('projects').select(PROJECT_COLS).eq('id', sourceProjectId).maybeSingle());
    if (!project) return refuse('The project for that item was not found.');
  }
  const clientId = project.client_id;
  if (!clientId) return refuse(`${project.name} has no client, so there is no one to invoice.`);

  const [customer, erpLink, org] = await Promise.all([
    readOne<{ name: string }>(sb.from('companies').select('name').eq('id', clientId).maybeSingle()),
    readRows<{ external_record_id: string }>(
      sb.from('external_refs').select('external_record_id').eq('domain', 'companies').eq('pmo_record_id', clientId).limit(1),
    ),
    readOne<{ default_locale: string | null; default_number_locale: string | null }>(
      sb.from('organizations').select('default_locale, default_number_locale').eq('id', ctx.orgId).maybeSingle(),
    ),
  ]);
  if (erpLink.length === 0) {
    return refuse(`${customer?.name ?? 'This client'} is not linked to ERPNext yet, so an invoice cannot be raised for them.`);
  }

  // DD-AIN-4: a stated amount wins; else a work order's value BEFORE tax from its own recorded tax facts.
  let rate: number | null = req.amount ?? null;
  if (rate === null && source.kind === 'workOrder') {
    const wo = source.wo;
    rate = normalizeTaxAmount(Number(wo.order_value), Number(wo.tax_amount), wo.tax_treatment, 'exclusive');
  }
  if (rate === null) {
    return source.kind === 'milestone'
      ? refuse("Milestones don't carry an amount yet. How much should this invoice be, before tax?", 'amount')
      : refuse(`I can't work out ${woLabel(source.wo)}'s value before tax. How much should this invoice be, before tax?`, 'amount');
  }
  if (!isMoney(rate)) return refuse('The amount to invoice must be more than zero.', 'amount');

  const item = await resolveItem(ctx, req.itemCode);
  if (!item.ok) return item;

  const currency = source.kind === 'workOrder' ? source.wo.currency : project.currency;
  const description = (source.kind === 'workOrder' ? woLabel(source.wo) : `${project.name} — ${source.ms.name}`).slice(0, 140);
  const sourceLabel = source.kind === 'workOrder' ? source.wo.wo_number ?? source.wo.title : source.ms.name;
  const value: DraftInvoicePrepared = {
    kind: 'prepared-draft-invoice',
    commandId: newId(),
    idempotencyKey: newId(),
    customerId: clientId,
    projectId: project.id,
    items: [{ item_code: item.value, qty: 1, rate, description }],
    reference_number: source.kind === 'workOrder' ? source.wo.client_po_number ?? null : null,
    display: {
      customerName: customer?.name ?? 'the client',
      projectName: project.name,
      sourceLabel,
      amountText: formatMoney(rate, currency, resolveNumberLocale(org)),
    },
  };
  return { ok: true, value, summary: summarizeDraft(value) };
```
Step 4 — `(cd pmo-portal && npx vitest run src/lib/agent/draftInvoice.prepare.test.ts src/lib/agent/draftInvoice.request.test.ts)` → PASS.

#### B12 — `run`: send the create through adapter-dispatch as the caller; the action object
**Files:** `draftInvoice.ts`, `pmo-portal/src/lib/agent/draftInvoice.run.test.ts` · **Covers:** AC-AIN-016, NFR-AIN-SEC-003, FR-AIN-025/026/027

Step 1 — failing test `draftInvoice.run.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_INVOICE_DISPATCH_TIMEOUT_MS, draftInvoiceAction, runDraftInvoice } from '../../../../supabase/functions/agent-chat/draftInvoice';
import { PREPARED } from './testing/draftInvoiceFixtures';
import { fakeSupabase, type Invoker } from './testing/fakeSupabase';

const ctx = (invoke: Invoker) => ({ jwt: '', userId: 'u-fin', orgId: 'org-1', role: 'Finance', supabase: fakeSupabase(() => ({ data: null, error: null }), invoke).client as never });
afterEach(() => vi.useRealTimers());

describe('runDraftInvoice (#787)', () => {
  it('NFR-AIN-SEC-003 sends exactly one revenue CREATE with the proposal identity — never a transition', async () => {
    const invoke = vi.fn<Invoker>(async () => ({ data: { canonical: { id: PREPARED.commandId, si_number: 'ACC-SINV-2026-00099' } }, error: null }));
    const out = await runDraftInvoice(PREPARED, ctx(invoke));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('adapter-dispatch', { body: {
      domain: 'revenue', operation: 'create', idempotencyKey: PREPARED.idempotencyKey,
      record: { customerId: PREPARED.customerId, projectId: PREPARED.projectId, items: PREPARED.items, reference_number: 'PO-778', erp_doc_kind: 'sales-invoice', id: PREPARED.commandId },
    } });
    expect(JSON.stringify(invoke.mock.calls[0][1])).not.toMatch(/submit|transition|verb/);
    expect(out).toMatchObject({ ok: true, status: 'Draft', siNumber: 'ACC-SINV-2026-00099', link: '/sales-invoices?q=ACC-SINV-2026-00099' });
  });
  it('AC-AIN-016 a dispatch rejection surfaces its message, never ok', async () => {
    const invoke: Invoker = async () => ({ data: null, error: { context: new Response(JSON.stringify({ error: 'commit-rejected', message: 'project is not mapped in ERPNext' }), { status: 422 }) } });
    expect(await runDraftInvoice(PREPARED, ctx(invoke))).toEqual({ error: 'project is not mapped in ERPNext', code: 'commit-rejected' });
  });
  it('AC-AIN-016 a 25 s timeout tells the user to check before asking again', async () => {
    vi.useFakeTimers();
    const p = runDraftInvoice(PREPARED, ctx(() => new Promise(() => {})));
    await vi.advanceTimersByTimeAsync(DRAFT_INVOICE_DISPATCH_TIMEOUT_MS + 1);
    expect(await p).toEqual({ error: 'ERPNext did not answer in time. The draft may still appear — check Sales Invoices before asking again.', code: 'external-unreachable' });
  });
  it('an invalid replayed draft is refused without dispatching', async () => {
    const invoke = vi.fn<Invoker>();
    expect(await runDraftInvoice({ ...PREPARED, kind: 'x' }, ctx(invoke))).toEqual({ error: 'not a prepared draft invoice' });
    expect(invoke).not.toHaveBeenCalled();
  });
  it('the action always chips and carries prepare + validatePrepared', () => {
    expect(draftInvoiceAction).toMatchObject({ name: 'draft_invoice', confirm: true });
    expect(draftInvoiceAction.needsApproval?.({}, {} as never)).toBe(true);
    expect(typeof draftInvoiceAction.prepare).toBe('function');
    expect(typeof draftInvoiceAction.validatePrepared).toBe('function');
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/draftInvoice.run.test.ts)` → FAIL.

Step 3 — add imports `type AgentAction` (port), `salesInvoiceCreateFields` from
`'../../../pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceCommand.ts'`, `DRAFT_INVOICE_SCHEMA` from
`./schema.ts`; append:
```ts
export const DRAFT_INVOICE_DISPATCH_TIMEOUT_MS = 25_000;

async function readDispatchError(error: unknown): Promise<{ message: string; code?: string }> {
  const res = (error as { context?: Response } | null)?.context;
  if (res && typeof res.clone === 'function') {
    try {
      const body = (await res.clone().json()) as { error?: string; message?: string };
      if (typeof body.message === 'string' && body.message.trim()) {
        return { message: body.message, ...(body.error ? { code: body.error } : {}) };
      }
    } catch {
      /* fall through to the generic message */
    }
  }
  return { message: 'The invoice could not be saved.' };
}

/** Approval execution: ONE revenue CREATE through the served write path, as the caller (ADR-0079 §4). */
export async function runDraftInvoice(input: unknown, ctx: DeputyContext): Promise<unknown> {
  const v = validatePreparedDraft(input);
  if (v.ok === false) return { error: v.error };
  const fns = asFunctions(ctx.supabase);
  if (!fns) return { error: 'The invoice could not be saved.' };
  const p = v.value;
  const body = {
    domain: 'revenue',
    operation: 'create', // NFR-AIN-SEC-003: the ONLY operation this tool may ever send.
    record: {
      ...salesInvoiceCreateFields({
        customerId: p.customerId,
        projectId: p.projectId,
        items: p.items,
        ...(p.reference_number ? { reference_number: p.reference_number } : {}),
      }),
      id: p.commandId,
    },
    idempotencyKey: p.idempotencyKey,
  };
  let out: { data: unknown; error: unknown };
  try {
    out = await withTimeout(fns.functions.invoke('adapter-dispatch', { body }), DRAFT_INVOICE_DISPATCH_TIMEOUT_MS);
  } catch {
    return { error: 'ERPNext did not answer in time. The draft may still appear — check Sales Invoices before asking again.', code: 'external-unreachable' };
  }
  if (out.error) {
    const { message, code } = await readDispatchError(out.error);
    return { error: message, ...(code ? { code } : {}) };
  }
  const canonical = (out.data as { canonical?: { id?: unknown; si_number?: unknown } } | null)?.canonical;
  const siNumber = typeof canonical?.si_number === 'string' ? canonical.si_number : null;
  return {
    ok: true,
    status: 'Draft',
    id: typeof canonical?.id === 'string' ? canonical.id : p.commandId,
    siNumber,
    link: siNumber ? `/sales-invoices?q=${encodeURIComponent(siNumber)}` : '/sales-invoices',
    note: "Saved as a Draft under the user's name. It is NOT submitted; a different Finance or Admin user submits it.",
  };
}

export const draftInvoiceAction: AgentAction & {
  validate: typeof validateDraftRequest;
  summarize: (i: unknown) => string;
} = {
  name: 'draft_invoice',
  description:
    'Prepare a DRAFT sales invoice for a work order or project milestone, for the user to confirm. Saves as Draft only — never submits or approves.',
  inputSchema: DRAFT_INVOICE_SCHEMA,
  surfaces: ['agent'],
  confirm: true,
  needsApproval: () => true,
  validate: validateDraftRequest,
  prepare: (input, ctx) => prepareDraftInvoice(input as DraftInvoiceRequest, ctx),
  validatePrepared: validatePreparedDraft,
  // Only reached if a caller bypasses `prepare` — the handler always uses prepare's summary.
  summarize: () => 'Save a draft invoice. Not submitted.',
  run: runDraftInvoice,
};
```
Step 4 — same command → PASS. **Mutation check:** change `operation: 'create'` to `'transition'` → the first test
goes red; revert.

#### B13 — Prompt: `draft_invoice` index line + skill, gated (before the handler passes the option)
**Files:** `supabase/functions/agent-chat/prompt.ts`, `pmo-portal/src/lib/agent/prompt.experience.test.ts` · **Covers:** AC-AIN-017 (draft half), FR-AIN-028

Step 1 — append to `prompt.experience.test.ts`:
```ts
it('AC-AIN-017 draft_invoice is advertised only when enabled, and never claims approval', () => {
  const on = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, 'Finance', { invoiceDraftsEnabled: true });
  expect(on).toContain('- draft_invoice —');
  expect(on).toMatch(/### draft-invoice — Use when the user asks to invoice or bill/);
  expect(on).toMatch(/call `ask_user` with those candidates/);
  expect(on).toMatch(/NEVER say an invoice is approved or submitted/);
  const off = buildAgentSystemPrompt(ENTITIES as unknown as never, ROW_CAP, 'Finance', { invoiceDraftsEnabled: false });
  expect(off).not.toContain('draft_invoice');
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/prompt.experience.test.ts)` → FAIL.

Step 3 — `prompt.ts`:
1. `AgentPromptOptions`: add `invoiceDraftsEnabled?: boolean;`; in the body add
   `const invoiceDraftsEnabled = opts.invoiceDraftsEnabled === true;`
2. `toolIndexLines`, after the `update_task_status` line:
   ```ts
    invoiceDraftsEnabled
      ? '- draft_invoice — prepare a DRAFT sales invoice for a work order or project milestone. Write action — goes through the approve/deny chip; it saves as Draft and is never submitted.'
      : '',
   ```
3. After `overdueSkill`, add:
   ```ts
  const invoiceSkill = invoiceDraftsEnabled
    ? `

### draft-invoice — Use when the user asks to invoice or bill a work order or a milestone
Call \`draft_invoice\` with \`workOrder\` (its number like WO-… or its title) OR \`milestone\` (its name, or its number in the project such as "2"), plus \`project\` when known (use the context-hint id when the user is on a project page). Pass \`amount\` only when the user stated it (before tax) and \`itemCode\` only when the user named or picked one. If it returns \`needs\` with \`candidates\`, call \`ask_user\` with those candidates as the options, then call \`draft_invoice\` again with the chosen id; if it asks for an amount, ask the user. The user confirms on the approve/deny chip. NEVER say an invoice is approved or submitted — it is saved as a Draft only after the user confirms, and a different Finance or Admin user submits it.`
    : '';
   ```
4. Change `${overdueSkill}\n\n### map-questions-to-entities` to `${overdueSkill}${invoiceSkill}\n\n### map-questions-to-entities`.

Step 4 — same command → PASS.

#### B14 — Handler: `prepare` before the chip, `validatePrepared` on approve, permission mapping, kill switch
**Files:** `supabase/functions/agent-chat/handler.ts`, `pmo-portal/src/lib/agent/handlerDraftInvoice.test.ts` · **Covers:** **AC-AIN-002 (owning)**, AC-AIN-010, AC-AIN-011, AC-AIN-007 (handler), FR-AIN-024/025

Step 1 — failing test `handlerDraftInvoice.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { agentChatHandler, type HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';
import { fakeSupabase, type FakeCall, type Invoker } from './testing/fakeSupabase';
import { C1, P1, world } from './testing/draftInvoiceFixtures';

async function collect(it: AsyncIterable<AgentEvent>) { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; }
const toolCall = (name: string, args: object) => ({ finish_reason: 'tool_calls', usage: {}, model: 'm',
  message: { role: 'assistant', content: null, tool_calls: [{ id: 'tc-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }] } });
const stop = (text: string) => ({ finish_reason: 'stop', usage: {}, model: 'm', message: { role: 'assistant', content: text } });

function setup(role: string) {
  const base = world();
  const respond = (c: FakeCall) => (c.table === 'profiles' ? { data: { org_id: 'org-1', role }, error: null } : base(c));
  const invoke = vi.fn<Invoker>(async (name) => name === 'external-items'
    ? { data: { items: [{ code: 'SVC', name: 'Services' }] }, error: null }
    : { data: { canonical: { id: 'si-new', si_number: 'ACC-SINV-2026-00099' } }, error: null });
  return { ...fakeSupabase(respond, invoke), invoke };
}
const deps = (client: unknown, create: ReturnType<typeof vi.fn>, can: HandlerDeps['can'] = vi.fn(() => true)): HandlerDeps =>
  ({ modelClient: { create }, model: 'm', userId: 'u-fin', can, supabase: client as HandlerDeps['supabase'] });
const USER = { role: 'user' as const, content: 'Invoice work order WO-20261001-001' };

async function propose(role = 'Finance') {
  const s = setup(role);
  const create = vi.fn().mockResolvedValueOnce(toolCall('draft_invoice', { workOrder: 'WO-20261001-001' })).mockResolvedValueOnce(stop('Only Finance can.'));
  const events = await collect(agentChatHandler({ runId: 'run-1', messages: [USER] }, deps(s.client, create)));
  const chip = events.find((e) => (e.payload as { status?: string } | undefined)?.status === 'needs-approval');
  return { ...s, create, events, chip: chip?.payload as { pendingId: string; humanSummary: string; structuredArgs: Record<string, unknown> } | undefined };
}
const approveReq = (pendingId: string, args: object) => ({
  runId: 'run-1',
  decision: { pendingId, verdict: 'approve' as const },
  messages: [USER, { role: 'assistant' as const, content: [{ type: 'tool_use', id: pendingId, name: 'draft_invoice', input: args }] }],
}) as never;
const dispatchBody = (invoke: ReturnType<typeof setup>['invoke']) =>
  (invoke.mock.calls.find(([name]) => name === 'adapter-dispatch')?.[1] as { body: Record<string, unknown> } | undefined)?.body;

describe('draft_invoice through the handler (#787)', () => {
  it('AC-AIN-002 proposes the resolved Draft, then approval sends one CREATE as the caller', async () => {
    const { chip, invoke, client } = await propose();
    expect(chip?.humanSummary).toMatch(/^Save as Draft: invoice PT Client .* Not submitted\.$/);
    expect(chip?.structuredArgs).toMatchObject({ kind: 'prepared-draft-invoice', customerId: C1, projectId: P1, items: [{ rate: 1_000_000 }] });
    expect(dispatchBody(invoke)).toBeUndefined();

    const can = vi.fn(() => true);
    const create = vi.fn().mockResolvedValueOnce(stop('Saved as a draft.'));
    const events = await collect(agentChatHandler(approveReq(chip!.pendingId, chip!.structuredArgs), deps(client, create, can)));
    expect(can).toHaveBeenCalledWith('create', 'salesInvoice', { realRole: 'Finance' });
    expect(invoke.mock.calls.filter(([name]) => name === 'adapter-dispatch')).toHaveLength(1);
    expect(dispatchBody(invoke)).toMatchObject({ domain: 'revenue', operation: 'create', idempotencyKey: chip!.structuredArgs.idempotencyKey,
      record: { id: chip!.structuredArgs.commandId, erp_doc_kind: 'sales-invoice', customerId: C1, projectId: P1 } });
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ payload: { name: 'draft_invoice', result: { ok: true, status: 'Draft' } } });
  });

  it('AC-AIN-007 a PM gets the refusal, no chip, no dispatch', async () => {
    const { chip, invoke, create } = await propose('Project Manager');
    expect(chip).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
    expect(JSON.parse(create.mock.calls[1][0].messages.at(-1).content)).toEqual({ error: 'Only Finance or Admin can raise an invoice.' });
  });

  it('AC-AIN-010 role lost before approval → PERMISSION_DENIED, nothing dispatched', async () => {
    const { chip, invoke, client } = await propose();
    const events = await collect(agentChatHandler(approveReq(chip!.pendingId, chip!.structuredArgs), deps(client, vi.fn(), vi.fn(() => false))));
    expect(events.some((e) => (e.payload as { error?: string } | undefined)?.error === 'PERMISSION_DENIED')).toBe(true);
    expect(dispatchBody(invoke)).toBeUndefined();
  });

  it('AC-AIN-011 smuggled fields in the replayed args never reach the dispatch', async () => {
    const { chip, invoke, client } = await propose();
    const forged = { ...chip!.structuredArgs, verb: 'submit', operation: 'transition', author_user_id: 'someone-else' };
    await collect(agentChatHandler(approveReq(chip!.pendingId, forged), deps(client, vi.fn().mockResolvedValueOnce(stop('ok')))));
    const body = dispatchBody(invoke);
    expect(body?.operation).toBe('create');
    expect(JSON.stringify(body)).not.toMatch(/verb|submit|transition|author_user_id/);
  });
});
```
Step 2 — `(cd pmo-portal && npx vitest run src/lib/agent/handlerDraftInvoice.test.ts)` → FAIL.

Step 3 — edits in `handler.ts`:
1. Import `import { draftInvoiceAction } from './draftInvoice.ts';`
2. Replace the `BASE_ACTIONS` declaration with:
   ```ts
   /** #787 kill switch: AGENT_INVOICE_DRAFTS=false removes draft_invoice without a redeploy (default ON; ON in
    *  a Deno-less test context, mirroring AUTOMATIONS_ENABLED). */
   const INVOICE_DRAFTS_ENABLED = denoGlobal === undefined || denoGlobal.env.get('AGENT_INVOICE_DRAFTS') !== 'false';
   const BASE_ACTIONS: AgentAction[] = [
     queryEntityAction,
     whatsOverdueAction,
     createActivityAction,
     updateTaskStatusAction,
     ...(INVOICE_DRAFTS_ENABLED ? [draftInvoiceAction] : []),
     ...(AUTOMATIONS_ENABLED ? [notifyAction, createAutomationAction] : []),
   ];
   ```
3. `getPermissionCheck`: add `case 'draft_invoice': return { action: 'create', entity: 'salesInvoice' };`
4. `runToolLoop` propose branch — replace from `const requiresApproval = resolveNeedsApproval(action, validation.value, deputyCtx);`
   through the `return;` that ends the `if (requiresApproval) { … }` block with:
   ```ts
        // ADR-0079 §2: resolve the proposal on the server BEFORE the chip — the chip shows the resolved record,
        // and that record (replayed by the client) is exactly what an approval executes.
        let proposalArgs: unknown = validation.value;
        let proposalSummary: string | null = null;
        if (action.prepare) {
          let prepared: Awaited<ReturnType<NonNullable<AgentAction['prepare']>>>;
          try {
            prepared = await action.prepare(validation.value, deputyCtx);
          } catch {
            prepared = { ok: false, error: { error: 'The request could not be prepared right now.' } };
          }
          if (prepared.ok === false) {
            messages.push({ role: 'tool', tool_call_id: toolId, name: toolName, content: JSON.stringify(prepared.error) });
            continue;
          }
          proposalArgs = prepared.value;
          proposalSummary = prepared.summary;
        }
        // A prepared action ALWAYS chips: its auto-approve path would execute the unresolved request.
        const requiresApproval = action.prepare ? true : resolveNeedsApproval(action, validation.value, deputyCtx);
        if (requiresApproval) {
          const pendingId = makeId();
          const humanSummary = proposalSummary ?? writeAction.summarize(validation.value);
          yield statusEvent('needs-approval', {
            pendingId,
            actionName: action.name,
            humanSummary,
            structuredArgs: proposalArgs as object,
          });
          return;
        }
   ```
5. `handleDecision` approve path — replace `const validation = writeAction.validate(toolInput);` with:
   ```ts
  // ADR-0079 §2: a prepared action's replayed input IS the resolved record the user saw — validate THAT
  // (allow-list rebuild), never the original model request.
  const validation: { ok: boolean; error?: string; value?: unknown } = action.validatePrepared
    ? action.validatePrepared(toolInput)
    : writeAction.validate(toolInput);
   ```
6. Add `invoiceDraftsEnabled: INVOICE_DRAFTS_ENABLED,` to the options object of all three `buildAgentSystemPrompt(...)` calls.

Step 4 — `(cd pmo-portal && npx vitest run src/lib/agent/handlerDraftInvoice.test.ts src/lib/agent/handlerApprovals.test.ts src/lib/agent/agentWriteActions.test.ts src/lib/agent/handlerTrailingToolUse.test.ts src/lib/agent/handlerPersistence.test.ts src/lib/agent/handlerOverdue.test.ts src/lib/agent/prompt.experience.test.ts) && bash scripts/deno-typecheck-edge-fns.sh && bash scripts/deno-boot-smoke-edge-fns.sh`
→ PASS.

#### B15 — Eval cases: the two draft journeys
**Files:** `pmo-portal/evals/cases/invoice-reach.eval.ts` · **Covers:** AC-AIN-003 (draft)

Step 1/3 — change the scorer import to `import { contains, proposesAction, usesTool } from '../harness/scorers';` and
append to `cases`:
```ts
      {
        name: 'AC-AIN-003 AC-AIN-002 "invoice work order WO-EVAL-0001" → proposes the Draft at its value before tax',
        prompt: 'Invoice work order WO-EVAL-0001.',
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [
          proposesAction('draft_invoice', (a) =>
            a.kind === 'prepared-draft-invoice' && (a.items as Array<{ rate: number }>)[0]?.rate === 1_000_000),
        ],
      },
      {
        name: 'AC-AIN-003 AC-AIN-002 "invoice milestone 2 on EVAL-P1 for 5,000,000" → proposes the Draft',
        prompt: 'Invoice milestone 2 on project EVAL-P1 for 5,000,000 before tax.',
        runs: RUNS,
        minPasses: MIN_PASSES,
        expect: [proposesAction('draft_invoice', (a) => (a.items as Array<{ rate: number }>)[0]?.rate === 5_000_000)],
      },
```
Step 2/4 — `(cd pmo-portal && npx vitest run --config vitest.eval.config.ts evals/cases/invoice-reach.eval.ts && npm run typecheck)`
→ 3 cases skipped without the eval env, exit 0; typecheck 0.

### Slice C

#### C1 — Local final gate (per slice, before its PR)
```
cd pmo-portal && npm run typecheck
cd pmo-portal && npx eslint --max-warnings=0 <every touched .ts/.tsx under pmo-portal and supabase/functions/agent-chat>
cd pmo-portal && ../scripts/with-test-lock.sh npx vitest run --changed origin/dev
bash scripts/deno-typecheck-edge-fns.sh && bash scripts/deno-boot-smoke-edge-fns.sh && bash scripts/deno-test-edge-fns.sh
```
No DB reset, no pgTAP (no migration). Reviewers: spec, code-quality, security (focus: replayed-args trust, the
`create`-only invariant, markdown escaping, `ilike` sanitising, caller-JWT only). Discover pass for A11 only (render
`/sales-invoices?q=…` on rich seed).

#### C2 — Deploy + eval (owner-gated) and the model decision
1. Owner per-instance yes to deploy **`agent-chat` and `agent-dispatch`** (the latter imports the handler) to the
   hosted project, per `docs/environments.md`. Back-to-front: no DB step; edge fns; A11's FE change can follow
   independently (links still land on Sales Invoices without it).
2. Provision the eval org per `evals/README.md` § "Invoice-reach fixture" (owner question 4).
3. `(cd pmo-portal && npm run test:evals -- evals/cases/invoice-reach.eval.ts)` with the eval env from process env
   (names in `evals/harness/runEval.ts`; never from files).
4. **≥9/10 on all three cases** → AC-AIN-003 green; record date, model id and per-case passes in the PR.
   **Below the bar** → per OD-REEL-1, run the same suite against a candidate tool-calling model on a local
   `supabase functions serve` (`EVAL_AGENT_CHAT_URL` at localhost, model via the existing default-model setting),
   bring the comparison to the owner, and change the deployed model only on their yes.

---

## 4. Traceability

| Task | AC / requirement |
|---|---|
| A1 | AC-AIN-004, AC-AIN-007 (role sets, drift-guarded) |
| A2 | enables AC-AIN-002/004 |
| A3 | AC-AIN-012, FR-AIN-002 |
| A4 | NFR-AIN-SEC-002 |
| A5 | test seam |
| A6 | AC-AIN-004, AC-AIN-005, FR-AIN-003 |
| A7 | AC-AIN-013, AC-AIN-006, AC-AIN-005, AC-AIN-004, FR-AIN-004/005 |
| A8 | FR-AIN-006/007/008, NFR-AIN-PERF-001 |
| A9 | **AC-AIN-001** |
| A10 | AC-AIN-017, FR-AIN-010 |
| A11 | AC-AIN-015, FR-AIN-009 |
| A12 | AC-AIN-003 (harness), NFR-AIN-QUAL-001 |
| A13 | AC-AIN-003 (overdue) |
| B1 | AC-AIN-014 (enabler) |
| B2 | FR-AIN-025 (one command shape) |
| B3 | AC-AIN-010 |
| B4 | FR-AIN-020 |
| B5 | AC-AIN-011, FR-AIN-024 |
| B6 | AC-AIN-007, FR-AIN-022 |
| B7 | FR-AIN-021/023 |
| B8 | AC-AIN-009 |
| B9 | AC-AIN-008 |
| B10 | DD-AIN-5, FR-AIN-023 |
| B11 | AC-AIN-014, AC-AIN-008, FR-AIN-021/024 |
| B12 | AC-AIN-016, NFR-AIN-SEC-003, FR-AIN-025/026/027 |
| B13 | AC-AIN-017, FR-AIN-028 |
| B14 | **AC-AIN-002**, AC-AIN-010, AC-AIN-011, AC-AIN-007 |
| B15 | AC-AIN-003 (draft) |
| C1 | all deterministic ACs green |
| C2 | **AC-AIN-003**, NFR-AIN-QUAL-001 |

## 5. Risks

- **Model reliability is the open question this issue exists to answer.** Everything deterministic is proven in
  CI; the weak model's tool choice is proven only by C2. OD-REEL-1 already allows a model change if it fails.
- **`functions.invoke` from inside an edge fn** carries the caller's JWT because the client is built with a global
  `Authorization` header; B14's handler test proves the call shape, C2 proves it live. If the hosted gateway
  rejected it, the fallback is a direct `fetch` to the same function URL with the same header — same path, same
  gates.
- **Project mapping in ERPNext.** A project not mapped to an ERPNext project can fail the project gate after
  approval; the error surfaces verbatim (AC-AIN-016). No pre-check: the mapping lives in the binding config, which
  members cannot read.
