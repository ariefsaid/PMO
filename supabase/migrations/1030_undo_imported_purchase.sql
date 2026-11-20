-- #2321: an Admin takes back a purchase that `import_purchase_history` (0890) brought in, by its import key.
-- Preview first (the default): the call reports what would be removed and writes nothing. Apply deletes ONLY that import's rows
-- (the purchase, its items, its order/receipt/invoice/payment, the status events the import derived and the import record, which frees
-- the key for a corrected row) and writes an audit event that keeps the payload and the reason.
-- Hard delete, not archive (ADR-0018 exception, recorded in the spec): the import wrote only PMO-native rows, nothing was sent to an
-- accounting system, and the key and the document numbers must be free again; the audit event is the permanent record.
-- Refused (nothing deleted) once anything outside the import exists: any row in a table that references the purchase or one of its documents (even one that would cascade) other than the
-- import's own tables (found from the catalog, so a table added later refuses by default), a document count or status that differs from
-- what the import created, a status change made after the import, or a queued ERP command for the purchase.
-- Rollback: rollback/1030_undo_imported_purchase_down.sql
create function public.undo_imported_purchase(p_import_key text, p_reason text, p_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_org uuid := public.auth_org_id(); v_actor uuid := auth.uid(); v_key text := btrim(p_import_key);
  v_imp public.purchase_history_imports%rowtype; v_proc public.procurements%rowtype; v_payload jsonb;
  v_has_po boolean; v_has_rc boolean; v_has_in boolean; v_has_py boolean; v_lines integer; v_expect_inv_status text;
  v_blockers jsonb := '[]'::jsonb; v_n bigint; v_fk record;
  v_removed jsonb;
begin
  if v_actor is null or v_org is null or not coalesce(public.is_active_member(), false)
     or public.auth_role()::text is distinct from 'Admin'
     or exists (select 1 from auth.users u where u.id = v_actor and u.banned_until is not null and u.banned_until > now()) then
    raise exception 'Only an active Admin can undo an imported purchase.' using errcode = '42501';
  end if;
  if v_key is null or v_key = '' or char_length(v_key) > 120 then
    raise exception 'import_key_required' using errcode = '22023';
  end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required' using errcode = '22023'; end if;
  if p_dry_run is null then raise exception 'invalid_dry_run' using errcode = '22023'; end if;
  -- The same lock the import takes for this key: an undo and a re-import of one key never interleave.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':purchase-history:' || v_key, 0));
  select * into v_imp from public.purchase_history_imports where org_id = v_org and import_key = v_key;
  if not found then
    return jsonb_build_object('import_key', v_key, 'outcome', 'refused', 'reason', 'import_not_found', 'erp_write', false);
  end if;
  select * into v_proc from public.procurements where id = v_imp.procurement_id and org_id = v_org for update;
  if not found then
    return jsonb_build_object('import_key', v_key, 'outcome', 'refused', 'reason', 'import_not_found', 'erp_write', false);
  end if;
  v_payload := v_imp.payload;
  v_has_po := jsonb_typeof(v_payload->'order') = 'object';
  v_has_rc := jsonb_typeof(v_payload->'receipt') = 'object';
  v_has_in := jsonb_typeof(v_payload->'invoice') = 'object';
  v_has_py := jsonb_typeof(v_payload->'payment') = 'object';
  v_lines := case when jsonb_typeof(v_payload->'lines') = 'array' then jsonb_array_length(v_payload->'lines') else 0 end;
  v_expect_inv_status := case when v_has_py then 'Paid' else 'Received' end;

  -- 1. Each document table holds exactly what the import created: nothing recorded later, nothing removed.
  if (select count(*) from public.procurement_items where procurement_id = v_proc.id) is distinct from v_lines then
    v_blockers := v_blockers || jsonb_build_array('procurement_items'); end if;
  if (select count(*) from public.purchase_orders where procurement_id = v_proc.id) is distinct from (case when v_has_po then 1 else 0 end) then
    v_blockers := v_blockers || jsonb_build_array('purchase_orders'); end if;
  if (select count(*) from public.procurement_receipts where procurement_id = v_proc.id) is distinct from (case when v_has_rc then 1 else 0 end) then
    v_blockers := v_blockers || jsonb_build_array('procurement_receipts'); end if;
  if (select count(*) from public.procurement_invoices where procurement_id = v_proc.id) is distinct from (case when v_has_in then 1 else 0 end)
     or exists (select 1 from public.procurement_invoices where procurement_id = v_proc.id and status::text is distinct from v_expect_inv_status) then
    v_blockers := v_blockers || jsonb_build_array('procurement_invoices'); end if;
  if (select count(*) from public.payments where procurement_id = v_proc.id) is distinct from (case when v_has_py then 1 else 0 end) then
    v_blockers := v_blockers || jsonb_build_array('payments'); end if;
  -- The import's own status events are the derived ones (note 'Derived: ...'); any other event is a later transition.
  if exists (select 1 from public.procurement_status_events e where e.procurement_id = v_proc.id and coalesce(e.notes, '') not like 'Derived: %') then
    v_blockers := v_blockers || jsonb_build_array('procurement_status_events'); end if;

  -- 2. Any other table that references the purchase or one of the import's own documents (found from the catalog, including composite
  --    keys, whatever the on-delete action): a row there is later work. Cascading children (receipt lines, bill matches and their lines)
  --    would otherwise be deleted silently, so they are counted here rather than left to the 23503 catch below.
  for v_fk in
    select distinct c.conrelid::regclass::text as tbl, a.attname::text as col, c.confrelid::regclass::text as ptbl,
           (c.confrelid = 'public.procurements'::regclass) as is_head
      from pg_constraint c
      cross join lateral unnest(c.conkey, c.confkey) as k(child_attnum, parent_attnum)
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.child_attnum
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.parent_attnum and pa.attname = 'id'
     where c.contype = 'f'
       and c.confrelid in ('public.procurements'::regclass, 'public.procurement_items'::regclass, 'public.purchase_orders'::regclass,
                           'public.procurement_receipts'::regclass, 'public.procurement_invoices'::regclass, 'public.payments'::regclass)
       and c.conrelid not in ('public.procurement_items'::regclass, 'public.purchase_orders'::regclass, 'public.procurement_receipts'::regclass,
                              'public.procurement_invoices'::regclass, 'public.payments'::regclass, 'public.procurement_status_events'::regclass,
                              'public.purchase_history_imports'::regclass)
  loop
    if v_fk.is_head then
      execute format('select count(*) from %s where %I = $1', v_fk.tbl, v_fk.col) into v_n using v_proc.id;
    else
      execute format('select count(*) from %s where %I in (select id from %s where procurement_id = $1)', v_fk.tbl, v_fk.col, v_fk.ptbl)
        into v_n using v_proc.id;
    end if;
    if v_n > 0 then v_blockers := v_blockers || jsonb_build_array(regexp_replace(v_fk.tbl, '^public\.', '')); end if;
  end loop;
  -- The 23503 catch below stays as the last line, for any reference the scan cannot see.

  -- 3. A command queued for an accounting system for this purchase.
  if exists (select 1 from public.external_command_outbox o where o.org_id = v_org and o.domain = 'procurement'
             and public.procurement_case_uuid(o.payload->>'procurementId') = v_proc.id) then
    v_blockers := v_blockers || jsonb_build_array('external_command_outbox');
  end if;

  v_removed := jsonb_build_object('procurement', 1, 'items', (select count(*) from public.procurement_items where procurement_id = v_proc.id),
    'purchase_orders', (select count(*) from public.purchase_orders where procurement_id = v_proc.id),
    'receipts', (select count(*) from public.procurement_receipts where procurement_id = v_proc.id),
    'invoices', (select count(*) from public.procurement_invoices where procurement_id = v_proc.id),
    'payments', (select count(*) from public.payments where procurement_id = v_proc.id),
    'status_events', (select count(*) from public.procurement_status_events where procurement_id = v_proc.id),
    'import_record', 1);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('import_key', v_key, 'outcome', 'refused', 'reason', 'has_later_records', 'blocked_by', v_blockers,
      'procurement_id', v_proc.id, 'erp_write', false);
  end if;
  if p_dry_run then
    return jsonb_build_object('import_key', v_key, 'outcome', 'undo', 'dry_run', true, 'procurement_id', v_proc.id, 'code', v_proc.code,
      'status', v_proc.status, 'would_remove', v_removed, 'erp_write', false);
  end if;

  begin
    delete from public.purchase_history_imports where org_id = v_org and import_key = v_key;
    delete from public.payments where procurement_id = v_proc.id;
    delete from public.procurement_invoices where procurement_id = v_proc.id;
    delete from public.procurement_receipts where procurement_id = v_proc.id;
    delete from public.purchase_orders where procurement_id = v_proc.id;
    delete from public.procurement_items where procurement_id = v_proc.id;
    delete from public.procurements where id = v_proc.id and org_id = v_org;  -- cascades the derived status events
  exception when foreign_key_violation then
    -- Something outside the import points at one of its documents: the savepoint of this block rolls the deletes back.
    return jsonb_build_object('import_key', v_key, 'outcome', 'refused', 'reason', 'has_later_records',
      'blocked_by', jsonb_build_array('referenced_document'), 'procurement_id', v_proc.id, 'erp_write', false);
  end;
  perform public.log_audit('procurement.history_import_undo', v_org, v_actor, v_proc.id,
    jsonb_build_object('import_key', v_key, 'reason', btrim(p_reason), 'code', v_proc.code, 'status', v_proc.status,
      'approved_outside_pmo_by', v_imp.approved_outside_pmo_by, 'imported_by', v_imp.imported_by, 'imported_at', v_imp.imported_at,
      'removed', v_removed, 'payload', v_payload, 'erp_write', false));
  return jsonb_build_object('import_key', v_key, 'outcome', 'undo', 'dry_run', false, 'procurement_id', v_proc.id, 'code', v_proc.code,
    'removed', v_removed, 'erp_write', false);
end $$;
revoke all on function public.undo_imported_purchase(text, text, boolean) from public, anon, service_role;
grant execute on function public.undo_imported_purchase(text, text, boolean) to authenticated;
