-- 0127_process_gates_merge_and_sod_author_guard.sql — Luna re-audit BLOCKs 5 + 6 (money path).
--
-- §A (BLOCK 5) get_process_gates: 0126 returned the STORED process_gates jsonb UNCHANGED, so the
--    defaults applied ONLY when the whole value was NULL. A PARTIAL object — `{}`, or an Admin flip
--    that states one key — silently dropped every unstated gate: adapter-dispatch then read
--    `require_project_on_si` as `undefined` -> falsy -> a gate the org believes is ON was OFF.
--    Now the stored object is MERGED per-key OVER the defaults.
--
-- §B (BLOCK 6) submit_sales_invoice: the SoD compared approver≠author against a possibly-NULL author
--    (readModelWriters writes `author_user_id: ctx.callerUserId ?? null`), which passes trivially for
--    EVERYONE — the two-person rule evaporated on exactly the rows whose authorship is unknown. Now a
--    NULL author FAILS CLOSED with a distinct 'sod-author-missing' detail.
--
-- §C (BLOCK 7) external_command_outbox.actor_user_id: the outbox (0096) has NO actor column at all —
--    the caller's user id is threaded only from the LIVE request JWT (adapter-dispatch/index.ts's
--    `callerUserId`) and never persisted. So when the SWEEP finalizes a committed-but-unmirrored SI
--    (no request JWT) the author is unrecoverable and `sales_invoices.author_user_id` lands NULL —
--    the root cause of the NULL-author SoD hole §B fails closed on. Additive + NULLABLE so existing
--    P2 rows and the shipped insert path stay valid.
--
-- 0126's org guard + service_role bypass are preserved VERBATIM in §A. The bypass is load-bearing:
-- the dispatch calls this RPC with the service client, whose auth_org_id() is NULL — without it every
-- SI create fails 'gate-check-failed'.
--
-- Reversibility (pre-production): `supabase db reset`. Manual reverse: re-create 0126's
-- get_process_gates body + 0124 §C's submit_sales_invoice body (the null-author-allowed variant), and
--   alter table public.external_command_outbox drop column if exists actor_user_id;

-- ============================================================================
-- §A — get_process_gates: merge the stored object OVER the per-key defaults.
-- ============================================================================

create or replace function public.get_process_gates(p_org uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- The single source of truth for gate defaults (mirrors DEFAULT_GATES in
  -- pmo-portal/src/lib/adapterSeam/erpnext/processGates.ts). require_project_on_si defaults TRUE.
  v_defaults constant jsonb :=
    '{"require_so_before_si":false,"require_bast_before_si":false,"require_project_on_si":true}'::jsonb;
  v_stored   jsonb;
begin
  -- (0126, unchanged) A SECURITY DEFINER reader must not hand back another org's config to a USER. The
  -- machine (service_role — the adapter-dispatch pre-flight gate check reads the command's own org) is
  -- exempt; a user-JWT caller may read only its OWN org's gates. A cross-org user read is 42501.
  -- (service_role bypass is load-bearing: the dispatch calls this with the serviceClient, where
  --  auth_org_id() is null — without the bypass every revenue create fails 'gate-check-failed'.)
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and p_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select (config -> 'process_gates') into v_stored
    from public.external_org_bindings
   where org_id = p_org and external_tier = 'erpnext';

  -- Absent, JSON null, or a non-object (a malformed config must never shape the gates) -> defaults.
  if v_stored is null or jsonb_typeof(v_stored) <> 'object' then
    return v_defaults;
  end if;

  -- Merge per-key OVER the defaults, taking ONLY known keys carrying a real boolean. A non-boolean
  -- (null/string/number) therefore falls back to its default rather than reaching the dispatch as a
  -- falsy value that would read as "gate off" — fail closed. Unknown keys are dropped, so the returned
  -- shape is always exactly the three documented gates.
  return v_defaults || coalesce(
    (select jsonb_object_agg(e.key, e.value)
       from jsonb_each(v_stored) as e
      where jsonb_typeof(e.value) = 'boolean'
        and v_defaults ? e.key),
    '{}'::jsonb);
end; $$;

revoke all on function public.get_process_gates(uuid) from public;
grant execute on function public.get_process_gates(uuid) to authenticated;

-- ============================================================================
-- §B — submit_sales_invoice: a NULL author can never satisfy approver≠author.
-- ============================================================================

create or replace function public.submit_sales_invoice(p_si_id uuid)
returns public.sales_invoices language plpgsql security definer set search_path = public as $$
declare
  v_row       public.sales_invoices;
  v_org       uuid;
  v_author    uuid;
  v_submitter text;
begin
  select * into v_row from public.sales_invoices where id = p_si_id;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;

  v_org := v_row.org_id;
  if v_org is distinct from auth_org_id()
     or auth_role() not in ('Admin','Executive','Project Manager','Finance')
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  v_author    := v_row.author_user_id;
  v_submitter := coalesce(auth.uid()::text, '');

  -- BLOCK 6 (defence in depth): FAIL CLOSED on an unknown author. Previously a NULL author was treated
  -- as SoD-exempt, so the approver≠author check below passed trivially for every caller — the rows we
  -- cannot attribute were exactly the rows with no two-person control. A submit now requires a known
  -- author; an inbound-adopted/unattributed SI must be attributed before it can be submitted from PMO.
  if v_author is null then
    raise exception 'sales invoice has no recorded author — SoD cannot be verified'
      using errcode = '42501',
            detail = 'sod-author-missing';
  end if;

  -- SoD (FR-SAR-195): the submitter must differ from the author.
  if v_author::text = v_submitter then
    raise exception 'approver must differ from author (SoD)'
      using errcode = '42501',
            detail = 'sod-self-approval';
  end if;

  return v_row;
end; $$;

revoke all on function public.submit_sales_invoice(uuid) from public;
grant execute on function public.submit_sales_invoice(uuid) to authenticated;

-- ============================================================================
-- §C — external_command_outbox.actor_user_id: persist WHO dispatched the command.
-- ============================================================================

-- Nullable (additive): existing P2 rows have no actor, and a machine/sweep-originated command
-- legitimately has none. The dispatch stamps it from the VERIFIED JWT (never a client-supplied value);
-- the sweep reads it back to attribute the author on a deferred finalize. Same FK shape as 0124's
-- sales_invoices.author_user_id.
alter table public.external_command_outbox
  add column if not exists actor_user_id uuid references auth.users(id);

comment on column public.external_command_outbox.actor_user_id is
  'The verified dispatching user (adapter-dispatch JWT sub) — lets a LATER sweep finalize attribute '
  'sales_invoices.author_user_id, which would otherwise be NULL and silently void the submit SoD. '
  'Nullable: machine/sweep-originated commands and pre-0127 rows have no actor.';
