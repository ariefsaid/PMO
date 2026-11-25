# Plan: the stage list becomes an organisation setting (#2906), slice 1 of 4

Spec: `docs/specs/stage-list-setting.spec.md` (read §2 for the full inventory with file:line).
Executor: an Orca worker. Slice 1 touches no money, SoD or auth function, so it is an ordinary
bounded slice. Slices 2 and 3 change `transition_project` and are money/SoD tier: each ships alone,
Director-dispatched, with its own plan after the owner answers Q1-Q3.

## 1. Design

### 1.1 The one decision that makes this small

The stored stage stays the fixed `project_status` enum (spec D1). The organisation setting is an
overlay on the twelve keys: words now (slice 1), then order and on/off (slice 2), then what the win
step needs (slice 3), then a neutral default for new organisations (slice 4). Consequences:

- **Zero change for an organisation that keeps the default.** No stored status, stage-history row,
  saved view, filter link (`?status=Leads`), export key, import column or assistant query changes.
  Every name column starts empty, and empty means the wording shipped today.
- **The four groups stay the reporting contract** (spec D2). A stage's group is computed from its key
  by `pipeline_project_statuses()` / `on_hand_project_statuses()` (database) and
  `projectStatusGroup()` (`src/lib/db/projectTransitions.ts:90`). No slice adds a group column or lets
  an Admin move a stage between groups. Every report (`get_sales_pipeline`, `get_win_rate`,
  `get_loss_breakdown`, `get_executive_dashboard`, management pack, work in hand) keeps filtering by
  group and is not touched.
- **Adding a stage of your own is a different design** (spec D3, Q3): it needs an organisation stage
  id on `projects` and on `project_stage_entries`, and a rewrite of the transition map and the win SoD.
  Not built here.

This decision is cross-cutting and hard to reverse, so it should be recorded as an ADR when slice 1
merges (the Director files it; this plan does not write it).

### 1.2 Where the setting lives: `pipeline_stage_config`, extended

The table already is the organisation's per-stage row: key `(org_id, status)`, Admin-only write
(`0268_role_gate_hardening.sql:314-316`), active-member read, `org_id` stamped, seeded for new
organisations by `seed_org_defaults` (`0591_pipeline_order_go_get.sql:140`). Slice 1 adds:

- one row for each of the seven non-pipeline keys, for every organisation (backfill) and every new one
  (`seed_org_defaults` restated from 0591);
- `win_probability` becomes nullable; a check keeps it required on the five pipeline rows, so no reader
  changes meaning (`get_sales_pipeline` and `get_executive_dashboard` read pipeline rows only and
  coalesce to 0; `set_project_probabilities_for_status` reads pipeline rows only);
- `label_en text`, `label_id text`, each null or 1-40 characters with no outer spaces.

Not in `record_history_config` (settings are not tracked records), so the change-history catalogue gate
does not apply. No new table and no new definer: the isolation manifest
(`scripts/isolation-probe-denominator.d/legacy.json:181`, `columns: "*"`) and the anon-definer inventory
are unchanged. The write is a direct table update under the existing Admin-only policy, the same shape as
the terminology setting (`src/lib/db/orgTerminology.ts:35-43`).

### 1.3 One name resolver for the four label paths

Today four paths name a stage and disagree (spec §2.2). Slice 1 does not merge them (that would change
words for organisations that keep the default). It adds one store that all four consult first:

`src/lib/status/orgStageNames.ts` holds the active organisation's names for the reader's language.
`useApplyOrgStageNames(locale)` (mounted in `I18nProvider`, beside `useApplyOrgRoleNames`) loads the
twelve rows once per session and fills the store; when the store changes it re-renders the tree the same
way the terminology setting does (`i18next.changeLanguage(i18next.language)`,
`src/hooks/useOrgTerminology.ts:28-32`). Then:

| Path | File | Change |
|---|---|---|
| pills, lists, filters, menus | `src/lib/status/statusMap.ts:299` `statusLabel` | `record === 'project'` → store first |
| history, confirm, form, funnel | `src/hooks/useProjectStatusLabel.ts:27` | store first |
| Sales board columns + funnel | `src/hooks/useProjectStatusLabel.ts:47` `useSalesStageLabel` | `stage-<key>` → store first |
| journey steps | `pages/sales/useDealActions.tsx:37` `useStageJourneyStepLabel` | step → key → store first |
| "Advance to …" | `pages/sales/useDealActions.tsx:96-99` | store first |
| card stage-date line | `components/salesPipeline.ts:306` `stageLine` | store first |
| Projects board columns | `components/ProjectKanbanBoard.tsx:192,211` | store first |

The Sales board's "Won" and "Lost" columns and the journey's Won/Lost steps are group words, not stage
names, and stay as shipped (spec §7).

### 1.4 The Admin screen

Administration › Project setup gets a "Sales and project stages" card (`pages/admin/OrgStageNames.tsx`),
placed after the classification options (`pages/Administration.tsx:381`). Twelve rows under four group
headings; each row: shipped name, English name, Bahasa name, Save, Reset. Gated by a new policy entity
`orgStageNames: { manage: allow(ADMIN) }` (UX only; the Admin-only row policy is the authority). Follow
`docs/ux/screen-rules.md` and the issue-types card (`pages/admin/OrgIssueTypes.tsx`) for layout and
tokens; no new primitives.

### 1.5 Later slices (designed here, planned separately)

- **Slice 2, order and switch off** (FR-STG-101..106). Add `position smallint not null` and
  `enabled boolean not null default true`. `transition_project` (restate from
  `0534_feature_enforcement.sql:2590` with the 0591 map) replaces the five pipeline rows of its map with
  "any enabled pipeline stage ↔ any enabled pipeline stage" and refuses a move into a disabled stage;
  the win branch and every SoD clause stay verbatim. A switch-off is refused while a non-archived project
  sits at that stage (a definer writer `set_stage_enabled`, `assert_not_light`, Admin, own org, pgTAP +
  anon inventory + isolation manifest). App: `LEGAL_PROJECT_TRANSITIONS`, `PIPELINE_STATUSES` order and
  `SALES_COLUMNS` become functions of the stage rows; the parity test
  `supabase/tests/project_transition_map_parity.test.sql` moves with it.
- **Slice 3, win step** (FR-STG-201..203). Add `win_allowed boolean` per pipeline row (default: true for
  Quotation, Tender, Negotiation, matching `project_win_eligibility`, `0394_action_eligibility.sql:41`)
  and an organisation-level `win_requires_contract_ref boolean default true`. `transition_project`'s
  check at `0534:2759-2761` reads it; `project_win_eligibility` reads `win_allowed`; the win panels
  (`useDealActions.tsx:190-201`, `DraggableSalesBoard.tsx:143,210`, `ProjectStatusControl.tsx:132-172`)
  require the reference only when set.
- **Slice 4, neutral default** (FR-STG-301/302). `seed_org_defaults` gives new organisations PQ and
  Tender switched off and the reference optional; existing organisations were migrated in slices 2-3 with
  everything on and the reference required.

## 2. Slice 1 tasks

Work in a worktree off `origin/dev`. Migration number below is `2690`; if the Director reserves another
number, run `scripts/renumber-migration.sh 2690 <reserved>` after Task 2. Every command runs from the
repository root unless it starts with `cd pmo-portal`.

### Task 1: failing pgTAP for the stored setting (AC-STG-001..005), 5 min

Create `supabase/tests/2690_stage_list_labels.test.sql`:

```sql
-- 2690_stage_list_labels.test.sql: #2906 slice 1, the stage list setting (docs/specs/stage-list-setting.spec.md).
-- Mutation checks: (a) drop constraint pipeline_stage_config_label_en_check -> the two label cases go red;
-- (b) add 'Project Manager' to pipeline_stage_config_write -> the PM case goes red;
-- (c) restate seed_org_defaults with only the five pipeline rows -> the new-org count goes red.
begin;
select plan(14);

insert into auth.users (id, email) values
  ('26900000-0000-0000-0000-0000000000a1','stg-admin@example.com'),
  ('26900000-0000-0000-0000-0000000000a2','stg-pm@example.com'),
  ('26900000-0000-0000-0000-0000000000a3','stg-field@example.com'),
  ('26900000-0000-0000-0000-0000000000b1','stg-admin-b@example.com');
insert into organizations (id, name) values
  ('26900000-0000-0000-0000-000000000001','STG Org A'),
  ('26900000-0000-0000-0000-000000000002','STG Org B');
insert into profiles (id, org_id, full_name, email, role) values
  ('26900000-0000-0000-0000-0000000000a1','26900000-0000-0000-0000-000000000001','STG Admin','stg-admin@example.com','Admin'),
  ('26900000-0000-0000-0000-0000000000a2','26900000-0000-0000-0000-000000000001','STG PM','stg-pm@example.com','Project Manager'),
  ('26900000-0000-0000-0000-0000000000a3','26900000-0000-0000-0000-000000000001','STG Field','stg-field@example.com','Engineer'),
  ('26900000-0000-0000-0000-0000000000b1','26900000-0000-0000-0000-000000000002','STG Admin B','stg-admin-b@example.com','Admin');
update profiles set built_in_role = 'field_user' where id = '26900000-0000-0000-0000-0000000000a3';

-- AC-STG-001: the migration gave every existing organisation twelve rows, probabilities on the pipeline five only.
select is((select count(*)::int from pipeline_stage_config where org_id = '00000000-0000-0000-0000-000000000001'), 12,
  'AC-STG-001 the seed organisation has one row per stage key');
select is((select json_agg(win_probability order by array_position(public.pipeline_project_statuses(), status::text))::text
             from pipeline_stage_config where org_id = '00000000-0000-0000-0000-000000000001'
              and status::text = any (public.pipeline_project_statuses())),
  '[0.100, 0.200, 0.400, 0.800, 0.900]', 'AC-STG-001 the five pipeline probabilities are unchanged');
select is((select count(*)::int from pipeline_stage_config where org_id = '00000000-0000-0000-0000-000000000001'
             and win_probability is null), 7, 'AC-STG-001 the seven other stages hold no probability');
select is((select count(*)::int from pipeline_stage_config where label_en is not null or label_id is not null), 0,
  'AC-STG-001 no organisation has a stage name: everyone keeps the shipped wording');

-- AC-STG-004: a new organisation gets the same twelve rows (seed_org_defaults).
select public.seed_org_defaults('26900000-0000-0000-0000-000000000001');
select public.seed_org_defaults('26900000-0000-0000-0000-000000000002');
select is((select count(*)::int from pipeline_stage_config where org_id = '26900000-0000-0000-0000-000000000001'), 12,
  'AC-STG-004 a new organisation has one row per stage key');
select is((select win_probability from pipeline_stage_config
            where org_id = '26900000-0000-0000-0000-000000000001' and status = 'Negotiation'), 0.900::numeric,
  'AC-STG-004 the new organisation keeps the 0591 Negotiation default');

-- AC-STG-002: the database refuses a pipeline row without a probability and a malformed name.
select throws_ok($$ update pipeline_stage_config set win_probability = null
                     where org_id = '26900000-0000-0000-0000-000000000001' and status = 'Leads' $$,
  '23514', null, 'AC-STG-002 a pipeline stage keeps its probability');
select throws_ok($$ update pipeline_stage_config set label_en = '   '
                     where org_id = '26900000-0000-0000-0000-000000000001' and status = 'Leads' $$,
  '23514', null, 'AC-STG-002 a blank name is refused (blank is stored as null)');
select throws_ok($$ update pipeline_stage_config set label_id = repeat('x', 41)
                     where org_id = '26900000-0000-0000-0000-000000000001' and status = 'Leads' $$,
  '23514', null, 'AC-STG-002 a name over 40 characters is refused');

-- AC-STG-005 fixture: a deal at Tender Submitted, and its stage history before the rename.
insert into projects (id, org_id, name, status) values
  ('26900000-0000-0000-0000-000000000010','26900000-0000-0000-0000-000000000001','STG Deal','Tender Submitted');
create temp table stg_before as
  select count(*)::int as entries from project_stage_entries where project_id = '26900000-0000-0000-0000-000000000010';
grant select on stg_before to authenticated;

-- AC-STG-003: only an active Admin of the organisation renames.
set local role authenticated;
set local request.jwt.claims = '{"sub":"26900000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update pipeline_stage_config set label_en = 'Bid sent', label_id = 'Penawaran dikirim' where status = 'Tender Submitted';
set local request.jwt.claims = '{"sub":"26900000-0000-0000-0000-0000000000a2","role":"authenticated"}';
update pipeline_stage_config set label_en = 'PM name' where status = 'Leads';
set local request.jwt.claims = '{"sub":"26900000-0000-0000-0000-0000000000a3","role":"authenticated"}';
update pipeline_stage_config set label_en = 'Field name' where status = 'Negotiation';
set local request.jwt.claims = '{"sub":"26900000-0000-0000-0000-0000000000b1","role":"authenticated"}';
update pipeline_stage_config set label_en = 'Other org name'
  where org_id = '26900000-0000-0000-0000-000000000001' and status = 'On Hold';
reset role;

select is((select label_en || ' / ' || label_id from pipeline_stage_config
            where org_id = '26900000-0000-0000-0000-000000000001' and status = 'Tender Submitted'),
  'Bid sent / Penawaran dikirim', 'AC-STG-003 the Admin''s names are stored');
select is((select count(*)::int from pipeline_stage_config
            where org_id = '26900000-0000-0000-0000-000000000001' and status in ('Leads','Negotiation','On Hold')
              and label_en is not null), 0,
  'AC-STG-003 a Project Manager, a field account and another organisation''s Admin change nothing');
select is((select count(*)::int from pipeline_stage_config
            where org_id = '26900000-0000-0000-0000-000000000002' and label_en is not null), 0,
  'AC-STG-003 the other organisation''s own rows are untouched');

-- AC-STG-005: a rename changes no stored data.
select is((select status::text from projects where id = '26900000-0000-0000-0000-000000000010'), 'Tender Submitted',
  'AC-STG-005 the deal''s stored status is unchanged by the rename');
select is((select count(*)::int from project_stage_entries where project_id = '26900000-0000-0000-0000-000000000010'),
  (select entries from stg_before), 'AC-STG-005 the deal''s stage history is unchanged by the rename');

select * from finish();
rollback;
```

Run (expect red: the row counts and the `label_en` column do not exist yet):

```bash
scripts/with-db-lock.sh bash -c 'supabase test db supabase/tests/2690_stage_list_labels.test.sql'
```

If `profiles` refuses the field profile insert (a not-null column added after 0268's fixture), copy the
missing columns from the nearest light-account fixture in
`supabase/tests/2711_light_account_boundary_sweep.test.sql`; do not drop the case.

### Task 2: the migration, 5 min

Create `supabase/migrations/2690_stage_list_labels.sql`:

```sql
-- 2690_stage_list_labels.sql: #2906 slice 1. The sales and project stage list becomes an organisation
-- setting: one pipeline_stage_config row per stage key, with an optional name per language.
-- The stored stage key (project_status) never changes; a blank name means the shipped wording.
-- Reversal: supabase/migrations/rollback/2690_stage_list_labels_down.sql.

alter table public.pipeline_stage_config
  alter column win_probability drop not null,
  add column label_en text,
  add column label_id text,
  add constraint pipeline_stage_config_label_en_check
    check (label_en is null or (char_length(label_en) between 1 and 40 and label_en = btrim(label_en))),
  add constraint pipeline_stage_config_label_id_check
    check (label_id is null or (char_length(label_id) between 1 and 40 and label_id = btrim(label_id))),
  -- Readers use the probability on the pipeline stages only; those five must keep one.
  add constraint pipeline_stage_config_pipeline_probability_check
    check (win_probability is not null
           or status not in ('Leads','Quotation Submitted','PQ Submitted','Tender Submitted','Negotiation'));

comment on column public.pipeline_stage_config.label_en is
  '#2906: the organisation''s English name for this stage; null = the shipped wording.';
comment on column public.pipeline_stage_config.label_id is
  '#2906: the organisation''s Bahasa Indonesia name for this stage; null = the shipped wording.';

-- Every existing organisation gets a row for the seven stages outside the pipeline (no probability).
insert into public.pipeline_stage_config (org_id, status, win_probability)
select o.id, s.status, null
from public.organizations o
cross join unnest(enum_range(null::public.project_status)) as s(status)
where not (s.status::text = any (public.pipeline_project_statuses()))
on conflict (org_id, status) do nothing;

-- Restated from 0591_pipeline_order_go_get.sql:140 (latest); adds the seven non-pipeline rows and the
-- house search_path. create or replace keeps 0213's ACL (revoked from public, anon, authenticated).
create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'Quotation Submitted', 0.200),
    (p_org_id, 'PQ Submitted',        0.400),
    (p_org_id, 'Tender Submitted',    0.800),
    (p_org_id, 'Negotiation',         0.900),
    (p_org_id, 'Won, Pending KoM',    null),
    (p_org_id, 'Ongoing Project',     null),
    (p_org_id, 'On Hold',             null),
    (p_org_id, 'Close Out',           null),
    (p_org_id, 'Loss Tender',         null),
    (p_org_id, 'Declined',            null),
    (p_org_id, 'Internal Project',    null)
  on conflict (org_id, status) do nothing;
$$;
revoke all on function public.seed_org_defaults(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
```

Create `supabase/migrations/rollback/2690_stage_list_labels_down.sql`:

```sql
-- Reverses 2690_stage_list_labels.sql: back to 0591's five-row stage table and seed function.
delete from public.pipeline_stage_config where win_probability is null;
alter table public.pipeline_stage_config
  drop constraint pipeline_stage_config_pipeline_probability_check,
  drop constraint pipeline_stage_config_label_en_check,
  drop constraint pipeline_stage_config_label_id_check,
  drop column label_en,
  drop column label_id,
  alter column win_probability set not null;
create or replace function public.seed_org_defaults(p_org_id uuid) returns void
language sql security definer set search_path = public as $$
  insert into public.pipeline_stage_config (org_id, status, win_probability) values
    (p_org_id, 'Leads',               0.100),
    (p_org_id, 'Quotation Submitted', 0.200),
    (p_org_id, 'PQ Submitted',        0.400),
    (p_org_id, 'Tender Submitted',    0.800),
    (p_org_id, 'Negotiation',         0.900)
  on conflict (org_id, status) do nothing;
$$;
revoke all on function public.seed_org_defaults(uuid) from public, anon, authenticated;
notify pgrst, 'reload schema';
```

### Task 3: keep the two existing five-row contracts honest, 2 min

Two tests count the stage rows; their contract is "five pipeline probabilities", which still holds.
Change the count to what they mean (the twelve-row contract is owned by Task 1's file):

- `supabase/tests/0032_pipeline_stage_config_rls.test.sql:84`: `(select count(*)::int from pipeline_stage_config`
  → `(select count(*)::int from pipeline_stage_config where win_probability is not null and`
  and turn the following `where org_id = …` into the continuation of that clause
  (`org_id = '00000000-0000-0000-0000-000000000001'`). Description stays
  `'AC-1010: default-org seed has 5 OD-SP-2 rows'`.
- `supabase/tests/operator_create_org.test.sql:109`: add `and c.win_probability is not null` before `), 5,`.

Then reset, regenerate types and run every file that names the table or the restated function, in ONE
lock hold (expect green):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts && supabase test db supabase/tests/2690_stage_list_labels.test.sql supabase/tests/0032_pipeline_stage_config_rls.test.sql supabase/tests/operator_create_org.test.sql supabase/tests/0268_role_gate_hardening.test.sql supabase/tests/0591_pipeline_order_go_get.test.sql supabase/tests/0044_sales_pipeline_stages.test.sql supabase/tests/0035_dashboard_pipeline_weighted.test.sql supabase/tests/0036_dashboard_pipeline_projected.test.sql supabase/tests/0208_sales_pipeline_tax_treatment.test.sql supabase/tests/0261_pipeline_hides_archived.test.sql supabase/tests/0656_dashboard_finance_set_based.test.sql supabase/tests/0001_rls_enabled.test.sql supabase/tests/0203_rls_active_member_composition.test.sql supabase/tests/0825_rls_policy_shape_guard.test.sql supabase/tests/2711_light_account_boundary_sweep.test.sql supabase/tests/record_changes_catalog_gate.test.sql'
```

Then the three mutation checks named in Task 1's header (apply each by hand in a scratch migration-free
`psql` session inside one lock hold, see the cases go red, restore), and
`node scripts/check-isolation-denominator.mjs` (expect no change).

### Task 4: failing tests for the name store (AC-STG-007), 3 min

Create `pmo-portal/src/lib/status/orgStageNames.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { orgStageName, setOrgStageNames } from './orgStageNames';

const rows = [
  { status: 'Tender Submitted', label_en: 'Bid sent', label_id: null },
  { status: 'Leads', label_en: null, label_id: 'Calon' },
];

describe('organisation stage names', () => {
  afterEach(() => setOrgStageNames([], 'en'));

  it('AC-STG-007: gives the English name to an English reader and nothing for an unnamed stage', () => {
    expect(setOrgStageNames(rows, 'en')).toBe(true);
    expect(orgStageName('Tender Submitted')).toBe('Bid sent');
    expect(orgStageName('Leads')).toBeUndefined();
  });

  it('AC-STG-007: never leaks the English name to a Bahasa reader', () => {
    setOrgStageNames(rows, 'id');
    expect(orgStageName('Tender Submitted')).toBeUndefined();
    expect(orgStageName('Leads')).toBe('Calon');
  });

  it('reports no change when the same names are set again', () => {
    setOrgStageNames(rows, 'en');
    expect(setOrgStageNames(rows, 'en')).toBe(false);
  });
});
```

Run (expect red, module missing): `cd pmo-portal && npx vitest run src/lib/status/orgStageNames.test.ts`

### Task 5: the name store, 2 min

Create `pmo-portal/src/lib/status/orgStageNames.ts`:

```ts
/**
 * #2906: the organisation's own stage names for the reader's language. Filled once per session by
 * `useApplyOrgStageNames`; every stage label path asks here first and falls back to the shipped
 * wording. The stored stage key never changes.
 */
export interface StageNameRow { status: string; label_en: string | null; label_id: string | null }

let active: Record<string, string> = {};

/** Returns true when the names changed, so the caller knows to re-render. */
export function setOrgStageNames(rows: readonly StageNameRow[], locale: string): boolean {
  const lang = locale.startsWith('id') ? 'id' : 'en';
  const next: Record<string, string> = {};
  for (const r of rows) {
    const name = lang === 'id' ? r.label_id : r.label_en;
    if (name) next[r.status] = name;
  }
  if (JSON.stringify(next) === JSON.stringify(active)) return false;
  active = next;
  return true;
}

export const orgStageName = (status: string): string | undefined => active[status];
```

Run (expect green): `cd pmo-portal && npx vitest run src/lib/status/orgStageNames.test.ts`

### Task 6: failing tests for the label paths (AC-STG-007, AC-STG-008), 5 min

Append to `pmo-portal/src/lib/status/statusMap.test.ts` (add the imports at the top of the file):

```ts
import { setOrgStageNames } from './orgStageNames';

describe('organisation stage names (#2906)', () => {
  const t = (_k: string, d: string) => d;
  afterEach(() => setOrgStageNames([], 'en'));

  it('AC-STG-007: a named stage reads its organisation name; every other stage and record is unchanged', () => {
    setOrgStageNames([{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: null }], 'en');
    expect(statusLabel('project', 'Tender Submitted', t)).toBe('Bid sent');
    expect(statusLabel('project', 'Negotiation', t)).toBe('Negotiation');
    expect(shippedStatusLabel('project', 'Tender Submitted', t)).toBe('Tender submitted');
  });

  it('AC-STG-007: with no names the shipped wording is exactly as before', () => {
    expect(statusLabel('project', 'Tender Submitted', t)).toBe('Tender submitted');
  });
});
```

(`afterEach` from `vitest`, `shippedStatusLabel` and `statusLabel` from `./statusMap`.)

Create `pmo-portal/src/hooks/useProjectStatusLabel.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProjectStatusLabel, useSalesStageLabel } from './useProjectStatusLabel';
import { setOrgStageNames } from '@/src/lib/status/orgStageNames';

describe('stage label hooks (#2906)', () => {
  afterEach(() => setOrgStageNames([], 'en'));

  it('AC-STG-007: the status label and the Sales board column read the organisation name', () => {
    setOrgStageNames([{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: null }], 'en');
    const status = renderHook(() => useProjectStatusLabel()).result.current;
    const column = renderHook(() => useSalesStageLabel()).result.current;
    expect(status('Tender Submitted')).toBe('Bid sent');
    expect(column({ title: 'Tender', testId: 'stage-Tender Submitted' })).toBe('Bid sent');
    expect(column({ title: 'Won', testId: 'stage-Won' })).toBe('Won');
  });

  it('AC-STG-007: unnamed stages keep the shipped words', () => {
    const column = renderHook(() => useSalesStageLabel()).result.current;
    expect(column({ title: 'Pre-Qual', testId: 'stage-PQ Submitted' })).toBe('PQ submitted');
  });
});
```

Append to `pmo-portal/components/salesPipeline.test.ts`:

```ts
import { setOrgStageNames } from '@/src/lib/status/orgStageNames';
import { stageLine } from './salesPipeline';

describe('stage-date line with an organisation name (#2906)', () => {
  afterEach(() => setOrgStageNames([], 'en'));
  it('AC-STG-008: the card names the renamed stage, not the shipped date word', () => {
    setOrgStageNames([{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: null }], 'en');
    expect(stageLine('Tender Submitted', '2026-11-01', '2026-11-21', (_k, d) => d)).toBe('Bid sent 1 Nov · 20 d');
  });
});
```

(If the existing file's `stageLine` assertions show a different date format, match that format; the
oracle is the leading "Bid sent".)

Create `pmo-portal/pages/sales/useDealActions.stageNames.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStageJourneyStepLabel } from './useDealActions';
import { setOrgStageNames } from '@/src/lib/status/orgStageNames';

describe('deal journey with organisation names (#2906)', () => {
  afterEach(() => setOrgStageNames([], 'en'));
  it('AC-STG-008: the journey step for a renamed stage reads its organisation name', () => {
    setOrgStageNames([{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: null }], 'en');
    const label = renderHook(() => useStageJourneyStepLabel()).result.current;
    expect(label('Tender')).toBe('Bid sent');
    expect(label('Pre-Qualification')).toBe('Pre-Qualification');
    expect(label('Won')).toBe('Won');
  });
});
```

Run (expect red): `cd pmo-portal && npx vitest run src/lib/status/statusMap.test.ts src/hooks/useProjectStatusLabel.test.ts components/salesPipeline.test.ts pages/sales/useDealActions.stageNames.test.ts`

### Task 7: route the label paths through the store, 5 min

`pmo-portal/src/lib/status/statusMap.ts`, replace `statusLabel` (`:298-301`):

```ts
/** The shipped display name of a state, ignoring any organisation name (#2906: the Admin screen shows it). */
export function shippedStatusLabel(record: StatusRecord, state: string, t: StatusTranslate): string {
  return entryFor(record, state)?.label(t) ?? state;
}

/** The one display name of a state. An unknown state reads as its stored text, untranslated. */
export function statusLabel(record: StatusRecord, state: string, t: StatusTranslate): string {
  return (record === 'project' ? orgStageName(state) : undefined) ?? shippedStatusLabel(record, state, t);
}
```

with `import { orgStageName } from './orgStageNames';` at the top.

`pmo-portal/src/hooks/useProjectStatusLabel.ts`: import `orgStageName` from
`@/src/lib/status/orgStageNames`; line 27 becomes
`return (status) => orgStageName(status) ?? labels[status] ?? status;`; line 47 becomes

```ts
  return (col) => (col.testId.startsWith('stage-') ? orgStageName(col.testId.slice(6)) : undefined) ?? labels[col.testId] ?? col.title;
```

`pmo-portal/pages/sales/useDealActions.tsx`: import `orgStageName`; above `useStageJourneyStepLabel` add

```ts
/** The stage key behind each journey step; Won and Lost are group words, not stages (#2906). */
const JOURNEY_STAGE_KEY: Partial<Record<DealJourneyStage, string>> = {
  Leads: 'Leads',
  Quotation: 'Quotation Submitted',
  'Pre-Qualification': 'PQ Submitted',
  Tender: 'Tender Submitted',
  Negotiation: 'Negotiation',
};
```

and make the returned function start with
`const named = JOURNEY_STAGE_KEY[step] ? orgStageName(JOURNEY_STAGE_KEY[step]!) : undefined; if (named) return named;`.
Replace `nextStageLabel` (`:96-99`) with

```ts
  const nextStageLabel = nextStage && orgStageName(nextStage)
    ? orgStageName(nextStage)!
    : nextStageKey
      ? t(`projectDetail.pipeline.nextStage.${nextStageKey}`, NEXT_STAGE_LABEL[status])
      : (nextStage ? (NEXT_STAGE_LABEL[status] ?? stageLabel(nextStage)) : null);
```

`pmo-portal/components/salesPipeline.ts` `stageLine` (`:306-308`): import `orgStageName` from
`@/src/lib/status/orgStageNames` and set `const label = orgStageName(status) ?? (key ? t(key, fallback) : fallback);`.

`pmo-portal/components/ProjectKanbanBoard.tsx` (`:192` and `:211`): import `orgStageName`; at both lines use
`orgStageName(col.statuses[0]) ?? titles[col.key]` in place of `titles[col.key]`.

Run (expect green), then the direct importers of the changed files:

```bash
cd pmo-portal && npx vitest run src/lib/status/statusMap.test.ts src/hooks/useProjectStatusLabel.test.ts components/salesPipeline.test.ts pages/sales/useDealActions.stageNames.test.ts && npx vitest related --run src/lib/status/statusMap.ts src/hooks/useProjectStatusLabel.ts pages/sales/useDealActions.tsx components/salesPipeline.ts components/ProjectKanbanBoard.tsx
```

### Task 8: failing tests for the DAL (AC-STG-006), 3 min

Create `pmo-portal/src/lib/db/stageNames.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import { saveStageName, validateStageName } from './stageNames';

describe('stage name validation (AC-STG-006)', () => {
  it('AC-STG-006: blank is allowed (back to shipped), over 40 characters and a taken name are refused', () => {
    expect(validateStageName('  ', ['Leads'])).toBeNull();
    expect(validateStageName('x'.repeat(41), [])).toBe('tooLong');
    expect(validateStageName(' leads ', ['Leads', 'Negotiation'])).toBe('duplicate');
    expect(validateStageName('Bid sent', ['Leads'])).toBeNull();
  });
});

describe('saveStageName', () => {
  beforeEach(() => mockFrom.mockReset());
  const chain = (result: { data: unknown; error: unknown }) => {
    const update = vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn().mockResolvedValue(result) })) }));
    mockFrom.mockReturnValue({ update });
    return update;
  };

  it('stores trimmed names and turns a blank into the shipped wording', async () => {
    const update = chain({ data: [{ status: 'Leads' }], error: null });
    await saveStageName('Leads', { en: ' Prospect ', id: '' });
    expect(mockFrom).toHaveBeenCalledWith('pipeline_stage_config');
    expect(update).toHaveBeenCalledWith({ label_en: 'Prospect', label_id: null });
  });

  it('throws when the row policy let nothing change', async () => {
    chain({ data: [], error: null });
    await expect(saveStageName('Leads', { en: 'Prospect', id: '' })).rejects.toThrow();
  });
});
```

Run (expect red): `cd pmo-portal && npx vitest run src/lib/db/stageNames.test.ts`

### Task 9: the DAL, 3 min

Create `pmo-portal/src/lib/db/stageNames.ts`:

```ts
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { StageNameRow } from '@/src/lib/status/orgStageNames';

/**
 * #2906: the organisation's stage names, on pipeline_stage_config (one row per stage key). `org_id` is never
 * sent: RLS scopes the read to the caller's organisation and lets only an active Admin write.
 */
const STAGE_COUNT = 12;

export async function listStageNames(): Promise<StageNameRow[]> {
  const { data, error } = await supabase
    .from('pipeline_stage_config')
    .select('status, label_en, label_id')
    .limit(STAGE_COUNT); // bounded: one row per stage key
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []) as StageNameRow[];
}

/** `others` = the names the OTHER stages show in the same language. ponytail: compares against saved names
 *  and English shipped words only; a clash with a shipped Bahasa word is not caught (cosmetic, fixable by renaming). */
export function validateStageName(name: string, others: readonly string[]): 'tooLong' | 'duplicate' | null {
  const n = name.trim();
  if (!n) return null;
  if (n.length > 40) return 'tooLong';
  if (others.some((o) => o.trim().toLowerCase() === n.toLowerCase())) return 'duplicate';
  return null;
}

export async function saveStageName(status: string, names: { en: string; id: string }): Promise<void> {
  const { data, error } = await supabase
    .from('pipeline_stage_config')
    .update({ label_en: names.en.trim() || null, label_id: names.id.trim() || null })
    .eq('status', status as never)
    .select('status');
  if (error) throw new AppError(error.message, error.code);
  if (!data?.length) throw new AppError('not authorized', '42501');
}
```

Run (expect green): `cd pmo-portal && npx vitest run src/lib/db/stageNames.test.ts && npm run check:unpaged-reads && npm run check:typed-dals`

### Task 10: load the names once per session, 3 min

Create `pmo-portal/src/hooks/useOrgStageNames.ts`:

```ts
import { useEffect } from 'react';
import { i18next } from '@/src/lib/i18n';
import { listStageNames } from '@/src/lib/db/stageNames';
import { setOrgStageNames } from '@/src/lib/status/orgStageNames';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

export const ORG_STAGE_NAMES_KEY = ['org-stage-names'] as const;

export function useOrgStageNames() {
  return useOrgQuery([...ORG_STAGE_NAMES_KEY], listStageNames, { staleness: 'session' });
}

/** Mount once in I18nProvider, beside useApplyOrgRoleNames. Re-renders the tree when the names change,
 *  the same way the terminology setting does (#2529). */
export function useApplyOrgStageNames(locale: string): void {
  const { data } = useOrgStageNames();
  useEffect(() => {
    if (setOrgStageNames(data ?? [], locale) && i18next.isInitialized) void i18next.changeLanguage(i18next.language);
  }, [data, locale]);
}
```

`pmo-portal/src/lib/i18n/I18nProvider.tsx`: import `useApplyOrgStageNames` from
`@/src/hooks/useOrgStageNames` and, after `useApplyOrgRoleNames();` (`:31`), add
`useApplyOrgStageNames(resolved.locale);` with the comment `// #2906: the org's own stage names.`

Test: add to `pmo-portal/src/lib/i18n/I18nProvider.test.tsx` a case titled
`'AC-STG-007: the organisation stage names load and a project status pill reads the Bahasa name for a Bahasa reader'`
that mocks `@/src/lib/db/stageNames` `listStageNames` to resolve
`[{ status: 'Tender Submitted', label_en: 'Bid sent', label_id: 'Penawaran dikirim' }]`, renders a
`<StatusPill record="project" state="Tender Submitted" />` under the provider with an Indonesian profile
(follow that file's existing locale setup), and awaits `findByText('Penawaran dikirim')`. Write it red
first (before the provider line), then add the line.

Run: `cd pmo-portal && npx vitest run src/lib/i18n/I18nProvider.test.tsx src/lib/i18n/I18nProvider.languageRace.test.tsx`

### Task 11: the policy entity, 2 min

`pmo-portal/src/auth/policy.ts`: add `| 'orgStageNames'` to the entity union after `'orgProjectClassification'`
(`:155`) and `orgStageNames: { manage: allow(ADMIN) },` after `orgProjectClassification` (`:1192`).
In `pmo-portal/src/auth/policy.test.ts` after `:687` add
`expect(allowedRoles('manage', 'orgStageNames')).toEqual(['Admin']);` (write it first; red).

Run: `cd pmo-portal && npx vitest run src/auth/policy.test.ts`

### Task 12: failing test for the Admin card (AC-STG-009), 5 min

Create `pmo-portal/pages/admin/OrgStageNames.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const permissions = vi.hoisted(() => ({ manage: true }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => permissions.manage }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1' } }) }));
const save = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/db/stageNames', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/db/stageNames')>()),
  listStageNames: vi.fn().mockResolvedValue([
    'Leads', 'Quotation Submitted', 'PQ Submitted', 'Tender Submitted', 'Negotiation', 'Won, Pending KoM',
    'Ongoing Project', 'On Hold', 'Close Out', 'Loss Tender', 'Declined', 'Internal Project',
  ].map((status) => ({ status, label_en: status === 'Negotiation' ? 'Closing' : null, label_id: null }))),
  saveStageName: (...a: unknown[]) => save(...a),
}));

import OrgStageNames from './OrgStageNames';

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><OrgStageNames /></ToastProvider>
  </QueryClientProvider>,
);

describe('Administration › stage names (#2906)', () => {
  beforeEach(() => { permissions.manage = true; save.mockClear(); });

  it('AC-STG-009: an Admin sees the twelve stages under the four groups', async () => {
    wrap();
    for (const group of ['Pipeline', 'On hand', 'Lost', 'Internal']) {
      expect(await screen.findByRole('heading', { name: group })).toBeInTheDocument();
    }
    expect(screen.getAllByTestId(/^stage-name-row-/)).toHaveLength(12);
  });

  it('AC-STG-009: someone who may not manage stages sees no card', () => {
    permissions.manage = false;
    const { container } = wrap();
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-STG-006: saving sends both languages; a name another stage shows is refused on screen', async () => {
    wrap();
    const row = await screen.findByTestId('stage-name-row-Tender Submitted');
    await userEvent.type(within(row).getByLabelText('English'), 'Bid sent');
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith('Tender Submitted', { en: 'Bid sent', id: '' });

    const leads = screen.getByTestId('stage-name-row-Leads');
    await userEvent.type(within(leads).getByLabelText('English'), 'closing');
    await userEvent.click(within(leads).getByRole('button', { name: 'Save' }));
    expect(await within(leads).findByText('Another stage already has this name')).toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
```

Run (expect red): `cd pmo-portal && npx vitest run pages/admin/OrgStageNames.test.tsx`

### Task 13: the Admin card, 5 min

Create `pmo-portal/pages/admin/OrgStageNames.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { saveStageName, validateStageName } from '@/src/lib/db/stageNames';
import { ORG_STAGE_NAMES_KEY, useOrgStageNames } from '@/src/hooks/useOrgStageNames';
import { projectStatusGroup, type ProjectStatusGroup } from '@/src/lib/db/projectTransitions';
import { shippedStatusLabel } from '@/src/lib/status/statusMap';
import type { StageNameRow } from '@/src/lib/status/orgStageNames';

/**
 * Administration › Project setup › Sales and project stages (#2906 slice 1). An Admin names each stage in
 * English and Bahasa; a blank name keeps the shipped wording. Names only change what people read: stored
 * stages, filters, saved views and reports keep their keys. UX gate only: the Admin-only row policy decides.
 */
const GROUPS: ProjectStatusGroup[] = ['pipeline', 'onHand', 'lost', 'internal'];
const english = (_k: string, d: string) => d;

const StageRow: React.FC<{ row: StageNameRow; others: (lang: 'en' | 'id') => string[] }> = ({ row, others }) => {
  const { t } = useTranslation('administration');
  const { t: tStatus } = useTranslation('status');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [en, setEn] = useState(row.label_en ?? '');
  const [id, setId] = useState(row.label_id ?? '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEn(row.label_en ?? ''); setId(row.label_id ?? ''); }, [row.label_en, row.label_id]);

  const save = async (next: { en: string; id: string }) => {
    const bad = validateStageName(next.en, others('en')) ?? validateStageName(next.id, others('id'));
    if (bad) { setError(bad === 'tooLong' ? t('admin.stageNames.tooLong', 'Use 40 characters or fewer') : t('admin.stageNames.duplicate', 'Another stage already has this name')); return; }
    setError(undefined); setSaving(true);
    try {
      await saveStageName(row.status, next);
      await qc.invalidateQueries({ queryKey: [...ORG_STAGE_NAMES_KEY] });
      toast(t('admin.stageNames.saved', 'Stage names saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    } finally { setSaving(false); }
  };
  const shipped = shippedStatusLabel('project', row.status, tStatus);

  return (
    <li data-testid={`stage-name-row-${row.status}`} className="grid gap-2 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
      <span className="text-control text-foreground">{shipped}</span>
      <TextField label={t('admin.stageNames.english', 'English')} value={en} onChange={setEn} />
      <TextField label={t('admin.stageNames.bahasa', 'Bahasa Indonesia')} value={id} onChange={setId} />
      <span className="flex gap-2">
        <Button variant="primary" size="sm" disabled={saving} onClick={() => void save({ en, id })}>{t('admin.stageNames.save', 'Save')}</Button>
        <Button variant="outline" size="sm" disabled={saving || (!row.label_en && !row.label_id)} onClick={() => void save({ en: '', id: '' })}>{t('admin.stageNames.reset', 'Reset')}</Button>
      </span>
      {error && <FieldError id={`stage-name-error-${row.status}`}>{error}</FieldError>}
    </li>
  );
};

const StageNamesCard: React.FC = () => {
  const { t } = useTranslation('administration');
  const query = useOrgStageNames();
  const groupTitle: Record<ProjectStatusGroup, string> = {
    pipeline: t('admin.stageNames.group.pipeline', 'Pipeline'),
    onHand: t('admin.stageNames.group.onHand', 'On hand'),
    lost: t('admin.stageNames.group.lost', 'Lost'),
    internal: t('admin.stageNames.group.internal', 'Internal'),
  };
  const rows = query.data ?? [];
  const others = (status: string) => (lang: 'en' | 'id') => rows.filter((r) => r.status !== status).map((r) =>
    (lang === 'en' ? r.label_en : r.label_id) ?? (lang === 'en' ? shippedStatusLabel('project', r.status, english) : '')).filter(Boolean);

  return (
    <section id="stage-names" tabIndex={-1} className="scroll-mt-4" aria-labelledby="stage-names-heading">
      <h2 id="stage-names-heading" className="text-group font-semibold tracking-[-0.01em]">{t('admin.stageNames.title', 'Sales and project stages')}</h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">{t('admin.stageNames.helper', 'Rename a stage to match your own process. A blank name keeps the shipped name. Records, filters and reports keep working.')}</p>
      {query.isError && !query.data ? (
        <ListState variant="error" title={t('admin.stageNames.loadError', "Couldn't load the stages")} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <ListState variant="loading" rows={3} />
      ) : GROUPS.map((g) => (
        <div key={g} className="mt-4">
          <h3 className="text-control font-semibold text-foreground">{groupTitle[g]}</h3>
          <ul className="divide-y divide-border">
            {rows.filter((r) => projectStatusGroup(r.status as never) === g).map((r) => <StageRow key={r.status} row={r} others={others(r.status)} />)}
          </ul>
        </div>
      ))}
    </section>
  );
};

const OrgStageNames: React.FC = () => (usePermission()('manage', 'orgStageNames') ? <StageNamesCard /> : null);
export default OrgStageNames;
```

Rows within a group follow the stage order: sort `rows` by
`Object.keys(STATUS_MAP.project)` index before rendering if the DAL order differs (the test above lists
them in that order; keep the assertion, sort in the card if a real read returns another order).

`pmo-portal/pages/Administration.tsx`: `import OrgStageNames from './admin/OrgStageNames';` and render
`<OrgStageNames />` right after `<OrgProjectClassificationOptions />` (`:381`).

Run (expect green): `cd pmo-portal && npx vitest run pages/admin/OrgStageNames.test.tsx pages/AdministrationShell.test.tsx`

### Task 14: translations, 3 min

Add under `admin` in `pmo-portal/public/locales/en/administration.json` and
`pmo-portal/public/locales/id/administration.json` (match the files' nesting):

| key `admin.stageNames.` | en | id |
|---|---|---|
| `title` | Sales and project stages | Tahapan penjualan dan proyek |
| `helper` | Rename a stage to match your own process. A blank name keeps the shipped name. Records, filters and reports keep working. | Ganti nama tahapan agar sesuai dengan proses Anda. Nama kosong memakai nama bawaan. Catatan, filter, dan laporan tetap berjalan. |
| `group.pipeline` | Pipeline | Pipeline |
| `group.onHand` | On hand | Sedang berjalan |
| `group.lost` | Lost | Kalah |
| `group.internal` | Internal | Internal |
| `english` | English | Bahasa Inggris |
| `bahasa` | Bahasa Indonesia | Bahasa Indonesia |
| `save` | Save | Simpan |
| `reset` | Reset | Kembalikan |
| `saved` | Stage names saved | Nama tahapan disimpan |
| `tooLong` | Use 40 characters or fewer | Gunakan paling banyak 40 karakter |
| `duplicate` | Another stage already has this name | Tahapan lain sudah memakai nama ini |
| `loadError` | Couldn't load the stages | Tahapan tidak dapat dimuat |

Run: `cd pmo-portal && npm run check:i18n && npm run check:plain-words && npm run check:org-terms && npm run check:locale-terms`

### Task 15: the role-job journey (AC-STG-010), 5 min

Create `pmo-portal/e2e/serial/AC-STG-010-stage-rename.spec.ts`:

```ts
// @e2e-isolation: serial — renames an organisation-wide sales stage and restores it afterward.
import { test, expect } from '@playwright/test';
import { login, pickComboboxOption, stubErpProjectSync } from '../helpers';
import { ORG_ID, need, serviceClient } from '../support/jobJourney';

test('AC-STG-010: an Admin renames a stage and the sales lead works the board under the new name', async ({ browser }) => {
  test.setTimeout(120_000);
  const db = serviceClient('AC-STG-010');
  const ok = need('AC-STG-010');
  const before = ok('read the stage', await db.from('pipeline_stage_config').select('label_en, label_id')
    .eq('org_id', ORG_ID).eq('status', 'Quotation Submitted').single());
  const deal = `Stage rename deal ${Date.now()}`;
  try {
    const admin = await browser.newPage();
    await login(admin, 'admin@acme.test');
    await admin.goto('/administration/projects');
    const row = admin.getByTestId('stage-name-row-Quotation Submitted');
    await row.getByLabel('English').fill('Proposal sent');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(admin.getByText('Stage names saved').first()).toBeVisible();
    await admin.close();

    const pm = await browser.newPage();
    await stubErpProjectSync(pm);
    await login(pm, 'pm@acme.test');
    await pm.goto('/projects');
    await pm.getByRole('button', { name: /new project/i }).first().click();
    await pm.getByLabel(/project name/i).fill(deal);
    await pickComboboxOption(pm, pm, /client company/i, /^Meridian Steelworks/);
    await pm.getByRole('button', { name: /^Create project$/i }).click();
    await expect(pm).toHaveURL(/\/projects\/[0-9a-f-]{36}$/u);

    await pm.getByRole('button', { name: 'Advance to Proposal sent' }).click();
    await expect(pm.getByText('Moved to Proposal sent').first()).toBeVisible();

    await pm.goto('/sales');
    await expect(pm.getByTestId('stage-Quotation Submitted')).toContainText('Proposal sent');
    await expect(pm.getByTestId('stage-Quotation Submitted')).toContainText(deal);
  } finally {
    ok('restore the stage', await db.from('pipeline_stage_config').update(before)
      .eq('org_id', ORG_ID).eq('status', 'Quotation Submitted').select('status'));
    const removed = await db.from('projects').delete().eq('org_id', ORG_ID).eq('name', deal);
    if (removed.error) throw removed.error;
  }
});
```

Journey steps may change only for a deliberate UX step the builder finds on screen (for example a confirm
dialog after "Advance to"): add the step, keep the three goal assertions ("Moved to Proposal sent", the
column title, the deal in that column). If `stage-Quotation Submitted` is not the column's test id, use the
column the board renders for `SALES_COLUMNS`' `testId` (`components/salesPipeline.ts:74`).

Run:

```bash
E2E_WORKERS=2 scripts/e2e-local.sh --project=serial --reporter=line e2e/serial/AC-STG-010-stage-rename.spec.ts
node scripts/affected-e2e.mjs
```

and run what `affected-e2e` lists (at most 8) with the same wrapper.

### Task 16: local final gate, 3 min

```bash
cd pmo-portal && npm run check:guards && npm run typecheck && npx eslint --max-warnings=0 src/lib/status/orgStageNames.ts src/lib/status/statusMap.ts src/hooks/useProjectStatusLabel.ts src/hooks/useOrgStageNames.ts src/lib/db/stageNames.ts src/lib/i18n/I18nProvider.tsx src/auth/policy.ts pages/admin/OrgStageNames.tsx pages/Administration.tsx pages/sales/useDealActions.tsx components/salesPipeline.ts components/ProjectKanbanBoard.tsx e2e/serial/AC-STG-010-stage-rename.spec.ts && scripts/ux-proof.sh /administration/projects /sales
```

## 3. Traceability

| AC | Owning test | Layer |
|---|---|---|
| AC-STG-001 | `supabase/tests/2690_stage_list_labels.test.sql` (4 cases) | pgTAP |
| AC-STG-002 | `supabase/tests/2690_stage_list_labels.test.sql` (3 cases) | pgTAP |
| AC-STG-003 | `supabase/tests/2690_stage_list_labels.test.sql` (3 cases; PM, field account, other organisation) | pgTAP |
| AC-STG-004 | `supabase/tests/2690_stage_list_labels.test.sql` (2 cases) | pgTAP |
| AC-STG-005 | `supabase/tests/2690_stage_list_labels.test.sql` (2 cases) | pgTAP |
| AC-STG-006 | `pmo-portal/src/lib/db/stageNames.test.ts` (also exercised on screen in `OrgStageNames.test.tsx`) | unit |
| AC-STG-007 | `pmo-portal/src/lib/status/orgStageNames.test.ts` (language rule); paths in `statusMap.test.ts`, `useProjectStatusLabel.test.ts`, `I18nProvider.test.tsx` | unit |
| AC-STG-008 | `pmo-portal/components/salesPipeline.test.ts`, `pmo-portal/pages/sales/useDealActions.stageNames.test.ts` | unit |
| AC-STG-009 | `pmo-portal/pages/admin/OrgStageNames.test.tsx` | unit (RTL) |
| AC-STG-010 | `pmo-portal/e2e/serial/AC-STG-010-stage-rename.spec.ts` (Admin renames, Project Manager works the deal) | e2e |

## 4. Risks and what is deliberately not done

- **Four label paths stay four.** Merging them would change words for organisations that keep the default
  (the board says "Pre-Qual", the pill "PQ submitted"). The store sits in front of all four, so a rename is
  consistent; the shipped drift is a separate clean-up for the engineering health map (#1533).
- **Server-written text keeps shipped words** (assistant, CLI, notifications). Spec §7.
- **Rename is visible after the next session load for other people** (session staleness, like role names and
  terminology). The Admin sees it at once (the card invalidates the query).
- **New term for the glossary:** *stage name*, the organisation's word for a stored stage key; a blank stage
  name means the shipped wording. Rule: a stage's group follows its key and is never a setting.
