-- #1514 T3: client sign-off and the invoice bridge for time-and-materials claims.
-- A confirmed sign-off creates the progress-claim record (kind time_materials, claim id = invoice id) with the signed document
-- as billing evidence; everything after (raise, approve, outbox, recovery, mirror, withdraw) is the shipped claim path.
-- Rollback: migrations/rollback/0517_tm_signoff_down.sql (refuses while any time_materials claim exists).

-- ── §1 progress_claims admits the new kind ──────────────────────────────────────────────────────
alter table public.progress_claims drop constraint progress_claims_kind_check;
alter table public.progress_claims add constraint progress_claims_kind_check
  check (kind in ('down_payment', 'progress', 'time_materials'));
alter table public.progress_claims drop constraint progress_claims_kind_shape;
alter table public.progress_claims add constraint progress_claims_kind_shape check (
  (kind = 'down_payment'
    and down_payment_amount > 0 and down_payment_amount < 'Infinity'::numeric
    and recovery_pct > 0 and recovery_pct <= 100
    and gross_amount = down_payment_amount and dp_recovery_amount = 0 and dp_item_code is not null)
  or (kind = 'progress'
    and down_payment_amount is null and recovery_pct is null
    and dp_recovery_amount <= gross_amount
    and (dp_recovery_amount = 0 or dp_item_code is not null))
  or (kind = 'time_materials'
    and down_payment_amount is null and recovery_pct is null
    and dp_recovery_amount = 0 and dp_item_code is null));

-- ── §2 sign-off columns on the T&M claim ────────────────────────────────────────────────────────
-- prepared_by (T2) is whoever assembled the claim; signoff_prepared_by is whoever prepared the sign-off. Both are authors
-- of the quantities, so neither may confirm (unless the sole active member) and neither may approve the invoice.
-- prepared_fingerprint pins what the client was shown: a deselect after prepare forces a new prepare.
alter table public.tm_claims
  add column signoff_prepared_by uuid references public.profiles(id),
  add column signoff_prepared_at timestamptz,
  add column prepared_fingerprint text,
  add constraint tm_claims_note_len check (note is null or length(note) <= 500),
  add constraint tm_claims_signed_off_prepared check (
    status <> 'SignedOff' or (signoff_prepared_by is not null and prepared_fingerprint is not null));
create index tm_claims_signoff_prepared_by_idx on public.tm_claims (signoff_prepared_by);

create function public.tm_claim_fingerprint(p_claim uuid) returns text
language sql stable set search_path = public, pg_temp as $$
  select md5(coalesce((select c.gross_amount::text from public.tm_claims c where c.id = p_claim), '') || ':' ||
             coalesce((select string_agg(s.source_id::text || '=' || s.units::text, ',' order by s.source_id)
                         from public.tm_claim_sources s where s.claim_id = p_claim), ''))
$$;

-- ── §3 a signed-off claim is frozen (the withdrawal is the one allowed change) ──────────────────
create function public.tm_claims_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'SignedOff' then
      raise exception 'a confirmed sign-off cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;
  if (new.id, new.org_id, new.project_id) is distinct from (old.id, old.org_id, old.project_id) then
    raise exception 'a claim cannot move to another project' using errcode = '42501';
  end if;
  if old.status = 'Withdrawn' then
    raise exception 'this claim was withdrawn and can no longer change' using errcode = '42501';
  end if;
  if old.status = 'SignedOff' and (new.status <> 'Withdrawn'
       or (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')) then
    raise exception 'a confirmed sign-off cannot be edited: withdraw the claim instead' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tm_claims_guard before update or delete on public.tm_claims
  for each row execute function public.tm_claims_guard();

-- Lines and sources change only while their claim is Draft; a withdrawal releases sources (is_live true -> false) once.
create function public.tm_claim_child_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_status text;
begin
  select c.status into v_status from public.tm_claims c where c.id = old.claim_id;
  -- no parent row: the claim itself is being deleted (cascade)
  if v_status is null or v_status = 'Draft' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'tm_claim_sources' and tg_op = 'UPDATE' and v_status = 'Withdrawn' then
    if old.is_live and not new.is_live and (to_jsonb(new) - 'is_live') = (to_jsonb(old) - 'is_live') then
      return new;
    end if;
  end if;
  raise exception 'the lines and sources of a % claim cannot change', lower(v_status) using errcode = '42501';
end $$;
create trigger tm_claim_lines_guard before update or delete on public.tm_claim_lines
  for each row execute function public.tm_claim_child_guard();
create trigger tm_claim_sources_guard before update or delete on public.tm_claim_sources
  for each row execute function public.tm_claim_child_guard();

-- ── §4 prepare / withdraw / confirm ─────────────────────────────────────────────────────────────
create function public.prepare_tm_signoff(p_claim uuid, p_document uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_project uuid;
  v_wo uuid;
  v_status text;
  v_note text := nullif(btrim(p_note), '');
begin
  perform public.assert_is_active_member();
  if p_claim is null or p_document is null then
    raise exception 'a claim and a signed project document are required' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'the note may have at most 500 characters' using errcode = '22023';
  end if;
  select c.project_id, c.work_order_id into v_project, v_wo from public.tm_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  -- SECURITY: the role re-assertion MUST stay: a SECURITY DEFINER body bypasses RLS.
  if not public.may_record_project_progress(v_project) then
    raise exception 'not authorized to prepare a sign-off for this project' using errcode = '42501';
  end if;
  -- Lock order as create_progress_claim: the work order's billing lock, the project row, then the claim.
  if v_wo is not null then perform public.lock_work_order_billing(v_wo); end if;
  perform 1 from public.projects p where p.id = v_project and p.org_id = v_org for update;
  select c.status into v_status from public.tm_claims c where c.id = p_claim for update;
  if v_status is distinct from 'Draft' then
    raise exception 'only a Draft claim can be prepared for sign-off (this one is %)', v_status using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.project_documents d where d.id = p_document and d.org_id = v_org and d.project_id = v_project) then
    raise exception 'the sign-off document must belong to the claim''s project' using errcode = '23514';
  end if;
  update public.tm_claims set document_id = p_document, note = v_note, signoff_prepared_by = v_uid, signoff_prepared_at = now(),
         prepared_fingerprint = public.tm_claim_fingerprint(p_claim)
   where id = p_claim;
  perform public.log_audit('tm_signoff.prepare', v_org, v_uid, p_claim,
    jsonb_build_object('project_id', v_project, 'document_id', p_document,
                       'gross_amount', (select c.gross_amount from public.tm_claims c where c.id = p_claim)));
end $$;

create function public.withdraw_tm_signoff(p_claim uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_role user_role := public.auth_role();
  v_wo uuid;
  v_status text;
  v_assembler uuid;
  v_preparer uuid;
  v_cancelled boolean;
begin
  perform public.assert_is_active_member();
  select c.work_order_id, c.prepared_by, c.signoff_prepared_by into v_wo, v_assembler, v_preparer
    from public.tm_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  if v_wo is not null then perform public.lock_work_order_billing(v_wo); end if;
  select c.status into v_status from public.tm_claims c where c.id = p_claim for update;
  if v_status = 'Withdrawn' then
    raise exception 'this claim is already withdrawn' using errcode = 'P0001';
  end if;
  if v_status = 'Draft' then
    -- SECURITY: the role re-assertion MUST stay.
    if not (v_uid is not distinct from v_assembler or v_uid is not distinct from v_preparer or v_role in ('Admin', 'Finance')) then
      raise exception 'only the preparer, Admin or Finance may withdraw this claim' using errcode = '42501';
    end if;
    update public.tm_claims set status = 'Withdrawn' where id = p_claim;
    update public.tm_claim_sources set is_live = false where claim_id = p_claim;
  else
    if v_role is null or v_role not in ('Admin', 'Finance') then
      raise exception 'only Admin or Finance may withdraw a confirmed sign-off' using errcode = '42501';
    end if;
    -- Same row lock and refusals as withdraw_progress_claim, except that a CANCELLED invoice no longer holds the hours.
    perform 1 from public.progress_claims pc where pc.id = p_claim for update;
    if exists (select 1 from public.sales_invoices si where si.id = p_claim and si.status <> 'Cancelled') then
      raise exception 'this claim already has an invoice — cancel the invoice instead' using errcode = 'P0001';
    end if;
    v_cancelled := exists (select 1 from public.sales_invoices si where si.id = p_claim and si.status = 'Cancelled');
    if exists (select 1 from public.external_command_outbox o
                where o.org_id = v_org and o.domain = 'revenue' and lower(o.pmo_record_id) = p_claim::text
                  and o.state <> 'failed' and not (v_cancelled and o.state = 'confirmed')) then
      raise exception 'an invoice for this claim is being raised in the ERP — wait for it to finish, then cancel the invoice if it is wrong'
        using errcode = 'P0001';
    end if;
    -- tm_claim_follow_withdrawal moves the T&M claim to Withdrawn and releases its sources.
    update public.progress_claims set withdrawn_by = v_uid, withdrawn_at = now() where id = p_claim;
  end if;
  perform public.log_audit('tm_signoff.withdraw', v_org, v_uid, p_claim, jsonb_build_object('was', v_status));
end $$;

-- A claim withdrawn through the existing withdraw_progress_claim releases its hours the same way.
create function public.tm_claim_follow_withdrawal() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.tm_claims set status = 'Withdrawn' where id = new.id and status = 'SignedOff';
  update public.tm_claim_sources set is_live = false where claim_id = new.id and is_live;
  return null;
end $$;
create trigger progress_claims_tm_follow_withdrawal after update on public.progress_claims
  for each row when (new.kind = 'time_materials' and old.withdrawn_at is null and new.withdrawn_at is not null)
  execute function public.tm_claim_follow_withdrawal();

create function public.confirm_tm_signoff(p_claim uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid := public.auth_org_id();
  v_uid uuid := auth.uid();
  v_role user_role := public.auth_role();
  v_c public.tm_claims;
  v_currency text;
  v_basis text := 'standard';
  v_sole boolean := false;
  v_doc_status public.doc_status;
  v_doc_revision text;
  v_bad integer;
begin
  perform public.assert_is_active_member();
  select * into v_c from public.tm_claims c where c.id = p_claim and c.org_id = v_org;
  if not found then raise exception 'claim not found' using errcode = 'P0002'; end if;
  -- SECURITY: the role and separation-of-duties re-assertions MUST stay: a SECURITY DEFINER body bypasses RLS.
  if v_role is null or v_role not in ('Admin', 'Finance') then
    raise exception 'only Admin or Finance may confirm a sign-off' using errcode = '42501';
  end if;
  -- Lock order as create_progress_claim: the work order's billing lock, the project row, then the claim.
  if v_c.work_order_id is not null then perform public.lock_work_order_billing(v_c.work_order_id); end if;
  select p.currency into v_currency from public.projects p where p.id = v_c.project_id and p.org_id = v_org for update;
  select * into v_c from public.tm_claims c where c.id = p_claim for update;
  if v_c.status <> 'Draft' then
    raise exception 'this sign-off is already %', lower(v_c.status) using errcode = 'P0001';
  end if;
  if v_c.signoff_prepared_by is null or v_c.document_id is null or v_c.prepared_fingerprint is null then
    raise exception 'prepare the sign-off before confirming it' using errcode = 'P0001';
  end if;
  if v_uid is not distinct from v_c.prepared_by or v_uid is not distinct from v_c.signoff_prepared_by then
    select count(*) = 1 and bool_or(p.id = auth.uid()) into v_sole
      from public.profiles p where p.org_id = v_org and public.is_active_member(p.id);
    if not coalesce(v_sole, false) then
      raise exception 'separation of duties: the preparer cannot confirm this sign-off' using errcode = '42501';
    end if;
    v_basis := 'sole_operator';
  end if;
  if v_c.currency is distinct from v_currency then
    raise exception 'the claim is in % but the project is in %', v_c.currency, v_currency using errcode = '23514';
  end if;
  select d.status, d.revision into v_doc_status, v_doc_revision
    from public.project_documents d
   where d.id = v_c.document_id and d.org_id = v_org and d.project_id = v_c.project_id
     and d.status in ('Issued', 'Approved') and nullif(btrim(d.file_path), '') is not null
     for share;
  if not found then
    raise exception 'confirmation requires an Issued or Approved project document with a file' using errcode = '23514';
  end if;
  if not exists (select 1 from public.tm_claim_lines l where l.claim_id = p_claim) then
    raise exception 'a claim with no lines cannot be signed off' using errcode = 'P0001';
  end if;
  if public.tm_claim_fingerprint(p_claim) is distinct from v_c.prepared_fingerprint then
    raise exception 'the claim changed after its sign-off was prepared: prepare it again' using errcode = 'P0001';
  end if;
  -- Every source must still be an Approved hour of this project, as assembled. Hold the weeks while we read them: a concurrent
  -- reopen takes the row lock first (and then sees this claim is live), or waits for this transaction.
  -- ponytail: timesheet sources only; T5 adds the equipment usage branch here (an unknown kind fails closed).
  perform 1 from public.timesheets t
   where t.id in (select en.timesheet_id from public.tm_claim_sources s
                    join public.timesheet_entries en on en.id = s.source_id where s.claim_id = p_claim and s.source_kind = 'timesheet_entry')
   order by t.id for share;
  select count(*) into v_bad from public.tm_claim_sources s
   where s.claim_id = p_claim and (not s.is_live or not exists (
     select 1 from public.timesheet_entries en join public.timesheets t on t.id = en.timesheet_id
      where s.source_kind = 'timesheet_entry' and en.id = s.source_id and en.org_id = v_org and t.org_id = v_org
        and t.status = 'Approved' and en.project_id = v_c.project_id
        and en.entry_date between v_c.period_from and v_c.period_to and en.hours = s.units));
  if v_bad > 0 then
    raise exception 'an hour in this claim is no longer approved: withdraw the claim and assemble it again' using errcode = 'P0001';
  end if;
  -- ⚑ FR-TM-033: the claim reserves its gross against its work order at confirm, as create_progress_claim does.
  if v_c.work_order_id is not null then
    perform public.assert_work_order_invoiceable(v_org, v_c.work_order_id, v_c.project_id, p_claim::text, v_c.gross_amount, v_c.currency);
  end if;
  insert into public.progress_claims (id, org_id, project_id, work_order_id, kind, currency, gross_amount, dp_recovery_amount, created_by)
  values (p_claim, v_org, v_c.project_id, v_c.work_order_id, 'time_materials', v_c.currency, v_c.gross_amount, 0, v_c.prepared_by);
  insert into public.progress_claim_evidence (org_id, claim_id, document_id, document_status, document_revision, attached_by)
  values (v_org, p_claim, v_c.document_id, v_doc_status, v_doc_revision, v_uid);
  update public.tm_claims set status = 'SignedOff', confirmed_by = v_uid, confirm_basis = v_basis where id = p_claim;
  perform public.log_audit('tm_signoff.confirm', v_org, v_uid, p_claim,
    jsonb_build_object('project_id', v_c.project_id, 'work_order_id', v_c.work_order_id, 'document_id', v_c.document_id,
                       'gross_amount', v_c.gross_amount, 'basis', v_basis));
  return jsonb_build_object('claim_id', p_claim, 'basis', v_basis, 'gross_amount', v_c.gross_amount);
end $$;

-- ── §5 the fence and the author set (newest bodies: 0250 §7, extended) ───────────────────────────
create or replace function public.assert_progress_claim_raisable() returns trigger
  language plpgsql security definer set search_path = public as $$
declare v_withdrawn timestamptz; v_claim_org uuid; v_tm_org uuid; v_tm_status text; v_tm_confirmed uuid;
begin
  if new.pmo_record_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return new;
  end if;
  -- ⚑ 0517 (#1514 D2): a time-and-materials claim exists before its sign-off, without a progress-claim row, so the
  -- "not a claim" exit below would wave it through. Only a confirmed sign-off can be raised.
  select c.org_id, c.status, c.confirmed_by into v_tm_org, v_tm_status, v_tm_confirmed
    from public.tm_claims c where c.id = new.pmo_record_id::uuid for share;
  if found then
    if v_tm_org is distinct from new.org_id then
      raise exception 'this progress claim belongs to another organisation' using errcode = '42501';
    end if;
    if v_tm_status = 'Withdrawn' then
      raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
    end if;
    if v_tm_status is distinct from 'SignedOff' or v_tm_confirmed is null then
      raise exception 'confirm the client''s sign-off before raising this time-and-materials claim''s invoice' using errcode = '55000';
    end if;
  end if;
  select pc.withdrawn_at, pc.org_id into v_withdrawn, v_claim_org
    from public.progress_claims pc
   where pc.id = new.pmo_record_id::uuid
     for share;
  if not found then
    return new;   -- not a claim: an ordinary invoice or receipt
  end if;
  -- A money fence fails CLOSED: a claim id under another org is refused, never waved through as "not a claim".
  if v_claim_org is distinct from new.org_id then
    raise exception 'this progress claim belongs to another organisation' using errcode = '42501';
  end if;
  if v_withdrawn is not null then
    raise exception 'this progress claim was withdrawn, so no invoice can be raised for it' using errcode = '55000';
  end if;
  if not exists (select 1 from public.progress_claim_evidence ev where ev.claim_id = new.pmo_record_id::uuid) then
    raise exception 'attach the billing evidence (for example the progress report or the client''s acceptance) before raising this claim''s invoice'
      using errcode = '55000';
  end if;
  return new;
end; $$;

create or replace function public.append_progress_claim_author() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  select new.org_id, new.id, pc.created_by
    from public.progress_claims pc
   where pc.id = new.id and pc.org_id = new.org_id
  on conflict do nothing;
  -- ⚑ 0517 (#1514 FR-TM-035): a T&M claim's invoice is also authored by whoever prepared its sign-off and whoever confirmed it.
  insert into public.sales_invoice_authors (org_id, sales_invoice_id, user_id)
  select new.org_id, new.id, u.id
    from public.tm_claims c
   cross join lateral (values (c.prepared_by), (c.signoff_prepared_by), (c.confirmed_by)) u(id)
   where c.id = new.id and c.org_id = new.org_id and u.id is not null
  on conflict do nothing;
  return new;
end; $$;

-- ── §6 grants ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public.assert_progress_claim_raisable() from public, anon, authenticated;
revoke all on function public.append_progress_claim_author() from public, anon, authenticated;
revoke all on function public.tm_claim_fingerprint(uuid) from public, anon, authenticated;
revoke all on function public.tm_claims_guard() from public, anon, authenticated;
revoke all on function public.tm_claim_child_guard() from public, anon, authenticated;
revoke all on function public.tm_claim_follow_withdrawal() from public, anon, authenticated;
revoke all on function public.prepare_tm_signoff(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.withdraw_tm_signoff(uuid) from public, anon, authenticated;
revoke all on function public.confirm_tm_signoff(uuid) from public, anon, authenticated;
grant execute on function public.prepare_tm_signoff(uuid, uuid, text) to authenticated;
grant execute on function public.withdraw_tm_signoff(uuid) to authenticated;
grant execute on function public.confirm_tm_signoff(uuid) to authenticated;
alter function public.prepare_tm_signoff(uuid, uuid, text) owner to postgres;
alter function public.withdraw_tm_signoff(uuid) owner to postgres;
alter function public.confirm_tm_signoff(uuid) owner to postgres;
alter function public.tm_claim_follow_withdrawal() owner to postgres;

do $$
declare v_bad text;
begin
  select p.oid::regprocedure::text into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('tm_claim_fingerprint', 'tm_claims_guard', 'tm_claim_child_guard', 'tm_claim_follow_withdrawal',
                       'prepare_tm_signoff', 'withdraw_tm_signoff', 'confirm_tm_signoff')
     and (
       (p.proname not in ('prepare_tm_signoff', 'withdraw_tm_signoff', 'confirm_tm_signoff')
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
       or has_function_privilege('anon', p.oid, 'EXECUTE')
       or exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
       )
     )
   limit 1;
  if v_bad is not null then raise exception '0517 function has an unsafe client grant: %', v_bad; end if;
end $$;
