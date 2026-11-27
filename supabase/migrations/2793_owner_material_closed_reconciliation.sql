-- 2793_owner_material_closed_reconciliation.sql — a closed work order still records its owner-supplied
-- material reconciliation step (#3024). Restates om_material_set_reconciliation from 2791's body with
-- ONE clause changed: the work-order status check admits 'Closed' alongside 'Draft' and 'Issued', so the
-- closing stage of a job can still be reconciled. Cancelled stays frozen and every other material write
-- keeps refusing on a closed order (guard_section_material_plan WOS_STATUS; om_material_import
-- 'Work order is frozen' — proven 2793_owner_material_closed_reconciliation.test.sql).
-- Mutation: remove 'Closed' from the status list (`-- mut:material_reconciliation_closed`) and the
-- closed-order acceptance assertions go red.
-- drops: om_material_set_reconciliation(uuid,uuid,text) | "if v_wo.id is null or v_wo.status not in ('Draft','Issued') or v_section.archived_at is not null then" | The status check now also admits 'Closed' (restated on the next line of the body); every other check is unchanged.
-- Rollback: supabase/migrations/rollback/2793_owner_material_closed_reconciliation_down.sql
create or replace function public.om_material_set_reconciliation(p_section_id uuid,p_step_id uuid,p_reason text default null) returns jsonb
language plpgsql volatile security definer set search_path=public,pg_temp as $$
declare v_org uuid:=public.auth_org_id();v_section public.work_order_sections;v_wo public.work_orders;
 v_step public.owner_material_reconciliation_steps;v_old public.owner_material_reconciliation;v_old_pct numeric;
begin
 perform public.assert_is_active_member();perform public.assert_not_light();perform public.csr_assert_recorder();
 perform pg_advisory_xact_lock(hashtextextended('om-scale:'||v_org::text,0));
 select * into v_section from public.work_order_sections s where s.id=p_section_id and s.org_id=v_org;
 if v_section.id is null then raise exception 'Section unavailable' using errcode='42501';end if; -- mut:material_reconciliation_org
 select * into v_wo from public.work_orders w where w.id=v_section.work_order_id and w.org_id=v_org for update;
 select * into v_section from public.work_order_sections s where s.id=p_section_id and s.org_id=v_org for update;
 if v_wo.id is null or v_wo.status not in ('Draft','Issued','Closed') or v_section.archived_at is not null then -- mut:material_reconciliation_closed
 raise exception 'Section is frozen' using detail='material-conflict';end if;
 select * into v_step from public.owner_material_reconciliation_steps s where s.id=p_step_id and s.org_id=v_org and s.archived_at is null;
 if v_step.id is null then raise exception 'Step unavailable' using errcode='42501';end if;
 select * into v_old from public.owner_material_reconciliation r where r.section_id=p_section_id for update;
 select percentage into v_old_pct from public.owner_material_reconciliation_steps where id=v_old.step_id;
 if v_step.percentage<v_old_pct and nullif(btrim(p_reason),'') is null then
 raise exception 'Moving backwards requires a reason' using detail='material-invalid';end if;
 insert into public.owner_material_reconciliation(org_id,section_id,step_id,changed_by,reason)
 values(v_org,p_section_id,p_step_id,auth.uid(),nullif(btrim(p_reason),''))
 on conflict(section_id) do update set step_id=excluded.step_id,changed_by=excluded.changed_by,changed_on=now(),reason=excluded.reason;
 insert into public.owner_material_reconciliation_events(org_id,section_id,previous_step_id,step_id,changed_by,reason)
 values(v_org,p_section_id,v_old.step_id,p_step_id,auth.uid(),nullif(btrim(p_reason),''));
 return jsonb_build_object('section_id',p_section_id,'step_id',p_step_id,'percentage',v_step.percentage::text);
end $$;
revoke all on function public.om_material_set_reconciliation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.om_material_set_reconciliation(uuid,uuid,text) to authenticated;
