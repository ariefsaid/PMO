# #956 — PPN cancel + re-issue proof and cancelled-project VAT unlock

Date: 2026-10-08. **Design/plan only; no implementation, DB/bench run, git write or release performed.**
Spec: `docs/specs/ppn-invoice-change.spec.md` (owner sign-off required).
Spike: `docs/spikes/2026-10-08-ppn-amend.md`; readback helper alongside it.

## Execution and scope gate

Executor chosen **before build**: Director-dispatched money-path/SoD loop, not the default ADW
(`docs/factory-workflow.md` § Executor routing). Build in its own dev-based feature worktree;
all three reviewers (spec, quality, security), mutation checks, rendered Discover and acceptance
remain binding. No push/merge/deploy without the appropriate approval; production needs a separate
explicit per-instance authorization. This planning brief does not authorize any of those operations.

**Director ruling: OD-TAX-4c.** Finance cancels the issued invoice in PMO, waits for confirmed
cancellation, then raises a **new** invoice through the normal create and independent approval path.
DD-PBL-13 computes fresh tax rows on create; the old Cancelled mirror keeps taxed history. Distinct
PMO UUIDs/ERP names, no repointing or amended-from link. The adapter can amend and returns a Draft
requiring a second approver, but page/repository/hook expose none and #956 builds none. Claims/down
payments retain DD-PBL-7's cancel + new claim. Coretax replacement is manual/out of scope; #893
records the new invoice's e-Faktur number.

There is **one execution path**: S rehearses the existing in-app
cancel/create/submit path; D implements the full unlock rule, tests and concurrency; U changes only
the existing project contract/VAT editor and its supporting seam; V proves the outcomes. Record
actual versions, row shapes, numeric and rendered comparisons in the spike's Evidence section.
If the rehearsal fails, use the repair map below and rerun the same oracle; no amend implementation
or tax-copy experiment is substituted. No reliable REST/rendered readback means BLOCKED.

## Eight design decisions

1. DD-TAX-4b replaces only DD-TAX-4a's permanent cancellation lock; tax setup fail-closed is retained.
2. Existing setter/trigger remain the write authority; one scoped reader drives explanatory UI.
3. “All cancelled” covers every invoice family in `sales_invoices`, never only ordinary ERP invoices.
4. Every nonterminal SI command blocks, associated by project payload OR invoice/claim identity.
5. Project row serialization and a server-built VAT witness bind body resolution to activation/revival.
6. Flag changes never rewrite cancelled invoice facts; 0260 already captures the required history.
7. ERP taxes/totals decide success; PMO mirror/AR and net work-order billing must independently converge.
8. Correction uses DD-PBL-13's fresh create rows, separate identities and normal SoD; no new amend path.

## Exact file map

Existing files to change (future build, **not this planning run**):

- `pmo-portal/src/lib/db/projects.ts` — typed editability reader DAL.
- `pmo-portal/src/lib/repositories/index.ts`, `types.ts` — project editability reader only; existing
  revenue cancel/create/submit methods are retained.
- `pmo-portal/src/hooks/useProjects.ts`, `useRevenue.ts` — reader invalidation on existing writes;
  no new correction mutation.
- `pmo-portal/pages/project-detail/ProjectDetailHeader.tsx` — reader-based VAT state/copy/refusal.
- `pmo-portal/public/locales/en/common.json`, `id/common.json` — all new messages in both languages.
- `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` — server VAT witness for unlock races;
  no extension of the ordinary create tax resolver to amendment/update tax rows.
- `pmo-portal/src/lib/adapterSeam/erpnext/salesInvoiceTaxRows.test.ts` — next-create tax pin on the
  real factory; existing create/replay tests remain. See repair map for evidence-triggered fixes.
- `supabase/functions/adapter-dispatch/index.ts` — fresh request strips the internal witness before
  resolving it; never strip persisted internal fields on trusted sweep replay.
- `supabase/functions/adapter-dispatch/moneyOutboxDeps.test.ts` — persisted witness/digest evidence.
- `supabase/tests/0253_project_vat_flag.test.sql`, `0255_project_vat_flag_lock_case.test.sql` — deliberate
  DD-TAX-4b expected-behavior update; retain all permission/live-invoice/uppercase-id coverage.
- `scripts/isolation-probe-denominator.json` — register the new non-trigger definer reader signature;
  `supabase/tests/0178_anon_executable_definers.test.sql` — keep its existing ACL sweep and declared
  retained-writer inventory unchanged (the new reader is read-only); new reader grants are proven in
  `0282_vat_flag_unlock_acl_history.test.sql` and the isolation denominator.

New build files:

- `supabase/migrations/0282_vat_flag_unlock.sql` — provisional sequence, renumber **at merge** with
  `scripts/renumber-migration.sh 0282 0283` if 0282 is then occupied (use next free head sequence if
  0283 is also occupied). Do not rewrite 0253/0255/0262/0275.
- `supabase/migrations/rollback/0282_vat_flag_unlock_down.sql` — full reversal described below.
- `supabase/tests/0282_vat_flag_unlock.test.sql`, `0282_vat_flag_unlock_outbox.test.sql`,
  `0282_vat_flag_unlock_acl_history.test.sql` — state/refusal/scope/history proof.
- `pmo-portal/src/hooks/useProjectVatEditability.ts`, `useProjectVatEditability.test.tsx`,
  `useRevenue.vatUnlock.test.tsx` (actual existing-write/eligibility invalidation).
- `pmo-portal/src/lib/projectVatRefusal.ts`, `projectVatRefusal.test.ts` — stable-detail copy selector.
- `pmo-portal/src/lib/adapterSeam/erpnext/invoiceVatContext.test.ts` — witness source and replay tests.
- `pmo-portal/pages/project-detail/__tests__/ProjectDetailHeader.vatUnlock.test.tsx`.
- `pmo-portal/e2e/serial/AC-PPNC-001-ppn-reissue.spec.ts` — one curated served-lane normal
  cancel/create/submit journey with mandatory ERP child-row reads and rendered money oracles.
- `pmo-portal/e2e/AC-PPNC-014-vat-stale-editor.spec.ts` — deterministic rendered stale-refusal journey,
  mocked RPC/writes, read-only isolation (no DB mutations).
- `scripts/spikes/ppnc-vat-concurrency.sh` — two-session local DB proof, no bench needed.
- `scripts/spikes/ppnc-vat-rollback.sh` — transactional local up→down→up catalog/history proof.

History uses existing `record_changes` and `list_record_history`; add no table, second VAT log,
RPC to rewrite cancelled rows, project “unlocked” stored column or reconciliation job. Indexes are
additive only after catalog/query-plan review; the SQL access paths below require `(org_id,project_id)`
on invoices/claims and a partial nonterminal revenue outbox index. No FE enumeration or N+1 count.

## SQL design and real implementation kernels

All functions below are named implementation targets; internal helpers are revoked from public,
anon and authenticated. New client reader returns eligibility only and explicitly checks membership
and org. Reader result is advisory; trigger uses the same helper at write time. Root setter remains
0253's exact nine-argument signature and preserves its original value/basis checks and audit.

### 1. Shared lock reason and scoped reader

Place this actual kernel in 0282, with grants as shown. `Cancelled` is the native oracle, ERP cancellation
requires docstatus 2; no-name/no-docstatus cancelled rows are never-sent local records. Case-insensitive
text joins avoid casting arbitrary command ids. Association ORs are intentional: a caller payload cannot
hide an invoice's real project, and a claim create may have no mirror yet.

```sql
create function public.project_invoice_vat_lock_reason(p_org uuid, p_project uuid)
returns text language sql volatile set search_path = public as $$
  select case
    when exists (
      select 1 from public.sales_invoices si
       where si.org_id = p_org and si.project_id = p_project
         and not coalesce(si.status::text = 'Cancelled' and (
           si.pmo_native or si.erp_docstatus = 2
           or (si.si_number is null and si.erp_docstatus is null)), false)
    ) then 'vat-live-invoice'
    when exists (
      select 1 from public.external_command_outbox o
       where o.org_id = p_org and o.domain = 'revenue'
         and o.payload->>'erp_doc_kind' = 'sales-invoice'
         and o.state not in ('confirmed','failed')
         and (
           lower(o.payload->>'projectId') = lower(p_project::text)
           or exists (select 1 from public.sales_invoices si
                       where si.org_id = p_org and si.project_id = p_project
                         and lower(si.id::text) = lower(o.pmo_record_id))
           or exists (select 1 from public.progress_claims pc
                       where pc.org_id = p_org and pc.project_id = p_project
                         and lower(pc.id::text) = lower(o.pmo_record_id))
         )
    ) then 'vat-command-pending'
    else null end
$$;
revoke all on function public.project_invoice_vat_lock_reason(uuid,uuid)
  from public, anon, authenticated;

create or replace function public.guard_project_vat_flag_lock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_reason text;
begin
  v_reason := public.project_invoice_vat_lock_reason(new.org_id, new.id);
  if v_reason is not null then
    raise exception 'this project VAT setting is locked by its invoice state'
      using errcode = '42501', detail = v_reason;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_project_vat_flag_lock() from public, anon, authenticated;

create function public.get_project_vat_editability(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_reason text; v_has_invoices boolean;
begin
  if not public.is_active_member() then
    raise exception 'not authorized' using errcode='42501', detail='vat-not-authorized';
  end if;
  select org_id into v_org from public.projects where id = p_id;
  if not found then
    raise exception 'project not found' using errcode='P0002', detail='vat-project-not-found';
  end if;
  if v_org is distinct from public.auth_org_id() then
    raise exception 'not authorized' using errcode='42501', detail='vat-not-authorized';
  end if;
  v_reason := public.project_invoice_vat_lock_reason(v_org, p_id);
  select exists(select 1 from public.sales_invoices where org_id=v_org and project_id=p_id)
    into v_has_invoices;
  return jsonb_build_object('eligible', v_reason is null, 'reason', v_reason,
                           'hasInvoices', v_has_invoices);
end;
$$;
revoke all on function public.get_project_vat_editability(uuid) from public, anon;
grant execute on function public.get_project_vat_editability(uuid) to authenticated;
```

Do not return raw outbox payload, document/customer names or foreign counts. Reader's eligibility is
independent of role; FE ANDs it with `setVatFlag` real-JWT permission. Setter reasserts authority.
For flag-changing setter calls, add stable details to the existing unknown-project/wrong-org/inactive/
flag-role exceptions; preserve their SQLSTATE and checks. For null/identical flag requests, old value-only
role rules continue exactly as today. Example role arm, with 0253's existing variables:

```sql
if p_subject_to_vat is not null and p_subject_to_vat is distinct from v_old_vat
   and (v_role is null or v_role not in ('Finance','Admin')) then
  raise exception 'only Finance or Admin can change whether a project is subject to VAT'
    using errcode='42501', detail='vat-role-forbidden';
end if;
```

Ensure the flag-role check precedes value-role denial **for a flag-changing request**, so Engineer
and Executive produce the same VAT refusal contract; do not give them contract-value authority.
Use the existing project FOR UPDATE acquisition for setter serialization. Its history capture happens
AFTER the successful project update; existing 0260 classification already holds `subject_to_vat:bool`.

### 2. Serialize invoice insertion and outbox activation

The setter holds the project row and **only reads**, never locks invoice/outbox rows. Invoice writers
and command activations take FOR SHARE on that project before their new live facts become visible.
Preserve existing order: work-order billing lock → project. For commands claimed from failed:
outbox row → existing work-order billing fence → project. No project holder waits on those outer locks.

Add `sales_invoices_zzzzz_vat_project_lock`, BEFORE INSERT OR UPDATE OF project_id, status,
erp_docstatus, after `sales_invoices_zzzz_work_order_invoiceable` in alphabetical BEFORE-trigger order.
Its definer function locks each involved project FOR SHARE, including OLD project on a move, in UUID
order. Apply to native, ordinary, claim and service-role mirror writes; do not reject financial mirror
facts or exempt the serialization by `current_user`. Native 0275 already locks its project when reading
VAT. The new trigger is serialization only, not a new authorization policy or a mirror refusal.

Add `external_command_outbox_zzz_vat_context`, BEFORE INSERT OR UPDATE OF state, payload.
Only nonterminal `domain='revenue'`, `erp_doc_kind='sales-invoice'` enters it; terminal writebacks return
immediately. Resolve same-org project from authoritative invoice, then claim, then canonical payload
project id (UUID regex before any cast). If multiple supplied associations disagree, refuse rather
than choose a different project; legitimate unassigned ordinary invoices remain unassigned and do
not lock arbitrary projects. Missing known-project rows refuse, never pass as unassigned.
Acquire project FOR SHARE; read subject_to_vat only after that lock. The shared reason helper
is VOLATILE deliberately: its checks after a lock wait must use fresh READ COMMITTED snapshots,
not a pre-wait statement snapshot. Include direct privileged UPDATE as well as RPC race coverage. On **fresh INSERT** or
**failed→active UPDATE** of a body-building command, require a boolean payload witness and equality
with the locked project. Cancellation/submit-only commands carry no witness and need only association
serialization; they build no body. Existing legacy active commands may settle without a new witness,
while still blocking flips until terminal. Do not mutate payload/digest in this trigger.

Exact body/witness predicates for the trigger (`NEW`/`OLD` in PL/pgSQL):

```sql
v_builds_body := new.operation in ('create','update')
  or (new.operation = 'transition' and new.payload->>'verb' = 'amend');
v_needs_witness := tg_op = 'INSERT';
if tg_op = 'UPDATE' then v_needs_witness := old.state = 'failed'; end if;
if v_builds_body and v_needs_witness and v_project is not null then
  if jsonb_typeof(new.payload->'vat_flag_at_resolution') is distinct from 'boolean' then
    raise exception 'invoice VAT context could not be verified'
      using errcode='P0001', detail='vat-context-unavailable';
  end if;
  if (new.payload->>'vat_flag_at_resolution')::boolean is distinct from v_current_vat then
    raise exception 'project VAT changed before this invoice command could be sent'
      using errcode='P0001', detail='vat-context-changed';
  end if;
end if;
```

Fresh dispatch strips any incoming `vat_flag_at_resolution`, then the factory sets it from the
**same server project read** used for its VAT gate (claim and ordinary create sources; existing
update/amend body commands resolve project from the authoritative mirror, never caller override).
Set it before payload hashing/insertion. Trusted sweep replay keeps it unchanged; retain the
existing create-path persisted taxes/digest behavior. No new amendment tax rows or replay expansion.
The witness for existing adapter body commands is **unlock concurrency coverage**, not a new amend
capability. No extra ERP read for the witness; no witness or flag is sent as an ERP field.

This resolves both race orderings: enqueue first holds the project until its pending row commits,
so flag save sees the row and refuses; flag save first commits the new flag, so a pre-resolved old
body cannot activate. A failed command is ignored by unlock but cannot revive old tax context.
Do not keep a DB lock open across ERP HTTP: the **persisted nonterminal outbox** fences that window.

### 3. Indexes and rollback

In 0282 use `CREATE INDEX IF NOT EXISTS` for:

```sql
create index if not exists sales_invoices_vat_project_idx
  on public.sales_invoices(org_id,project_id);
create index if not exists progress_claims_vat_project_idx
  on public.progress_claims(org_id,project_id);
create index if not exists outbox_vat_project_pending_idx
  on public.external_command_outbox(org_id,lower(payload->>'projectId'))
  where domain='revenue' and payload->>'erp_doc_kind'='sales-invoice'
    and state not in ('confirmed','failed');
create index if not exists outbox_vat_invoice_pending_idx
  on public.external_command_outbox(org_id,lower(pmo_record_id))
  where domain='revenue' and payload->>'erp_doc_kind'='sales-invoice'
    and state not in ('confirmed','failed');
```

Omit a redundant new index if the catalog already has an equivalent leading-key index; record its
actual name in build evidence. Review EXPLAIN for payload association and invoice/claim joins on a
synthetic multi-project fixture; a seq scan on a tiny pgTAP fixture is not a performance defect.
Rollback restores 0255 guard and 0253 setter verbatim, drops only newly named serialization triggers,
functions/reader/indexes created by 0282, revokes the reader and removes its inventory entry. It must
not drop the VAT column or 0260 history, or rewrite invoices. For rollback, remove new DB activation
requirements before reverting the witness producer; the preceding FE/dispatch then works with the
stricter historical lock. Forward order is additive server witness producer first (old schema safely
ignores its internal field), then 0282, then editor. This avoids requiring a witness before dispatch
can produce it. If the reader is unavailable the editor stays read-only, never “unlocked”. The
Director checks this ordering under deployment review; this plan authorizes no deployment.

## Repository and UI design kernels

Add the following type/reader method to the project seam; hook consumes repositories, not DAL:

```ts
export interface ProjectVatEditability {
  eligible: boolean;
  reason: 'vat-live-invoice' | 'vat-command-pending' | null;
  hasInvoices: boolean;
}

export async function getProjectVatEditability(id: string): Promise<ProjectVatEditability> {
  const { data, error } = await supabase.rpc('get_project_vat_editability', { p_id: id });
  if (error) throw error;
  if (!data || typeof data.eligible !== 'boolean' || typeof data.hasInvoices !== 'boolean'
      || ![null, 'vat-live-invoice', 'vat-command-pending'].includes(data.reason)) {
    throw new Error('Project VAT editability is unavailable');
  }
  return data as ProjectVatEditability;
}
```

`supabase` is the existing import in `src/lib/db/projects.ts`; expose as
`repositories.project.getVatEditability(id)` wrapped with existing `wrap`. New hook query key:
`['project-vat-editability', orgId, projectId]`, enabled only with both ids. Preserve existing org
context convention in `useProjects.ts`. Invalidate this family on contract saves and existing SI
create/cancel/submit writes, and on known stale refusal; refetch on opening the contract editor.
A refetch in flight disables changing VAT until eligibility is established. Keep the flag's stored
value while loading/locked; permit unchanged-flag contract edits.

Header replacement uses the new hook, removes only invoice-length eligibility inference:

```ts
const vatCheck = useProjectVatEditability(project.id);
const vatLocked = vatCheck.isPending || vatCheck.isFetching || vatCheck.isError
  || vatCheck.data?.eligible !== true;
const mayChangeVat = canSetVat && !vatLocked;
```

`vatDraft` still enters the existing `setContractValue` payload only when different and
`mayChangeVat`. Error selector reads PostgREST `details` carried through `AppError.details`,
not English message matching; assert actual error shape in the DAL/repository tests. Include the
existing DAL `throwWrite` in this contract (used by the contract-value setter):

```ts
interface PostgrestErrorLike { message: string; code?: string; details?: string }
function throwWrite(error: PostgrestErrorLike): never {
  throw new AppError(error.message, error.code, error.details);
}
```

Use `projectVatRefusal` for these stable details, and verify `adapter-dispatch`'s response/dispatch
client preserves the activation-refusal detail before offering any retry remedy. Map all spec
codes to translated copy. Persistent in-editor error once; inputs survive refusal, no success toast,
and eligibility refreshes. `Checkbox` help uses an id/`aria-describedby`; label-click guards disabled
state. The new hint replaces “locked once any invoice exists”, not the stored value or tax fields.

No revenue method, correction mutation, invoice action or form is added. Rehearsal uses existing
`cancelInvoice`, `createInvoice` and `submitInvoice`. Cancel, new create and each submit have
**separate intents**; uncertain retries reuse the intent of that operation. Wait for confirmed
cancellation before new create. The new invoice has a new UUID and ERP name; its complete author
set is checked by normal approval. Preserve customer/project/work-order selection through the
normal form, not by cloning the old mirror, old taxes or ERP amendment link.

## Rehearsal failure repair map (only if actual evidence is FAIL)

These are diagnostic/fix targets, not claims of current defects. Finance's wrong outcome would be
an incorrectly taxed corrected invoice, cancelled history still counted, or inconsistent visible
AR/billing. Capture the failing phase first, write a regression importing the deciding shipped code,
repair only the demonstrated boundary, then rerun AC-PPNC-001 unchanged. A required repair outside
the signed cancel/create scope is a Director escalation, not permission to add amend.

| Failed oracle | Existing repair target | Regression / exact targeted command |
|---|---|---|
| NEW create rows/rate wrong or missing | `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.ts` (`resolveOrdinaryInvoiceTaxes`), `erpSalesTaxRows.ts`, `bodies/salesInvoice.ts` (`siToBody`) | `salesInvoiceTaxRows.test.ts`, `erpSalesTaxRows.test.ts`; `unit-tax` below. Fresh authoritative flag/base, effective 11%, no predecessor tax_amount; setup refusal before new POST. |
| Correct new-create wire, incorrect ERP full-document taxes | Authorized local ERP default template/company/item setup per `docs/environments.md`; then body builder above if REST proves a wire issue | Same mandatory full-doc spike reads and live-reissue command below; no Desk edits to issued taxes and no invented clearing contract. |
| ERP cancelled but original mirror/history wrong, or new mirror totals wrong | `pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts` (`siFromDoc`), `supabase/functions/adapter-dispatch/readModelWriters.ts`; inbound lifecycle only if shown: `supabase/functions/_shared/erpnextFeedDeps.ts` | `scripts/with-db-lock.sh bash -c 'cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-read --allow-net readModelWriters.money.test.ts'`; inbound: `scripts/with-db-lock.sh bash -c 'cd supabase/functions/_shared && deno test --allow-env --allow-read --allow-net erpnextFeedDeps.revenue.test.ts'`. |
| Cancelled history contributes to AR/revenue | `pmo-portal/src/lib/db/revenue.ts` (`getRevenueByProject`), `src/lib/projectInvoicing.ts` and `src/hooks/useRevenue.ts` invalidation | `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/revenue.test.ts src/hooks/useRevenue.workOrderBilling.test.tsx'`. |
| Net drawdown/pending/remaining wrong after cancel/new create | `sales_invoice_work_billed`, `work_order_billing_lines`, `work_order_billing` definitions in `supabase/migrations/0262_billing_by_work_order.sql`; `pmo-portal/src/lib/db/workOrderBilling.ts` and hook invalidation | Add proven SQL correction to forward 0282, never rewrite shipped 0262; `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0262_work_order_billing_figures.test.sql'`; `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/workOrderBilling.test.ts src/hooks/useRevenue.workOrderBilling.test.tsx'`. |
| Sources correct but list/AR/billing displays wrong | `pmo-portal/pages/SalesInvoices.tsx`, `pages/RevenueByProject.tsx`, `pages/project-detail/tabs/WorkOrdersTab.tsx` and their consuming hooks | Actual rendered AC-PPNC-001 stage table is the goal oracle; billing component pin: `scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run pages/project-detail/__tests__/WorkOrdersTab.billing.test.tsx'`; then live-reissue. No new amend UI. |

Cancellation or new create with an uncertain result is **BLOCKED pending recovery**, never a second
create with a fresh key. This map does not change DD-PBL-13's edit/amend tax rule or add tax-copy
experiments. Missing evidence is not failure evidence and does not justify speculative fixes.

## 2–5 minute TDD tasks

Each item is a bounded red→green or refactor chunk; fixture creation and long external waits are
separate runbook checkpoints, not disguised 5-minute coding tasks. All production edits follow a
failing behavior test. Task titles are the dispatch checklist; run the named targeted command after
each green chunk, and inspect the output body. Do not weaken/skip tests.

### Rehearsal gate (Director later)

- **S1: Freeze fixture/version and original-submitted oracle (AC-001).** Run spike steps 1–3 under
  ERPNext→DB locks; record original 1,200,000 net / 132,000 tax / 1,332,000 gross and rendered
  figures. Existing normal create and B-submit only. This is an external checkpoint, not a build.
- **S2: Confirm cancellation and fresh re-issue draft (AC-001).** Spike steps 4–6: existing PMO Cancel,
  wait for settlement, new normal create at 2,400,000, distinct UUID/name/intents; full original/new
  REST taxes and stage-specific rendered figures. Stop on uncertain cancellation or create.
- **S3: Independently submit and record PASS/FAIL (AC-001).** Spike steps 7–8: B submits the new
  invoice, fresh full GET and PMO list/AR/billing convergence. Record sanitized evidence in the spike;
  FAIL uses the repair map, never amend. After D/U, repeat step 9 for unlock/history/untaxed next create.

### D — Full DD-TAX-4b unlock, witness and concurrency

- **D1 (4 min): RED cancelled-family and live-family matrix (AC-006/007).** New
  `0282_vat_flag_unlock.test.sql`: empty, all-cancelled ERP/native/progress/down-payment and mixed
  sets; Draft/Submitted/Unpaid/Paid/contradictory ERP status. Assert both directions and unchanged facts.
- **D2 (4 min): GREEN shared lock-reason and existing trigger (AC-006/007).** Create 0282 with shared
  helper/kernel above; existing trigger registration remains. Run `db-state` command below.
- **D3 (4 min): RED/GREEN scoped reader and refusal priority (AC-019).** Add reader SQL and reader
  pgTAP assertions: empty/all-cancelled/live/pending, own active read, wrong-org/inactive/anon refusal;
  authorization before reasons; no payload/count leakage. Run `db-acl`.
- **D4 (4 min): RED nonterminal command matrix (AC-008/009).** New outbox tests for all five states ×
  create/transition-cancel/transition-amend/update/transition-submit × payload/identity/claim association.
  Include uppercase UUID, missing payload project, no-mirror claim, mixed projects/orgs; test terminal
  states and unrelated receipts separately. No new trigger yet. Run `db-outbox` and observe red.
- **D5 (3 min): GREEN outbox predicate/scope/indexes (AC-008/009).** Finish shared helper above,
  validate catalog index equivalence, retain case-insensitive comparisons and terminal exclusion.
  Run `db-outbox`.
- **D6 (4 min): RED/GREEN roles, direct grants and history (AC-010/011).** New ACL/history test captures
  SQLSTATE **and DETAIL via GET STACKED DIAGNOSTICS**, not only throws_ok's message. Add stable details
  in setter while preserving null/same-flag value roles. Test real Finance/Admin, PM/Exec/Engineer,
  inactive, wrong-org, anon privilege refusal, no direct column writes, old/new/actor/time and no-op/
  refused-save VAT diffs. Run `db-acl`.
- **D7 (4 min): RED/GREEN native next-invoice + preservation (AC-012).** Use real 0275 native create,
  approve/cancel actors and 12×11/12; compare cancelled invoice tax columns before/after flag save.
  Check off→untaxed new draft→relock and on→taxed new draft. Add to state suite; run `db-state`.
- **D8 (3 min): RED server VAT-witness producer (AC-015/016).** Add `invoiceVatContext.test.ts`
  importing the real factory: ordinary/claim source, update/amend mirror association, ignores caller
  witness, no extra tax GET for the witness, digest includes it and replay preserves original value.
  Run `unit-context` and see red.
- **D9 (4 min): GREEN witness producer (AC-015/016).** Add server-built internal field to the existing
  authoritative project-read paths before hashing, strip only fresh input in `index.ts`, trust only
  existing authenticated sweep replay handling. Use actual handler import + global fetch mocks for
  any edge test; no production dependency injection. Run `unit-context` + `edge`.
- **D10 (4 min): RED activation/revival tests (AC-015/016).** Outbox pgTAP: stale boolean, missing,
  string instead of boolean, valid match, failed revival after both flag directions, legacy active
  recovery unchanged, cancel/submit identities without project payload. Assert no state/digest change.
- **D11 (4 min): GREEN serialization triggers (AC-015/016).** Add the trigger pair above, resolve
  authoritative same-org project, preserve lock order, compare witness only for fresh/revived bodies.
  Run `db-outbox`; inspect trigger registration/order in pg_trigger as an additional binding assertion.
- **D12 (4 min): Two-session RED/GREEN interleave oracle (AC-016).** Write
  `scripts/spikes/ppnc-vat-concurrency.sh` using local Docker `psql`, two independent transactions
  and explicit barriers, **not sleep-based guesswork**. Fixtures are synthetic own project/actors,
  cleaned even on failure. Sequence 1: T1 native create uncommitted holds project SHARE, T2 setter
  must block, T1 commits, T2 reports live-invoice. Sequence 2: T1 setter holds project, T2 stale
  prebuilt outbox INSERT waits; T1 commits, T2 reports context-changed with no row. Repeat sequence
  2 for failed→active claim. Observe pg_locks/pg_stat_activity wait before releasing the barrier;
  bounded timeout fails the test. Assert post-state and preserved payload/digest, not just exit codes.
  Use `db-concurrency` below; single-session pgTAP is not the concurrency proof.
- **D13 (4 min): Reversible migration and ACL inventory.** Implement rollback as specified; assert
  trigger/internal-helper no EXECUTE, reader authenticated only, native authority unchanged, and no
  broadened column grants. Register the new reader in isolation denominator, run `db-acl` and schema
  contract gates. Add `scripts/spikes/ppnc-vat-rollback.sh`: under the DB hold use local psql only,
  run down/up SQL inside one transaction and roll it back; assert restored 0253/0255 function bodies,
  reader/internal ACLs, trigger inventory and unchanged VAT/history/invoice facts at each phase.
  Identify local DB from the repo's existing local-stack scripts, never linked/cloud. Trap failure,
  bounded timeout, ON_ERROR_STOP, no payload/credential output. Run `db-rollback` below.
- **D14 (3 min): Deliberate historical expectation graduation.** DD-TAX-4b changes old permanent-lock
  assertions: replace the **cancelled-only** expectation in 0253 with eligible-and-history-preserved,
  keep live-invoice refusal and grants. 0255 keeps uppercase **pending** refusal. Update only intended
  lock error text/details assertions; never delete cases. Add valid server-witness fields to existing
  fresh body-command fixtures where required by the new activation contract: inspect
  `0253_project_vat_flag.test.sql`, `0255_project_vat_flag_lock_case.test.sql`,
  `0262_work_order_billing_fence_hardening.test.sql`, `0262_work_order_billing_refusal.test.sql`,
  `outbox_inflight_link_delete_guard.test.sql` and `0272_efaktur_number.test.sql`. Preserve each file's
  goal assertions and malformed-body cases (expected prior validation priority); do not exempt a
  real command merely to keep fixtures green. Run `db-regression`.

### U — Existing project's contract/VAT editor only

- **U1 (4 min): RED/GREEN typed editability seam (AC-019).** DAL/repository tests in existing
  `db/projects.test.ts` and repository project test section prove exact RPC/typed result/error
  preservation; add DAL/interface/wrap from kernel. Run `unit-ui`.
- **U2 (3 min): RED/GREEN editability hook/invalidation (AC-013).** New hook test imports actual hook;
  scoped key, enabled/read/refetch/error and SI/contract invalidation asserted in new
  `useRevenue.vatUnlock.test.tsx`, existing `useRevenue.workOrderBilling.test.tsx`
  and `useProjectMutations.test.tsx`. Add query and invalidations, not FE org_id plumbing. Run `unit-ui`.
- **U3 (4 min): RED/GREEN header state/copy (AC-013).** Header tests for no invoices/all-cancelled/
  live/pending/loading/error, Finance/Admin vs real role, click-label and keyboard, English/Bahasa,
  preserved locked value and unchanged-flag contract save. Replace length-derived flag state with
  new query; use spec copy, existing layout/tokens and accessible help. Run `unit-ui`.
- **U4 (4 min): RED/GREEN stale-save error (AC-014).** Code-keyed refusal selector and Header tests:
  concurrent lock refusal keeps input and dialog, one persistent error, eligibility refresh, no success
  announcement. Add both locales and mapping, never parse SQL English. Run `unit-ui`.

### V — Proofs and acceptance

- **V1 (4 min): Pin next-create tax inheritance (AC-018).** Factory tests in
  `salesInvoiceTaxRows.test.ts`: new flag drives ordinary, progress and down-payment creates,
  cancelled history irrelevant, caller tax rows cannot win; preserve claim reduced-base/work-order
  fraction and explicit-rate contract. Use the real factory, supported by existing
  `progressClaimInvoice.test.ts`. If new assertions expose a failure, fix the existing create path
  after RED; do not extend tax resolution to amend/update. Run `unit-tax`.
- **V2 (4 min): Pin rendered stale-save outcome (AC-014).** New read-only mocked Playwright file:
  open contract/VAT editor, unlocked reader then save refusal; oracle inputs retained/refreshed reason,
  no success announcement. No DB mutation/dependency gate; 390px and desktop, keyboard/axe. Actual
  page selectors and goals, not control-presence substitutes. Run `ui-e2e`.
- **V3 (4 min): Pin curated cancel + re-issue child-row journey (AC-001).** New
  `e2e/serial/AC-PPNC-001-ppn-reissue.spec.ts` seeds a unique project/customer/work order, snapshots
  and restores shared binding/ownership in finally (serial because setup mutates org-global state).
  **One journey**: A normal create, B submit, A existing PMO Cancel and confirmed settlement, A normal
  new create with distinct UUID/name, B submit. Mandatory full ERP GETs and rendered list/project AR/
  work-order stage-table oracles come from the spike. It covers existing independent approval, not
  a new approval route; retain incumbent SoD tests rather than add an amend-only AC. Fail on missing
  ERP reads or misconfiguration once the served lane is supplied; absent lane has a documented restore
  path, never CI-based gating. Existing create tax unit tests support, not own, this cross-stack AC.
- **V4 (3 min): Rendered Discover and retention.** Director-dispatched reviewer renders the project
  editor and existing invoice correction journey on rich seed, English/Bahasa, narrow/light/dark;
  graduate findings to tests/routes×oracles/decision KB; re-render clean. Screenshots do not replace
  ERP totals. Complete spike step 9 after D/U for the unlock/history/next-create rendered proof.
- **V5 (4 min): Mutation-sensitive guards and restored green.** Execute the table below one mutation
  at a time, named owning oracle RED, restore exact code and rerun GREEN. Never commit mutations,
  weaken assertions or copy production validators into tests.
- **V6 (3 min): Local final gates and three-reviewer handoff.** Run changed-origin/dev Vitest,
  typecheck, touched ESLint, DB/e2e/edge below, actual result bodies and ≥80% changed-line coverage.
  Spec/quality/security reviewers consume the evidence, rerun only disputed targeted checks.
  CI verify+pgtap gates PR→dev, verify+integration gates PR→main; no local full-suite repetition.

## Exact verification commands (future builder/Director only)

Run from repo root unless a command explicitly cds. No command in this section was executed by
this docs-only brief. Wrapper names below label commands, not shell aliases or unchecked scripts.

**db-state / db-outbox / db-acl** during red-green (use their named file respectively):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0282_vat_flag_unlock.test.sql'
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0282_vat_flag_unlock_outbox.test.sql'
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0282_vat_flag_unlock_acl_history.test.sql'
```

**db-regression** / combined final targeted DB proof (reset and tests ONE lock hold):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/0253_project_vat_flag.test.sql supabase/tests/0255_project_vat_flag_lock_case.test.sql supabase/tests/0282_vat_flag_unlock.test.sql supabase/tests/0282_vat_flag_unlock_outbox.test.sql supabase/tests/0282_vat_flag_unlock_acl_history.test.sql supabase/tests/0275_native_revenue_create.test.sql supabase/tests/0275_native_revenue_approve.test.sql supabase/tests/0275_native_revenue_serialise.test.sql supabase/tests/record_changes_capture.test.sql supabase/tests/record_changes_actor.test.sql supabase/tests/record_history_read.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0262_work_order_billing_fence_hardening.test.sql supabase/tests/0262_work_order_billing_refusal.test.sql supabase/tests/outbox_inflight_link_delete_guard.test.sql supabase/tests/0272_efaktur_number.test.sql'
```

**db-concurrency** (new two-session harness; fixtures/rollback inside it):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && bash scripts/spikes/ppnc-vat-concurrency.sh'
```

**db-rollback** (new local-only transactional harness; down/up never commits to shared data):

```bash
scripts/with-db-lock.sh bash -c 'supabase db reset && bash scripts/spikes/ppnc-vat-rollback.sh'
```

**unit-context / unit-tax** (both import shipped code):

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/invoiceVatContext.test.ts'
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/adapterSeam/erpnext/salesInvoiceTaxRows.test.ts src/lib/adapterSeam/erpnext/erpSalesTaxRows.test.ts src/lib/adapterSeam/erpnext/progressClaimInvoice.test.ts'
```

**unit-ui** (new files plus existing cross-component regressions):

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run src/lib/db/projects.test.ts src/lib/repositories/index.test.ts src/lib/repositories/revenue.external.test.ts src/hooks/useProjectVatEditability.test.tsx src/hooks/useProjectMutations.test.tsx src/hooks/useRevenue.vatUnlock.test.tsx src/hooks/useRevenue.workOrderBilling.test.tsx src/lib/projectVatRefusal.test.ts pages/project-detail/__tests__/ProjectDetailHeader.test.tsx pages/project-detail/__tests__/ProjectDetailHeader.vatUnlock.test.tsx'
```

**edge** (use handler/global-fetch pattern for new handler tests):

```bash
node scripts/check-edge-fn-test-binding.mjs
scripts/with-db-lock.sh bash -c 'cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-read --allow-net moneyOutboxDeps.test.ts pmoNativeRevenue.test.ts'
```

**ui-e2e** and **live-reissue** (lock order ERPNext→DB; environment setup delegated to Director,
no credential names/coordinates added here):

```bash
scripts/e2e-local.sh --project=chromium --workers=1 e2e/AC-PPNC-014-vat-stale-editor.spec.ts
scripts/with-erpnext-lock.sh scripts/with-db-lock.sh scripts/serve-functions.sh -- scripts/e2e-local.sh --project=serial --workers=1 e2e/serial/AC-PPNC-001-ppn-reissue.spec.ts
```

The live command is local-only, required for ERP semantics; CI bench-free smoke is not equivalent.
When absent in CI, register dependency-based skip in `scripts/check-e2e-skips.mjs`'s existing
allowlist with this exact local command as restore path. Both e2e files must pass `scripts/check-e2e-isolation.sh`.

**Local final gate**:

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npm run typecheck && npx vitest run --changed origin/dev'
(cd pmo-portal && npx eslint --max-warnings=0 src/lib/db/projects.ts src/lib/db/projects.test.ts src/lib/repositories/index.ts src/lib/repositories/types.ts src/lib/repositories/index.test.ts src/hooks/useProjects.ts src/hooks/useRevenue.ts src/hooks/useProjectVatEditability.ts src/hooks/useProjectVatEditability.test.tsx src/hooks/useProjectMutations.test.tsx src/hooks/useRevenue.vatUnlock.test.tsx src/lib/projectVatRefusal.ts src/lib/projectVatRefusal.test.ts src/lib/adapterSeam/erpnext/dispatchFactory.ts src/lib/adapterSeam/erpnext/invoiceVatContext.test.ts src/lib/adapterSeam/erpnext/salesInvoiceTaxRows.test.ts pages/project-detail/ProjectDetailHeader.tsx pages/project-detail/__tests__/ProjectDetailHeader.vatUnlock.test.tsx e2e/AC-PPNC-014-vat-stale-editor.spec.ts e2e/serial/AC-PPNC-001-ppn-reissue.spec.ts)
```

The explicit ESLint list covers planned FE changes/tests; include any further paths actually
changed by a demonstrated repair, exclude support-only files not changed. Review CI's full suite
before merge. Scoped coverage command (existing coverage configuration, ≥80% changed lines):

```bash
scripts/with-test-lock.sh bash -c 'cd pmo-portal && npx vitest run --changed origin/dev --coverage'
```

Do not inflate coverage through artificial tests; collect the report and changed-line evidence.

Regenerate typed client after 0282 under the DB lock (local target, never linked/cloud):

```bash
scripts/with-db-lock.sh bash -c 'supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts'
```

Include `pmo-portal/src/lib/supabase/database.types.ts` in the future build diff and typecheck. The
in-repo history registry already classifies the VAT column; no new captured column is needed.

Schema contracts under DB lock:

```bash
scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs --write
scripts/with-db-lock.sh node scripts/check-isolation-denominator.mjs
```

Inspect generated inventory diff; new trigger functions are excluded, new client reader is included.
Use the repository's current ACL suite as the catalog authority; no weakening existing allowlists.

## Mutation checks (one mutation → named RED → exact restore → GREEN)

| Temporary mutation | Required red proof |
|---|---|
| Trigger always returns NEW | AC-007/008 live/pending refusals |
| Native rows excluded from invoice predicate | AC-007 native live blocks |
| Only ordinary invoices counted | AC-007 progress/down-payment live blocks |
| Only creates counted / only payload projectId used | AC-008 cancel/amend/submit/update identity cases |
| Remove lowercase normalization | AC-008 + 0255 uppercase pending |
| Treat held/quarantined/committed as terminal | AC-008 each named state |
| Remove role/membership/org check, separately | AC-010/019 each named caller |
| Allow direct flag column UPDATE | AC-010 privilege assertions and direct write probe |
| Delete witness comparison / failed revival guard | AC-015 stale/missing boolean tests |
| Remove project serialization from outbox/native path | AC-016 two-session interleave (not pgTAP alone) |
| Suppress record capture | AC-011 old/new actor/time proof |
| Remove create effective scaling / tax resolver call | Existing AC-856-2 create-row test; AC-001 live NEW tax |
| Delete persisted create taxes on replay | Existing AC-858-1 same-row/digest replay test |
| Count original Cancelled invoice in AR/billing | AC-001 phase-specific aggregate/rendered goals |
| UI enables VAT during reader loading/error | AC-013 actual Header/hook tests |

Baseline and restored suites must be green; any mutation remaining green blocks acceptance until
its owning oracle is repaired against shipped code (not copied validators). Security-review details
not suitable for this public repository remain private; this plan specifies intended contracts only.

## Traceability (one canonical owner per AC)

| AC-PPNC | Owning layer / exact file | Goal |
|---|---|---|
| 001 | Served/live UI e2e `e2e/serial/AC-PPNC-001-ppn-reissue.spec.ts` | Existing cancel + fresh create + B-submit; NEW ERP taxes/totals, original cancelled history, distinct mirrors, rendered list/AR/net billing |
| 006 | pgTAP `0282_vat_flag_unlock.test.sql` | Empty/all-cancelled success, both roles/directions |
| 007 | pgTAP same file | All invoice families/statuses refuse |
| 008 | pgTAP `0282_vat_flag_unlock_outbox.test.sql` | All nonterminal verbs/state/identity associations |
| 009 | pgTAP same file | Terminal/unrelated commands do not lock |
| 010 | pgTAP `0282_vat_flag_unlock_acl_history.test.sql` | Roles/member/org/grants refuse |
| 011 | pgTAP same file | Existing history diff/actor/time, no-op/fail |
| 012 | pgTAP `0282_vat_flag_unlock.test.sql` | Native next tax + immutable cancelled history/relock |
| 013 | Unit `pages/project-detail/__tests__/ProjectDetailHeader.vatUnlock.test.tsx` | Role/state/a11y/i18n editor behavior |
| 014 | UI e2e `e2e/AC-PPNC-014-vat-stale-editor.spec.ts` | Retained input/code-keyed remedy/refreshed lock |
| 015 | pgTAP `0282_vat_flag_unlock_outbox.test.sql` | Failed revival witness refusal |
| 016 | Integration `scripts/spikes/ppnc-vat-concurrency.sh` | Actual transaction interleaves |
| 018 | Unit `src/lib/adapterSeam/erpnext/salesInvoiceTaxRows.test.ts` | New flag drives ordinary/claim/down-payment create |
| 019 | pgTAP `0282_vat_flag_unlock_acl_history.test.sql` | Scoped reader returned shape/authority |

Support tests at other layers reference their AC but do not claim canonical ownership. All pgTAP
paths above are under `supabase/tests/`; unit/e2e paths under `pmo-portal/`. Amend-only AC-002..005
and 017 are retired from this spec, not skipped. AC-001's lowest sufficient layer is the single
served/live journey: existing `salesInvoiceTaxRows.test.ts` (AC-856-2 effective rate, AC-858-1 replay),
`erpSalesTaxRows.test.ts` and normal SoD tests support it; sanitized spike evidence supports ERP and
rendered semantics without replacing the canonical pin. There is no claim of PASS until run.
No invoice/AR/drawdown expected values are weakened.

## Premise corrections and stop conditions

- In-app cancel/create/submit exist; amend is not exposed in the inspected page/repository/hook.
  OD-TAX-4c intentionally builds none. ERP amended-from is revisited only if the owner asks.
- Correction is confirmed cancel→**new create Draft with a different UUID/name**→independent submit,
  using fresh create tax rows; neither ERP tax-copy behavior nor a second approval path is needed.
- ERP row is effective 11%, not literal 12% on full net; both encode 12% of the 11/12 base.
- Original Cancelled mirror keeps its history; a new mirror represents re-issue. Flag changes rewrite
  neither. Rendered active figures exclude original history; the list may still show that history.
- Failed is terminal at rest but can revive; snapshot validation binds that re-entry. Pending must
  cover identity-only cancel/amend and update/submit, not just creates with payload projectId.
- The environment doc has a legacy inverted lock example; use binding ERPNext→DB→test order.
- Provisional 0282 must be renumbered if occupied; no schema state is inferred from this plan's name.

Stop on missing owner sign-off, unavailable spike oracle, inconclusive post-cancel outcome, red gate,
wrong test requiring weakened assertions, or unresolved money/SoD review. Technical rehearsal,
fixture/version, repair, test ownership and concurrency decisions belong to the Director, not the
owner question queue. Remaining owner-only checkpoint: spec sign-off (and the usual sketch-glance
of the existing editor hint if not already approved). No unresolved owner product question is
introduced by this revision; ERP amended-from is only a future owner-requested scope change.
No bench/DB execution is performed as part of the present documentation brief.

## Mutation evidence (2026-10-09)

Each row is a single temporary mutation, owning oracle failure, `git checkout -- <file>`,
and fresh restored GREEN. SQL runs reset + four owning files under one DB lock (0283 state,
outbox, ACL/history and 0255 case); production mutations are never committed.

| Row / mutation | Quoted RED oracle | Restored GREEN |
|---|---|---|
| a — only ordinary invoices counted | Initial suite survived; added real progress/down-payment invoice fixtures. `Failed test 21: "AC-PPNC-007 live progress invoice blocks"` and `Failed test 22: "AC-PPNC-007 live down-payment invoice blocks"`; `caught: no exception`, `wanted: 42501`. | Files=4, Tests=88, Result: PASS |
| b1 — only creates counted | `Failed test 20: "AC-PPNC-008 pending SI amend refuses the VAT change"`; also pending cancel/submit/update (21/23/24) and identity cases (30/31), 22 failures. | Files=4, Tests=88, Result: PASS |
| b2 — only payload projectId counted | `Failed test 30: "AC-PPNC-008 claim pmo_record_id blocks before a mirror exists"`; `Failed test 31: "AC-PPNC-008 command without projectId associates through invoice pmo_record_id"`. | Files=4, Tests=88, Result: PASS |
| c — remove lowercase normalization | `Failed test 22: "AC-PPNC-008 pending SI create refuses the VAT change"`; identity tests 30/31; `Failed test 1: "AC-858-4 an in-flight create with an upper-case projectId still locks the VAT flag"` (0255). Graduated uppercase fixtures containing actual hex letters (the original matrix's project UUID was digits only). | Files=4, Tests=88, Result: PASS |
| d1 — held treated as terminal | `Failed test 17: "AC-PPNC-008 held SI create refuses the VAT change"`; all held verbs (15–19) and identity (31) fail. | Files=4, Tests=88, Result: PASS |
| d2 — quarantined treated as terminal | `Failed test 27: "AC-PPNC-008 quarantined SI create refuses the VAT change"`; all quarantined verbs (25–29) fail. | Files=4, Tests=88, Result: PASS |
| d3 — committed treated as terminal | `Failed test 7: "AC-PPNC-008 committed SI create refuses the VAT change"`; all committed verbs (5–9) fail. | Files=4, Tests=88, Result: PASS |
| e1 — remove flag-role check | `Failed test 11: "AC-PPNC-010 Project Manager is refused"`; Executive/Engineer (13/14) and unchanged-facts/history assertions fail. | Files=4, Tests=88, Result: PASS |
| e2 — remove active-member checks (reader/setter) | `Failed test 3: "AC-PPNC-019 inactive member cannot read project VAT eligibility"`; `Failed test 15: "AC-PPNC-010 inactive Finance member is refused"`. | Files=4, Tests=88, Result: PASS |
| e3 — remove org checks (reader/setter) | `Failed test 4: "AC-PPNC-019 wrong-org member cannot read project VAT eligibility"`; `Failed test 16: "AC-PPNC-010 wrong-org Finance is refused"`. | Files=4, Tests=88, Result: PASS |
| f — grant direct flag UPDATE | `Failed test 24: "AC-PPNC-010 direct VAT UPDATE remains unavailable"`; `Failed test 25: "AC-PPNC-010 authenticated direct UPDATE is refused"`. | Files=4, Tests=88, Result: PASS |
| g1 — delete witness comparison | `Failed test 1: "AC-PPNC-015 stale VAT witness is refused before activation"` (`caught: no exception`). | Files=4, Tests=88, Result: PASS |
| g2 — delete failed-revival guard | `Failed test 4: "AC-PPNC-015 failed command cannot revive without a valid VAT witness"` (`caught: no exception`). | Files=4, Tests=88, Result: PASS |
| h — suppress project record capture | `Failed test 9: "AC-PPNC-011 successful VAT change records exactly one actor-attributed diff"`; `Failed test 10: "AC-PPNC-011 VAT diff records old/new boolean and timestamp"`. | Files=4, Tests=88, Result: PASS |
| i — remove create effective-rate scaling (`erpSalesTaxRows.ts`) | `FAIL ... AC-856-2 a reduced-base contract (11/12) scales the rate`; `AssertionError: expected 12 to be 11`; AC-PPNC-018 also RED. | salesInvoiceTaxRows.test.ts: 24/24 PASS |
| j — delete persisted create taxes on replay (`dispatchFactory.ts`) | `FAIL ... AC-858-1 a replayed ordinary create keeps its persisted tax rows: no ERPNext read, same digest after the template rate or VAT flag changes`; digest equality AssertionError. | salesInvoiceTaxRows.test.ts: 24/24 PASS |
| k1 — count Cancelled in submitted AR/revenue (`projectInvoicing.ts` shared allow-list) | `FAIL ... AC-UNB-001: reports submitted invoice totals and remaining contract value on the contract basis`; `invoicedToDate: 10900` vs `2900`. DAL submitted-status filter test also RED. | revenue.test.ts + projectInvoicing.test.ts: 21/21 PASS |
| k2 — count Cancelled in work-order billing (`0262_billing_by_work_order.sql`) | `Failed test 11: "AC-BWO-001 the cancelled invoice and the withdrawn claim are out, and a raised claim counts once (as its invoice)"`; totals/pending/count tests 3/5/7 also RED. | 0262_work_order_billing_figures.test.sql: Files=1, Tests=18, Result: PASS |
| l1 — remove outbox project FOR SHARE | `RACE stale_insert: T2 completed without project serialization`; `RACE stale_insert: committed facts violate VAT/history oracle`; failed claim revival also completes with `success` instead of `vat-context-changed`. | AC-PPNC-016 PASS: all four interleaves serialized, no superseded VAT facts |
| l2 — remove native VAT-read and invoice-trigger project FOR SHARE | `RACE setter_first: committed facts violate VAT/history oracle`; AC-PPNC-016 FAIL (exit 1). A later FK wait still occurs, but tax was read under the old flag: waiting alone is not the oracle. Both 0275 and 0283 restored with checkout. | AC-PPNC-016 PASS: all four interleaves serialized, no superseded VAT facts |

### AC-PPNC-016 two-session proof output

Harness: `scripts/spikes/ppnc-vat-concurrency.sh`, local Docker psql only, under DB lock.
T1 is held by an explicit FIFO BEGIN/COMMIT barrier; T2 must appear blocked by T1 in
`pg_stat_activity`/`pg_blocking_pids` before COMMIT is sent. Bounded polling is observation,
not sleep-based transaction ordering. Synthetic fixtures are cleaned by an EXIT trap.
Native creation is the real 0275 RPC. The postconditions check invoice tax, committed flag,
actor-attributed old/new history and absence of stale activation; failed revival preserves
its exact payload, digest and failed state.

Restored output (exit 0):

```text
PASS native_first: T2 waits on T1 project transaction
PASS native_first: T2 outcome=vat-live-invoice
PASS native_first: committed VAT, invoice/body and history consistent
PASS setter_first: T2 waits on T1 project transaction
PASS setter_first: T2 outcome=success
PASS setter_first: committed VAT, invoice/body and history consistent
PASS stale_insert: T2 waits on T1 project transaction
PASS stale_insert: T2 outcome=vat-context-changed
PASS stale_insert: committed VAT, invoice/body and history consistent
PASS stale_revival: T2 waits on T1 project transaction
PASS stale_revival: T2 outcome=vat-context-changed
PASS stale_revival: committed VAT, invoice/body and history consistent
AC-PPNC-016 PASS: all four interleaves serialized, no superseded VAT facts
```

### Final verification and self-review

- `git diff 85fa1aa9 -- supabase/migrations`: empty. No production/schema repair required.
- ONE full suite: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` (exit 0):

```text
All tests successful.
Files=409, Tests=5545, 65 wallclock secs ( 1.50 usr  0.70 sys +  3.78 cusr  1.91 csys =  7.89 CPU)
Result: PASS
```

- Final standalone harness invocation (self-acquired DB lock): four interleaves PASS, exit 0.
- `bash -n scripts/spikes/ppnc-vat-concurrency.sh` and `git diff --check`: exit 0.
- Self-review: changes add behavioral proofs only (claim-family fixtures, genuine uppercase UUIDs,
  two-session script and evidence). All mutations restored; no assertions weakened, no new app
  behavior, no push/deploy. Aggregate unit/pgTAP proofs support AC-001; they do not claim the
  unavailable live ERP/rendered journey passed. Existing served acceptance remains a separate gate.

