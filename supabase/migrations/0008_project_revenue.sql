-- 0008_project_revenue.sql — Projects revenue fields + pipeline_stage_config + transition_project
-- (projects-revenue-transitions.spec / OD-SP-1/2/3, OD-MARGIN-2, OD-PR-A/B/C/D).
--
-- Follows the ADR-0012 pattern (the procurement/timesheet transition-RPC: security-definer + internal
-- authz re-assertion + map-as-data legality + pinned search_path = public + revoke-anon + schema-qualified
-- table refs), itself ADR-0011 generalized. No new ADR: a single-table state machine over `projects`, a
-- status→number config lookup seeded per org, three nullable columns — none architecturally novel. The
-- pipeline_stage_config table is the OD-SP-2-sanctioned cheap config seam (distinct from the deferred
-- workflow-config engine OD-PROC-6). Forward-only, additive; reversibility = `supabase db reset`
-- (pre-production, ADR-0006). Calls auth_org_id()/auth_role() from 0002_rls.sql.

-- ============================================================================
-- A1 — Revenue columns on projects (FR-PR-005/006, NFR-PR-PERF-001).
-- All nullable: null = still in pipeline / undecided (OD-SP-3).
-- ============================================================================
alter table projects
  add column customer_contract_ref text,        -- the CLIENT's inbound contract/PO number issued TO us:
                                                 -- MANUALLY entered, NOT auto-generated (mirror of our
                                                 -- outbound vendor PO, OD-SP-3). Capturing it IS the win.
  add column contract_date          date,        -- the customer contract/PO date (the decision date on win)
  add column decided_at             timestamptz; -- win-rate time-filter field: contract_date on win,
                                                 -- now() on Loss Tender, null while undecided (OD-SP-3/OD-PR-D)

-- Supporting index for #5's decided-deal time filter (win-rate over a chosen period).
create index projects_org_decided_idx on projects (org_id, decided_at);

-- ============================================================================
-- A2 — pipeline_stage_config table + RLS (FR-PR-008, OD-SP-2, OD-PR-A).
-- Cheap org-scoped status→win-probability lookup so the future admin-settings UI edits rows with no
-- migration/code change. PK (org_id, status) gives the indexed org read (NFR-PR-PERF-001) and prevents
-- duplicate stage rows. org_id from the column default = client-unspoofable on insert.
-- ============================================================================
create table pipeline_stage_config (
  org_id          uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  status          project_status not null,
  win_probability numeric(4,3) not null,
  primary key (org_id, status)
);
alter table pipeline_stage_config enable row level security;
alter table pipeline_stage_config force  row level security;  -- even the table owner is subject to policies (0004)
create policy pipeline_stage_config_select on pipeline_stage_config for select
  using (org_id = auth_org_id());
-- Coarse 4-role write gate (FR-PR-008, OD-PR-A): consistent with projects_write / budget_versions_write.
-- Fine-grained (e.g. Admin-only) tightening deferred to the OD-PROC-6 config bridge.
create policy pipeline_stage_config_write on pipeline_stage_config for all
  using (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'))
  with check (org_id = auth_org_id() and auth_role() in ('Admin','Executive','Project Manager','Finance'));

-- ============================================================================
-- A3 — Seed the OD-SP-2 default win-probabilities for the default org (FR-PR-009).
-- Monotonic ramp; only the five pipeline stages get a row (on-hand/lost/internal have no win-prob).
-- ============================================================================
insert into pipeline_stage_config (org_id, status, win_probability) values
  ('00000000-0000-0000-0000-000000000001','Leads',               0.100),
  ('00000000-0000-0000-0000-000000000001','PQ Submitted',        0.250),
  ('00000000-0000-0000-0000-000000000001','Quotation Submitted', 0.400),
  ('00000000-0000-0000-0000-000000000001','Tender Submitted',    0.500),
  ('00000000-0000-0000-0000-000000000001','Negotiation',         0.750)
on conflict (org_id, status) do nothing;

-- ============================================================================
-- A4/A5 — transition_project: the single authority for all project status changes
-- (FR-PR-001/002/003/004/005/006/007/010, NFR-PR-ATOM-001). map-as-data legality (P0001) + coarse role
-- gate + tenant isolation (42501) + win/loss capture + single atomic update.
-- SECURITY DEFINER so the status + captured-field write is one indivisible txn; it therefore RE-ASSERTS
-- auth_org_id() + the coarse role gate INTERNALLY. Removing either re-assertion would bypass RLS and permit
-- cross-org / unauthorized transitions — they MUST stay (ADR-0011/0012 lesson). search_path pinned to
-- public; table refs schema-qualified (LOW-BV-1).
-- ============================================================================
create or replace function transition_project(
  p_id uuid, p_to project_status, p_customer_contract_ref text default null, p_contract_date date default null)
  returns void language plpgsql security definer set search_path = public as $$
declare
  v_from project_status;
  v_org  uuid;
  v_role user_role := auth_role();
  -- The transition map (OD-SP-1/OD-PR-B config seam): legal (from → [allowed to]) permissive superset, as
  -- data. Win reachable from late pipeline; free on-hand interconversion; Loss Tender→Negotiation and
  -- Close Out→Ongoing re-open allowed; Internal Project reachable only from Leads (terminal). EXACT enum
  -- spelling (note the comma in 'Won, Pending KoM').
  v_legal jsonb := jsonb_build_object(
    'Leads',               jsonb_build_array('PQ Submitted','Loss Tender','Internal Project'),
    'PQ Submitted',        jsonb_build_array('Quotation Submitted','Leads','Loss Tender'),
    'Quotation Submitted', jsonb_build_array('Tender Submitted','PQ Submitted','Won, Pending KoM','Loss Tender'),
    'Tender Submitted',    jsonb_build_array('Negotiation','Quotation Submitted','Won, Pending KoM','Loss Tender'),
    'Negotiation',         jsonb_build_array('Won, Pending KoM','Tender Submitted','Loss Tender'),
    'Won, Pending KoM',    jsonb_build_array('Ongoing Project','On Hold','Close Out'),
    'Ongoing Project',     jsonb_build_array('On Hold','Close Out'),
    'On Hold',             jsonb_build_array('Ongoing Project','Close Out'),
    'Close Out',           jsonb_build_array('Ongoing Project'),
    'Loss Tender',         jsonb_build_array('Negotiation'),
    'Internal Project',    jsonb_build_array()
  );
begin
  -- Load + lock the row (serializes concurrent transitions on the SAME project). P0002 if absent.
  select status, org_id into v_from, v_org from public.projects where id = p_id for update;
  if v_from is null then
    raise exception 'project not found' using errcode = 'P0002';
  end if;

  -- Tenant isolation (FR-PR-004): proven independently of RLS (definer bypasses it).
  -- SECURITY: this org re-assertion MUST stay — removing it leaks cross-org writes.
  if v_org is distinct from auth_org_id() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Coarse role gate (FR-PR-004, OD-SP-1): no per-transition matrix (sales is not procurement).
  -- SECURITY: this coarse role gate MUST stay — removing it lets any authenticated user transition.
  if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Transition-map legality (FR-PR-001/003): (from,to) must be in the data map and not a no-op, else P0001.
  if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then
    raise exception 'illegal transition % -> %', v_from, p_to using errcode = 'P0001';
  end if;

  -- Branch on the target (OD-PR-C/D, FR-PR-005/006/007).
  if p_to = 'Won, Pending KoM'
     and v_from in ('Leads','PQ Submitted','Quotation Submitted','Tender Submitted','Negotiation') then
    -- Win-capture (OD-PR-C): fires only on FIRST reach of Won from a pipeline stage. Require the customer's
    -- inbound contract ref + date (capturing the customer PO IS the win), stamp decided_at = contract_date
    -- (midnight, OD-PR-D). On-hand re-entry (Close Out→Ongoing etc.) is not a pipeline→Won edge, so it does
    -- not re-stamp.
    if p_customer_contract_ref is null or btrim(p_customer_contract_ref) = '' or p_contract_date is null then
      raise exception 'customer contract ref and date are required to win' using errcode = 'P0001';
    end if;
    update public.projects set
      status                = p_to,
      customer_contract_ref = p_customer_contract_ref,
      contract_date         = p_contract_date,
      decided_at            = p_contract_date::timestamptz,  -- OD-SP-3/OD-PR-D: win decided at the contract date
      last_update           = now()
    where id = p_id;
  elsif p_to = 'Loss Tender' then
    -- Loss: no customer PO, so decided_at = transition time (OD-SP-3/OD-PR-D); customer fields left as-is (null).
    update public.projects set
      status      = p_to,
      decided_at  = now(),
      last_update = now()
    where id = p_id;
  else
    -- Any other (pipeline or on-hand) move: status only; decided_at + customer fields untouched (OD-PR-C).
    update public.projects set
      status      = p_to,
      last_update = now()
    where id = p_id;
  end if;
end; $$;
revoke all     on function transition_project(uuid, project_status, text, date) from public;
grant  execute on function transition_project(uuid, project_status, text, date) to   authenticated;
revoke execute on function transition_project(uuid, project_status, text, date) from anon;

-- ============================================================================
-- A6 — Column-level UPDATE lockdown (MED-PR-1): the win-capture / legal-map / decided_at
-- columns are RPC-ONLY. transition_project (security-definer, runs as table owner) is the
-- SOLE authority for these four columns. Without this, a 4-role insider could direct-
-- `update projects set status='Won, Pending KoM', decided_at=...` and bypass the required
-- customer-PO capture, the legal transition map, and forge the decision date. projects_write
-- gates org+role on row-level UPDATE but not per-column.
--
-- NOTE on Postgres semantics: Supabase's bootstrap grants a TABLE-level UPDATE to
-- `authenticated`, which covers ALL columns and is NOT reduced by a column-level REVOKE.
-- So we must (1) revoke the table-wide UPDATE, then (2) re-grant UPDATE only on the columns
-- that stay client-writable. The four omitted columns (status, decided_at,
-- customer_contract_ref, contract_date) thus become writable ONLY by the security-definer RPC.
-- (auditor option b; FR-PR-001/005/006/007, ADR-0011/0012)
-- ============================================================================
revoke update on projects from authenticated;
grant  update (id, org_id, code, name, client_id, project_manager_id, contract_value,
               budget, spent, start_date, end_date, created_at, last_update)
  on projects to authenticated;
