# Plan: Projects — status-transitions + revenue fields (build-wave #4)

- **Spec:** `docs/specs/projects-revenue-transitions.spec.md` (FR-PR-001..013, AC-1000..1011).
- **Decisions:** `docs/decisions.md` OD-SP-1/2/3, OD-MARGIN-2 (binding); assumed owner-flags
  OD-PR-A/B/C/D (flagged in the spec, non-blocking; pin before merge).
- **Foundation for #5.** This issue ships ONLY the fields + config table + transition RPC + the
  membership/legality/config-read helpers that the Sales-pipeline/Dashboard issue (#5) consumes. It
  computes no margin, no weighted value, no win-rate (all #5).
- **No new ADR.** `transition_project` is a **direct application of ADR-0012** (the procurement
  transition-RPC pattern: `security definer` + internal authz re-assertion + map-as-data legality +
  pinned `search_path = public` + revoke-anon + schema-qualified table refs), itself ADR-0011 generalized.
  No genuinely new architectural decision (a single-table state machine over `projects`, a status→number
  lookup table seeded per org, three nullable columns — none is architecturally novel). The new
  `pipeline_stage_config` table is the cheap config seam OD-SP-2 explicitly sanctioned (distinct from the
  deferred workflow-config engine OD-PROC-6), not an architectural decision. Recorded here per the
  playbook: **follows ADR-0012 pattern**.
- **Layer ownership:** ADR-0010. Each AC has exactly one owning test at the lowest sufficient layer.

Strict TDD: every behavior task writes a failing test (RED) first, then the minimum implementation (GREEN).
The eng-planner writes ONLY this plan + the spec; the implementer writes the code/tests. Run `npm`/`vitest`/
`playwright` from `pmo-portal/`; run `supabase test db` and `supabase db reset` from the repo root.

---

## 1. Design

### 1.1 Architecture & data flow

```
pages/Projects.tsx          ← live-DAL list (EXISTING) + NEW per-row "Change status" control
  ├─ useProjects()                        ← project list (read, EXISTING — reused as-is)
  ├─ usePipelineStageConfig() (new)       ← org's stage win-probabilities (read; #5 also consumes)
  └─ useProjectTransition() (new)         ← transition mutation (invalidates ['projects', orgId])
        │                                   (TanStack useMutation)
        ▼
src/lib/db/projectTransitions.ts  (NEW DAL module — typed; mirrors timesheetTransition.ts RPC-cast pattern)
  writes: transitionProject(id, to, opts?)                              (RPC)
  reads:  listPipelineStageConfig()                                     (table select)
  pure:   isLegalProjectTransition(from, to) · projectStatusGroup(status)
        │
        ▼
Supabase Postgres
  projects + RLS already exist (0001/0002/0004) — REUSED; no projects policy change this issue.
  NEW migration 0008_project_revenue.sql:
    • schema delta: projects (+customer_contract_ref text, +contract_date date, +decided_at timestamptz — all nullable)
    • NEW table pipeline_stage_config(org_id, status, win_probability) + enable/force RLS + select + write policies + seed
    • transition_project(p_id, p_to, p_customer_contract_ref, p_contract_date)  security definer  (map + role gate + win/loss stamp)
```

**Org seam:** the DAL NEVER sends `org_id`. `transition_project` is `security definer` (bypasses RLS) and
therefore re-asserts `auth_org_id()` + the coarse role gate **internally** (ADR-0011/0012). The config read
sends no `org_id` — `pipeline_stage_config_select` (`org_id = auth_org_id()`) scopes it. New rows in
`pipeline_stage_config` get `org_id` from the column default (client-unspoofable).

`pages/ProjectDetails.tsx` is the un-migrated mock-backed prototype — **NOT touched** this issue (separate
decomposition backlog item). The transition UI lands on the live `pages/Projects.tsx`.

### 1.2 Transition state machine (the map, as data — FR-PR-001/003, OD-SP-1, OD-PR-B)

Legal `(from → {to})` permissive superset, as a `jsonb` literal inside `transition_project` AND as a TS
literal in the DAL (`LEGAL_PROJECT_TRANSITIONS`, single TS source, mirrors the SQL). Status literals use
the EXACT enum spelling (note `'Won, Pending KoM'` has a comma):

```
Leads               → {PQ Submitted, Loss Tender, Internal Project}
PQ Submitted        → {Quotation Submitted, Leads, Loss Tender}
Quotation Submitted → {Tender Submitted, PQ Submitted, Won, Pending KoM, Loss Tender}
Tender Submitted    → {Negotiation, Quotation Submitted, Won, Pending KoM, Loss Tender}
Negotiation         → {Won, Pending KoM, Tender Submitted, Loss Tender}
Won, Pending KoM    → {Ongoing Project, On Hold, Close Out}
Ongoing Project     → {On Hold, Close Out}
On Hold             → {Ongoing Project, Close Out}
Close Out           → {Ongoing Project}
Loss Tender         → {Negotiation}
Internal Project    → {}                 (terminal; reachable only FROM Leads)
```

The function: load row `for update` → assert org (`42501`) → assert role gate (`42501`) → assert `(from,to)`
legal AND `from <> to` (`P0001`) → branch on target:
- `to = 'Won, Pending KoM'` AND `from` is a pipeline stage ⇒ require non-blank `p_customer_contract_ref` +
  non-null `p_contract_date` (`P0001` if missing); single `update` setting status + the three fields +
  `decided_at = p_contract_date::timestamptz`.
- `to = 'Loss Tender'` ⇒ single `update` setting status + `decided_at = now()`.
- otherwise ⇒ single `update` setting status only (decided_at + customer fields untouched, OD-PR-C).

### 1.3 Authorization + tenancy (re-asserted inside the RPC — FR-PR-004, OD-SP-1 coarse gate)

```
caller's role must be in {Admin, Executive, Project Manager, Finance}   -- coarse gate (42501 else)
project's org_id must equal auth_org_id()                               -- tenant isolation (42501 else)
```

No SoD / per-transition matrix this issue (sales is not procurement; OD-SP-1 keeps it coarse). The win edge
adds an INPUT requirement (ref+date), not a role distinction.

### 1.4 `pipeline_stage_config` table (FR-PR-008/009, OD-SP-2)

```sql
create table pipeline_stage_config (
  org_id          uuid not null references organizations(id) default '00000000-0000-0000-0000-000000000001',
  status          project_status not null,
  win_probability numeric(4,3) not null,
  primary key (org_id, status)
);
```
`enable` + `force row level security`. `pipeline_stage_config_select` = `using (org_id = auth_org_id())`.
`pipeline_stage_config_write` (FOR ALL) = `using`/`with check` = `org_id = auth_org_id() and auth_role() in
('Admin','Executive','Project Manager','Finance')` (OD-PR-A). Seeded per default org with the five OD-SP-2
rows. No editing UI this issue (FR-PR-013 read only). PK `(org_id, status)` gives the indexed org read
(NFR-PR-PERF-001) and prevents duplicate stage rows.

### 1.5 UI (NFR-PR-UI-001)

`pages/Projects.tsx` (live): each project row/card gains a **Change status** control (a small inline
menu/select) cosmetically gated by `useEffectiveRole` to {Admin, Executive, PM, Finance} (the RPC is the
real authority). It offers exactly `LEGAL_PROJECT_TRANSITIONS[project.status]`. Selecting a target invokes
`useProjectTransition().mutate`; when the target is `'Won, Pending KoM'` it first prompts (inline form) for
**customer contract reference** + **contract date**, then submits `{ customerContractRef, contractDate }`.
On success the list refetches (the mutation invalidates `['projects', orgId]`) so the new status + customer
ref render; on error the message is surfaced inline (not swallowed). The existing loading/empty/error+retry
branches of `pages/Projects.tsx` are preserved. The customer ref (once set) is shown on the project row.

### 1.6 Type contract used across tasks

```ts
// src/lib/db/projectTransitions.ts
import type { ProjectRow } from './projects';                  // = Tables<'projects'>
export type ProjectStatus = ProjectRow['status'];              // project_status enum
export type ProjectStatusGroup = 'pipeline' | 'onHand' | 'lost' | 'internal';
export interface PipelineStageConfig { status: ProjectStatus; win_probability: number; }
export interface TransitionProjectOpts { customerContractRef?: string; contractDate?: string; } // contractDate = ISO 'YYYY-MM-DD'

export const LEGAL_PROJECT_TRANSITIONS: Record<string, string[]>; // single TS source, mirrors SQL §1.2
export function isLegalProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean;
export function projectStatusGroup(status: ProjectStatus): ProjectStatusGroup;
export function transitionProject(id: string, to: ProjectStatus, opts?: TransitionProjectOpts): Promise<void>;
export function listPipelineStageConfig(): Promise<PipelineStageConfig[]>;

// src/hooks/useProjectTransitions.ts
export function usePipelineStageConfig(): UseQueryResult<PipelineStageConfig[]>;
export function useProjectTransition(): UseMutationResult<
  void, Error, { id: string; to: ProjectStatus; opts?: TransitionProjectOpts }>;
```

`transitionProject` calls `supabase.rpc('transition_project', { p_id, p_to, p_customer_contract_ref,
p_contract_date })` with the `// @ts-expect-error` + `as unknown as { data; error }` cast (mirror
`timesheetTransition.ts` / `procurementLifecycle.ts`); `p_customer_contract_ref` / `p_contract_date` default
to `null` when `opts` omits them.

---

## 2. Phased task list (TDD; 2–5 min each)

### Phase A — Migration `0008_project_revenue.sql` (schema + config table + RPC)

> The pgTAP tests that prove A live in Phase D (written RED there, before the implementer fills the SQL).
> Phase A tasks build the migration; verify each with `supabase db reset` (applies migration + seed).

- **A1** — Header + revenue columns. Create `supabase/migrations/0008_project_revenue.sql` with a header
  comment ("follows ADR-0012 pattern; forward-only additive; reversibility = `supabase db reset`, ADR-0006;
  calls auth_org_id()/auth_role() from 0002_rls.sql") and
  `alter table projects add column customer_contract_ref text, add column contract_date date, add column
  decided_at timestamptz;` (all nullable; inline comment: customer_contract_ref = the CLIENT's inbound
  contract/PO number, manually entered, NOT auto-generated — OD-SP-3). Add a supporting index for #5's
  decided-deal time filter: `create index projects_org_decided_idx on projects (org_id, decided_at);`.
  *(FR-PR-005/006, NFR-PR-PERF-001)*
  Verify: `supabase db reset` exits 0.

- **A2** — `pipeline_stage_config` table + RLS. Append the §1.4 `create table pipeline_stage_config (…)`,
  then `alter table pipeline_stage_config enable row level security;` +
  `alter table pipeline_stage_config force row level security;`, then
  `create policy pipeline_stage_config_select on pipeline_stage_config for select using (org_id =
  auth_org_id());` and
  `create policy pipeline_stage_config_write on pipeline_stage_config for all using (org_id = auth_org_id()
  and auth_role() in ('Admin','Executive','Project Manager','Finance')) with check (org_id = auth_org_id()
  and auth_role() in ('Admin','Executive','Project Manager','Finance'));` with an inline comment citing
  FR-PR-008 + OD-PR-A (coarse write gate; fine-grained Admin-only deferred to OD-PROC-6 config bridge).
  *(FR-PR-008)*
  Verify: `supabase db reset` exits 0.

- **A3** — Seed the OD-SP-2 defaults into the migration (org-default, so every org gets them at provision;
  the default org also seeded here). Append
  `insert into pipeline_stage_config (org_id, status, win_probability) values
  ('00000000-0000-0000-0000-000000000001','Leads',0.100),
  ('00000000-0000-0000-0000-000000000001','PQ Submitted',0.250),
  ('00000000-0000-0000-0000-000000000001','Quotation Submitted',0.400),
  ('00000000-0000-0000-0000-000000000001','Tender Submitted',0.500),
  ('00000000-0000-0000-0000-000000000001','Negotiation',0.750) on conflict (org_id, status) do nothing;`
  (inline comment: OD-SP-2 monotonic ramp; only the five pipeline stages get a row). *(FR-PR-009)*
  Verify: `supabase db reset` exits 0; `select count(*) from pipeline_stage_config` = 5.

- **A4** — `transition_project` signature + map + org/role guards. Append
  `create or replace function transition_project(p_id uuid, p_to project_status, p_customer_contract_ref
  text default null, p_contract_date date default null) returns void language plpgsql security definer set
  search_path = public as $$ … $$;`. Body part 1: declare
  `v_from project_status; v_org uuid; v_role user_role := auth_role();` and the legal map (the §1.2 literal
  as `v_legal jsonb := jsonb_build_object('Leads', jsonb_build_array('PQ Submitted','Loss Tender','Internal
  Project'), 'PQ Submitted', jsonb_build_array('Quotation Submitted','Leads','Loss Tender'),
  'Quotation Submitted', jsonb_build_array('Tender Submitted','PQ Submitted','Won, Pending KoM','Loss
  Tender'), 'Tender Submitted', jsonb_build_array('Negotiation','Quotation Submitted','Won, Pending
  KoM','Loss Tender'), 'Negotiation', jsonb_build_array('Won, Pending KoM','Tender Submitted','Loss
  Tender'), 'Won, Pending KoM', jsonb_build_array('Ongoing Project','On Hold','Close Out'), 'Ongoing
  Project', jsonb_build_array('On Hold','Close Out'), 'On Hold', jsonb_build_array('Ongoing Project','Close
  Out'), 'Close Out', jsonb_build_array('Ongoing Project'), 'Loss Tender', jsonb_build_array('Negotiation'),
  'Internal Project', jsonb_build_array());`). Load+lock:
  `select status, org_id into v_from, v_org from public.projects where id = p_id for update;` then
  `if v_from is null then raise exception 'project not found' using errcode = 'P0002'; end if;`. Org guard:
  `if v_org is distinct from auth_org_id() then raise exception 'not authorized' using errcode = '42501';
  end if;` with the inline `-- SECURITY: this org re-assertion MUST stay (definer bypasses RLS)` comment
  (ADR-0011/0012 lesson). Role gate:
  `if v_role is null or v_role not in ('Admin','Executive','Project Manager','Finance') then raise exception
  'not authorized' using errcode = '42501'; end if;` with the inline `-- SECURITY: coarse role gate MUST
  stay` comment. Legality:
  `if p_to = v_from or not (v_legal -> v_from::text) ? p_to::text then raise exception 'illegal transition %
  -> %', v_from, p_to using errcode = 'P0001'; end if;`. *(FR-PR-001/003/004, NFR-PR-PERF-001 setup)*
  Verify: `supabase db reset` exits 0.

- **A5** — `transition_project` win/loss/other branches + atomic update + ACL trio. In the same function
  body, after the legality check, add the branch:
  `if p_to = 'Won, Pending KoM' and v_from in ('Leads','PQ Submitted','Quotation Submitted','Tender
  Submitted','Negotiation') then`
    `if p_customer_contract_ref is null or btrim(p_customer_contract_ref) = '' or p_contract_date is null
    then raise exception 'customer contract ref and date are required to win' using errcode = 'P0001'; end
    if;`
    `update public.projects set status = p_to, customer_contract_ref = p_customer_contract_ref,
    contract_date = p_contract_date, decided_at = p_contract_date::timestamptz, last_update = now() where id
    = p_id;`  -- atomic, NFR-PR-ATOM-001; decided_at = contract_date (OD-SP-3/OD-PR-D)
  `elsif p_to = 'Loss Tender' then`
    `update public.projects set status = p_to, decided_at = now(), last_update = now() where id = p_id;`
    -- loss = transition time (OD-SP-3); customer fields left null
  `else`
    `update public.projects set status = p_to, last_update = now() where id = p_id;`  -- decided_at + customer fields untouched (OD-PR-C)
  `end if;`. Then the ACL trio:
  `revoke all on function transition_project(uuid, project_status, text, date) from public;`
  `grant execute on function transition_project(uuid, project_status, text, date) to authenticated;`
  `revoke execute on function transition_project(uuid, project_status, text, date) from anon;`.
  *(FR-PR-002/005/006/007/010, NFR-PR-ATOM-001)*
  Verify: `supabase db reset` exits 0.

### Phase B — DAL `src/lib/db/projectTransitions.ts` (unit, TDD)

> Mock-builder pattern + `vi.hoisted` exactly as `timesheetTransition.test.ts` (mock `supabase.rpc` and
> `supabase.from`/`select`). Run: `npm test -- projectTransitions` from `pmo-portal/`.

- **B1** *(RED)* — In `src/lib/db/projectTransitions.test.ts` write the transition-map unit test:
  `it('AC-1000: project transition map accepts legal pairs, rejects illegal jumps, terminals and no-ops
  (FR-PR-001/003)', …)` asserting `isLegalProjectTransition('Leads','PQ Submitted')===true`,
  `('Negotiation','Won, Pending KoM')===true`, `('Tender Submitted','Loss Tender')===true`,
  `('Won, Pending KoM','Ongoing Project')===true`, `('On Hold','Ongoing Project')===true`,
  `('Close Out','Ongoing Project')===true`, `('Loss Tender','Negotiation')===true`,
  `('Leads','Internal Project')===true`; and `('Leads','Won, Pending KoM')===false`,
  `('Internal Project','Leads')===false`, `('Ongoing Project','Leads')===false`,
  `('Leads','Leads')===false`. *(AC-1000)*
  Verify: `npm test -- projectTransitions` FAILS (module/function absent).

- **B2** *(GREEN)* — In `projectTransitions.ts` implement `LEGAL_PROJECT_TRANSITIONS` (the §1.2 literal,
  EXACT enum spellings incl. `'Won, Pending KoM'`) and `isLegalProjectTransition(from, to)` reading it
  (return false when `from === to` or `from` absent from map or `to` not in the allowed list). *(AC-1000,
  FR-PR-001/003/012)*
  Verify: `npm test -- projectTransitions` PASSES B1.

- **B3** *(RED→GREEN)* — Status-group helper: `it('AC-1001: projectStatusGroup maps the five pipeline
  statuses to pipeline, the won/active set to onHand, Loss Tender to lost, Internal Project to internal
  (FR-PR-012)', …)` asserting each of the 11 statuses maps to its OD-SP-1 group. Implement
  `projectStatusGroup(status)` with the four constant arrays (`PIPELINE_STATUSES`, `ON_HAND_STATUSES`,
  `LOST_STATUSES`, `INTERNAL_STATUSES`) and a lookup. Export the arrays (the #5 seam). *(AC-1001,
  FR-PR-012)*
  Verify: `npm test -- projectTransitions` PASSES.

- **B4** *(RED→GREEN)* — DAL RPC error surfacing + params/no-org-id. Mock `supabase.rpc` to resolve
  `{data:null, error:{message:'illegal transition', code:'P0001'}}`; `it('AC-1002: transitionProject
  surfaces the RPC 42501/P0001 error and sends {p_id,p_to,p_customer_contract_ref,p_contract_date} with no
  org_id (FR-PR-002/011)', …)` asserting `await expect(transitionProject('p1','Won, Pending KoM')).rejects
  .toThrow('illegal transition')`; and (success mock) a win call
  `transitionProject('p1','Won, Pending KoM',{customerContractRef:'CPO-9', contractDate:'2026-03-01'})`
  ⇒ `expect(mockRpc).toHaveBeenCalledWith('transition_project',{p_id:'p1', p_to:'Won, Pending KoM',
  p_customer_contract_ref:'CPO-9', p_contract_date:'2026-03-01'})`; and a non-win call
  `transitionProject('p1','PQ Submitted')` ⇒ params `p_customer_contract_ref:null, p_contract_date:null`;
  and `expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id')`. Implement `transitionProject(id,
  to, opts?)` — the `supabase.rpc(...)` + `// @ts-expect-error` cast + throw pattern of `submitTimesheet`,
  mapping `opts?.customerContractRef ?? null` / `opts?.contractDate ?? null`. *(AC-1002, FR-PR-002/011)*
  Verify: `npm test -- projectTransitions` PASSES.

- **B5** *(RED→GREEN)* — `listPipelineStageConfig` shape + no-org-id. Mock `supabase.from('pipeline_stage_
  config').select('status, win_probability')` resolving
  `[{status:'Leads', win_probability:'0.100'}]`; `it('AC-1003: listPipelineStageConfig selects (status,
  win_probability) from pipeline_stage_config, normalises win_probability to Number, sends no org_id
  (FR-PR-013)', …)` asserting `mockFrom('pipeline_stage_config')`, `mockSelect('status, win_probability')`,
  the returned `win_probability === 0.1` (a number, not the string), and
  `JSON.stringify(...).not.toContain('org_id')`. Implement `listPipelineStageConfig()` mirroring the read
  pattern of `listProjects` (throw on error; `.map(r => ({ ...r, win_probability: Number(r.win_probability)
  }))`). *(AC-1003, FR-PR-013)*
  Verify: `npm test -- projectTransitions` PASSES.

### Phase C — Hooks `src/hooks/useProjectTransitions.ts` + UI (unit, TDD)

- **C1** *(RED→GREEN)* — In `src/hooks/useProjectTransitions.test.ts`: `it('AC-1003 (hook):
  usePipelineStageConfig keys cache by [pipeline-stage-config, orgId] and calls listPipelineStageConfig',
  …)` using `QueryClientProvider` + mocked DAL + mocked `useAuth` (mirror `useProjects` /
  `useTimesheetApproval.test.ts`). Implement `usePipelineStageConfig()` (useQuery, key
  `['pipeline-stage-config', orgId]`, `queryFn: listPipelineStageConfig`, `enabled: Boolean(orgId)`).
  *(supports AC-1003)*
  Verify: `npm test -- useProjectTransitions` PASSES.

- **C2** *(RED→GREEN)* — `it('AC-1011 (hook): useProjectTransition.mutate calls transitionProject(id,to,opts)
  and invalidates [projects, orgId] on success', …)` using a mocked DAL + `invalidateQueries` spy.
  Implement `useProjectTransition()` (`useMutation<void, Error, {id; to; opts?}>`, `mutationFn: ({id,to,
  opts}) => transitionProject(id, to, opts)`, `onSuccess` invalidates `['projects', orgId]`), mirroring
  `useTimesheetMutations`. *(supports AC-1011)*
  Verify: `npm test -- useProjectTransitions` PASSES.

- **C3** *(RED→GREEN)* — Status control component states + legal options + win prompt. In
  `components/ProjectStatusControl.test.tsx`: `it('AC-1004: ProjectStatusControl offers exactly the legal
  next statuses for the current status, requires a customer contract ref + date when target is Won, Pending
  KoM, surfaces a mutation error inline, and is hidden for a non-write role (FR-PR-005/011, NFR-PR-UI-001)',
  …)` — mock `useEffectiveRole` (Project Manager) + `useProjectTransition`; for a `Negotiation` project
  assert the offered options are exactly `['Won, Pending KoM','Tender Submitted','Loss Tender']`; selecting
  `Won, Pending KoM` reveals required `customer contract reference` + `contract date` inputs and submit is
  blocked until both are filled; a rejected mutation renders the error text (not swallowed); with
  `useEffectiveRole` = `Engineer` the control renders nothing. Create
  `components/ProjectStatusControl.tsx` (props `{ project: { id; status; customer_contract_ref } }`) reading
  `LEGAL_PROJECT_TRANSITIONS[project.status]`, gated by `useEffectiveRole` ∈ {Admin,Executive,PM,Finance},
  wired to `useProjectTransition().mutate`, with the conditional win-input form and inline error display.
  *(AC-1004, FR-PR-005/011, NFR-PR-UI-001)*
  Verify: `npm test -- ProjectStatusControl` PASSES.

- **C4** *(RED→GREEN)* — Mount the control + customer-ref display on `pages/Projects.tsx`. In
  `pages/Projects.test.tsx` add `it('AC-1011 (UI): each project row renders a ProjectStatusControl and shows
  the customer contract reference when set (FR-PR-011)', …)` — render `pages/Projects.tsx` with a mocked
  `useProjects` returning one pipeline project + one won project (with `customer_contract_ref` set); assert a
  `ProjectStatusControl` (by a stable `data-testid="project-status-control"`) is present per row and the
  won project's `customer_contract_ref` text renders. Wire `pages/Projects.tsx` to render
  `<ProjectStatusControl project={project} />` in each Grid card + List row (without disturbing the existing
  loading/empty/error branches) and show `project.customer_contract_ref` on the footer/row when non-null.
  Extend `ProjectWithRefs` / the select in `src/lib/db/projects.ts` to include the three new columns
  (`customer_contract_ref`, `contract_date`, `decided_at`) so the type carries them (`*` select already
  returns them; add the fields to the `ProjectRow` type via regenerated `database.types` — see C5).
  *(AC-1011 UI, FR-PR-011, NFR-PR-UI-001)*
  Verify: `npm test -- Projects` PASSES.

- **C5** *(GREEN)* — Type sync. Regenerate `src/lib/supabase/database.types.ts` (or hand-add the three new
  `projects` columns + the `pipeline_stage_config` table row type) so `Tables<'projects'>` includes
  `customer_contract_ref: string | null`, `contract_date: string | null`, `decided_at: string | null` and
  `Tables<'pipeline_stage_config'>` exists with `{ org_id; status; win_probability }`. Confirm
  `transition_project` is in the generated `Functions` type (or rely on the `// @ts-expect-error` cast in
  the DAL — matches `timesheetTransition.ts`). *(supports AC-1002/1003, type consistency)*
  Verify: `npm run typecheck` exits 0 AND `npm test` (full unit suite) PASSES.

### Phase D — pgTAP (the DB is the real gate; written RED first, then Phase A fills the SQL)

> Each file: `begin; select plan(N); …fixtures as table owner (orgs, auth.users, profiles, projects)…;
> set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
> …asserts…; reset role; select * from finish(); rollback;` (mirror `0013`/`0021`/`0023`). Run all:
> `supabase test db` from repo root. Numbering continues from the existing max (0026) → 0027..0032.

- **D1** — `supabase/tests/0027_project_transition_authz.test.sql` (plan 3): two orgs; org-A has a PM (a2)
  and an Engineer (a4) and a project; org-B has a project. (i) org-A PM calls `transition_project(<org-B
  project>, 'Loss Tender')` → `throws_ok(…, '42501', null, 'AC-1005: cross-org project transition raises
  42501 (tenant isolation inside RPC)')`; (ii) org-A Engineer calls a legal transition on org-A's project →
  `throws_ok(…, '42501', null, 'AC-1005: Engineer-role blocked by coarse role gate')`; (iii) org-A PM calls
  a legal transition on org-A's project → `lives_ok(…, 'AC-1005: in-org Project Manager may transition')`.
  *(AC-1005, FR-PR-004/010)*
  Verify: `supabase test db` reports this file pass.

- **D2** — `0028_project_transition_legality.test.sql` (plan 3): one org, an authorized PM. (i) a `Leads`
  project, `transition_project(…, 'Won, Pending KoM', 'X', '2026-01-01')` → `throws_ok(…, 'P0001', null,
  'AC-1006: illegal Leads→Won jump rejected (P0001)')`; (ii) a `Negotiation` project,
  `transition_project(…, 'Won, Pending KoM', null, null)` → `throws_ok(…, 'P0001', null, 'AC-1006: win
  requires customer contract ref and date (P0001)')`; (iii) a `Negotiation` project,
  `transition_project(…, 'Negotiation')` (no-op) → `throws_ok(…, 'P0001', null, 'AC-1006: no-op transition
  rejected (P0001)')`. *(AC-1006, FR-PR-001/003/005)*
  Verify: file passes.

- **D3** — `0029_project_win_path.test.sql` (plan 4): one org, an authorized PM, a `Negotiation` project. PM
  calls `transition_project(…, 'Won, Pending KoM', 'CPO-2026-77', '2026-03-15')` →
  `lives_ok(…, 'AC-1007: authorized win transition succeeds')` +
  `is((select status from projects where id=…), 'Won, Pending KoM', 'AC-1007: status is Won, Pending KoM')`
  + `is((select customer_contract_ref from projects where id=…), 'CPO-2026-77', 'AC-1007: customer ref
  captured')` + `is((select contract_date from projects where id=…), '2026-03-15'::date, 'AC-1007: contract
  date captured')` + `is((select decided_at from projects where id=…), '2026-03-15'::timestamptz, 'AC-1007:
  decided_at = contract_date (OD-SP-3)')`. *(AC-1007, FR-PR-005, NFR-PR-ATOM-001)*
  Verify: file passes.

- **D4** — `0030_project_loss_path.test.sql` (plan 3): one org, an authorized PM, a `Tender Submitted`
  project. PM calls `transition_project(…, 'Loss Tender')` → `lives_ok(…, 'AC-1008: loss transition
  succeeds')` + `is((select decided_at is not null from projects where id=…), true, 'AC-1008: decided_at
  stamped at loss-transition time')` + `is((select customer_contract_ref is null and contract_date is null
  from projects where id=…), true, 'AC-1008: no customer fields on loss')`. *(AC-1008, FR-PR-006,
  NFR-PR-ATOM-001)*
  Verify: file passes.

- **D5** — `0031_project_decided_at_preserved.test.sql` (plan 2): one org, an authorized PM. (i) a won
  project (`status = 'Won, Pending KoM'`, `decided_at = '2026-03-15'::timestamptz`, customer fields set);
  PM calls `transition_project(…, 'Ongoing Project')` → `is((select decided_at from projects where id=…),
  '2026-03-15'::timestamptz, 'AC-1009: decided_at unchanged on on-hand move (OD-PR-C)')`; (ii) a `Leads`
  project with null `decided_at`; PM calls `transition_project(…, 'PQ Submitted')` → `is((select decided_at
  is null from projects where id=…), true, 'AC-1009: decided_at stays null on pipeline move')`. *(AC-1009,
  FR-PR-007)*
  Verify: file passes.

- **D6** — `0032_pipeline_stage_config_rls.test.sql` (plan 6): two orgs; org-A has a PM (a2) and an Engineer
  (a4). Org-A's `pipeline_stage_config` seeded for org-A (insert as table owner before role switch). (i)
  org-A PM SELECTs `pipeline_stage_config` → `is((select count(*)::int from pipeline_stage_config), <Norg
  A>, 'AC-1010: in-org read returns org rows')`; (ii) switch to an org-B user, SELECT → `is((select
  count(*)::int from pipeline_stage_config), 0, 'AC-1010: cross-org read isolated')`; (iii) org-A Engineer
  `insert into pipeline_stage_config(status,win_probability) values('On Hold',0.9)` →
  `throws_ok(…, '42501', null, 'AC-1010: Engineer write blocked by coarse gate')` (org_id from default; RLS
  with-check denies); (iv) org-A PM same insert → `lives_ok(…, 'AC-1010: authorized PM write succeeds')`;
  (v) on the default org (no role switch / owner): `is((select count(*)::int from pipeline_stage_config
  where org_id='00000000-0000-0000-0000-000000000001'), 5, 'AC-1010: default-org seed has 5 OD-SP-2 rows')`
  and `is((select win_probability from pipeline_stage_config where org_id='00000000-0000-0000-0000-
  000000000001' and status='Negotiation'), 0.750, 'AC-1010: Negotiation win prob = 0.75')`; (vi)
  `set local role anon;` then `throws_ok($$ select transition_project('00000000-0000-0000-0000-
  000000000001'::uuid,'Loss Tender') $$, '42501', null, 'AC-1010: anon cannot execute transition_project')`
  (anon execute revoked → permission denied). *(AC-1010, FR-PR-008/009/010)*
  Verify: file passes. Note: scope the org-A seed/fixtures so counts are deterministic (use a dedicated
  test org id, not the default '…0001', for the read-isolation arms; assert the default-org seed count
  separately).

### Phase E — Seed enrichment `supabase/seed.sql` (data for #5)

- **E1** — Backfill won-project decision data. Append to `supabase/seed.sql` §projects (post-insert
  `update`s, no `org_id` touched): for `P001` (`40000000-…-001`, Ongoing) set
  `customer_contract_ref='CPO-2026-001', contract_date='2026-01-06', decided_at='2026-01-06T00:00:00Z'`; for
  `P003`/Acme Internal Platform (`40000000-…-004`, Ongoing) set `customer_contract_ref='CPO-2026-003',
  contract_date='2026-02-01', decided_at='2026-02-01T00:00:00Z'`. Inline comment: gives #5's value-weighted
  win-rate numerator + on-hand value real data (AC-1010 is the migration-seed assertion; this is the app
  seed). *(FR-PR-005 data; supports #5)*
  Verify: `supabase db reset` exits 0.

- **E2** — Add a `Loss Tender` seeded project (win-rate denominator). Append a new project row to
  `supabase/seed.sql` §projects: `insert into projects (id, code, name, status, client_id,
  project_manager_id, contract_value, budget, spent, decided_at) values ('40000000-0000-0000-0000-
  000000000005','P004','Coastal Depot Bid','Loss Tender','c0000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-0000000000a2',650000,0,0,'2026-02-20T00:00:00Z');` (PM = Alice; client =
  Northwind; null customer fields per FR-PR-006; fresh `code` 'P004' so `unique(org_id, code)` holds;
  `org_id` omitted = default). Inline comment: gives #5's win-rate denominator a decided loss. *(FR-PR-006
  data; supports #5)*
  Verify: `supabase db reset` exits 0; `select count(*) from projects where status='Loss Tender'` ≥ 1.

### Phase F — E2E (one curated journey)

- **F1** *(RED→GREEN)* — `pmo-portal/e2e/AC-1011-win-project.spec.ts`:
  `test('AC-1011: a PM wins a project — open status control, choose Won, Pending KoM, enter customer
  contract ref + date, submit; status shows Won and the customer ref is displayed', async ({ page }) => {…})`.
  Sign in as the PM (`pm@acme.test` / `Passw0rd!dev` — seed creds), go to `/projects`, locate a late
  pipeline project (the seed's `P002` Tender Submitted, `40000000-…-002`), open its `project-status-control`,
  choose **Won, Pending KoM**, fill the customer contract reference (e.g. `CPO-E2E-1`) + a contract date,
  submit; assert the project row now shows the `Won, Pending KoM` status badge and the `CPO-E2E-1` text is
  visible after the list refetch. Mirror the auth + navigation setup of `e2e/AC-911-timesheet-approval.spec
  .ts` and `e2e/AC-401-projects-smoke.spec.ts`. *(AC-1011, FR-PR-001/004/005/011, NFR-PR-UI-001)*
  Verify: `npx playwright test AC-1011-win-project` PASSES (after a `supabase db reset` so the seed fixtures
  are present).

### Phase G — Gate

- **G1** — Full gate. Run, from `pmo-portal/`: `npm run typecheck` (0 errors), `npm run lint`
  (`--max-warnings=0`), `npm test` (all unit/RTL pass, ≥80% lines on changed files); from repo root:
  `supabase test db` (0027..0032 pass) and `npx playwright test AC-1011-win-project` (passes). Confirm the
  traceability table: every AC-1000..1011 has its owning test green at its layer.
  Verify: all commands exit 0.

---

## 3. Traceability (AC → owning test → task)

| AC | Owning layer | Owning test (file :: title leading token) | Task |
|---|---|---|---|
| AC-1000 | Unit | `projectTransitions.test.ts` :: `AC-1000:` | B1/B2 |
| AC-1001 | Unit | `projectTransitions.test.ts` :: `AC-1001:` | B3 |
| AC-1002 | Unit | `projectTransitions.test.ts` :: `AC-1002:` | B4 |
| AC-1003 | Unit | `projectTransitions.test.ts` :: `AC-1003:` (+ hook ref C1) | B5 (hook C1) |
| AC-1004 | Unit | `ProjectStatusControl.test.tsx` :: `AC-1004:` | C3 |
| AC-1005 | pgTAP | `0027_project_transition_authz.test.sql` :: `AC-1005:` | D1 |
| AC-1006 | pgTAP | `0028_project_transition_legality.test.sql` :: `AC-1006:` | D2 |
| AC-1007 | pgTAP | `0029_project_win_path.test.sql` :: `AC-1007:` | D3 |
| AC-1008 | pgTAP | `0030_project_loss_path.test.sql` :: `AC-1008:` | D4 |
| AC-1009 | pgTAP | `0031_project_decided_at_preserved.test.sql` :: `AC-1009:` | D5 |
| AC-1010 | pgTAP | `0032_pipeline_stage_config_rls.test.sql` :: `AC-1010:` | D6 |
| AC-1011 | E2E | `e2e/AC-1011-win-project.spec.ts` :: `AC-1011:` | F1 (UI C2/C4) |

**Task count:** 24 (A1–A5, B1–B5, C1–C5, D1–D6, E1–E2, F1, G1). Phases: A migration (5), B DAL unit (5),
C hooks+UI unit (5), D pgTAP (6), E seed (2), F e2e (1), G gate (1).

**No new ADR** (follows ADR-0012 pattern; the `pipeline_stage_config` seam is the OD-SP-2-sanctioned cheap
config table, not an architectural decision).
