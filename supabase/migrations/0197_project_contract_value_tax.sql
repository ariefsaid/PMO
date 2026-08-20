-- 0197_project_contract_value_tax.sql — #513: the drawdown compares like with like.
--
-- `get_project_drawdown` (0193 §6) sums `work_orders.order_value` against `projects.contract_value`.
-- `order_value` carries a `tax_treatment` (0193, per #478); `contract_value` did not. So the two
-- sides of the comparison could be keyed differently and NOTHING said which.
--
-- ⛔ WHY THIS IS WORSE THAN A ROUNDING ERROR, and it is worth stating before the DDL. The error is
-- not one-directional. A tax-EXCLUSIVE work order measured against a tax-INCLUSIVE ceiling makes the
-- drawdown look SMALLER than it is — so the system UNDER-DETECTS the over-commitment it exists to
-- detect. That inverts the control: `DD-WO-2` deliberately permits over-commitment but requires an
-- explicit, attributed acknowledgement, and if the comparison silently understates drawdown the
-- acknowledgement is never demanded and nobody is ever asked. At Indonesian PPN that is ~11-12% of
-- the ceiling, on the one figure a PM is measured against.
--
-- ── THE RULING (Director, 2026-08-20 — issue #513 option 1) ─────────────────────────────────────
-- Option 2 was "declare by ruling that contract_value is always tax-exclusive and enforce it with a
-- CHECK". Refused, and the ticket contains the reason: it is a claim about every existing row AND
-- every future one. The future half is the worse half — a ruling that the value is always exclusive
-- makes whoever enters an inclusive contract convert it by hand, which is a silent-error generator of
-- exactly the `parseMoneyInput` class (#468). A column records the fact; a ruling asks a human to
-- remember it.
--
-- ── NORMALISED TO **NET**, and why that choice rather than gross ────────────────────────────────
-- Both sides now state their own basis, so the drawdown can convert either way and the over-commit
-- decision is identical whichever is picked. NET is chosen because tax is PASS-THROUGH, not revenue:
-- it is the figure that does not move when a tax rate changes, and a drawdown is a statement about
-- how much of the commercial commitment has been consumed. `get_project_drawdown` therefore returns
-- net figures and NAMES the basis in a new `basis` column, so no caller has to infer it — inferring
-- it is the whole defect.
--
-- ── SHAPE: 0188/0193's four columns, with ONE deliberate difference ─────────────────────────────
--   • tax_treatment — text, NO DEFAULT, and NOT NULL **only when there is a value to describe**.
--   • tax_amount    — same rule. 0 means no tax, never unknown.
--   • tax_rate      — NULLABLE. Not recorded ≠ 0%.
--   • tax_template  — NULLABLE. Connect-time ERPNext config a standalone org legitimately lacks.
--
-- ⚑ WHY CONDITIONAL AND NOT A FLAT `NOT NULL`, which is what `sales_invoices` and `work_orders` use.
-- Those tables exist to record a money document: every row HAS an amount, so every row has a basis to
-- state. `projects` is different — `contract_value` is `not null default 0`, and a project spends
-- most of its life at 0 (a lead, an internal project, anything pre-win). A flat NOT NULL would force
-- a tax treatment onto a row that has no value to describe, which is not a fact, it is ceremony.
--
-- It is also measurable: a flat NOT NULL broke **115 of 294 pgTAP files** — every fixture that ever
-- creates a project, in suites about RLS, timesheets, budgets, tenancy, none of which have any
-- interest in tax. That is not a cost worth paying for a guarantee, it is a signal that the
-- constraint was attached to the wrong thing. Tied to the VALUE instead of to the row, the same
-- guarantee touches 34 files, and it is strictly more precise:
--
--     check (contract_value = 0 or (tax_treatment is not null and tax_amount is not null))
--
-- "You may not record a contract value without saying what it means" — which is the actual rule.
-- A project at 0 states nothing and claims nothing. The RPC (§2) still demands the basis on every
-- single set, so the only way to reach a non-zero value is to state one.
--
-- ── BACKFILL: 'exclusive' + 0, and this is the ONE value chosen to change nothing ───────────────
-- 17 rows exist locally, all demo (RIS is not live; ADR-0047 makes the cloud project staging). With
-- `tax_amount = 0`, net and gross are EQUAL, so every existing drawdown renders exactly the figure
-- it rendered before this migration. That is the point of the choice: a NOT NULL add cannot avoid a
-- backfill, so the backfill is picked to be arithmetically inert rather than to be a guess about
-- anybody's tax posture. One-time UPDATE, NOT a column default — nothing written afterwards inherits.
--
-- ⏸ The owner-only question — do RIS contract values get quoted inclusive or exclusive of PPN — is
-- PARKED as issue #518 and blocks nothing here. It informs what the FORM pre-selects (nothing, for
-- now: the user must choose) and how a real client's rows are stated at seeding, not this DDL.
--
-- ⛔ DEPLOY PRECONDITION, same class as 0196's: the "17 demo rows" count is LOCAL. Before applying
-- this anywhere else, count and inspect `projects` there — for a row whose `contract_value` really
-- did include PPN, `'exclusive' + 0` is well-formed and wrong, this issue's own defect applied
-- retroactively. Prod carries no real contract values as of 2026-08-20.
--
-- ── Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse, in order:
--   -- re-run 0193 §6's get_project_drawdown body verbatim (4 output columns, no basis);
--   -- re-run 0193 §7's transition_work_order body verbatim (raw contract_value comparison);
--   drop function if exists public.set_project_contract_value(uuid, numeric, text, numeric, numeric, text);
--   -- then re-run 0178's set_project_contract_value(uuid, numeric) verbatim;
--   alter table public.projects
--     drop column if exists tax_template, drop column if exists tax_rate,
--     drop column if exists tax_amount,   drop column if exists tax_treatment;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §1 — the columns.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.projects
  add column if not exists tax_treatment text,
  add column if not exists tax_amount    numeric(14,2),
  add column if not exists tax_rate      numeric(6,3),
  add column if not exists tax_template  text;

-- One-time backfill (see header) — deliberately inert, never a DEFAULT.
update public.projects
   set tax_treatment = coalesce(tax_treatment, 'exclusive'),
       tax_amount    = coalesce(tax_amount, 0)
 where tax_treatment is null or tax_amount is null;

-- The conditional NOT NULL (see header). `not valid` then `validate` is unnecessary — the backfill
-- above has already satisfied it for every existing row.
alter table public.projects
  add constraint projects_tax_basis_stated_when_valued
  check (contract_value = 0 or (tax_treatment is not null and tax_amount is not null));

alter table public.projects
  add constraint projects_tax_treatment_domain
  check (tax_treatment is null or tax_treatment in ('inclusive','exclusive'));

-- `>= 0` alone does NOT reject NaN: Postgres orders numeric NaN above every ordinary value, so
-- `'NaN'::numeric >= 0` is TRUE and PostgREST coerces the JSON string "NaN" straight in. The upper
-- bound is what rejects it. Same construction and same reason as 0169, 0188, 0193 and 0196.
alter table public.projects
  add constraint projects_tax_amount_nonneg
  check (tax_amount is null or (tax_amount >= 0 and tax_amount < 'Infinity'::numeric));

alter table public.projects
  add constraint projects_tax_rate_pct
  check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 100));

comment on column public.projects.tax_treatment is
  '#513: does `contract_value` already include `tax_amount` (''inclusive'') or not (''exclusive'')? '
  'NOT NULL with no default — without it the drawdown compares a work order''s stated figure against '
  'a ceiling on an unknown basis, and UNDER-detects over-commitment by the tax rate.';
comment on column public.projects.tax_amount is
  '#513: total tax on the contract value, in `currency`. 0 means no tax; it never means unknown.';
comment on column public.projects.tax_rate is
  '#513: the authored tax percentage (e.g. 11.000 for PPN 11%). NULL = not recorded — never 0%.';
comment on column public.projects.tax_template is
  '#513: ERPNext taxes-and-charges template name. Connect-time org config, so NULL for a standalone org.';

-- ⚑ DD-CUR-4, the inverse of the familiar trap: `projects` INSERT and UPDATE are BOTH column-level
-- (0173 §INSERT, 0014/0008 §UPDATE), so a new column is NOT writable unless it is granted here.
-- INSERT is granted — origination states the basis alongside the value it states.
grant insert (tax_treatment, tax_amount, tax_rate, tax_template) on public.projects to authenticated;
-- ⛔ UPDATE is deliberately NOT granted. `contract_value` itself is not client-updatable — 0014
-- removed it from the update list and `set_project_contract_value` has been its sole writer since.
-- The basis must travel with the value it describes: letting a client re-key the treatment behind
-- that RPC's back would move the money without the witness the SoD depends on. §3 extends the RPC.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §2 — `set_project_contract_value`: the basis travels WITH the value.
--
-- The RPC is `contract_value`'s sole writer (0014 onward). Letting it move the number while the
-- treatment stayed behind would recreate the defect one migration later: the figure would be new and
-- its basis would describe the old one. So the four tax params are added and the first two are
-- REQUIRED — restating the value restates the basis, every time.
--
-- ⚑ Postgres identifies a function by its exact arg list, so adding params changes the identity: the
-- OLD 2-arg signature is DROPPED with its exact types, or both overloads coexist and PostgREST's
-- named-param `.rpc()` errors "could not choose the best candidate function".
--
-- ⚑ The new params carry `default null` and are then REJECTED in the body — the same construction
-- and the same reason as 0196 §2 and 0176's `p_status` gate. Postgres forbids a non-defaulted param
-- after a defaulted one, and a bare NOT NULL violation names a column rather than the thing the
-- caller must fix.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
drop function if exists public.set_project_contract_value(uuid, numeric);

create or replace function set_project_contract_value(
  p_id uuid, p_value numeric,
  p_tax_treatment text default null, p_tax_amount numeric default null,
  p_tax_rate numeric default null, p_tax_template text default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_status project_status;
  v_org    uuid;
  v_old    numeric;
  v_role   user_role := auth_role();
  v_on_hand constant text[] := array['Won, Pending KoM','Ongoing Project','On Hold','Close Out'];
begin
  -- FR-HRD-040: reject an invalid value here for the human-readable message; the column CHECK/
  -- NOT NULL are the authority for every UPDATE writer. Null is distinguished from out-of-range
  -- (negative/NaN/Infinity) so the diagnosis is useful; the out-of-range message is asserted
  -- verbatim by pgTAP 0162 for both the negative and the NaN case, so keep it exact.
  if p_value is null then
    raise exception 'contract value is required' using errcode = '23502';
  end if;
  if not (p_value >= 0 and p_value < 'Infinity'::numeric) then
    raise exception 'contract value must be a non-negative number' using errcode = '23514';
  end if;

  -- ⚑ #513: the basis gate. Tests the VALUE, not just presence — PostgREST turns an ABSENT json
  -- field into NULL but an EMPTY form field into '', and a padded ' exclusive ' is neither, so a
  -- presence-only check would send all three to the domain CHECK to die on the wrong error.
  if p_tax_treatment is null or btrim(p_tax_treatment) not in ('inclusive','exclusive')
     or p_tax_amount is null then
    raise exception
      'a contract value must state its tax treatment: p_tax_treatment must be ''inclusive'' or ''exclusive'' (does the value already include the tax?) and p_tax_amount must be given (0 when there is no tax). Without it the drawdown compares this ceiling against work-order values on an unknown basis'
      using errcode = 'P0001';
  end if;

  select status, org_id, contract_value
    into v_status, v_org, v_old
    from public.projects where id = p_id for update;
  if v_status is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- ⚑ 0178 (§5). SECURITY: this active-membership conjunct MUST stay. Without it a DISABLED profile
  -- still satisfies auth_role() (it reads profiles.role with no status filter), so an offboarded
  -- account can author the contract value that transition_project's money SoD then treats as a
  -- legitimate second person.
  if not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- SECURITY: this role/status gate MUST stay (ADR-0019 SoD). Byte-preserved from 0178 — the
  -- on-hand branch is the rank threshold, the pre-win branch is Project Manager and above (owner
  -- ruling 2026-07-29, Finance IS in), and both refusal messages are asserted verbatim by 0162.
  if v_status::text = any(v_on_hand) then
    if not public.holds_won_value_authority(v_role) then
      raise exception 'changing the contract value on a won project requires Executive or Finance'
        using errcode = '42501';
    end if;
  else
    if not public.holds_pipeline_value_authority(v_role) then
      raise exception 'not authorized to set the contract value' using errcode = '42501';
    end if;
  end if;

  update public.projects
    set contract_value = p_value,
        tax_treatment  = btrim(p_tax_treatment),
        tax_amount     = p_tax_amount,
        tax_rate       = p_tax_rate,
        tax_template   = p_tax_template,
        last_update    = now()
  where id = p_id;

  perform public.log_audit('project.contract_value.set', v_org, auth.uid(), p_id,
                           jsonb_build_object('from', v_old, 'to', p_value,
                                              'tax_treatment', btrim(p_tax_treatment),
                                              'tax_amount', p_tax_amount));
end; $$;

-- EXECUTE grants re-issued for the NEW identity — a DROP takes its ACL with it.
revoke all     on function public.set_project_contract_value(uuid, numeric, text, numeric, numeric, text) from public;
grant  execute on function public.set_project_contract_value(uuid, numeric, text, numeric, numeric, text) to   authenticated;
revoke execute on function public.set_project_contract_value(uuid, numeric, text, numeric, numeric, text) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §3 — `get_project_drawdown`: NET on both sides, and the basis is RETURNED, not inferred.
--
-- 0193 §6's body with the arithmetic normalised and a `basis` output column added. Still
-- SECURITY INVOKER — 0193's header says do NOT make it definer, and 0178's retained-definer roster
-- deliberately excludes it precisely so a later flip to definer would be visible.
--
--   net(value, treatment, tax) = (treatment = 'inclusive') ? value - tax : value
--
-- Both sides are converted, so the comparison is basis-independent and the over-commit trigger point
-- is correct in BOTH directions — an exclusive WO under an inclusive ceiling no longer under-states
-- the drawdown, and the reverse no longer over-states it.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚑ DROPPED first, not just replaced: adding an output column changes the row type, and
-- `create or replace` refuses that (42P13). The arg list is unchanged, so this is the one place in
-- this migration where a DROP is about the RETURN type rather than the identity — and it takes the
-- ACL with it, hence the grants restated below.
drop function if exists public.get_project_drawdown(uuid);

create function public.get_project_drawdown(p_project_id uuid)
  returns table (committed numeric, draft numeric, ceiling numeric, currency text, basis text)
  language sql stable security invoker set search_path = public as $$
  -- `wo.tax_treatment` is a flat NOT NULL on work_orders (0193), so its branch is total. The
  -- project's is conditional (§1), and `is not distinct from` is NOT needed: a NULL treatment only
  -- ever accompanies contract_value = 0, where net and gross are the same number anyway.
  select coalesce(sum(case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                           else wo.order_value end)
                  filter (where wo.status in ('Issued','Closed')), 0)::numeric,
         coalesce(sum(case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                           else wo.order_value end)
                  filter (where wo.status = 'Draft'), 0)::numeric,
         (case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
               else p.contract_value end)::numeric,
         p.currency,
         'net'::text
    from public.projects p
    left join public.work_orders wo on wo.project_id = p.id
   where p.id = p_project_id
   group by p.id, p.contract_value, p.tax_treatment, p.tax_amount, p.currency
$$;
revoke all     on function public.get_project_drawdown(uuid) from public;
grant  execute on function public.get_project_drawdown(uuid) to   authenticated;
revoke execute on function public.get_project_drawdown(uuid) from anon;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- §4 — `transition_work_order`: the GATE normalises the same way the display does.
--
-- 0193 §7's body verbatim with FOUR deltas, all marked inline: three new locals, the WO's own tax
-- facts read under the existing lock, the ceiling/committed/candidate figures normalised to net, and
-- the two refusal messages quoting the net candidate. Every authorization gate, the transition map,
-- the value-authority SoD, the acknowledgement fail-closed rule and the audit payload are unchanged.
--
-- ⚑ `create or replace` does NOT inherit volatility or security attributes — SECURITY DEFINER with
-- `set search_path = public` is restated below exactly as 0193 ships it.
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
  v_treatment  text;      -- #513: this work order's own tax basis
  v_tax        numeric;   -- #513: this work order's own tax amount
  v_net        numeric;   -- #513: v_value normalised to net
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
  -- ⚑ #513: this row's OWN tax facts are read under the SAME lock as its value, for the same reason
  -- the witness pair is — a basis read separately from the figure it describes can be read torn.
  select status, org_id, project_id, order_value, order_value_set_by, order_value_set_at, wo_number,
         tax_treatment, tax_amount
    into v_from, v_org, v_project, v_value, v_set_by, v_set_at, v_number,
         v_treatment, v_tax
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
    -- ⚑ #513: EVERY figure below is NET. Before this, the gate compared a work order's stated
    -- `order_value` against a `contract_value` with no tax basis at all, so an exclusive WO under an
    -- inclusive ceiling made the drawdown look SMALLER than it is — the control UNDER-detected the
    -- over-commitment it exists to detect, and nobody was ever asked to acknowledge it. The
    -- normalisation here is byte-identical to `get_project_drawdown`'s (§3), deliberately: a gate
    -- that computes the drawdown differently from the screen showing it is worse than either being
    -- wrong alone, because the two disagree and neither is visibly at fault.
    select (case when p.tax_treatment = 'inclusive' then p.contract_value - coalesce(p.tax_amount, 0)
                 else p.contract_value end)
      into v_ceiling
      from public.projects p where p.id = v_project for update;
    if v_ceiling is null then
      raise exception 'work order parent project not found' using errcode = 'P0002';
    end if;

    select coalesce(sum(case when wo.tax_treatment = 'inclusive' then wo.order_value - wo.tax_amount
                             else wo.order_value end), 0)
      into v_committed
      from public.work_orders wo
     where wo.project_id = v_project and wo.status in ('Issued','Closed');

    v_net := case when v_treatment = 'inclusive' then coalesce(v_value, 0) - coalesce(v_tax, 0)
                  else coalesce(v_value, 0) end;

    v_exceeds := (v_committed + v_net) > v_ceiling;

    -- FAIL CLOSED: the acknowledgement is never assumed. `is not true` covers both NULL (the caller
    -- said nothing) and false (the caller explicitly declined) — a `= false` test would let an
    -- omitted parameter through.
    if v_exceeds and p_over_commit_ack is not true then
      raise exception
        'issuing this work order would commit % against a contract ceiling of % (already committed: %): this is allowed, but it must be acknowledged explicitly — re-issue with the over-commitment acknowledgement so the decision is recorded against your name',
        v_committed + v_net, v_ceiling, v_committed
        using errcode = 'P0001';
    end if;

    -- The mirror of fail-closed: an acknowledgement with nothing to acknowledge is refused rather
    -- than accepted-and-ignored. If it were ignored, a client could send it unconditionally and the
    -- stamp would stop meaning "a person looked at an over-commitment and chose it".
    if p_over_commit_ack is not null and not v_exceeds then
      raise exception
        'there is no over-commitment to acknowledge: committing % leaves the contract ceiling of % intact',
        v_committed + v_net, v_ceiling
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

-- ⚑ No grants are re-issued for `transition_work_order`: `create or replace` keeps the function's
-- identity and therefore its ACL. Only §2's `set_project_contract_value` was DROPPED, and only that
-- one needed its grants restated.
