# #1033 — Budget push on ERPNext v16

**Spec:** `docs/specs/budget-push-v16.spec.md`, signed, including the Director's amendment in `ced8f1cd`. **Executor:** Director-dispatched money-path builder. **Planning only:** no source changes, migrations run, remote writes, commits, or pushes were performed.

## Ambiguities, compatibility constraint, and Director checkpoints

- The shared-account ambiguity is **resolved**: refuse `commit-rejected`, naming the account; never aggregate across categories. No mapping-model change.
- **Important schema choice:** the existing v15 tests pin the literal three-column `onConflict`, not just observable ERP behavior (`readModelWriters.test.ts:431–432`, `dispatchGateWiring.test.ts:206`). Replacing the original table's unique with a four-column unique necessarily invalidates that production upsert. Keeping both uniques prevents account fan-out. This plan therefore adds an **account-grained companion mirror**, `budget_version_account_erp_mirror`, for v16, rather than changing the legacy writer or its tests. FR-BV16-007 specifies the logical mirror grain, not a table name. The new relation has the requested account dimension and four-column unique; a read-only union supplies existing read RPCs. V15 rows, keys, writers, and pinning tests remain valid. Do not silently substitute the single-table design: if the Director requires that physical design, obtain permission to update the mechanical conflict-target assertions first. This is an explicit design tradeoff, not an unreported test change.
- `held`/`pushing` still exist. Preserve distinct `held` in the status result. Rank failure-class `failed`/`held` above in-progress `pending`/`pushing`, above `pushed`; among equally ranked rows use account then row id. This implements the signed three-class ordering without deleting the existing hold affordance.
- AC-BV16-008 requires **Director execution and evidence**. No rehearsal coordinates or credential coordinates belong in this public plan. The Director must establish site-specific routing to the rehearsal copy, **never the site named `frontend`**, before any write. A v15 bench run or mocked v16 run is not this proof. Missing access is BLOCKED, not PASS.
- No remaining requirement ambiguity blocks the implementation below. An ERP major upgrade with outstanding v15 Budget documents is not a migration this issue authorizes; the rehearsal must start on a fresh run-owned Project. Never infer an account for an existing v15 document.

## Design decisions (decision record; approximately one page)

1. **Identity and key.** Keep every v15 byte: identity `vid:encodeFiscalYear(fy)`, key from the existing three-argument `budgetPushKey`. For v16 use `vid:a:<FY-token-length>:<FY-token>:<account-UTF8-hex>` and `bud16:<that identity>:<epoch-ms>`. The FY alphabet itself contains `:` (for example a slash encodes to `2:`), so splitting on colons is incorrect. A length frame preserves the existing FY encoding; lowercase UTF-8 hex makes the account reversible and delimiter-safe. The `:a:` discriminator cannot start a legacy FY token. Reject noncanonical lengths, invalid UTF-8, odd hex, empty dimensions, and trailing data. Use **`timestamptzEpochMs` from `budgetPushKey.ts`**, including in sweep recovery, never another Date parser. Add a separate exact `bud16` guard before existing key rules; leave legacy rules unchanged.
2. **Storage.** Migration **0292** is next after the verified maximum `0291_fx_rates_jisdor.sql`; 0287/0288 are not used. Add the v16 companion mirror, four-column unique `(org_id,budget_version_id,fiscal_year,erp_account)`, machine-only RLS, queue index, and an invoker union view. Empty account is a **gate-failure sentinel only**, never an ERP unit. Existing mirror and v15 outbox/refs remain untouched. Use one canonical identity parser everywhere; no new identity columns in outbox/refs. Reversible rollback refuses while account data/commands exist, rather than collapsing several pointers. Record the schema/key decision in ADR-0087.
3. **Fan-out and revision.** Expand gate plan years into account units **in `adapter-dispatch/index.ts`**, before `runOneDispatch`, alongside today's year fan-out. `budgetToBody` still returns exactly one body per command. A plural pure helper supports AC-001/003 and preflights the complete year before writes. Discover previously PMO-pushed accounts from the project-scoped v16 mirror, not today's map; union with desired accounts. Each unit stays an outbox `create`, with server-derived `erp_account` and `budget_intent: 'ensure'|'remove'`. Resolve the account grain and reverse creation witness. `ensure`: no occupant→create; owned submitted occupant with equal exact amount→read-only success; changed→existing cancel/amend/submit. `remove`: owned submitted occupant→cancel only; already cancelled recorded predecessor→read-only success. No external target comes from HTTP. A dropped account is not a zero-amount ERP body. For unchanged/cancel-only success the same ERP name moves to the new version's identity through a **v16-only fenced finalization branch**; otherwise reverse uniqueness would reject it. Never relax the reverse unique.
4. **Version threading.** `ErpCtx.versionMajor?: 15|16` preserves old unit fixtures; production budget factories require a binding major of 15 or 16 and set it explicitly. Only explicit 16 uses the new shape. Thread the major through fan-out, body/mapper, grain filters, sweep fields, and recovery. V16 grain is company+project+account+`from_fiscal_year`, docstatus<2; request no `fiscal_year` on a v16 Budget list. Keep draft/multiple/unowned refusals and post-cancel failure reporting.
5. **Inbound/recovery.** Lifecycle-only mapping includes normalized PMO `fiscal_year` from v16 `from_fiscal_year`, and `erp_account` from `account`; no amounts flow back. Full identity chooses mirror table and predicates in feed, CAS holds, orphan dedup, candidate lookup, sweep gates, and operator release. Desk cancellations stay tombstoned; Desk amendments repoint only that account. Recovery reauthorizes the recorded actor and reruns current gate/account resolution; no second dispatch mechanism.
6. **Proof/performance.** Unit body/revision tests, a real-handler mocked-transport replay test, pgTAP grain/status/RLS proofs, and a real HTTP-dispatch rehearsal proof own the eight ACs. Reuse decimal-string account resolution, outbox fencing, existing ERP transport and rate limiter. Read map/source once per foreground plan; page previous-mirror reads; execute account units sequentially so fan-out does not multiply simultaneous ERP traffic. Continue after a unit fails. No UI-to-ERP reads, amount cache, parallel outbox, or PMO approval changes.

## Verified code map and execution flow

The supplied scratch map is orientation, not authority. These references were read at this worktree's head:

| Deciding artifact | Verified constraint / planned seam |
|---|---|
| `pmo-portal/src/lib/adapterSeam/erpnext/fiscalYearEncoding.ts` | Alphabet `0123456789TZ.+-:`; legacy parser splits first colon; FY decoder consumes the rest. Do not feed account identities to it. |
| `pmo-portal/src/lib/adapterSeam/erpnext/budgetPushKey.ts` | Existing overloads and exported `timestamptzEpochMs`; retain both legacy forms. |
| `supabase/functions/adapter-dispatch/transitionTargetGuard.ts` | `judgeBudgetPerYearKey` splits last colon; new prefix needs its own validator. `outboxIdentityOf` already carries the server identity. |
| `supabase/functions/adapter-dispatch/index.ts:857–936,1425–1446` | Gate plan→units→per-unit guard→same outbox path; failure closures use rebound command. Three-column failure upserts must stay for v15. |
| `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts:874–1040,1468–1580` | Binding major already selected; project and category map resolve before grain read; ownership is reverse `findPmoRecordId`. |
| `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.ts:96–147` | Single body, six action fields, applicable toggles, decimal-string resolution; lifecycle mapper/list fields currently v15. |
| `pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts:162–221,288–345,419–447` | Create upserts via `refs.self`; current submitted edit always amends. Add explicit v16 equality/remove routing before that route, not a global change. |
| `supabase/functions/adapter-dispatch/readModelWriters.ts:966–1060` | Span + activation witnesses mandatory, replay must not clear Desk tombstones. |
| `supabase/functions/_shared/erpnextFeedDeps.ts:101–137` | One `scopeMirrorQuery` centralizes feed predicates; table is currently selected by kind alone. Extend both table and predicates. |
| `supabase/functions/erpnext-sweep/index.ts:145–160,239–274,1013,1404–1700,2485–2766` | Fields selector has a production call site; backstop dedup/CAS/key and `assertBudgetSweepGate` need account scope. Recovery currently checks only year membership. |
| `supabase/migrations/0137_budget_push_seam.sql` | Original unique, machine-only RLS, queue index; keep intact. |
| `supabase/migrations/0233_erp_contacts.sql:36–70` | **Current** `record_outbox_ref` includes Contact insert-only branch; do not restore the obsolete 0154 body over it. |
| `supabase/migrations/0093_clickup_tasks_flip.sql:169` | Reverse external-ref unique means two version identities cannot simultaneously own one ERP document. |
| `supabase/migrations/0160_budget_push_status_binding_gate.sql` | Current status RPC body/8-column shape; keep binding gate and invoker grants. |
| `supabase/migrations/0290_project_finances.sql:252–343` | **Current** projection body; mirror predicates are `exists`, not a scalar ERP name. Add union source without multiplying money rows. Do not copy 0149 over 0290. |
| `pmo-portal/src/lib/repositories/budgetProjection.ts:330–365` | Release currently selects only year-qualified/bare keys. Extend account identities through mirror reads, never a LIKE-prefix scan. |
| `pmo-portal/pages/BudgetProjection.tsx:333,715,748` + `pmo-portal/src/lib/adapterSeam/pushErrorCopy.ts` | UI translates error code; putting account only in raw error text would not make Finance see it. Extend the translation for a structured account suffix. |

Also read: charter `docs/product-expectations.md`; money primer; ADR-0059 §§3–6, ADR-0062 (async UI), ADR-0073 (major authority); P3c spec FR-BUD-114/121/131/140/142/152 and dev-bed NFR; BFY spec FR-BFY-030..038/075/076/080 including reverse-lookup ruling; `categoryAccountMap.ts` (integer cents, map ambiguity guard), `budgetGate.ts` (single-year empty slice remains a plan entry); v15 fixture `bfyServedFixture.ts`; environment and e2e conventions. `gh repo view --json visibility` returned PUBLIC. `scripts/prior-art.sh budget-push-v16` found #1033 and the rehearsal-related closed issue; this is not a proof of absence elsewhere.

Data flow: activation RPC commits unchanged → existing nonblocking consequence → caller-JWT gate → binding major + map snapshot → year/account units → per-unit target guard → adapter + fenced outbox → ERP create/submit, amend, no-op or cancel → ref finalization + account mirror → union read RPC → existing Finance status. Sweep reconstructs the same persisted unit, not a fresh guessed target.

## Shared contracts to implement

All new modules below use relative imports with `.ts` so Vitest and Deno can import them.

### C1 — Account identity (`pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts`)

```ts
export interface BudgetIdentity {
  versionId: string;
  fiscalYear: string | null;
  erpAccount: string | null; // null = legacy, never an empty-account ERP unit
}
export function encodeBudgetAccount(account: string): string;
export function decodeBudgetAccount(token: string): string;
export function budgetAccountIdentity(versionId: string, fiscalYear: string, account: string): string;
export function parseBudgetIdentity(identity: string): BudgetIdentity;
export function budgetAccountPushKey(identity: string, activatedAt: string | null | undefined): string;
export function isBudgetAccountPushKey(key: string): boolean;
```

Implementation core (import `AdapterError`, `encodeFiscalYear`, `decodeFiscalYear`, `budgetVersionIdOf`, `timestamptzEpochMs` from their existing modules):

```ts
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function reject(): never { throw new AdapterError('commit-rejected', 'Invalid budget account identity'); }
export function encodeBudgetAccount(account: string): string {
  if (!account || account.trim() === '') reject();
  const bytes = new TextEncoder().encode(account);
  if (new TextDecoder('utf-8', { fatal: true }).decode(bytes) !== account) reject();
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export function decodeBudgetAccount(token: string): string {
  if (!/^(?:[0-9a-f]{2})+$/.test(token)) reject();
  try {
    const bytes = Uint8Array.from(token.match(/../g)!, b => parseInt(b, 16));
    const account = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (encodeBudgetAccount(account) !== token) reject();
    return account;
  } catch { return reject(); }
}
export function budgetAccountIdentity(versionId: string, fiscalYear: string, account: string): string {
  if (!UUID.test(versionId)) reject();
  const fy = encodeFiscalYear(fiscalYear);
  return `${versionId}:a:${fy.length}:${fy}:${encodeBudgetAccount(account)}`;
}
export function parseBudgetIdentity(identity: string): BudgetIdentity {
  if (UUID.test(identity)) return { versionId: identity, fiscalYear: null, erpAccount: null };
  const versionId = budgetVersionIdOf(identity);
  const rest = identity.slice(versionId.length + 1);
  if (!rest.startsWith('a:')) {
    const fiscalYear = decodeFiscalYear(rest);
    if (!fiscalYear || encodeFiscalYear(fiscalYear) !== rest) reject();
    return { versionId, fiscalYear, erpAccount: null };
  }
  const lengthEnd = rest.indexOf(':', 2);
  if (lengthEnd < 0) reject();
  const decimal = rest.slice(2, lengthEnd);
  if (!/^[1-9][0-9]*$/.test(decimal)) reject();
  const n = Number(decimal);
  if (!Number.isSafeInteger(n) || n > rest.length) reject();
  const start = lengthEnd + 1;
  if (rest[start + n] !== ':') reject();
  const token = rest.slice(start, start + n);
  const fiscalYear = decodeFiscalYear(token);
  const erpAccount = decodeBudgetAccount(rest.slice(start + n + 1));
  if (!fiscalYear || budgetAccountIdentity(versionId, fiscalYear, erpAccount) !== identity) reject();
  return { versionId, fiscalYear, erpAccount };
}
export function budgetAccountPushKey(identity: string, activatedAt: string | null | undefined): string {
  if (!parseBudgetIdentity(identity).erpAccount || !activatedAt) reject();
  const epoch = timestamptzEpochMs(activatedAt);
  if (!Number.isFinite(epoch) || epoch < 0) reject();
  return `bud16:${identity}:${epoch}`;
}
export function isBudgetAccountPushKey(key: string): boolean {
  if (!key.startsWith('bud16:')) return false;
  const end = key.lastIndexOf(':');
  const epoch = key.slice(end + 1);
  if (!/^[0-9]{4,20}$/.test(epoch)) return false;
  try { return parseBudgetIdentity(key.slice(6, end)).erpAccount !== null; }
  catch { return false; }
}
```

`isOpaqueIdempotencyKey` must return this verdict immediately for **every string starting `bud16:`**, even malformed ones; no fall-through to generic key admission.

### C2 — Pure account/body/intent contracts

New `pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountPlan.ts`:

```ts
export interface BudgetAccountUnitRecord extends PmoRecord {
  id: string; // bare budget_versions UUID
  erp_doc_kind: 'budget';
  projectId: string;
  fiscal_year: string;
  erp_account: string;
  budget_intent: 'ensure' | 'remove';
  budget_predecessor: string | null;
  outbox_identity: string;
  activated_at: string;
  project_start_date: string;
  project_end_date: string | null;
  line_items: BudgetLineItem[];
}
export interface BudgetAccountIntent {
  fiscalYear: string;
  erpAccount: string;
  intent: 'ensure' | 'remove';
  amount: string | null; // decimal, null only for remove
  predecessor: string | null; // from PMO mirror; never HTTP
}
export interface PriorBudgetAccount {
  fiscalYear: string;
  erpAccount: string;
  erpBudgetName: string;
  cancelledAt: string | null;
}
export function resolveV16BudgetAccounts(
  lines: readonly BudgetLineItem[], map: readonly CategoryAccountMapRow[],
): BudgetAccountRow[];
export function planBudgetAccountIntents(
  fiscalYear: string, desired: readonly BudgetAccountRow[], prior: readonly PriorBudgetAccount[],
): BudgetAccountIntent[];
```

`resolveV16BudgetAccounts` calls shipped `resolveBudgetAccounts`, then rejects any repeated `row.account` using a `Set<string>` and `new AdapterError('commit-rejected', 'budget push: multiple non-zero categories resolve to account ' + row.account)`. This detects category totals, not repeated line items inside one category. Run over each year before constructing any bodies/units. `planBudgetAccountIntents` creates ensure intents from desired rows in resolver order and remove intents for distinct prior accounts absent from desired, excluding Desk-tombstoned prior rows. Deduplicate history by `(fiscalYear,erpAccount,erpBudgetName)`; conflicting live predecessor names fail closed rather than select a winner. Ensure intents do not freeze a change/no-op decision; that decision uses a fresh ERP document under the adapter commit.

In `bodies/budget.ts` export `budgetBodiesForYear(rec: PmoRecord, ctx: ErpCtx): Record<string, unknown>[]`. V15 returns `[budgetToBody(rec, ctx) as Record<string, unknown>]`. V16 resolves all accounts and emits:

```ts
{
  company, budget_against: 'Project', project,
  account: row.account, budget_amount: row.budget_amount,
  from_fiscal_year: fiscalYear, to_fiscal_year: fiscalYear,
  distribution_frequency: 'Monthly', distribute_equally: 1,
  ...resolveApplicableOn(ctx.config),
  ...Object.fromEntries(ACTION_FIELDS.map(field => [field, resolveOverspendAction(ctx.config)])),
}
```

V16 `budgetToBody` selects exactly the body matching server `rec.erp_account` and throws if absent or if `budget_intent==='remove'`. Do not recurse from plural v16 into single. Leave the v15 body construction, field insertion order, and decimal resolution intact. Do not push any projection.

### C3 — Database delta and read compatibility

Migration paths:
- `supabase/migrations/0293_budget_v16_accounts.sql`
- `supabase/migrations/rollback/0293_budget_v16_accounts_down.sql`

Create the new table with **the original mirror's exact column names/types/defaults**, plus account and intent. Actual DDL:

```sql
create table public.budget_version_account_erp_mirror (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default coalesce(public.auth_org_id(),'00000000-0000-0000-0000-000000000001')
    references public.organizations(id) on delete cascade,
  budget_version_id uuid not null references public.budget_versions(id) on delete cascade,
  fiscal_year text not null,
  erp_account text not null default '',
  budget_intent text not null default 'ensure' check (budget_intent in ('ensure','remove')),
  push_state text not null default 'pending'
    check (push_state in ('pending','pushing','pushed','failed','held')),
  push_error text,
  unmapped_categories text[],
  activated_at_witness timestamptz,
  erp_budget_name text,
  erp_docstatus smallint,
  erp_modified text,
  erp_cancelled_at timestamptz,
  pushed_at timestamptz,
  created_at timestamptz not null default now(),
  pushed_project_start_date date,
  pushed_project_end_date date,
  unique (org_id,budget_version_id,fiscal_year,erp_account),
  check (erp_account <> '' or push_state in ('failed','held'))
);
create index budget_version_account_erp_mirror_queue_idx
  on public.budget_version_account_erp_mirror (org_id,push_state,created_at,id);
alter table public.budget_version_account_erp_mirror enable row level security;
alter table public.budget_version_account_erp_mirror force row level security;
create policy budget_version_account_erp_mirror_select
  on public.budget_version_account_erp_mirror for select
  using (org_id=public.auth_org_id() and public.is_active_member());
grant select on public.budget_version_account_erp_mirror to authenticated;
revoke all on public.budget_version_account_erp_mirror from anon;
create trigger budget_version_account_erp_mirror_stamp_org_id
  before insert on public.budget_version_account_erp_mirror
  for each row execute function public.stamp_org_id();
```

Add `grant all on public.budget_version_account_erp_mirror to service_role;` explicitly; retain no authenticated write grants. Add `budget_push_mirror_rows` as `security_invoker=true`, UNION ALL of the two tables, with this explicit common column list in both arms:
`id,org_id,budget_version_id,fiscal_year,push_state,push_error,unmapped_categories,activated_at_witness,erp_budget_name,erp_docstatus,erp_modified,erp_cancelled_at,pushed_at,created_at,pushed_project_start_date,pushed_project_end_date,erp_account,budget_intent`.
For legacy arm append `''::text,'ensure'::text`; for account arm select actual columns. Grant SELECT authenticated/service_role, revoke anon. Never expose an owner-rights view.

In the **current** definitions of `get_budget_projection(uuid,text)` (0290) and `list_budget_fiscal_years(uuid)` (0153), replace only mirror FROM sources with `public.budget_push_mirror_rows`. Keep the existing `exists`/distinct year semantics, attribution witness, FX fields, money arithmetic, grants and invoker execution. In projection F-A predicates add `and em.budget_intent='ensure' and em.erp_docstatus is distinct from 2` so a successful intentional removal does not become the witness attributing unphased money to a year. Legacy rows have intent ensure and retain their existing behavior.

For `get_budget_push_status(uuid)` retain its 8-column return shape, inference, binding gate and expected-year set. Replace mirror CTE with `mirror_rows`, plus a ranked one-row-per-year `mirror`:

```sql
row_number() over (partition by em.fiscal_year order by
  case em.push_state when 'failed' then 4 when 'held' then 4
    when 'pending' then 3 when 'pushing' then 3 when 'pushed' then 1 else 0 end desc,
  case em.push_state when 'failed' then 1 when 'held' then 2 else 3 end,
  em.erp_account, em.id) as rn
```

For the selected failing account use `coalesce(push_error,'budget-push-failed') || ': account=' || erp_account` when `erp_account<>''` and state in failed/held; v15 strings stay identical. Preserve sentinel gate failure until a complete fresh plan has replaced it: clear only the matching empty-account sentinel, for that activation/year, after all real account rows are durably pending or terminal. No sentinel key is dispatched.

Compute stale-attribution as `exists` over **all** successful ensure rows for the year (not just the selected worst row), using the existing witness comparison. `hold_releasable` tests exact identities built from each held account row, plus the original v15 predicates. Add immutable SQL `budget_account_identity(uuid,text,text)` using the same length frame, `budget_fiscal_year_token`, and `encode(convert_to(account,'UTF8'),'hex')`; no wildcard identity matching. Grant execute only authenticated/service_role, revoke public/anon. The account helper returns NULL for empty account and refuses empty year.

Concrete SQL identity helper (in 0292; test with C1 bytes):

```sql
create function public.budget_account_identity(p_version uuid,p_fy text,p_account text)
returns text language plpgsql immutable security invoker
set search_path=public,pg_temp as $$
declare t text;
begin
  if p_version is null or p_fy is null or p_fy='' then
    raise exception 'Invalid budget account identity' using errcode='22023';
  end if;
  if p_account is null or btrim(p_account)='' then return null; end if;
  t := public.budget_fiscal_year_token(p_fy);
  return p_version::text || ':a:' || length(t)::text || ':' || t || ':' ||
    encode(convert_to(p_account,'UTF8'),'hex');
end $$;
revoke all on function public.budget_account_identity(uuid,text,text) from public,anon;
grant execute on function public.budget_account_identity(uuid,text,text) to authenticated,service_role;
```

**Unchanged document mapping:** extend the CURRENT 0233 `record_outbox_ref`, preserving signature, Contact branch, locking, state/generation checks, grants. In its budget/v16 branch (recognize the exact `:a:` identity marker and validate against the SQL identity helper), before the final INSERT:
1. Read the locked outbox's server payload version/project/year/account and canonical lifecycle; require identity equal to SQL helper of payload values, canonical id=payload id, canonical year/account equal, and version belongs to `v.org_id` and payload project. Require the destination version's status Active and activation witness equal to payload stamp for a handoff to another identity.
2. Lock the candidate creation witness with `select r.* from public.external_refs r where r.org_id=v.org_id and r.domain='budget' and r.external_record_id=p_external_record_id for update`. If found under another identity, require that source identity resolves to an account mirror row for **the same project, year, account, and ERP name**. This is the FR-BFY-076 creation witness, not ERP author/occupancy. Require canonical docstatus 1 for ensure, 2 for remove; a remove requires payload predecessor equal to that name. Refuse on any mismatch with 23505.
3. Update that witnessed row's `pmo_record_id` to `v.pmo_record_id`. Replay of the same destination remains the existing idempotent upsert. A stale historical finalizer cannot take ownership back from the current version. Never delete mappings or weaken reverse uniqueness. Changed/new accounts still use the ordinary INSERT path.

The account mirror of the prior version remains historical; current lifecycle feed follows the transferred ref. A historical confirmed outbox replay is read-model convergence only and cannot transfer refs. New pgTAP must bind to the shipped RPC, including wrong generation and cross-project refusal cases.

**Rollback:** install a postgres-only, SECURITY INVOKER `public.bv16_migration_0293_revert()` in 0293, following the applied-and-tested 0154 revert-helper pattern. Revoke EXECUTE from public, anon, authenticated and service_role. Its first statement takes the existing budget-identity exclusive advisory lock. Refuse if any companion row exists, or any budget outbox/ref has an account identity. No lossy conversion is authorized. Restore pre-0293 definitions of all changed functions, including CURRENT 0233 `record_outbox_ref`, CURRENT 0290 projection, 0153 fiscal-year listing, and 0160 push status, with grants; embed the exact source bodies as DDL strings, not references to old migration files. Then drop union view, account identity function, trigger/table. A thrown exception rolls back all changes. The staged down file is exactly `begin; select public.bv16_migration_0293_revert(); drop function public.bv16_migration_0293_revert(); commit;`. All preexisting v15 rows and pointers survive. For an unused installation this is fully reversible; after a v16 push an explicit export/removal process is required before rollback. Do not delete rehearsal/live ERP documents as part of rollback.

### C4 — Adapter commit behavior and cancellation recovery

Add `ctx.budgetAccount?: { intent:'ensure'|'remove'; predecessor:string|null }` alongside `versionMajor`. Only the v16 budget factory fills it. Before any ERP read, the factory checks that an account-marked identity is used only with a current binding major16, and that major16 commands carry a parseable account identity matching their year/account fields. A binding change between gate and factory therefore refuses `config-rejected`, never emits a v15 body under a v16 identity or vice versa. `refs.self` still comes exclusively from a scoped grain read and reverse ownership witness. The factory re-resolves the selected account against the map for ensure; for remove it uses a witnessed prior mirror account, even when that category/map row no longer exists.

At the start of budget v16 `commitCreate`, before the existing `upsertOnGrain` branch:
- If ensure with `refs.self`, GET the full current document. Require submitted, company/project/account/from-year/to-year exactly matching the unit. Normalize the ERP amount with decimal-string integer-cents logic, not `Number` or float comparison. If amount equals the desired resolver row, return mapped lifecycle canonical with the new **bare** `record.id`, no POST/PUT and no amendment. If changed, build/validate replacement body **before** the existing amend call. Reuse `commitAmend`, hooks, submit, readback, lineage fields and abandoned-amend classification.
- If remove, require a witnessed predecessor. A live scoped occupant must equal that predecessor or another PMO-witnessed successor on the same account grain; resolve the actual target server-side and refresh the predecessor in context, not persisted payload. GET and verify the full target. Submitted→`cancelDoc`→GET, cancelled→GET only, draft→named refusal. Return canonical docstatus 2 with `budget_intent:'remove'`. No create/submit. If grain is empty, GET the recorded predecessor and accept only a cancelled doc with matching dimensions; an unexplained 404 is not a cancellation success.
- No fallback from remove to create. Every error remains classified and account-specific. A cancel-only success is `push_state='pushed'` (the requested removal succeeded) with docstatus 2 and intent remove. Its tombstone excludes it from recovery and cannot be treated as a Desk failure when the same cancellation returns through the feed. Feed cancellation for an ensure remains failed/tombstoned/action-required. Tombstoned prior Desk documents are not scheduled for removal or recreation by ordinary activation replay.

`budgetFromDoc` retains its v15 object exactly when `from_fiscal_year` is absent; on a v16 document return the same lifecycle fields with `fiscal_year=from_fiscal_year` and `erp_account=account`. No `budget_amount` in canonical. Carry `budget_intent` from the server unit in adapter result, not from an ERP field. Validate readback dimensions before canonical/mirror success.

## Traceability — exactly one owning test per AC

Supporting tests below reference requirements; they are not additional owners.

| Acceptance criterion | ONE owning test (exact title) | Layer | Tasks |
|---|---|---|---|
| AC-BV16-001 | `bodies/budget.v16.test.ts` → `AC-BV16-001 builds two v16 account bodies` | Vitest unit | 5–7 |
| AC-BV16-002 | `bodies/budget.v16.test.ts` → `AC-BV16-002 preserves the frozen v15 JSON bytes` | Vitest unit | 5–7 |
| AC-BV16-003 | `bodies/budget.v16.test.ts` → `AC-BV16-003 refuses a shared non-zero account before building` | Vitest unit | 4–7 |
| AC-BV16-004 | `supabase/functions/adapter-dispatch/budgetV16Replay.test.ts` → `AC-BV16-004 two account creates once across two real-handler pushes` | Deno real-handler / mocked transport | 1–3,16–22 |
| AC-BV16-005 | `erpnext/adapter.budgetV16.test.ts` → `AC-BV16-005 revises only changed accounts and removes the dropped account` | Vitest unit | 8,23–28 |
| AC-BV16-006 | `supabase/tests/budget_v16_accounts.test.sql` → `AC-BV16-006 account mirrors coexist and year reports the failing account` (one `ok` goal-oracle) | pgTAP integration | 9–15,29–31 |
| AC-BV16-007 | `supabase/functions/erpnext-sweep/budgetV16Fields.test.ts` → `AC-BV16-007 v16 Budget list never requests fiscal_year` | Deno unit, real exported selector | 32–34 |
| AC-BV16-008 | `scripts/bv16-rehearsal.mjs` → evidence assertion `AC-BV16-008 real-dispatch activation and single-account revision` | Live HTTP rehearsal | 41–46 |

Unit paths abbreviated in table only: `bodies/` is `pmo-portal/src/lib/adapterSeam/erpnext/bodies/`; `erpnext/` is `pmo-portal/src/lib/adapterSeam/erpnext/`.

## Implementation tasks — RED before GREEN, 2–5 minutes each

Run commands from repo root. A task's RED means run its stated test after adding the assertion, observe the named behavioral failure, then make only the stated implementation and rerun GREEN. Do not count import/fixture failures as behavioral RED. If a task introduces a new exported function, first create its signature with a throwing implementation, then prove the assertion fails. Those temporary stubs are local TDD scaffolding, never a completed task or committed result. Verification-only and documentation tasks explicitly do not add behavior.

### 1. Frame identities (AC-BV16-004 support, 4 minutes)

Create `pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.test.ts` and `.ts`. Test round trips using FY `FY/2026: α` and accounts `Salary: East/α` and `Salary: East/β`; assert distinct identities, bare UUID extraction, unchanged legacy parse, and round-trip account bytes. Assert frame length equals `encodeFiscalYear(fy).length`, **not** original FY length. RED→implement C1 identity encoder/parser. Verify:
` scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/budgetAccountIdentity.test.ts' `

### 2. Shared epoch and malformed inputs (AC-BV16-004 support, 4 minutes)

In the same new test file assert account key equality for `2026-10-15T10:00:00+00:00`, `2026-10-15 10:00:00+00`, `2026-10-15T17:00:00+07:00`, and `2026-10-15T10:00:00Z`. Reject odd hex, uppercase hex, invalid UTF-8 `ff`, empty account, missing separator, decimal length with leading zero, forged length, and extra trailer. RED→complete C1 key/validation using `timestamptzEpochMs`. Verify task 1's exact command.

### 3. Served key admission (AC-BV16-004 support, 3 minutes)

Create `supabase/functions/adapter-dispatch/budgetV16Key.test.ts`, import the shipped `isOpaqueIdempotencyKey` and C1. Assert valid framed keys pass, account/FY-corrupted keys fail, existing legacy `bud:` and UUID keys pass. In `transitionTargetGuard.ts`, import `isBudgetAccountPushKey`; insert `if (key.startsWith('bud16:')) return isBudgetAccountPushKey(key);` after the string check. Leave all existing regexes and tests unchanged. RED/GREEN:
`deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/budgetV16Key.test.ts supabase/functions/adapter-dispatch/transitionTargetGuard.test.ts`

### 4. Refuse shared category accounts (AC-BV16-003, 4 minutes)

Create `budgetAccountPlan.ts` and `budgetAccountPlan.test.ts` under `pmo-portal/src/lib/adapterSeam/erpnext/`. Assert two lines for Labor sum normally, Labor+Overtime non-zero on Salary throws code commit-rejected containing Salary, zero-total Overtime does not conflict, and missing category still raises shipped `BudgetCategoryUnmappedError`. Implement C2 resolver. No edit to `categoryAccountMap.ts` or its v15 tests. Verify:
`scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/budgetAccountPlan.test.ts'`

### 5. Freeze the body oracles (AC-BV16-001/002/003, 5 minutes)

Create `pmo-portal/src/lib/adapterSeam/erpnext/bodies/budget.v16.test.ts`. Use project `PROJ-1`, company `Test Co`, fiscal year 2026, map Labor→Salary, Materials→COGS, line amounts `50000.00`/`25000.00`. With explicit major 16 assert exactly the two C2 bodies, all six Warn fields, configured three applicable flags, no accounts/fiscal_year properties. Set all three configured applicable flags to true. Freeze these literal bytes (the existing builder's field order), never derive the oracle by calling new code:

```ts
const V15_JSON = '{"company":"Test Co","fiscal_year":"2026","budget_against":"Project","project":"PROJ-1","accounts":[{"account":"Salary","budget_amount":"50000.00"},{"account":"COGS","budget_amount":"25000.00"}],"applicable_on_material_request":1,"applicable_on_purchase_order":1,"applicable_on_booking_actual_expenses":1,"action_if_annual_budget_exceeded":"Warn","action_if_accumulated_monthly_budget_exceeded":"Warn","action_if_annual_budget_exceeded_on_mr":"Warn","action_if_accumulated_monthly_budget_exceeded_on_mr":"Warn","action_if_annual_budget_exceeded_on_po":"Warn","action_if_accumulated_monthly_budget_exceeded_on_po":"Warn"}';
```

 Assert new plural helper major 15 yields one body whose JSON equals that frozen string. Canonical owner titles are exactly the traceability table titles. Shared-account owner calls the plural helper and asserts throw; it must never return a partial array. Run RED:
`scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/bodies/budget.v16.test.ts'`

### 6. Versioned body branch (AC-BV16-001/002/003, 5 minutes)

In `doctypeRegistry.ts` add `versionMajor?:15|16` and C4 `budgetAccount` to `ErpCtx`. In `bodies/budget.ts` add C2 plural helper and an explicit major-16 branch at the top of the single builder. Factor v16 common fields into a private `v16Bodies` function; v15 existing block stays in place without field/order changes. Require selected `rec.erp_account` to resolve exactly once. Verify task 5 command GREEN, then:
`scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/bodies/budget.test.ts src/lib/adapterSeam/erpnext/bodies/budget.v16.test.ts'`

### 7. Lifecycle mapper and versioned fields (AC-BV16-001/002/007 support, 3 minutes)

Extend only the new v16 body test with normalized fiscal year/account and absence of money in `budgetFromDoc`; assert no v16 fields are added to v15 mapped object. Add `budgetFromDocFields(versionMajor?:number): readonly string[]`: explicit 16 returns `['name','modified','docstatus','amended_from','from_fiscal_year','to_fiscal_year','account']`, otherwise existing `BUDGET_FROM_DOC_FIELDS`. Implement C4 mapper. Run task 6 command.

### 8. Ensure/remove planning (AC-BV16-005 support, 4 minutes)

In `budgetAccountPlan.test.ts` assert desired Salary/COGS/Equipment plus prior Salary/COGS/Travel yields ensure Salary/COGS/Equipment and remove Travel. No removal for an already Desk-tombstoned prior account. Duplicate identical history does not double cancel; two distinct live predecessor names refuse. Implement `planBudgetAccountIntents` with C2 signatures. Verify task 4 command.

### 9. AC-006 pgTAP red fixture (AC-BV16-006, 5 minutes)

Create `supabase/tests/budget_v16_accounts.test.sql` with the executable AC-006 SQL fixture in Appendix A. The **single owning** `ok` conjunction asserts two account rows, exactly one returned 2026 status, failed state, `push_error` contains `account=COGS`, and legacy row/status are intact. Seed before switching to the authenticated org reader. RED against pre-migration schema is expected missing-relation; after table creation rerun and require the status assertion to be the behavioral RED. Verify:
`scripts/with-db-lock.sh supabase test db supabase/tests/budget_v16_accounts.test.sql`

### 10. Add account mirror and union (AC-BV16-006, 5 minutes)

Create `0293_budget_v16_accounts.sql` with C3 table, RLS, org trigger, queue index and explicit union view. Inspect `stamp_org_id` and original service grants before copying the call/grants; use the shipped function, no second org-stamping implementation. No change to original mirror. Apply in one lock:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_accounts.test.sql'`
AC-006 should now fail at its status oracle, not relation setup.

### 11. Exact SQL identity (AC-BV16-006 support, 4 minutes)

Create `supabase/tests/budget_v16_identity.test.sql`. Compare SQL `budget_account_identity` to fixed expected bytes produced by C1 for slash/colon FY and Unicode account; reject empty dimensions; assert no execute for anon. Add C3 immutable function and grants to 0292. Use UTF-8 octets in PostgreSQL's `encode`, and token **character** length (the token is ASCII). Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_identity.test.sql'`

### 12. Worst state per year (AC-BV16-006, 5 minutes)

Append the exact 0160 function declaration to 0292, editing its CTEs as C3: union source→ranked representative→per-year status; account suffix only on account failure/hold. Staleness and hold-release use all scoped account rows. Keep inference and all 8 result columns. Add failure/pending/pushed tie tests in new `supabase/tests/budget_v16_status.test.sql`, including all-pushed, one pending, two failures deterministically ordered, independent years, and held account. Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_accounts.test.sql supabase/tests/budget_v16_status.test.sql'`

### 13. Projection and fiscal-year listing compatibility (AC-BV16-006 support, 5 minutes)

Create `supabase/tests/budget_v16_projection.test.sql`: two successful account rows must not double any category budget/actual; successful remove-only row must not authorize unphased attribution; one account failed must not hide phased PMO amounts. Copy CURRENT 0290 projection and CURRENT 0153 fiscal-year listing definitions into 0292, change mirror sources/predicates exactly as C3. Preserve latest currency outputs and known-attribution branches. Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_projection.test.sql supabase/tests/budget_projection_rpc.test.sql supabase/tests/bfy_push_status_per_year.test.sql'`

### 14. Companion tenancy and privilege proofs (AC-BV16-006 support, 5 minutes)

Create `supabase/tests/budget_v16_rls.test.sql`. Assert same-org authenticated SELECT through union; other-org SELECT empty; authenticated/anon lack companion INSERT/UPDATE/DELETE grants; same-org user cannot write; service role can write; account unique permits two accounts and refuses duplicate account; queue index exists; union view `security_invoker=true`. Use catalog-derived grant checks, not policy-name checks alone. Implement missing grants/policies only in 0292. Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_rls.test.sql supabase/tests/budget_erp_mirror_rls.test.sql'`

### 15. Staged rollback (AC-BV16-006 support, 5 minutes)

Create the C3 applied revert helper and four-statement staged down file. Create `supabase/tests/budget_v16_rollback.test.sql` with `throws_like('select public.bv16_migration_0293_revert()', '%v16 account data%', 'occupied rollback refuses')` while a companion fixture exists; assert its pointer survives. Remove only that test's companion/outbox/ref fixtures, then `lives_ok('select public.bv16_migration_0293_revert()', 'unused rollback succeeds')` and assert the legacy fixture row/pointer and original unique remain. Finish and ROLLBACK the test transaction, restoring the migrated schema. This is the actual applied-helper mechanism verified in `bfy_migration_reversibility.test.sql`, not server filesystem reads. Never run staged down against an occupied working DB. Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_rollback.test.sql'`

### 16. Snapshot binding major (AC-BV16-004 support, 4 minutes)

Create `supabase/functions/adapter-dispatch/budgetV16Binding.test.ts`, importing `./index.ts` and using `edgeTestKit` fetch routes. Assert binding 16 creates account units despite caller major 15, and caller forged account/identity/intent/predecessor fields are overwritten. In `index.ts` extend `ErpBindingRow`/`resolveErpBindingRow` SELECT with `version_major,config,activated_at`; production budget path refuses absent/unsupported major rather than infer it. Keep credential resolution shared. No edit to v15 fixture. Verify:
`deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/budgetV16Binding.test.ts`

### 17. Page prior-account discovery (AC-BV16-004/005 support, 5 minutes)

Create `supabase/functions/adapter-dispatch/budgetV16History.test.ts`, real handler imported. Seed 501 historical rows and page-boundary duplicate history; assert all current-year removed accounts survive paging, wrong-org/wrong-project rows never enter units, and existing v15 dispatch does not read the companion. In `index.ts` use `fetchAllRowsByKeyset` on companion with `.select('id,fiscal_year,erp_account,erp_budget_name,erp_cancelled_at,budget_versions!inner(project_id)')`, `.eq('org_id',orgId)`, `.eq('budget_versions.project_id',gate.projectId)`, `.order('id')`, `.gt('id',afterId)`, `.limit(limit)`. Exclude blank accounts/names. Fail on read error. Verify:
`deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/budgetV16History.test.ts`

### 18. Account fan-out (AC-BV16-004, 5 minutes)

Create `supabase/functions/adapter-dispatch/budgetV16Fixture.ts` as a **new** stateful mock transport fixture (not a handler): binding 16, two account map entries, account-filtered grain lists, persistent outbox rows keyed by identity+key, guarded RPC replies, ERP create/submit/readback, separate companion rows. Do not copy handler decisions into it. Create owner `budgetV16Replay.test.ts` with the exact AC-004 title; invoke captured shipped handler twice with the same valid caller JWT and no client key. Assert two POST Budget calls total, two submitted docs, two distinct framed identities/keys, record.id stays bare, and replay has no extra POST/PUT. Run RED. In `index.ts` explicit-16 plan expansion calls C2, builds per-account records with `erp_account,budget_intent,budget_predecessor` (server only), C1 identity/key, and existing span/activation witnesses. Keep existing v15 map block byte-identical. Verify:
`deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/budgetV16Replay.test.ts`

### 19. Per-unit failure isolation (AC-BV16-004/006 support, 4 minutes)

New `supabase/functions/adapter-dispatch/budgetV16Partial.test.ts` real-handler test: first account ERP rejects, second succeeds; failed row names first account, success remains, replay creates neither duplicate. Extend unit type with `erpAccount:string|null`; loop continues existing behavior and records account dimension on companion failure/success. V15 closures retain original table/options. Verify:
`deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/budgetV16Partial.test.ts`

### 20. Year retry and complete unit queue (AC-BV16-004/006 support, 5 minutes)

Extend `budgetV16Partial.test.ts`: two years×two accounts, retry 2026 produces no 2027 command and no write to confirmed 2026 account. Before running v16 units durably insert missing companion pending rows with `ignoreDuplicates:true` and the four-column conflict target; do not overwrite terminal/tombstoned rows. Preserve server witnesses and intent. Resolve sentinel only after all real rows have durable slots. Bad target year refuses before outbox. Verify task 19 command.

### 21. Mirror writer account scope (AC-BV16-004/006 support, 5 minutes)

Create `supabase/functions/adapter-dispatch/readModelWriters.budgetV16.test.ts`. Drive shipped `getReadModelWriter('budget')`: successful ensure writes companion account+intent+witnesses; replay of Desk-cancelled one writes nothing; other account remains writable; remove success records pushed+docstatus2+tombstone, not failure. In `readModelWriters.ts` branch using parsed server outbox identity, verify canonical year/account equal that identity, select companion/four-column conflict, and apply all existing witness checks and replay fence. Leave original v15 branch intact. Verify:
`deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/readModelWriters.budgetV16.test.ts supabase/functions/adapter-dispatch/readModelWriters.test.ts`

### 22. Account-grained failure writers (AC-BV16-004/006 support, 4 minutes)

Extend `budgetV16Partial.test.ts` with adapter-select failure and post-cancel replacement failure; assert correct account and `budget-enforcement-absent`, untouched sibling, no false 409 failure. `recordBudgetPushFailure` routes v16 to companion with four-column conflict; legacy literal three-column branch remains. Gate failure before account resolution uses companion sentinel `erp_account=''` once year known; never borrow a caller account. Surface account with classified redacted error. Verify task 19 command and existing `budgetPushOutcome.test.ts`.

### 23. Thread major and selected account through factory (AC-BV16-001/005 support, 4 minutes)

Create `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.budgetV16.test.ts`, real factory+adapter with `FakePostgrest` and fetch spy. Assert `ctx.versionMajor` derives from binding, selected Salary unit builds only Salary, and a caller-selected nonexistent account fails before Budget read. In `dispatchFactory.ts` validate budget binding major, fill ErpCtx, C4 context; re-resolve current selected account with C2 rather than trusting unit amount. V15 path untouched. Verify:
`scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/dispatchFactory.budgetV16.test.ts'`

### 24. Per-account grain and witness (AC-BV16-005 support, 5 minutes)

In new factory test assert exact v16 filters company/project/account/from_fiscal_year/docstatus<2, and no fiscal_year field/filter; submitted unowned, any draft, or 2+ live all cause zero writes and named account/year refusal. Implement explicit-16 filter branch in `resolveBudgetRefs`, retaining existing reverse `findPmoRecordId` witness. For v16 reverse witness additionally parse identity/account/year and validate the associated companion row's project before accepting an old version's document. No ERP owner-email test. Verify task 23 command.

### 25. Revision owner red (AC-BV16-005, 5 minutes)

Create `pmo-portal/src/lib/adapterSeam/erpnext/adapter.budgetV16.test.ts`. Exact owner title from table. Drive four real v16 adapter commits: Salary old50000→60000, COGS old25000→25000, Equipment no occupant→10000, Travel remove with old5000. Assert Salary cancel+one create+submit with amended_from, COGS zero writes/same name, Equipment one create+submit, Travel cancel-only/no create; returned canonical IDs are the new version and accounts are correct. Fixture GETs expose docstatus, company, project, from/to years, header account/amount. Run RED:
`scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/adapter.budgetV16.test.ts'`

### 26. Read-only equality routing (AC-BV16-005, 4 minutes)

Implement ensure branch C4 in `adapter.ts`. Extract the exact existing private `toCents`/`fromCents` implementation from `pmo-portal/src/lib/budget/categoryAccountMap.ts` into new `pmo-portal/src/lib/budget/budgetAmount.ts`, export them, and import them back into the resolver without changing v15 output. The adapter compares `toCents(String(current.budget_amount)) === toCents(desired.budget_amount)`; amounts outside its exact grammar/range refuse. Assert `50000`, `50000.0`, `50000.00` equal, `50000.01` differs, malformed/nonfinite values refuse. Do not compare JS floats. Validate replacement body before any cancel. Verify task 25 command (Travel may still be the sole behavioral RED until task 27); do not claim task complete until its own equality assertions are GREEN.

### 27. Cancel-only dropped account (AC-BV16-005, 5 minutes)

Implement C4 remove routing in `adapter.ts`; unit stays `operation:'create'` so no client transition target is introduced. Factory resolves predecessor from companion and reverse witness even if current map has no Travel. Add supporting tests for no-op repeat cancel, network failure after cancel followed by cancelled readback, missing predecessor, wrong account/year/company, Desk draft, and unowned live. No zero Budget body. Verify task 25 command GREEN.

### 28. Revisions with entire account/year disappearance (AC-BV16-005 support, 5 minutes)

Add `budgetV16History.test.ts` cases: current single-year version has no nonzero lines→remove prior owned accounts; category absent from current map still removed; multi-FY one year's last category removed→include prior **valid in-span** year as a remove-only unit set. Use the live fiscal calendar and the same span validation as the gate; a now-out-of-span historical year is surfaced for operator action, never silently cancelled. Expose the gate's validated `inSpanFiscalYears:string[]` in `BudgetGateResult` (production result only; no change to `plan` shape), filled by existing span calculation, so neither foreground nor sweep invents a fiscal calendar. Do not change v15 empty-body refusal or v15 fan-out. Verify:
`deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json supabase/functions/adapter-dispatch/budgetV16History.test.ts`

### 29. Fenced same-document handoff red (AC-BV16-005/006 support, 5 minutes)

Create `supabase/tests/budget_v16_ref_handoff.test.sql`: real source account mirror+ref, new version outbox committed with current generation, unchanged ERP name. Assert RPC transfers exactly once, old historical mirror remains, one reverse ref remains; replay succeeds; stale generation returns 0. Separate assertions for another project/year/account/org, non-Active destination, stale activation witness, and a historical finalizer attempting transfer back must refuse. Assert Contact branch remains insert-only via existing contact test. RED:
`scripts/with-db-lock.sh supabase test db supabase/tests/budget_v16_ref_handoff.test.sql`

### 30. Implement fenced handoff (AC-BV16-005/006 support, 5 minutes)

Append current `record_outbox_ref` definition to 0292 and insert C3 v16-only branch. Check all witnesses under row locks; preserve non-budget and v15 paths. Derive identity from locked outbox, not RPC arguments. A conflict rolls back the transaction; no delete-then-insert gap. Implement NULL-safe `is distinct from` comparisons for witnesses. Verify:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_ref_handoff.test.sql supabase/tests/bfy_outbox_ref_rekey_race.test.sql'`

### 31. Operator-visible account text and release (AC-BV16-006 support, 5 minutes)

Create `pmo-portal/src/lib/adapterSeam/pushErrorCopy.budgetV16.test.ts`: `external-unreachable: account=COGS` retains existing transport/retry flags and adds `Account: COGS.` to message; account text with colon is intact; no raw code rendered. In `pushErrorCopy.ts` strip the final structured `: account=` suffix before existing classification, append bounded account text to message via string output (never HTML). Original inputs produce identical objects.

Create `pmo-portal/src/lib/repositories/budgetProjection.v16.test.ts`: release selection uses exact account identities from own companion year rows, plus legacy candidates, never another year/domain. In `releaseActiveBudgetPushHold` read companion `erp_account` for active version/year under RLS, build C1 identities, `.in('pmo_record_id',ids)`, retain existing RPC expected-domain guard. Keep existing one-command release behavior; status remains releasable until all holds are released. Verify:
`scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/pushErrorCopy.budgetV16.test.ts src/lib/repositories/budgetProjection.v16.test.ts src/lib/repositories/budgetProjection.test.ts'`

### 32. List-field owner red (AC-BV16-007, 3 minutes)

Create `supabase/functions/erpnext-sweep/budgetV16Fields.test.ts`, import actual selector from `./index.ts`, exact owner title. Assert explicit 16 fields contain from/to/account, exclude fiscal_year; 15/omitted retains original list. Add supporting real `sweepOrgDoctypesLive` fetch-spy test (the shipped export at `erpnext-sweep/index.ts:920`, no alternate handler) asserting outbound query fields actually use the major. RED:
`deno test --allow-all --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/budgetV16Fields.test.ts`

### 33. Wire versioned sweep fields (AC-BV16-007, 3 minutes)

In sweep `index.ts` change signature to `sweepFieldsForKind(kind:ErpDocKind,versionMajor?:number):string[]`; for budget only obtain base fields from `budgetFromDocFields(versionMajor)`, keep routing/company/anchor fields. Production call at current line1013 passes `org.versionMajor`. No other kind changes. Verify task 32 command GREEN plus `ownershipAndFields.test.ts` unchanged.

### 34. Account feed scope and intentional cancellation (AC-BV16-007/005 support, 5 minutes)

Create `supabase/functions/_shared/erpnextFeedDeps.budgetV16.test.ts` importing shipped `createErpFeedDeps`. Two accounts same version/year: Desk cancel Salary changes only Salary to failed/tombstoned/action-required; COGS unaffected; Desk amend Salary repoints only Salary and retains tombstone. Unknown native doc is never adopted; canonical amount is ignored. A mirror whose intent remove is already pushed/docstatus2 stays pushed when its own cancellation arrives. In `erpnextFeedDeps.ts`, use C1 parser to select companion for account identities and add year+account predicates in `scopeMirrorQuery`; dynamic table must be chosen for every read/update/tombstone/amend, not only lookup. Before assigning a cancel outcome, read that scoped row's `budget_intent`; do not trust an inbound payload to label its own cancellation intentional. `erpnext-webhook/index.ts:400–419` already calls the same shipped mapper and feed deps, so its v16 events take this exact routing without a second mapper or amount path. Preserve legacy table branch. Verify:
`deno test --allow-all --config supabase/functions/erpnext-sweep/deno.json supabase/functions/_shared/erpnextFeedDeps.budgetV16.test.ts supabase/functions/_shared/erpnextFeedDeps.test.ts`

### 35. Account candidate types and dedup (AC-BV16-004/007 support, 4 minutes)

Create `supabase/functions/erpnext-sweep/budgetV16Backstop.test.ts`, actual `budgetBackstopDepsLive` imported from `./index.ts`. Assert existing Salary mirror does not suppress COGS orphan, two years do not collide, and legacy candidates remain byte-identical. Add optional `erp_account?:string|null` and `budget_intent?:'ensure'|'remove'` to `BudgetMirrorCandidateRow`. Extend identity parsing and `budgetDedupKey` to include `erp_account` (legacy null sentinel). Enumerate companion rows in addition to original under same per-tick budget; no candidate dedup on version/year alone. Verify:
`deno test --allow-all --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/budgetV16Backstop.test.ts`

### 36. Account CAS and outbox lookup (AC-BV16-004/007 support, 4 minutes)

Extend new backstop test: attempts exhausted for Salary holds Salary only; foreground pushed row is not overwritten; absent COGS inserts held into companion with exact account; Desk tombstone never queued. Implement table/account predicates for `holdBudgetMirrorRow`, companion pending/failed select, and orphan insert. Derive identity/key with C1 for accounts; legacy use existing helpers unchanged. `findBudgetOutboxRow` receives complete identity. Verify task 35 command.

### 37. Recovery gate binds account and epoch (AC-BV16-004/005/007 support, 5 minutes)

Create `supabase/functions/erpnext-sweep/budgetV16Recovery.test.ts`, real `buildReconcileDepsLive` imported. Persisted ensure Salary must not reissue as COGS after a map edit; missing account refuses; changed activation timestamp spelling of same instant does not change key; genuinely newer activation does not recover an old intent. For remove, current desired map must still omit account and predecessor must have a same-org project/year/account reverse witness; in-span remove-only year is permitted. Implement `assertBudgetSweepGate` v16 checks using current C2 resolution, C1 identity/key and **shared epoch normalization**, not raw timestamp comparison. Preserve current no-write named `budget-sweep-gate-held` refusal and actor reauthorization. Verify:
`deno test --allow-all --config supabase/functions/erpnext-sweep/deno.json supabase/functions/erpnext-sweep/budgetV16Recovery.test.ts supabase/functions/erpnext-sweep/bfySweepGate.test.ts`

### 38. Recovery mirrors preserve replay tombstones (AC-BV16-004/007 support, 3 minutes)

Add new recovery test: confirmed/stored ensure canonical cannot clear one account's Desk tombstone; fresh successful push can. In `buildMoneyWriteDepsLive`, forward `options?.isReplay` from `writeReadModel(canonical,options)` into writer context, just as foreground does. Do not change outbox algorithm. Scope assertion to account branch; existing v15 tests must remain unchanged and green. Verify task 37 command plus existing `budgetOutboxOrphan.test.ts`.

### 39. Pending orphan fairness and no duplicate units (AC-BV16-004/007 support, 4 minutes)

Extend backstop test with >200 combined legacy/account candidates, stable queue order, one account throw and a later account still driven. Use the existing tick limit200 for the **combined** queue; fetch at most that many from each source, merge by created_at/id, slice200; do not fetch all tenant history. Preserve orphan eligibility `outbox_reconcile_candidates`, committing/quarantined-not-due handling and recorded actor. Verify task 35 command and `budgetBackstop.test.ts` unchanged.

### 40. Generate types and inspect hot query plans (AC-BV16-006 support, 4 minutes)

No new behavior. After green DB changes regenerate `pmo-portal/src/lib/supabase/database.types.ts` with:
`scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'`
Review only expected new relation/view/helper shape. Add SQL EXPLAIN checks to `budget_v16_status.test.sql` for org+version+year lookup using new unique and queue using `(org_id,push_state,created_at,id)` (fixture cardinality must justify planner choice; do not assert a tiny-table seq-scan is a defect). Verify:
`scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck'`

### 41. Rehearsal harness target guard (AC-BV16-008 support, 5 minutes)

Create `scripts/bv16-rehearsal.mjs` and `scripts/bv16-rehearsal.test.mjs` (Node built-in tests; no dependency install). Configuration is read from inherited FD3, never command arguments/env/logs. JSON fields: `localApi`, `localServiceKey`, `localAnonKey`, `firstActorJwt`, `secondActorJwt`, `rehearsalOrigin`, `rehearsalSite`, `erpAuthorization`, `company`, `salaryAccount`, `cogsAccount`, `fiscalYear`, `startDate`, `endDate`. Validate localApi is loopback, rehearsalSite nonempty and not frontend, distinct actors, explicit HTTPS rehearsal route, no redirect following, two distinct accounts, valid date span. No defaults to a live site or local v15 bed. Export guard functions; run entry only when main module. Test every rejection with synthetic nonsecret values. RED→guard implementation:
`node --test scripts/bv16-rehearsal.test.mjs`

### 42. Rehearsal fixture and real HTTP dispatch (AC-BV16-008, 5 minutes)

Extend harness test with a fetch spy which proves setup requests use local PMO and the nominated rehearsal origin only, and Budget writes are **not** made by the harness. Harness creates unique run-owned ERP Project and local PMO project/draft version and two map entries, snapshots local singleton rows before mutation, and verifies the **Director-prepared local-only** binding has the nominated rehearsal origin, company, explicit major16 and non-null activation. It adds only its project-map entry to that binding. Credential creation/rotation is not part of the harness. Seed first version by actor1; actor2 calls shipped `activate_budget_version`, then HTTP POST to loopback `/functions/v1/adapter-dispatch`:
`{domain:'budget',operation:'create',record:{id:versionId,erp_doc_kind:'budget'}}`.
Read actual local outbox/mirror rows and ERP Budget list/documents. Wait with bounded polling 60×1s, not arbitrary sleep. Assert exactly two submitted Budgets, 50000/25000, correct from/to year/account, Warn controls, Monthly/equal distribution, and no drafts. ERP list fields are only valid v16 fields. Verify task 41 command. This task builds a harness; mocked harness tests are NOT the live AC owner result.

### 43. Rehearsal revision oracle (AC-BV16-008, 4 minutes)

Harness actor1 clones via shipped `clone_budget_version`, edits only Salary to60000; actor2 activates clone then posts through the same real HTTP handler. Snapshot COGS ERP name+modified before. Assert Salary old doc cancelled, exactly one submitted successor with `amended_from=oldSalary`, amount60000; COGS name+modified unchanged, amount25000; exactly two submitted docs total. Repost identical dispatch and assert document count/names unchanged. Assert both activation witnesses and account identities in local DB. Emit only `AC-BV16-008 real-dispatch activation and single-account revision: PASS` and sanitized counts/amounts/version, not raw HTTP bodies, actors, keys, coordinates, account labels or document names. Verify task 41 command.

### 44. Rehearsal cleanup and honest failure (AC-BV16-008 support, 4 minutes)

Harness `finally` restores local binding/map snapshots and removes local run-owned fixtures only after saving private evidence. ERP cleanup is scoped to the created Project's returned Budget names and cancels only those; do not broad-delete any ERP table. A cleanup failure returns nonzero and saves a local-only cleanup manifest for Director action without logging credentials. Tests force assertion/setup/cleanup failures and prove no wildcard/destructive global request. If preserve-evidence mode is needed, explicit CLI `--retain-run` emits only an opaque local run token; Director owns later cleanup. Verify task 41 command.

### 45. Director read-only rehearsal preflight (AC-BV16-008, 2–5 minutes)

**DIRECTOR ONLY; no builder remote access.** Confirm through the private operations channel that the chosen route resolves solely to the rehearsal copy and selected site is not frontend; confirm actual ERPNext version16.33 through stock version handshake; make read-only Project/Account/Fiscal Year calls and verify the nominated fixture year and two expense leaf accounts. On the shared VM do not restart services, migrate, restore, switch a default site, or change live-site data. Configure the existing local runtime credential resolver for the rehearsal binding using its sanctioned secret seam; never copy live credentials or print them. Stop if isolated routing cannot be established. Prepare FD3 privately with the C41 JSON; no coordinates in this document or PR.

Exact **local** preflight for migrations and served lane (Director holds both resource locks in next task):
`supabase migration list --local`
Record applied0292 privately. No `--linked`, no production push, no seed against cloud.

### 46. Director real proof run (AC-BV16-008, 2–5 minutes)

**DIRECTOR ONLY.** With FD3 already opened by the Director's private shell and local runtime configured, run from repo root:

```bash
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh \
  scripts/serve-functions.sh -- node scripts/bv16-rehearsal.mjs --config-fd 3
```

The wrapper serves **this worktree's actual edge function**; the local binding points to rehearsal, so real auth, gate, unit fan-out, outbox RPCs, ref finalization and mirror writer all execute. This is not direct `budgetToBody`→ERP POST. Keep FD3 inherited through wrappers; if the local wrapper closes it, read FD3 into memory in a parent Node process and spawn the wrapper with explicit FD mapping—do not fall back to env/argument secrets. Record sanitized PASS evidence and baseline/revision/replay counts in PR. Keep raw proof privately. If transport cannot reach rehearsal from local runtime, STOP: closest honest equivalent is captured shipped `index.ts` handler in Deno with **real** local Supabase/auth and real ERP fetch, but it is a non-HTTP equivalent and must be labeled as such and approved by Director before claiming AC-008. A mocked handler or hand-built ERP body never qualifies.

### 47. Local scoped final gate (all ACs, verification only, 5 minutes active time)

Leave all existing v15-pinning tests unchanged. Commands:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
node scripts/check-edge-fn-test-binding.mjs
node --test scripts/bv16-rehearsal.test.mjs
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/budget_v16_accounts.test.sql supabase/tests/budget_v16_identity.test.sql supabase/tests/budget_v16_status.test.sql supabase/tests/budget_v16_projection.test.sql supabase/tests/budget_v16_rls.test.sql supabase/tests/budget_v16_rollback.test.sql supabase/tests/budget_v16_ref_handoff.test.sql supabase/tests/bfy_push_status_per_year.test.sql supabase/tests/bfy_projection_null_lines.test.sql supabase/tests/budget_projection_rpc.test.sql'
```

Run ESLint with zero warnings on exactly changed app TS paths:
`git diff --name-only --diff-filter=ACM origin/dev -- pmo-portal | grep -E '\.(ts|tsx)$' | while IFS= read -r f; do (cd pmo-portal && npx eslint --max-warnings=0 "${f#pmo-portal/}") || exit; done`

Run these exact targeted Deno and v15 pin commands:

```bash
deno test --allow-all --config supabase/functions/adapter-dispatch/deno.json \
  supabase/functions/adapter-dispatch/budgetV16Key.test.ts \
  supabase/functions/adapter-dispatch/budgetV16Binding.test.ts \
  supabase/functions/adapter-dispatch/budgetV16History.test.ts \
  supabase/functions/adapter-dispatch/budgetV16Replay.test.ts \
  supabase/functions/adapter-dispatch/budgetV16Partial.test.ts \
  supabase/functions/adapter-dispatch/readModelWriters.budgetV16.test.ts \
  supabase/functions/adapter-dispatch/bfyTypedCommand.test.ts \
  supabase/functions/adapter-dispatch/bfyColonFyRoundtrip.test.ts \
  supabase/functions/adapter-dispatch/bfyUnownedLiveOccupant.test.ts \
  supabase/functions/adapter-dispatch/budgetPushOutcome.test.ts \
  supabase/functions/adapter-dispatch/readModelWriters.test.ts
deno test --allow-all --config supabase/functions/erpnext-sweep/deno.json \
  supabase/functions/erpnext-sweep/budgetV16Fields.test.ts \
  supabase/functions/erpnext-sweep/budgetV16Backstop.test.ts \
  supabase/functions/erpnext-sweep/budgetV16Recovery.test.ts \
  supabase/functions/erpnext-sweep/bfySweepGate.test.ts \
  supabase/functions/erpnext-sweep/budgetHeldPrecondition.test.ts \
  supabase/functions/erpnext-sweep/budgetOutboxOrphan.test.ts \
  supabase/functions/erpnext-sweep/sweepTickBudget.test.ts \
  supabase/functions/erpnext-sweep/sweepWedge.test.ts \
  supabase/functions/_shared/erpnextFeedDeps.budgetV16.test.ts \
  supabase/functions/_shared/erpnextFeedDeps.test.ts
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/bodies/budget.test.ts src/lib/adapterSeam/erpnext/adapter.commitBudget.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.budget.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.budgetRecovery.test.ts src/lib/adapterSeam/erpnext/budgetNeverPushesProjection.test.ts src/lib/adapterSeam/erpnext/budgetPushKey.test.ts src/lib/adapterSeam/erpnext/doctypeRegistry.test.ts src/lib/adapterSeam/erpnext/fiscalYearEncoding.test.ts'
``` Never skip/weaken a failing pin.

After restoring the local v15 binding/credentials, Director runs the actual serial served lane (a bare fragment defaults to chromium and silently misses these tests):

```bash
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh scripts/serve-functions.sh -- \
  scripts/e2e-local.sh --project=serial --workers=1 \
  AC-BUD-030 AC-BUD-031 AC-BUD-032 AC-BFY-011 AC-BFY-012 AC-BFY-026 AC-BFY-031
```

The existing private/local bench configuration must already be loaded; a missing-dependency skip is not passing evidence. CI `verify`+`pgtap` decide PR→dev; full integration decides promotion to main. Do not run a full shared-Mac verify suite here. Require ≥80% changed-line coverage; CI is the full-suite gate. A live AC-008 still BLOCKED means issue not accepted even if local gates are green.

### 48. Record evidence and architectural decision (all ACs, docs only, 3 minutes)

Update this plan's execution checklist with actual RED/GREEN command outputs and the AC owner matrix results, no invented passes. ADR-0087 records C1/C3, scoped ref handoff, retained v15 storage, rollback boundary, and consequences. Spec/code-quality/security reviewers all review money-path evidence; mutation-check the account/year witness and generation checks (a deliberately wrong account or always-true ownership check MUST turn new tests red; restore code before any commit). No commit/push is part of this task or this planning request.

## Acceptance / remaining Director actions

- [ ] Approve the explicitly justified companion-mirror physical design (or obtain the narrow test-contract change required for a single-table design).
- [ ] Builder completes 48 tasks, leaving no temporary stubs and all unchanged v15 pins green.
- [ ] Director runs tasks45–46 on rehearsal only; attaches sanitized actual proof, not this plan as evidence.
- [ ] Reviewers confirm three-layer traceability, account-aware recovery/cancel ownership, hot query indexes, and reversible unused-state rollback.
- [ ] CI passes; no production operation authorized by this document.

## Appendix A — AC-006 owning SQL fixture

This is the complete new `supabase/tests/budget_v16_accounts.test.sql` body. IDs and labels below are synthetic test data. It follows the verified BFY fixture's Draft→seed→Active ordering, not a bypass of the draft-line guard. The one `ok` is the owning AC goal oracle; the other SQL test files own supporting mechanism checks only.

```sql
begin;
select plan(1);
insert into public.organizations(id,name)
values ('0b160000-0000-0000-0000-000000000001','BV16 test organization');
insert into auth.users(id,email)
values ('0b160000-0000-0000-0000-0000000000a1','bv16-fixture@example.invalid');
insert into public.profiles(id,org_id,full_name,email,role,status)
values ('0b160000-0000-0000-0000-0000000000a1',
        '0b160000-0000-0000-0000-000000000001','BV16 fixture',
        'bv16-fixture@example.invalid','Finance','active');
insert into public.projects(id,org_id,name,status,start_date,end_date)
values ('0b161111-0000-0000-0000-000000000001',
        '0b160000-0000-0000-0000-000000000001','BV16 fixture project',
        'Ongoing Project','2025-01-01','2026-12-31');
insert into public.budget_versions(id,org_id,project_id,version,name,status)
values ('0b162222-0000-0000-0000-000000000001',
        '0b160000-0000-0000-0000-000000000001',
        '0b161111-0000-0000-0000-000000000001',1,'BV16 fixture version','Draft');
insert into public.budget_line_items
  (org_id,budget_version_id,category,description,budgeted_amount,actual_amount,fiscal_year)
values ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','Labor','Fixture labor',50000,0,'2026'),
       ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','Materials','Fixture materials',25000,0,'2026');
update public.budget_versions
set status='Active',activated_at='2026-10-15T10:00:00Z'
where id='0b162222-0000-0000-0000-000000000001';
insert into public.budget_version_account_erp_mirror
  (org_id,budget_version_id,fiscal_year,erp_account,push_state,push_error,
   erp_budget_name,erp_docstatus,activated_at_witness)
values ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','2026','Salary','pushed',null,
        'BV16-SALARY-TEST',1,'2026-10-15T10:00:00Z'),
       ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','2026','COGS','failed',
        'external-unreachable',null,null,'2026-10-15T10:00:00Z');
-- Original relation/key remains legal, with no account field at all.
insert into public.budget_version_erp_mirror
  (org_id,budget_version_id,fiscal_year,push_state,erp_budget_name)
values ('0b160000-0000-0000-0000-000000000001',
        '0b162222-0000-0000-0000-000000000001','2025','pushed','BV15-TEST');
set local role authenticated;
set local request.jwt.claims=
  '{"sub":"0b160000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select ok(
  (select count(*)=2 from public.budget_version_account_erp_mirror
    where budget_version_id='0b162222-0000-0000-0000-000000000001' and fiscal_year='2026')
  and (select count(*)=1 from public.get_budget_push_status('0b161111-0000-0000-0000-000000000001')
    where fiscal_year='2026')
  and (select push_state='failed' and position('account=COGS' in push_error)>0
    from public.get_budget_push_status('0b161111-0000-0000-0000-000000000001') where fiscal_year='2026')
  and (select count(*)=1 from public.budget_version_erp_mirror
    where budget_version_id='0b162222-0000-0000-0000-000000000001' and fiscal_year='2025')
  and (select push_state='pushed' and erp_budget_name='BV15-TEST'
    from public.get_budget_push_status('0b161111-0000-0000-0000-000000000001') where fiscal_year='2025'),
  'AC-BV16-006 account mirrors coexist and year reports the failing account');
select finish();
rollback;
```
