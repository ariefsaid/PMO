-- Owner material opening positions and live attribution seam (#3010).
create table public.stock_material_categories (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 code text not null check(length(btrim(code)) between 1 and 40), name text not null check(length(btrim(name)) between 1 and 200),
 archived_at timestamptz, unique(id,org_id)
);
create unique index stock_material_categories_code on public.stock_material_categories(org_id,code) where archived_at is null;
create table public.owner_material_warehouses (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 code text not null check(length(btrim(code)) between 1 and 40), name text not null check(length(btrim(name)) between 1 and 200),
 archived_at timestamptz, unique(id,org_id)
);
create unique index owner_material_warehouses_code on public.owner_material_warehouses(org_id,code) where archived_at is null;
create table public.owner_material_import_batches (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 source_key text not null check(length(btrim(source_key)) between 1 and 200), schema_version integer not null check(schema_version=2),
 created_by uuid not null, created_at timestamptz not null default now(), source_digest text check(length(source_digest)<=200),
 unique(org_id,source_key),unique(id,org_id)
);
create table public.owner_material_import_rows (
 batch_id uuid not null, org_id uuid not null references public.organizations(id), entity_key text not null check(length(entity_key) between 1 and 500),
 payload_hash text not null, result_ids jsonb not null, primary key(batch_id,entity_key),
 foreign key(batch_id,org_id) references public.owner_material_import_batches(id,org_id)
);
alter table public.work_order_sections add column owner_cost_code text check(length(owner_cost_code)<=200), add unique(id,org_id);
alter table public.work_order_section_material_plan add column category_id uuid, add column import_batch_id uuid,
 add unique(id,org_id), add unique(id,org_id,item_id),
 add foreign key(category_id,org_id) references public.stock_material_categories(id,org_id),
 add foreign key(import_batch_id,org_id) references public.owner_material_import_batches(id,org_id);
alter table public.stock_items add column material_category_id uuid,
 add foreign key(material_category_id,org_id) references public.stock_material_categories(id,org_id);
alter table public.client_requisition_lines add column section_material_plan_id uuid,
 add foreign key(section_material_plan_id,org_id,stock_item_id) references public.work_order_section_material_plan(id,org_id,item_id);
alter table public.client_requisition_events add column owner_warehouse_id uuid,
 add foreign key(owner_warehouse_id,org_id) references public.owner_material_warehouses(id,org_id);
alter table public.client_requisitions add column import_batch_id uuid,
 add foreign key(import_batch_id,org_id) references public.owner_material_import_batches(id,org_id);
create table public.owner_material_openings (
 org_id uuid not null references public.organizations(id), section_material_plan_id uuid primary key,
 as_of date not null, requested numeric(14,3) not null default 0 check(requested>=0),
 set_aside numeric(14,3) not null default 0 check(set_aside>=0), received numeric(14,3) not null default 0 check(received>=0),
 issued numeric(14,3) not null default 0 check(issued>=0), returned numeric(14,3) not null default 0 check(returned>=0),
 transfer_in numeric(14,3) not null default 0 check(transfer_in>=0), transfer_out numeric(14,3) not null default 0 check(transfer_out>=0),
 owner_return numeric(14,3) not null default 0 check(owner_return>=0),
 evidence jsonb not null default '{}' check(octet_length(evidence::text)<=32768), import_batch_id uuid not null,
 created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(section_material_plan_id,org_id) references public.work_order_section_material_plan(id,org_id),
 foreign key(import_batch_id,org_id) references public.owner_material_import_batches(id,org_id)
);
create table public.owner_material_reconciliation_steps (
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations(id),
 position integer not null check(position>0),name text not null check(length(btrim(name)) between 1 and 100),
 percentage numeric(6,3) not null check(percentage between 0 and 100),archived_at timestamptz,unique(id,org_id)
);
create unique index owner_material_steps_position on public.owner_material_reconciliation_steps(org_id,position) where archived_at is null;
create unique index owner_material_steps_name on public.owner_material_reconciliation_steps(org_id,lower(btrim(name))) where archived_at is null;
create table public.owner_material_reconciliation (
 org_id uuid not null references public.organizations(id),section_id uuid primary key,step_id uuid not null,
 changed_on timestamptz not null default now(),changed_by uuid not null,reason text check(length(reason)<=1000),
 foreign key(section_id,org_id) references public.work_order_sections(id,org_id),
 foreign key(step_id,org_id) references public.owner_material_reconciliation_steps(id,org_id)
);
create table public.owner_material_reconciliation_events (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
 section_id uuid not null,previous_step_id uuid,step_id uuid not null,changed_by uuid not null,
 changed_on timestamptz not null default now(),reason text check(length(reason)<=1000),
 foreign key(section_id,org_id) references public.work_order_sections(id,org_id),
 foreign key(previous_step_id,org_id) references public.owner_material_reconciliation_steps(id,org_id),
 foreign key(step_id,org_id) references public.owner_material_reconciliation_steps(id,org_id)
);
alter table public.stock_document_lines add unique(id,document_id,org_id,item_id);
create table public.owner_material_movement_links (
 org_id uuid not null references public.organizations(id),document_id uuid not null,stock_line_id uuid not null,
 section_material_plan_id uuid not null,item_id uuid not null,
 stage text not null check(stage in ('received','issued','returned','transfer_in','transfer_out','owner_return')),
 primary key(document_id,stock_line_id,stage,section_material_plan_id),
 foreign key(stock_line_id,document_id,org_id,item_id) references public.stock_document_lines(id,document_id,org_id,item_id),
 foreign key(section_material_plan_id,org_id,item_id) references public.work_order_section_material_plan(id,org_id,item_id)
);
create index owner_material_links_plan on public.owner_material_movement_links(section_material_plan_id);
create index owner_material_openings_org on public.owner_material_openings(org_id);
create unique index owner_material_links_line_stage on public.owner_material_movement_links(stock_line_id,stage);
create index owner_material_reconciliation_section_org on public.owner_material_reconciliation(org_id,section_id);
-- Private capability: no client can insert a witness or retain one after the import returns.
create table public.owner_material_import_witness (
 transaction_id bigint not null,backend_pid integer not null,org_id uuid not null references public.organizations(id),
 actor_id uuid not null,batch_id uuid not null, primary key(transaction_id,backend_pid),
 foreign key(batch_id,org_id) references public.owner_material_import_batches(id,org_id)
);
do $$ declare t text; begin
 foreach t in array array['stock_material_categories','owner_material_warehouses','owner_material_import_batches','owner_material_import_rows',
 'owner_material_openings','owner_material_reconciliation_steps','owner_material_reconciliation','owner_material_reconciliation_events',
 'owner_material_movement_links','owner_material_import_witness'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 if t<>'owner_material_import_witness' then
 execute format('grant select on public.%I to authenticated',t);
 if t in ('owner_material_openings','owner_material_movement_links') then
 execute format('create policy material_read on public.%I for select to authenticated using (org_id=(select public.auth_org_id()) and (select public.is_active_member()) and exists(select 1 from public.work_order_section_material_plan p join public.work_orders w on w.id=p.work_order_id join public.projects j on j.id=w.project_id where p.id=section_material_plan_id))',t);
 elsif t in ('owner_material_reconciliation','owner_material_reconciliation_events') then
 execute format('create policy material_read on public.%I for select to authenticated using (org_id=(select public.auth_org_id()) and (select public.is_active_member()) and exists(select 1 from public.work_order_sections s join public.work_orders w on w.id=s.work_order_id join public.projects j on j.id=w.project_id where s.id=section_id))',t);
 elsif t in ('owner_material_import_batches','owner_material_import_rows') then
 execute format('create policy material_read on public.%I for select to authenticated using (org_id=(select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role())=''Admin'')',t);
 else
 execute format('create policy material_read on public.%I for select to authenticated using (org_id=(select public.auth_org_id()) and (select public.is_active_member()))',t);
 end if;
 end if;
 end loop;
end $$;
-- Opening rows and reconciliation events are written only by their owning RPCs.
create trigger owner_material_reconciliation_events_immutable before update or delete on public.owner_material_reconciliation_events
 for each row execute function public.guard_client_requisition_history();
update public.record_history_config set captured=captured||'{"owner_cost_code":"text"}' where table_name='work_order_sections';
update public.record_history_config set captured=captured||'{"category_id":"ref","import_batch_id":"ref"}' where table_name='work_order_section_material_plan';
update public.record_history_config set captured=captured||'{"material_category_id":"ref"}' where table_name='stock_items';
update public.record_history_config set captured=captured||'{"section_material_plan_id":"ref"}' where table_name='client_requisition_lines';
update public.record_history_config set captured=captured||'{"owner_warehouse_id":"ref"}' where table_name='client_requisition_events';
update public.record_history_config set captured=captured||'{"import_batch_id":"ref"}' where table_name='client_requisitions';

alter table public.work_order_sections add column skipped_source_rows integer not null default 0 check(skipped_source_rows>=0), add column skipped_reason_codes text[] not null default '{}' check(cardinality(skipped_reason_codes)<=20);
update public.record_history_config set captured=captured||'{"skipped_source_rows":"number","skipped_reason_codes":"text"}' where table_name='work_order_sections';
