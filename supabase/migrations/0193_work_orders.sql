-- 0193_work_orders.sql — DD-WO-1..6 / #498: the client's inbound PO, drawing down against a
-- project's contract ceiling. REVENUE side. Not procurement, not a vendor order.
--
-- ── WHAT THIS IS ────────────────────────────────────────────────────────────────────────────────
-- A project IS the client's commitment (OD-WO-1); `projects.contract_value` is its CEILING. A work
-- order is the client's PO for a scoped activity inside that commitment, and the sum of issued work
-- orders is the DRAWDOWN against the ceiling. Maximising that drawdown is the PM's job, so
-- `Σ work_orders / project.contract_value` is a first-class number, not a report someone assembles.
--
-- ⚑ REUSING `purchase_orders` WOULD BE WRONG (DD-WO-6), and the similarity is only that both are
--   called "PO". `purchase_orders` is a CHILD of a procurement case and an OUTBOUND vendor order:
--   its authorization routes through the procurement parent, its ERP posture points the other way,
--   and mixing the two sums would silently blend OUR vendor commitments with the CLIENT's grants —
--   the worst defect available on this table.
--
-- ── SHAPE (DD-WO-1) ─────────────────────────────────────────────────────────────────────────────
--   • ONE table. No child line-item table in v1 (#496 parked: whether real client POs carry lines).
--   • `project_id` NOT NULL — a work order with no commitment has no ceiling to draw against.
--     Deliberately unlike `tasks`, where nullable was the point.
--   • NO `client_id` — derive from `projects.client_id`. A second copy is a second answer.
--   • `wo_number` is minted by the EXISTING `next_procurement_doc_number(org,'WO')` (0006), which is
--     already atomic per-(org, prefix, day) and already revoked from anon/authenticated. The
--     procurement-flavoured name is cosmetic. There is no second minter.
--   • `currency` (0187) + the tax treatment (0188) from day one — the inclusive/exclusive marker is
--     the fact no later inference recovers, and an ERPNext Sales Order cannot be built without it.
--
-- ── DRAWDOWN IS DERIVED, NEVER STORED (DD-WO-2) ─────────────────────────────────────────────────
-- `get_project_drawdown()` is SECURITY INVOKER, copying `get_project_budget`, which carries an
-- explicit "do NOT add security definer" comment: each base-table read runs under the CALLER'S RLS,
-- so the aggregate is org-scoped automatically.
-- ⚑ Citation, per DD-BRIEF-1 (cite where a definition LIVES): its BODY is still 0005 §1 — but its
--   `search_path` pin is NOT, it was retrofitted by `0021` (`alter function … set search_path`,
--   AC-DBLINT-001) after the linter flagged all four invoker aggregation RPCs. §6 below pins
--   search_path INLINE so this function never needs that second migration. It is NOT a stored balance —
-- `projects.spent` was added in 0001:79 marked "DEFERRED: stored vs derived", is still unmaintained,
-- and the UI derives instead. Stored rollups rot in this schema.
--
-- ── OVER-CEILING IS ALLOWED, WARNED AND ATTRIBUTED — NOT BLOCKED (DD-WO-2) ──────────────────────
-- `contract_value` is Exec/Finance-gated once a project is won (ADR-0019 / 0014), so a hard cap
-- would stop a PM RECORDING A REAL CLIENT PO until someone a role away raised the ceiling — a
-- control that blocks recording reality. Instead `transition_work_order` computes the sum under the
-- PARENT's row lock and, on exceed, requires an explicit `p_over_commit_ack` it refuses to assume
-- (fail closed), stamping who acknowledged. Without that stamp there is no record ANYWHERE of who
-- chose to over-commit.
--
-- ⚑ ONE HONEST GAP, STATED RATHER THAN PAPERED OVER — the TAX BASIS of the comparison.
--   `order_value` carries `tax_treatment`, so this row's own arithmetic is total. `contract_value`
--   does NOT: 0187 gave `projects` a currency and #478 stopped at the sales invoice, so nothing
--   records whether a project's ceiling is stated gross or net. The drawdown therefore compares
--   STATED FIGURE against STATED FIGURE, which is right whenever both are keyed the same way — and
--   the two disagree by exactly the tax rate when they are not. That is a "wrong number on screen"
--   shape (money-path primer §5), so it is flagged here rather than hidden: the fix is a
--   `tax_treatment` on `projects`, which is a #478-class decision about the CONTRACT and not
--   something to smuggle into this slice. ⚑ And the error is NOT one-directional — a tax-EXCLUSIVE
--   work order under a tax-INCLUSIVE ceiling UNDER-detects the over-commitment (waves one through),
--   while the opposite pairing over-detects. Do not read this note as "it fails safe".
--
-- ── SoD: COPY THE SHIPPED PATTERN, DO NOT INVENT ONE (DD-WO-3) ──────────────────────────────────
-- `set_work_order_value` is the SOLE writer of `order_value`, exactly as `set_project_contract_value`
-- is for `contract_value`; `work_orders_stamp_value_witness` records WHO set it (0177 §B1);
-- and the `Draft -> Issued` gate refuses when the witness is the issuer, is inactive, or does not
-- outrank / line-manage the issuer (0178 §6 + 0181 + 0183, the three recorded variants:
-- witness=winner, offboarded, demoted).
--
-- ⚑ Citation, per DD-BRIEF-1: `0014` is where the sole-writer MECHANIC is defined and argued (A1 the
--   RPC, A2 the grant surgery), and it is the right thing to cite for the PATTERN. It is NOT where
--   `set_project_contract_value` lives — that body has been replaced three times since and is owned by
--   `0178` (rank thresholds + the active-member conjunct). Read 0014 for the shape, 0178 for the code.
--
-- ⚑ THE 0014 A2 MECHANIC, WRITTEN OUT EVEN THOUGH THIS TABLE IS NEW. A column-level REVOKE cannot
--   subtract from a table-level GRANT — it is a SILENT NO-OP, and that is how `contract_value` stayed
--   client-writable until 0014 revoked the TABLE grant and re-granted the column list MINUS the
--   protected column. §5 below issues the (today no-op) `revoke ... on work_orders from
--   authenticated, anon` FIRST and then grants ONLY column lists, so the table never holds a
--   table-level INSERT/UPDATE grant for a client role at any point in its history. The revokes are
--   written rather than assumed for the same reason 0177 §B1 wrote its no-op revokes: the intent
--   belongs in the migration, not only in the test. 0171 §J asserts the resulting privilege state.
--
-- ── POST-ISSUE EDITS ARE FORBIDDEN, AND THE FREEZE COVERS THE WHOLE BODY (DD-WO-5) ──────────────
-- If a work order's pushable content can change after issue, `issued_at` stops being a stamp that
-- moves when pushable content moves. A later re-push then DERIVES AN IDENTICAL ADR-0059 §4 key,
-- hits the outbox single-use constraint (0134), and is SILENTLY SUPPRESSED — leaving ERPNext holding
-- the wrong figure with no error anywhere. That is the OQ-BUD-2 failure (0137 / #479) and this
-- migration kills the class rather than compensating for it. An amended PO is Cancel + re-issue,
-- which is also how ERPNext amends.
--
-- ⚑ DELIBERATELY WIDER THAN THE RULING. DD-WO-5 forbids post-issue VALUE edits; `assert_work_order_update`
--   freezes EVERY body column (title, description, dates, the client's PO reference, currency and all
--   four tax fields), because every one of them is pushable content and each would break the stamp in
--   exactly the same way. Freezing only the value would close one path and leave the others open —
--   the shape that produced SoD slices 2-6.
-- ⚑ AND IT IS NOT EXEMPTED FOR SERVER AUTHORITY, unlike the origination guard. `set_work_order_value`
--   is SECURITY DEFINER and runs as the table owner, so an `actor_bypasses_rls()` carve-out would
--   exempt the exact writer the freeze exists to stop. There is no mirror writer for this table in v1
--   (the push is out of scope, DD-WO-6); WHEN one lands it will need an explicit, test-visible
--   carve-out here — adding it silently would re-open the class.
--
-- ── LIFECYCLE (DD-WO-3): Draft -> Issued -> Closed, plus Cancelled from either live state ────────
-- Deliberately NOT states: worked, delivered, invoiced, paid. Paid-ness already has an oracle on the
-- invoice (`sales_invoices.erp_outstanding_amount`, ADR-0048) and a second copy would disagree.
-- `Closed` and `Cancelled` are TERMINAL — which is also what makes `issued_at` a once-only stamp.
--
-- ── DELETE: there is none, and that is the decision ─────────────────────────────────────────────
-- No DELETE grant and no DELETE policy: `Cancelled` IS the soft-delete (ADR-0018 prefers archive over
-- hard-delete), and a hard-deletable money document with a minted document number is not a thing this
-- schema should own. `sales_invoices.work_order_id` and the `projects` FK are plain references, so a
-- referenced row FK-blocks with 23503 ("in use") — including an Admin's project hard-delete
-- (`projects_delete_admin_only`, 0052), which now correctly refuses while work orders exist.
--
-- ── REVERSIBILITY (ADR-0006, pre-production): `supabase db reset`. Manual reverse block, in order:
--   alter table public.sales_invoices drop column if exists work_order_id;
--   drop function if exists public.check_sales_invoice_work_order_same_project() cascade;
--   -- then re-apply 0189 §1's sales_invoices_native_mirror_guard() body verbatim (without work_order_id)
--   drop function if exists public.transition_work_order(uuid, work_order_status, boolean);
--   drop function if exists public.set_work_order_value(uuid, numeric);
--   drop function if exists public.get_project_drawdown(uuid);
--   drop table if exists public.work_orders;     -- cascades its policies + triggers
--   drop function if exists public.assert_work_order_update();
--   drop function if exists public.assert_work_order_origination_insert();
--   drop function if exists public.stamp_work_order_value_witness();
--   drop function if exists public.check_work_order_project_currency();
--   drop function if exists public.audit_work_order_insert();
--   drop type if exists public.work_order_status;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the status enum and the table
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create type public.work_order_status as enum ('Draft','Issued','Closed','Cancelled');

create table public.work_orders (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id)
                       default '00000000-0000-0000-0000-000000000001',
  -- ⚑ NOT NULL and immutable (§4): the ceiling this row draws against. No client_id — derive it
  --   from projects.client_id.
  project_id         uuid not null references public.projects(id),

  -- OUR sequence, minted once at issue by transition_work_order. NULL while Draft.
  wo_number          text,
  -- THE CLIENT's own PO reference. Free text: it is their document, not ours, and it is not unique
  -- across clients. Both identifiers are kept (#471 asked "ours, theirs, or both?" — both).
  client_po_number   text,

  title              text not null,
  description        text,
  status             public.work_order_status not null default 'Draft',

  -- ⚑ SOLE WRITER: set_work_order_value (§7) after creation; the origination INSERT before it.
  --   Removed from the client UPDATE column list in §5 — that is the whole control.
  order_value        numeric(14,2) not null default 0,

  -- 0187 (#478). Trigger-defaulted from organizations.default_currency; 'XXX' is the "caller stated
  -- nothing" sentinel the trigger overrides and the CHECK forbids surviving.
  currency           text not null default 'XXX',

  -- 0188 (#478). tax_treatment answers exactly one question: does THIS ROW's `order_value` already
  -- include `tax_amount`? Text with NO DEFAULT so an omission is a hard 23502 and a garbage value a
  -- hard 23514 — a boolean would let a falsy default silently mean 'exclusive'.
  tax_treatment      text not null,
  tax_amount         numeric(14,2) not null,
  tax_rate           numeric(6,3),
  tax_template       text,

  order_date         date,
  start_date         date,
  end_date           date,

  -- ── WITNESSES AND STAMPS. Never inputs: withheld from every client grant in §5, refused by the
  --    origination guard in §3, and written only by a trigger or by a definer RPC.
  order_value_set_by uuid references public.profiles(id),
  order_value_set_at timestamptz,
  issued_by          uuid references public.profiles(id),
  issued_at          timestamptz,
  over_commit_ack_by uuid references public.profiles(id),
  over_commit_ack_at timestamptz,
  closed_at          timestamptz,
  cancelled_at       timestamptz,

  created_at         timestamptz not null default now(),

  -- NULLs are distinct in a unique index, so every Draft may carry a NULL wo_number.
  unique (org_id, wo_number)
);

-- `>= 0` alone is NOT sufficient: Postgres orders numeric NaN ABOVE every ordinary value, so
-- 'NaN'::numeric >= 0 is TRUE and PostgREST coerces the JSON string "NaN" straight into the column.
-- The upper bound is what actually rejects NaN. Same construction and reason as 0169 / 0188.
alter table public.work_orders
  add constraint work_orders_order_value_nonneg
  check (order_value >= 0 and order_value < 'Infinity'::numeric);
alter table public.work_orders
  add constraint work_orders_tax_amount_nonneg
  check (tax_amount >= 0 and tax_amount < 'Infinity'::numeric);
alter table public.work_orders
  add constraint work_orders_tax_rate_pct
  check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100));
alter table public.work_orders
  add constraint work_orders_tax_treatment_domain
  check (tax_treatment in ('inclusive','exclusive'));
alter table public.work_orders
  add constraint work_orders_currency_iso4217
  check (currency ~ '^[A-Z]{3}$' and currency <> 'XXX');

-- RLS predicate + the drawdown aggregate both filter on (org_id, project_id); the status filter
-- rides along so the committed/draft split is index-only.
create index work_orders_org_project_status_idx
  on public.work_orders (org_id, project_id, status);
-- FK hot paths (the 0042/0178 lesson: an uncovered FK seq-scans this table on every profiles write).
create index work_orders_project_idx            on public.work_orders (project_id);
create index work_orders_order_value_set_by_idx on public.work_orders (order_value_set_by);
create index work_orders_issued_by_idx          on public.work_orders (issued_by);
create index work_orders_over_commit_ack_by_idx on public.work_orders (over_commit_ack_by);

comment on table public.work_orders is
  'DD-WO-1/#498 — the CLIENT''s inbound purchase order for a scoped activity inside a project''s '
  'commitment. REVENUE side: it draws DOWN against projects.contract_value. Not procurement, and '
  'deliberately not purchase_orders (which is an OUTBOUND vendor order under a procurement case).';
comment on column public.work_orders.order_value is
  'DD-WO-3 — the scope grant''s value, in `currency`. SOLE WRITER: set_work_order_value (plus the '
  'origination INSERT). Removed from the client UPDATE column list; FROZEN once the row leaves Draft.';
comment on column public.work_orders.wo_number is
  'DD-WO-1 — OUR document number, minted once at Draft->Issued by next_procurement_doc_number(org,''WO''). '
  'NULL while Draft. Never client-settable.';
comment on column public.work_orders.client_po_number is
  'DD-WO-1 — the CLIENT''s own PO reference. Their document, not ours: free text, not unique.';
comment on column public.work_orders.order_value_set_by is
  'WITNESS, never an input: who last set order_value, stamped by work_orders_stamp_value_witness. '
  'Read by transition_work_order''s issue SoD. Unlike projects.contract_value_set_by a NULL here is '
  'REFUSED at issue — see §8.';
comment on column public.work_orders.over_commit_ack_by is
  'DD-WO-2 — who explicitly acknowledged issuing this work order past the project''s contract ceiling. '
  'NULL means the issue did not exceed the ceiling. Never client-settable.';
comment on column public.work_orders.tax_treatment is
  'DD-XING-4/#478 shape — does THIS row''s `order_value` already include `tax_amount` (''inclusive'') '
  'or not (''exclusive'')? NOT NULL with no default: the one fact no later inference recovers.';
comment on column public.work_orders.currency is
  'OD-CR-5 — ISO-4217 currency this row''s money columns are denominated in. Trigger-defaulted from '
  'organizations.default_currency; pinned equal to the parent project''s currency (§2).';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — BEFORE-INSERT stamps and the currency pin.
--
-- ⚑ TRIGGER NAMES ARE LOAD-BEARING. Postgres fires BEFORE-row triggers in NAME order, so:
--     work_orders_origination_guard      (o…)   — refuses forged stamps, needs nothing stamped yet
--     work_orders_stamp_org_id           (s…)   — 0074: puts the caller's REAL org on the row
--     work_orders_stamp_value_witness    (s…)   — 0177 §B1 idiom, independent of the two above
--     work_orders_zz_stamp_currency      (zz_s) — 0187: resolves the default from new.org_id, so it
--                                                 MUST run after stamp_org_id (DD-CUR-2)
--     work_orders_zz_zcheck_project_currency (zz_z) — compares the STAMPED currency, so it must run
--                                                 after zz_stamp_currency ('s' < 'z' at the same
--                                                 position under both C and en_US collation)
--   Renaming any of these "alphabetically tidier" silently reorders them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create trigger work_orders_stamp_org_id
  before insert on public.work_orders
  for each row execute function public.stamp_org_id();

create trigger work_orders_zz_stamp_currency
  before insert on public.work_orders
  for each row execute function public.stamp_currency();

-- The 0177 §B1 witness idiom, verbatim in its reasoning:
--   • NOT exempted via actor_bypasses_rls(). This is a WITNESS, not a guard: it must record the truth
--     for EVERY writer or the oracle it feeds is a lie.
--   • The precision is in `update OF order_value`, NOT in a value comparison. Requiring
--     `new.order_value is distinct from old.order_value` was a real defect on projects (AC-PMS-020):
--     the ratifier's natural act is to CONFIRM the figure the originator proposed — the SAME number —
--     which is not a change, so the witness was not re-stamped and the two-person path DEADLOCKED.
--     Setting the value to the number it already holds is still an act of authorship, and it is the
--     one the rule is asking for.
create or replace function public.stamp_work_order_value_witness() returns trigger
  language plpgsql set search_path = public as $$
begin
  new.order_value_set_by := auth.uid();
  new.order_value_set_at := now();
  return new;
end; $$;

create trigger work_orders_stamp_value_witness
  before insert or update of order_value on public.work_orders
  for each row execute function public.stamp_work_order_value_witness();

-- A work order draws down against ITS PROJECT's ceiling, so summing rows denominated differently
-- from that ceiling produces a number that is silently meaningless. Today this can never fire
-- (0187 stamps both the project and the work order from organizations.default_currency), which is
-- exactly why it belongs here: it pins the invariant the drawdown arithmetic depends on BEFORE
-- multi-currency arrives, instead of discovering it as a wrong figure on a screen.
create or replace function public.check_work_order_project_currency() returns trigger
  language plpgsql set search_path = public as $$
declare v_project_currency text;
begin
  select p.currency into v_project_currency from public.projects p where p.id = new.project_id;
  if v_project_currency is distinct from new.currency then
    raise exception
      'work order currency % does not match project currency %: a work order draws down against its project''s contract ceiling, so the two must be denominated alike',
      new.currency, coalesce(v_project_currency, '<project not found>')
      using errcode = '23514';
  end if;
  return new;
end; $$;

create trigger work_orders_zz_zcheck_project_currency
  before insert or update on public.work_orders
  for each row execute function public.check_work_order_project_currency();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — origination guard (INSERT). Pattern: assert_sales_invoice_origination_insert (0176 §1b).
--
-- Defence in depth BEHIND the column grant of §5: the grant layer's 42501 names nothing, while this
-- layer names the offending column. Every branch uses `is distinct from` / `is not null` so it is
-- NULL-TOTAL — `new.status <> 'Draft'` is NULL for an explicit `status => NULL` and a NULL condition
-- FALLS THROUGH, which is the exact defect 0176 §6 had to repair in four guards.
--
-- Server-side authority (postgres / service_role / supabase_admin) is exempt: the seed, the historical
-- importer and any future mirror writer legitimately construct rows in a non-origination state.
-- ⚑ The witness columns get no branch here ON PURPOSE — work_orders_stamp_value_witness OVERWRITES
--   them unconditionally on every insert, so a forged value never survives to be checked.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_work_order_origination_insert() returns trigger
  language plpgsql set search_path = public as $$
begin
  if public.actor_bypasses_rls() then
    return new;
  end if;

  if new.status is distinct from 'Draft' then
    raise exception
      'work_orders.status "%" is not the origination status: a work order is created as a Draft, and Issued / Closed / Cancelled are reached only through transition_work_order, whose issue gate enforces that the person who set the value is not the person issuing it',
      new.status
      using errcode = 'P0001';
  end if;

  if new.wo_number is not null then
    raise exception
      'work_orders.wo_number cannot be set when a work order is created: the document number is minted only by next_procurement_doc_number, called from transition_work_order at issue'
      using errcode = 'P0001';
  end if;

  if new.issued_by is not null or new.issued_at is not null then
    raise exception
      'work_orders.issued_by / issued_at cannot be set when a work order is created: the issue stamp is written only by transition_work_order, and it is what a later ERP push derives its idempotency key from'
      using errcode = 'P0001';
  end if;

  if new.over_commit_ack_by is not null or new.over_commit_ack_at is not null then
    raise exception
      'work_orders.over_commit_ack_by / over_commit_ack_at cannot be set when a work order is created: the over-commitment acknowledgement is stamped only by transition_work_order, at the moment it is actually required'
      using errcode = 'P0001';
  end if;

  if new.closed_at is not null or new.cancelled_at is not null then
    raise exception
      'work_orders.closed_at / cancelled_at cannot be set when a work order is created: the terminal stamps are written only by transition_work_order'
      using errcode = 'P0001';
  end if;

  return new;
end; $$;

create trigger work_orders_origination_guard
  before insert on public.work_orders
  for each row execute function public.assert_work_order_origination_insert();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — the UPDATE guard: hard immutables, plus the post-Draft body freeze (DD-WO-5).
--
-- ⚑ NO SERVER-AUTHORITY EXEMPTION — see the header. set_work_order_value is SECURITY DEFINER and runs
--   as this table's owner, so exempting the owner would exempt the writer this freeze exists to stop.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.assert_work_order_update() returns trigger
  language plpgsql set search_path = public as $$
begin
  -- (a) Hard immutables, at every status and for every writer.
  if new.id is distinct from old.id
     or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'work_orders identity columns (id, org_id, created_at) are immutable'
      using errcode = '42501';
  end if;

  -- The ceiling a work order draws against is not re-pointable: moving it would silently move value
  -- between two projects' drawdowns with no record on either.
  if new.project_id is distinct from old.project_id then
    raise exception
      'work_orders.project_id is immutable: a work order draws down against ONE project''s contract ceiling, and re-pointing it would move committed value between two projects with no record on either — cancel it and raise a new one'
      using errcode = '42501';
  end if;

  -- Mint-once. A re-mint would produce a second ERP document for one intent (ADR-0058's invariant).
  if old.wo_number is not null and new.wo_number is distinct from old.wo_number then
    raise exception
      'work_orders.wo_number is minted once and never changes'
      using errcode = '42501';
  end if;

  -- (b) THE POST-ISSUE BODY FREEZE (DD-WO-5). Every column below is pushable content; if any of them
  -- can move after issue while `issued_at` stands still, a re-push derives an IDENTICAL key, the
  -- outbox single-use constraint rejects it, and the write is SILENTLY SUPPRESSED — the OQ-BUD-2
  -- failure (0137/#479). An amended PO is Cancel + re-issue, which is how ERPNext amends too.
  if old.status is distinct from 'Draft'
     and (   new.order_value      is distinct from old.order_value
          or new.title            is distinct from old.title
          or new.description      is distinct from old.description
          or new.client_po_number is distinct from old.client_po_number
          or new.currency         is distinct from old.currency
          or new.tax_treatment    is distinct from old.tax_treatment
          or new.tax_amount       is distinct from old.tax_amount
          or new.tax_rate         is distinct from old.tax_rate
          or new.tax_template     is distinct from old.tax_template
          or new.order_date       is distinct from old.order_date
          or new.start_date       is distinct from old.start_date
          or new.end_date         is distinct from old.end_date)
  then
    -- ⚑ The message names the STATUS and not the row: `wo_number` carries the mint DATE, which would
    -- make this string non-deterministic and force its pgTAP oracle to be weakened to an errcode-only
    -- match — and a bare throws_ok(sql,'42501',null) goes green for the WRONG reason the moment
    -- another 42501 gate moves in front of this one.
    raise exception
      'this work order is % and its content can no longer be changed: `issued_at` is the stamp an ERPNext push derives its idempotency key from, so an edit that leaves that stamp standing would be accepted here and SILENTLY DISCARDED there — cancel this work order and issue a replacement',
      old.status
      using errcode = '42501';
  end if;

  return new;
end; $$;

create trigger work_orders_assert_update
  before update on public.work_orders
  for each row execute function public.assert_work_order_update();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §5 — RLS, policies and THE GRANT TOPOLOGY (the 0014 A2 mechanic — see the header).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.work_orders enable row level security;
-- FORCE: the global AC-LOW-1 invariant (every RLS-enabled public table forces RLS), so the table
-- owner is RLS-subject too.
alter table public.work_orders force row level security;

-- ⚑ `is_active_member()` is conjoined EXPLICITLY. 0063's conjunction pass read pg_policies AT APPLY
--   TIME — it is not a standing rule — so a policy created after it carries the conjunct only if its
--   own migration writes it. An offboarded account holding a still-valid JWT must neither read nor
--   write this table.
create policy work_orders_select on public.work_orders for select
  using (org_id = public.auth_org_id() and public.is_active_member());

-- Parent-org guard (the 0002 budget_versions HIGH-BV-1 idiom): the project must ALSO be in the
-- caller's org, so a row stamped with the caller's own org cannot be grafted onto another org's
-- project — which would poison that org's drawdown from outside it.
create policy work_orders_insert on public.work_orders for insert
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p
                 where p.id = work_orders.project_id and p.org_id = public.auth_org_id()));

create policy work_orders_update on public.work_orders for update
  using (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = public.auth_org_id() and public.is_active_member()
    and public.auth_role() in ('Admin','Executive','Project Manager','Finance')
    and exists (select 1 from public.projects p
                 where p.id = work_orders.project_id and p.org_id = public.auth_org_id()));

-- NO DELETE POLICY AND NO DELETE GRANT — see the header. `Cancelled` is the soft-delete.

-- The A2 mechanic, written out. These revokes are no-ops on a table this young; they are here so the
-- table's privilege history NEVER contains a table-level client grant that a later column-level
-- REVOKE would silently fail to subtract from.
revoke all on public.work_orders from authenticated, anon;

grant select on public.work_orders to authenticated;

-- INSERT: the BODY only. `status`, `wo_number` and every witness/stamp column are WITHHELD — the
-- origination guard (§3) is the second layer, not the first.
-- ⚑ `currency` and the tax columns MUST be listed (DD-CUR-4): on a table whose INSERT grant is
--   column-level, a column is not insertable unless granted — the inverse of the familiar trap.
grant insert (id, org_id, project_id, client_po_number, title, description,
              order_value, currency, tax_treatment, tax_amount, tax_rate, tax_template,
              order_date, start_date, end_date, created_at)
  on public.work_orders to authenticated;

-- UPDATE: the body list MINUS `order_value` — that omission IS the SoD control (set_work_order_value
-- is the only remaining writer). `status`, `wo_number`, `currency` and every stamp are omitted too:
-- status moves only through transition_work_order, and re-denominating a money row is not a client
-- operation (0187's rule for every other money table).
grant update (client_po_number, title, description,
              tax_treatment, tax_amount, tax_rate, tax_template,
              order_date, start_date, end_date)
  on public.work_orders to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §6 — get_project_drawdown: SECURITY INVOKER, copying get_project_budget (0005 §1).
--
-- ⚑ SECURITY INVOKER (the default — do NOT add security definer). Each base-table read runs under the
--   CALLER'S RLS (`work_orders_select` / `projects_select` = org_id = auth_org_id() and
--   is_active_member()), so the aggregate is org-scoped automatically. Making it definer would hand
--   every authenticated caller every org's committed revenue in one call.
--
-- Committed = Issued + Closed (DD-WO-2). Draft is EXCLUDED and returned separately, or the PM's
-- headline number is polluted by drafts. Cancelled counts as neither.
--
-- ⚑ Every returned column is non-NULL by construction (coalesce on the sums; contract_value and
--   currency are NOT NULL on projects). That matters because `returns table` carries no nullability
--   to the type generator (ADR-0003), which emits every column as non-null regardless — a column that
--   really could be null would then render as a plausible 0 instead of an error (#508).
--   An invisible or non-existent project yields ZERO ROWS, never a fabricated zero row.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.get_project_drawdown(p_project_id uuid)
  returns table (committed numeric, draft numeric, ceiling numeric, currency text)
  language sql stable security invoker set search_path = public as $$
  select coalesce(sum(wo.order_value) filter (where wo.status in ('Issued','Closed')), 0)::numeric,
         coalesce(sum(wo.order_value) filter (where wo.status = 'Draft'), 0)::numeric,
         p.contract_value,
         p.currency
    from public.projects p
    left join public.work_orders wo on wo.project_id = p.id
   where p.id = p_project_id
   group by p.id, p.contract_value, p.currency
$$;
revoke all     on function public.get_project_drawdown(uuid) from public;
grant  execute on function public.get_project_drawdown(uuid) to   authenticated;
revoke execute on function public.get_project_drawdown(uuid) from anon;

comment on function public.get_project_drawdown(uuid) is
  'DD-WO-2 — the DERIVED drawdown of a project''s contract ceiling. SECURITY INVOKER on purpose: the '
  'reads run under the caller''s RLS, exactly as get_project_budget (0005) does. Committed = Issued + '
  'Closed; Draft is reported separately; Cancelled counts as neither. NOT a stored balance — '
  'projects.spent has been an unmaintained "DEFERRED: stored vs derived" column since 0001.';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §7 — set_work_order_value: the SOLE writer of order_value (the 0014 A1 pattern).
--
-- SECURITY DEFINER, so it RE-ASSERTS org + active membership + role INTERNALLY (definer rights bypass
-- RLS). Removing any of those re-assertions would permit a cross-org / offboarded / unauthorised
-- value write — they MUST stay. search_path pinned to public against injection.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.set_work_order_value(p_id uuid, p_value numeric)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid;
  v_status public.work_order_status;
  v_old    numeric;
  v_role   user_role := auth_role();
begin
  -- Reject an invalid value here for the human-readable message; the column CHECK is the authority
  -- for every writer. NULL is distinguished from out-of-range so the diagnosis is useful.
  if p_value is null then
    raise exception 'work order value is required' using errcode = '23502';
  end if;
  if not (p_value >= 0 and p_value < 'Infinity'::numeric) then
    raise exception 'work order value must be a non-negative number' using errcode = '23514';
  end if;

  -- Load + lock (serializes concurrent value edits on the SAME work order). P0002 if absent.
  select org_id, status, order_value into v_org, v_status, v_old
    from public.work_orders where id = p_id for update;
  if v_status is null then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this active-membership gate MUST stay. auth_role() reads profiles.role with NO status
  -- filter, so without it an offboarded account can author the very value the issue SoD then treats
  -- as a legitimate second person (probed live on projects at 0177: two disabled PMs landed a
  -- 77,000,000 won deal between them).
  perform public.assert_is_active_member();

  -- SECURITY: this role gate MUST stay. Expressed as RANK, never a list of literals, so a role
  -- slotted into the hierarchy later inherits the right answer with no edit here (ADR-0070).
  if not public.holds_pipeline_value_authority(v_role) then
    raise exception 'not authorized to set the work order value' using errcode = '42501';
  end if;

  -- ⚑ DD-WO-5. The value is frozen the moment the work order leaves Draft. §4's trigger is the
  -- unexemptable backstop; this branch exists so the caller gets the RULE rather than a trigger's
  -- generic body-freeze message.
  if v_status is distinct from 'Draft' then
    raise exception
      'the value of a work order that is % can no longer be changed: `issued_at` is the stamp an ERPNext push derives its idempotency key from, so a changed value under an unchanged stamp would be silently discarded there — cancel this work order and issue a replacement',
      v_status
      using errcode = '42501';
  end if;

  update public.work_orders
    set order_value = p_value
  where id = p_id;

  perform public.log_audit('work_order.value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value));
end; $$;
revoke all     on function public.set_work_order_value(uuid, numeric) from public;
grant  execute on function public.set_work_order_value(uuid, numeric) to   authenticated;
revoke execute on function public.set_work_order_value(uuid, numeric) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §8 — transition_work_order: the single authority for every status change.
--
-- SECURITY DEFINER so the multi-write (status + mint + stamps + audit) is one indivisible txn;
-- therefore it re-asserts org + active membership + role INTERNALLY.
--
-- ⚑ LOCK ORDER: the work order FIRST, then its project. Nothing in the tree takes those two in the
--   opposite order, so no cycle exists; stated here so nothing starts to.
--
-- ⚑ THE ISSUE SoD, and where it deliberately DIFFERS from transition_project's win gate.
--   Same three recorded variants are closed — witness = issuer (0181), witness offboarded (0183),
--   witness does not outrank / line-manage the issuer (0178 §6, ADR-0070) — with the same predicates,
--   so there is one definition of "who may ratify whose work" in the schema, not two.
--   ⚑ THE DIFFERENCE: transition_project PERMITS a NULL `contract_value_set_by` alongside a non-NULL
--   `..._set_at` (the witness shape of a server-side authority: seed, importer, service_role) because
--   it had un-backfillable legacy rows and a live importer to accommodate — 0170 AC-PMS-019 pins it.
--   `work_orders` has NEITHER: the table is new, every row is created through the client path, and its
--   witness trigger stamps auth.uid() on every insert. So an unattributed witness here would be a hole
--   this migration CREATED rather than one it inherited, and DD-WO-3's "fail closed on NULL witness"
--   is taken literally: BOTH null shapes refuse. A future importer that needs to land already-Issued
--   work orders must therefore get a deliberate, test-visible carve-out — not a silent one.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.transition_work_order(
  p_id uuid,
  p_to public.work_order_status,
  p_over_commit_ack boolean default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from       public.work_order_status;
  v_org        uuid;
  v_project    uuid;
  v_value      numeric;
  v_set_by     uuid;
  v_set_at     timestamptz;
  v_number     text;
  v_role       user_role := auth_role();
  v_ceiling    numeric;
  v_committed  numeric;
  v_exceeds    boolean := false;
  v_ack_by     uuid;
  v_ack_at     timestamptz;
  v_legal jsonb := jsonb_build_object(
    'Draft',     jsonb_build_array('Issued','Cancelled'),
    'Issued',    jsonb_build_array('Closed','Cancelled'),
    'Closed',    jsonb_build_array(),
    'Cancelled', jsonb_build_array()
  );
begin
  -- Load + lock the work order. The witness pair is read under the SAME lock as the value it
  -- witnesses — a concurrent set_work_order_value takes that lock too, so they cannot be read torn.
  select status, org_id, project_id, order_value, order_value_set_by, order_value_set_at, wo_number
    into v_from, v_org, v_project, v_value, v_set_by, v_set_at, v_number
    from public.work_orders where id = p_id for update;
  if v_from is null then
    raise exception 'work order not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org transitions.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this active-membership gate MUST stay — see the twin comment in set_work_order_value.
  perform public.assert_is_active_member();

  -- Coarse role gate (the transition_project shape: revenue is not procurement, so there is no
  -- per-transition matrix). SECURITY: MUST stay — without it any authenticated user may issue.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality: (from,to) must be in the data map and not a no-op.
  if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- The acknowledgement is meaningful ONLY on the issue step. Accepting it elsewhere would let a
  -- client attach it to every call and turn it into noise.
  if p_to is distinct from 'Issued' and p_over_commit_ack is not null then
    raise exception
      'the over-commitment acknowledgement applies only to issuing a work order, not to a % transition',
      p_to
      using errcode = 'P0001';
  end if;

  if p_to = 'Issued' then
    -- ── THE MONEY SoD. SECURITY: this block MUST stay. Without it one person sets the value on a
    -- Draft, issues it alone, and books client revenue at a figure NOBODY ELSE EVER APPROVED.
    -- Every clause is TOTAL (`is distinct from`, an explicit `is null` branch, helpers that all
    -- coalesce to FALSE) because a NULL-valued condition does not fire an `if` — the exact defect
    -- 0176 §6 had to repair in four other guards.
    --   (i)   there is money on the row              -> otherwise there is nothing to ratify;
    --   (ii)  the ISSUER does not themselves hold won-value authority -> a Finance/Exec/Admin issuer
    --         is already the accountable party and needs nobody;
    --   (iii) the value was authored by a DISTINCT, ACTIVE person who may approve THIS issuer's work.
    --         The direction matters and is easy to get backwards: the question is not "may the issuer
    --         approve the author?" but "did someone with authority OVER THE ISSUER put their name on
    --         this number?" A PM whose line manager set the value is cleared; a PM whose PEER set it
    --         is not.
    if coalesce(v_value, 0) > 0
       and not public.holds_won_value_authority(v_role)
       and (    v_set_at is null                                   -- never witnessed -> FAIL CLOSED
             or v_set_by is null                                   -- unattributed    -> FAIL CLOSED
             or v_set_by is not distinct from auth.uid()           -- issuer authored it themselves
             or not public.is_active_member(v_set_by)              -- witness offboarded / banned
             or not public.may_approve_work_of(v_set_by, auth.uid()) )
    then
      if v_set_at is null or v_set_by is null then
        raise exception
          'this work order''s value has no recorded author, so you cannot issue it: the value must be set by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif v_set_by is not distinct from auth.uid() then
        raise exception
          'you set this work order''s value yourself, so you cannot also issue it: the value must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      elsif not public.is_active_member(v_set_by) then
        -- Ordered BEFORE the seniority branch: an offboarded peer is offboarded first and not-senior
        -- second, and the operator needs "get someone who is still here".
        raise exception
          'this work order''s value was set by someone who is no longer an active member of this organisation, so you cannot issue it: it must be re-set by your supervisor or by someone who outranks you who is currently active, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      else
        raise exception
          'this work order''s value was not set by anyone senior to you, so you cannot issue it: it must be confirmed by your supervisor or by someone who outranks you, through set_work_order_value (which records who set it) — or ask them to issue it'
          using errcode = '42501';
      end if;
    end if;

    -- ── THE DRAWDOWN, COMPUTED UNDER THE PARENT'S LOCK (DD-WO-2). Locking the project row is what
    -- serializes two concurrent issues on the SAME project: without it both read the same committed
    -- total, both decide they fit, and the pair lands over the ceiling with no acknowledgement.
    select p.contract_value into v_ceiling
      from public.projects p where p.id = v_project for update;
    if v_ceiling is null then
      raise exception 'work order parent project not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(wo.order_value), 0) into v_committed
      from public.work_orders wo
     where wo.project_id = v_project and wo.status in ('Issued','Closed');

    v_exceeds := (v_committed + coalesce(v_value, 0)) > v_ceiling;

    -- FAIL CLOSED: the acknowledgement is never assumed. `is not true` covers both NULL (the caller
    -- said nothing) and false (the caller explicitly declined) — a `= false` test would let an
    -- omitted parameter through.
    if v_exceeds and p_over_commit_ack is not true then
      raise exception
        'issuing this work order would commit % against a contract ceiling of % (already committed: %): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
        v_committed + coalesce(v_value, 0), v_ceiling, v_committed
        using errcode = 'P0001';
    end if;

    -- The mirror of fail-closed: an acknowledgement with nothing to acknowledge is refused rather
    -- than accepted-and-ignored. If it were ignored, a client could send it unconditionally and the
    -- stamp would stop meaning "a person looked at an over-commitment and chose it".
    if p_over_commit_ack is not null and not v_exceeds then
      raise exception
        'there is no over-commitment to acknowledge: committing % leaves the contract ceiling of % intact',
        v_committed + coalesce(v_value, 0), v_ceiling
        using errcode = 'P0001';
    end if;

    if v_exceeds then
      v_ack_by := auth.uid();
      v_ack_at := now();
    end if;

    -- Mint the document number (once) and stamp the issue. `coalesce` rather than an unconditional
    -- mint so a re-run can never burn a second number on the same row.
    update public.work_orders set
      status             = p_to,
      wo_number          = coalesce(wo_number, public.next_procurement_doc_number(v_org, 'WO')),
      issued_by          = auth.uid(),
      issued_at          = now(),
      over_commit_ack_by = v_ack_by,
      over_commit_ack_at = v_ack_at
    where id = p_id;

  elsif p_to = 'Closed' then
    update public.work_orders set status = p_to, closed_at = now() where id = p_id;
  else  -- 'Cancelled'
    update public.work_orders set status = p_to, cancelled_at = now() where id = p_id;
  end if;

  perform public.log_audit('work_order.transition', v_org, auth.uid(), p_id,
                           jsonb_build_object('from',               v_from::text,
                                              'to',                 p_to::text,
                                              'project_id',         v_project,
                                              'order_value',        v_value,
                                              'order_value_set_by', v_set_by,
                                              'order_value_set_at', v_set_at,
                                              'contract_ceiling',   v_ceiling,
                                              'committed_before',   v_committed,
                                              'over_commit_ack_by', v_ack_by));
end; $$;
revoke all     on function public.transition_work_order(uuid, public.work_order_status, boolean) from public;
grant  execute on function public.transition_work_order(uuid, public.work_order_status, boolean) to   authenticated;
revoke execute on function public.transition_work_order(uuid, public.work_order_status, boolean) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §9 — every work order CREATE is on the audit trail (the 0178 §L3 convention: fires for all roles).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.audit_work_order_insert() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  perform public.log_audit('work_order.create', new.org_id, auth.uid(), new.id,
                           jsonb_build_object('project_id',       new.project_id,
                                              'status',           new.status::text,
                                              'order_value',      new.order_value,
                                              'currency',         new.currency,
                                              'client_po_number', new.client_po_number));
  return new;
end; $$;

create trigger work_orders_audit_insert
  after insert on public.work_orders
  for each row execute function public.audit_work_order_insert();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §10 — sales_invoices.work_order_id (DD-WO-4).
--
-- NULLABLE IS FORCED, not a preference: `sales_invoices` doubles as the machine-written mirror when
-- revenue flips externally-owned (0123), so an ADOPTED ERP-originated invoice has no PMO work order
-- and `not null` would break adoption outright. Pre-epoch history has none either. The UI path
-- requires it; the schema cannot.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.sales_invoices
  add column if not exists work_order_id uuid references public.work_orders(id);

create index if not exists sales_invoices_org_work_order_idx
  on public.sales_invoices (org_id, work_order_id);

comment on column public.sales_invoices.work_order_id is
  'DD-WO-4/#498 — the work order this invoice bills against. NULLABLE BY NECESSITY: this table is '
  'also the ERP mirror, and an adopted ERPNext-originated invoice has no PMO work order. Constrained '
  'to the invoice''s own project by check_sales_invoice_work_order_same_project.';

-- Precedent: check_tasks_parent_same_project (0140). Fails CLOSED — an invoice with a NULL project_id
-- that names a work order is refused, because `is distinct from` is total.
create or replace function public.check_sales_invoice_work_order_same_project() returns trigger
  language plpgsql set search_path = public as $$
begin
  if new.work_order_id is not null
     and (select wo.project_id from public.work_orders wo where wo.id = new.work_order_id)
         is distinct from new.project_id
  then
    raise exception
      'the work order must be on the same project as the invoice'
      using errcode = '42501';
  end if;
  return new;
end; $$;

create trigger sales_invoices_check_work_order_same_project
  before insert or update on public.sales_invoices
  for each row execute function public.check_sales_invoice_work_order_same_project();

-- ⚑ MANDATORY PAIRED EDIT (DD-WO-4). `sales_invoices_native_mirror_guard` ENUMERATES every native
-- field; a column added later is simply absent from the list and is therefore USER-WRITABLE while the
-- revenue it describes is owned by ERPNext. That is exactly how `author_user_id` shipped unpinned
-- (0124 after 0123's guard, closed by 0125) and it is the "closed one path, left the other open"
-- shape behind SoD slices 2-6.
--
-- Body copied VERBATIM from its live definition (0189 §1) with ONE added `is distinct from` line.
-- ⚑ Volatility/security attributes preserved exactly — `create or replace function` does NOT inherit
--   them, and this guard is SECURITY INVOKER (verified against 0189). ⚑ NO TRIGGER IS RE-CREATED: a
--   trigger binds to its function by OID and `create or replace` keeps that OID, so replacing the body
--   is sufficient; re-creating would risk a duplicate under a differently-named trigger (0125's
--   mistake, DD-CUR-5).
create or replace function public.sales_invoices_native_mirror_guard() returns trigger
  language plpgsql set search_path = public as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then return new; end if;
  if not public.domain_externally_owned(new.org_id, 'revenue') then return new; end if;
  if new.si_number is distinct from old.si_number
     or new.customer_id is distinct from old.customer_id
     or new.project_id is distinct from old.project_id
     or new.reference_number is distinct from old.reference_number
     or new.invoice_date is distinct from old.invoice_date
     or new.amount is distinct from old.amount
     or new.erp_outstanding_amount is distinct from old.erp_outstanding_amount
     or new.status is distinct from old.status
     or new.erp_docstatus is distinct from old.erp_docstatus
     or new.erp_modified is distinct from old.erp_modified
     or new.erp_amended_from is distinct from old.erp_amended_from
     or new.erp_cancelled_at is distinct from old.erp_cancelled_at
     or new.author_user_id is distinct from old.author_user_id   -- Luna BLOCK 3: pin the SoD-author column
     or new.currency is distinct from old.currency               -- 0187 (#478): re-denominates the row
     or new.tax_treatment is distinct from old.tax_treatment     -- 0188 (#478): the irrecoverable marker
     or new.tax_amount is distinct from old.tax_amount           -- 0188 (#478)
     or new.tax_rate is distinct from old.tax_rate               -- 0188 (#478)
     or new.tax_template is distinct from old.tax_template       -- 0188 (#478)
     or new.work_order_id is distinct from old.work_order_id     -- 0193 (#498): which scope grant this bills
     or new.id is distinct from old.id or new.org_id is distinct from old.org_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'sales_invoices native fields are read-only while revenue is externally-owned'
      using errcode = '42501';
  end if;
  return new;
end; $$;

-- `sales_invoices` INSERT is COLUMN-LEVEL (0176 §1a narrowed it), so a new column is NOT insertable
-- unless granted explicitly — the DD-CUR-4 inversion. No UPDATE grant: `authenticated` holds none on
-- this table at all, and this column must not be the exception that re-opens it.
grant insert (work_order_id) on public.sales_invoices to authenticated;
