# P3a money-path primer — read this INSTEAD of re-deriving the architecture

Orientation doc for anyone (human or agent) working the ERPNext money path. It exists so a fix or
audit lane does not spend its first third re-reading ADR-0058, the review docs and six source files
to rebuild the same mental model. **It is a map, not an authority** — where this disagrees with the
code or an ADR, they win, and you should fix this file.

## The one-paragraph model

PMO writes money into ERPNext through `adapter-dispatch` (an edge function). Every write is fenced by
an **outbox** (`external_command_outbox`, ADR-0058) whose job is a single invariant: **one PMO record
mints at most one ERP document, ever.** A write is *claimed* (generation-fenced), *committed* to ERP,
then *finalized* (external ref + read-model mirror), then *confirmed*. Anything that dies mid-way is
recovered by the **sweep**, which re-runs the same algorithm. Separately, ERP changes flow back in via
a **webhook** (latency) and the **sweep poll** (truth) into read-model mirror tables.

## The five things that keep going wrong

Every audit round has found defects in one of these five buckets. Check yours against them first.

1. **Duplicate money.** Two ERP documents for one intent. Causes found so far: per-click idempotency
   keys (the retry never reused the key); a claim budget that didn't bound the actual POST; a recovery
   probe that reissued while the original request was still alive; concurrent creates on one record.
2. **Wrong-document adoption.** The recovery probe or the sweep poll adopts an ERP doc that isn't
   ours. Causes: unescaped LIKE metacharacters in the key; short/non-opaque keys matching as
   substrings; missing `payment_type` discriminator (a Receive adopting a Pay entry); a stale or
   capped in-flight key set.
3. **Separation of duties.** One human sets the money *and* approves it. Causes: author stamped only
   on create (so an approver's edit was unattributed); last-writer-wins authorship; a clearance TTL
   shorter than the operation it guards; a release path reachable by the party being constrained.
4. **Tenancy.** A row crosses an org or an ERP company boundary. Remember RLS does **not** protect
   service-role writes — the sweep, the webhook and the mirror writers must enforce org scoping
   themselves.
5. **Wrong number on screen.** The DB can be perfect and the UI still lies: silent PostgREST
   truncation (`max_rows = 1000` bounds *any* single read), unstable paging, statuses derived without
   their oracle, a fabricated `$0` rendered from a failed query.

## Invariants you must not break

- **ADR-0058 C-1**: a *mutable-anchor* kind (Payment Entry) is **held, never reissued** on an
  inconclusive probe. Immutable-anchor kinds (Sales/Purchase Invoice) may reissue.
- **Fencing**: `claim_generation` discards a stale claimant's *write-backs*. It cannot un-mint their
  *ERP document* — so never rely on it to prevent a duplicate POST.
- **Draft-then-submit** (OD-SAR-DRAFT-SUBMIT): an SI is created as an ERP DRAFT; a *different* user
  submits it. Any path that rebuilds the invoice body is an authorship event.
- **The ledger is the oracle** (ADR-0048): PMO mirrors ERP money, never recomputes it.
- **Fail closed.** A guard that cannot evaluate must refuse, not pass.

## Where things live

| Concern | File |
|---|---|
| Claim / commit / finalize / recover | `pmo-portal/src/lib/adapterSeam/dispatch.ts` |
| ERP HTTP transport, retries, deadlines | `.../erpnext/client.ts` |
| Recovery probes (anchor + PE composite) | `.../erpnext/recoveryProbe.ts` |
| Per-doctype behaviour (submittable, anchor) | `.../erpnext/doctypeRegistry.ts` |
| Request body builders / `fromDoc` mappers | `.../erpnext/bodies/*` |
| Dispatch entry, gates, authz | `supabase/functions/adapter-dispatch/index.ts` + `*Guard.ts` |
| Read-model mirror writers | `supabase/functions/adapter-dispatch/readModelWriters.ts` |
| Inbound feed (adopt, lifecycle, status) | `supabase/functions/_shared/erpnextFeedDeps.ts` |
| Sweep (recovery pass + doctype poll) | `supabase/functions/erpnext-sweep/index.ts` |
| Outbox schema + its RPCs | `supabase/migrations/0096_erpnext_seam_tables.sql` |

## Numeric relationships that MUST hold (a whole round was lost to one of these)

These constants live in different files and nothing type-checks their relationship. If you change one,
re-check the others and assert the relationship in a test:

- quarantine reclaim window (`0096`, 5 min) **>** claim budget + POST deadline + settle margin
- per-attempt ERP deadline × max attempts **<** the window any lock/clearance guarding it is given
- SoD clearance TTL **>** the longest an ERP submit can still be in flight
- any PostgREST read cap **<** `max_rows` (1000) — a `limit(1001)` saturation check can never fire

## How to verify (and what each gate does NOT prove)

- `npm run verify` — typecheck + lint + unit + build. Proves nothing about ERP behaviour.
- `supabase test db` via `scripts/with-db-lock.sh` — RLS/RPC truth. Single-session: it cannot express
  a real concurrency interleave, only the mechanism.
- deno tests per edge function — pure logic at the seam. Does not prove the call site is *wired*.
- the served-fn money e2e vs the live bench — the only gate that touches real ERPNext. It asserts **DB
  rows, not rendered figures**, so a wrong number on screen passes it.

**Shared-resource rule:** one local Supabase and one ERPNext bench serve every worktree. Wrap every
DB-driving command in `scripts/with-db-lock.sh`, and chain `db reset && supabase test db` in ONE hold
— a sibling reset between them silently contaminates the result.
