# Plan — Timesheet re-open (Slice A): `Approved → Draft` for a sheet with NO confirmed ERP document

> **Spec:** `docs/specs/timesheet-correction-path.spec.md` (full correction path). This plan builds the
> **Director-narrowed Slice A** only. Slice B (the live-ERP cancel) is its own issue — see §6.
> **Review applied:** `docs/reviews/2026-07-23-luna-fu1-timesheet-correction-spec.md` findings **1 & 2**
> (the after-commit-before-mirror seam + the `pending`-push race) — both are Slice A's money boundary.
> **Conventions:** `CLAUDE.md` (exact paths, real code, exact verify, 2–5 min tasks, ADR-0010 pyramid +
> AC-id tagging). **Migration head:** `0150` on `dev`; this plan uses **0151** only. 0153/0154 are held by
> another lane — do not touch.

---

## 0. What Slice A builds (one sentence)

A new `Approved → Draft` transition in `transition_timesheet`, gated by the **approver population +
Admin, never the owner** (FR-TSC-020/021), that admits **only** when ERP holds no document for the sheet
— proven by a **durable, race-safe precondition** (FENCE 2) serialized by a **named per-timesheet
advisory lock** shared with the timesheet push insert. No ERP I/O, no cancel, no intent, no outbox row.

**Job story served (the common case):** an approver catches a mistake on a week that has *not* reached
ERP (org doesn't employ ERPNext, or the push never created a doc) and re-opens it in-app — no ERPNext Desk.

## 1. Fences (decided — specified, not re-litigated)

- **F1 (authority unchanged by the split).** Re-open = line manager (`profiles.manager_id`) OR
  Admin/Executive where manager is null OR Admin break-glass; **owner → `42501`**; bystander → `42501`.
  SoD-ordered (actor=owner checked BEFORE role/manager). Enforced inside the security-definer RPC with a
  pgTAP proof (ADR-0019). `can()`/UX is additional, never the authority.
- **F2 (the hard part — "no confirmed ERP document" is durable + race-safe).** The precondition considers
  the **mirror** (`ts_number` set AND `erp_cancelled_at` null ⇒ live doc ⇒ refuse) AND **every non-terminal
  outbox state** (`pending`,`committing`,`committed`,`quarantined`,`held`) — the after-commit-before-mirror
  seam (Luna f1) AND a bare `pending` row (Luna f2). It is serialized against the push insert by a NAMED
  `pg_advisory_xact_lock(hashtextextended('ts-correct:'||id,0))` acquired by BOTH the re-open arm AND the
  timesheet push insert. **Fail closed:** if any doubt ERP holds a document, refuse with an actionable
  message — that refusal is Slice B's entry point, not a bug.
- **F3 (no ERP I/O at all).** Slice A issues **no adapter command, no outbox row, no cancel**. The re-open
  is a pure PMO status transition. If a task below seems to specify ERP I/O, it is Slice B — stop.
- **F4 (do not foreclose Slice B).** Names are chosen so Slice B **extends**, never migrates away. Every
  Slice B seam is called out in §5. Slice A refuses where Slice B will fill.
- **F5 (UI).** `can()` gates the affordance (UX only; RPC is authority). A pushed sheet shows an **honest
  message** ("already in ERP — correction path coming"), never a disabled button with no reason. Strictly
  `DESIGN.md` tokens.

**F1 CONFIRMED (the shipped hazard):** `isTimesheetPush` (`supabase/functions/adapter-dispatch/approvalGuard.ts:47`)
keys only on `domain+erp_doc_kind`. Slice A adds **no dispatch command** (no `tsc:` cancel, no
`operation/verb`) and does **not** touch `isTimesheetPush`, `enforceTimesheetApproved`,
`approved_timesheet_for_push`, or the served gate. The only dispatch-path change is making the
**existing** timesheet push **insert** acquire the named lock + re-verify Approved (F2) — it adds no
command and no ERP call.

## 2. Design (why this is race-safe without the cancel machinery)

The double-count needs: *PMO `Draft` while ERPNext holds a live Timesheet.* Slice A makes that
structurally unreachable for the un-pushed case:

- **Re-open side** (`transition_timesheet` `Approved→Draft` arm): under the named lock, refuse if a live
  mirror doc OR any non-terminal outbox row exists; else atomic `Approved→Draft`. Refusing on `pending`
  (not just `committing`) closes Luna f2.
- **Push side** (the one residual race — a *sync* push that passed its gate read but has not yet inserted,
  concurrent with the re-open): the timesheet push **insert** acquires the **same** named lock and
  re-verifies `status='Approved'`; if the re-open flipped it to `Draft`, the insert **raises** `P0001
  'timesheet-no-longer-approved'` **before inserting** → no orphan row, no POST, no loop (the dispatch's
  `insertOutboxPending` catch rethrows non-`23505`). Whichever side wins the lock, the other sees its
  effect: insert-wins ⇒ re-open sees `pending` ⇒ refuses; re-open-wins ⇒ insert sees `Draft` ⇒ raises.
- **Sweep side (no change):** the sweep already re-checks status per candidate via
  `assertApprovedForPush` → `approved_timesheet_for_push` (`erpnext-sweep/timesheetBackstop.ts:128`,
  comment line 130: *"no longer Approved … intended refusal"*). A re-opened (`Draft`) sheet's stale
  `failed` push is therefore never re-driven. ✓ No retire logic needed in Slice A (the spec's
  FR-TSC-009 retire-`pending` is deferred — Slice A fails closed on `pending` instead, per F2).

**`failed` is terminal for `external_command_outbox_one_inflight_per_record`** (0134's non-terminal set is
`pending,committing,committed,quarantined,held` — `failed` is excluded), so a stale `failed` row never
wedges the next approval's `ts:<id>:t2` push. ✓

## 3. Schema — migration `0151_timesheet_reopen_unpushed.sql` (ONE migration)

Path: `supabase/migrations/0151_timesheet_reopen_unpushed.sql`. Reversible: `create or replace
transition_timesheet` with the `0007` body + `drop function insert_timesheet_outbox_pending`. No PMO data
lost; no new table; no new column (F4: Slice B adds the `timesheet_correction_intent` table +
`cancel_origin` — not this plan).

**(A) `create or replace function transition_timesheet(...)`** — three additive changes inside the
existing security-definer body; everything else byte-for-byte (NFR-TSC-REG-001):

1. **Map (FR-TSC-001):** `'Approved', jsonb_build_array('Draft')` (was `jsonb_build_array()`).
2. **Authz arm (FR-TSC-020/021)** — inserted **immediately before** the existing `elsif p_to = 'Draft'`
   arm; narrow that existing arm's guard to `and v_from = 'Rejected'` (owner-only body unchanged):
   ```sql
   elsif p_to = 'Draft' and v_from = 'Approved' then
     -- SoD FIRST (owner can never re-open their own approved sheet) — mirrors the approve arm ordering.
     if v_uid = v_owner then
       raise exception 'separation of duties: cannot re-open own approved timesheet' using errcode = '42501';
     end if;
     if not (v_uid is not distinct from v_mgr
             or (v_mgr is null and v_role in ('Admin','Executive'))
             or v_role = 'Admin') then
       raise exception 'not authorized' using errcode = '42501';
     end if;
     -- FENCE 2 (FR-TSC-008/010, scoped): serialize against a concurrent push insert.
     perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_timesheet_id::text, 0));
     -- Refuse if ERP may hold a LIVE document (Luna f1, mirror side).
     if exists (select 1 from public.timesheet_erp_mirror m
                 where m.timesheet_id = p_timesheet_id
                   and m.ts_number is not null and m.erp_cancelled_at is null) then
       raise exception 'reopen-erp-document-held' using errcode = 'P0001';
     end if;
     -- Refuse if ANY non-terminal outbox row exists — the after-commit-before-mirror seam (committed)
     -- AND a bare pending (Luna f1/f2). failed/confirmed are terminal ⇒ do not block.
     if exists (select 1 from public.external_command_outbox o
                 where o.org_id = v_org and o.domain = 'timesheets'
                   and o.pmo_record_id = p_timesheet_id::text
                   and o.state in ('pending','committing','committed','quarantined','held')) then
       raise exception 'reopen-push-in-flight' using errcode = 'P0001';
     end if;
     -- ⛔ SLICE B SEAM: the cancel-confirmed ADMIT branch (FR-TSC-008 full) lands HERE — when a
     -- generation-specific correction intent is consumed + its cancel outbox confirmed + mirror
     -- tombstoned, a PUSHED sheet may flip. Slice A admits ONLY the un-pushed case; a pushed sheet is
     -- refused (Slice B's entry point). Do NOT widen without the intent table + cancel machinery.
   ```
   The bottom atomic `update … set status=p_to …` already handles `p_to='Draft'` (stamps left as-is,
   OD-TS-4-A) — unchanged.

**(B) `create function insert_timesheet_outbox_pending(...)`** — the F2 push-side guard. SECURITY DEFINER,
`set search_path = public`. Same insert columns as the generic path (`moneyOutboxDeps.ts:insertOutboxPending`):
```sql
create function public.insert_timesheet_outbox_pending(
  p_org uuid, p_domain text, p_record_id text, p_key text, p_tier text, p_operation text,
  p_payload jsonb, p_digest text, p_actor uuid
) returns public.external_command_outbox
  language plpgsql security definer set search_path = public as $$
declare v_status timesheet_status; v_row public.external_command_outbox;
begin
  -- FENCE 2: serialize the push INSERT against a concurrent re-open (same named lock as the
  -- Approved→Draft arm) and re-verify Approved. A re-open that flipped the sheet to Draft between the
  -- dispatch gate read and this insert MUST NOT create an ERP document — raise BEFORE inserting
  -- (no orphan row ⇒ no wedge, no POST, no reconcile loop; the dispatch rethrows non-23505).
  perform pg_advisory_xact_lock(hashtextextended('ts-correct:' || p_record_id, 0));
  select status into v_status from public.timesheets where id = p_record_id::uuid;
  if v_status is distinct from 'Approved' then
    raise exception 'timesheet-no-longer-approved' using errcode = 'P0001';
  end if;
  insert into public.external_command_outbox
    (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state,
     payload, payload_digest, actor_user_id)
  values (p_org, p_domain, p_record_id, p_key, p_tier, p_operation, 'pending',
          p_payload, p_digest, p_actor)
  returning * into v_row;
  return v_row;
end; $$;
revoke all on function insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid) from public, anon;
grant  execute on function insert_timesheet_outbox_pending(uuid,text,text,text,text,text,jsonb,text,uuid) to authenticated, service_role;
```

## 4. Task list (TDD, dependency order, 2–5 min each)

> **DB inner loop / gate (binding):** every DB-driving command is chained inside ONE lock hold —
> `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` (run from the **repo root**).
> **FE inner loop:** `cd pmo-portal && npm test -- <file>` · `npm run typecheck`.
> **Pre-push gate (binding):** `cd pmo-portal && npm run verify` **and** the chained DB command above.

**T1 — pgTAP RED, authority + map (AC-TSC-020/021).** Write
`supabase/tests/0151_timesheet_reopen_authority.test.sql`: independent `Approved` fixture per actor (the
r1 NOTE fix). Assert: (a) `Approved→Draft` legal & flips; (b) line-manager M (Engineer-role) admitted;
(c) Admin A admitted; (d) owner U → `42501`; (e) bystander B → `42501`; (f) Admin break-glass cannot
re-open OWN sheet (`42501`, SoD-ordered); (g) `Rejected→Draft` stays owner-only (re-run the `0025` SoD
shape for the Rejected arm); (h) no status outside `{Draft,Submitted,Approved,Rejected}`; (i) the
`Submitted→Approved/Rejected` arms are byte-for-byte (re-assert `approved_by`/`approved_at` stamps).
Verify: chained DB reset+test → **fails** (no `Approved→Draft` edge / arm yet).

**T2 — pgTAP RED, precondition (AC-TSC-R1 ≈ scoped AC-TSC-008/009/010/012).** Write
`supabase/tests/0151_timesheet_reopen_precondition.test.sql`. Fixtures (each its own `Approved` sheet,
approver M): (a) mirror `ts_number` set + `erp_cancelled_at` null → `P0001 'reopen-erp-document-held'`,
sheet stays `Approved`; (b) NO mirror row but a `committed` outbox row (`external_record_id` set, the
after-commit-before-mirror seam, Luna f1) → `P0001 'reopen-push-in-flight'`; (c) a bare `pending` outbox
row, no mirror (Luna f2) → `P0001 'reopen-push-in-flight'`; (d) a `quarantined`/`held` row → refuse; (e)
a `failed` outbox row + no mirror (push rejected, no doc) → ADMITS, flips to `Draft` (AC-TSC-012); (f)
no mirror + no outbox row (un-pushed, non-ERPNext org) → ADMITS, flips, no stamp churn. Verify: chained
reset+test → **fails** (arm not present).

**T3 — pgTAP RED, push-insert guard (AC-TSC-R2).** Write
`supabase/tests/0151_timesheet_push_insert_recheck.test.sql`: (a) `insert_timesheet_outbox_pending(...)`
on an `Approved` sheet → returns the `pending` row; (b) same on a `Draft` sheet → raises `P0001
'timesheet-no-longer-approved'`, **no** row inserted; (c) on `Submitted` → raises; (d) after a successful
insert, `transition_timesheet(sheet,'Draft')` from the approver → `P0001 'reopen-push-in-flight'` (the
re-open sees the `pending` row — proves the two sides observe each other under the lock). Verify: chained
reset+test → **fails** (RPC absent).

**T4 — Migration 0151 (GREEN for T1–T3).** Create `supabase/migrations/0151_timesheet_reopen_unpushed.sql`
with §3 (A) + (B). Verify: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'` →
T1/T2/T3 **green**, and the existing `0021`–`0026` transition battery stays green (byte-for-byte).

**T5 — Wire the timesheet push insert through the guard.** Edit
`supabase/functions/adapter-dispatch/moneyOutboxDeps.ts` `insertOutboxPending`: branch on
`domain === 'timesheets'` → `serviceClient.rpc('insert_timesheet_outbox_pending', { p_org: orgId,
p_domain: domain, p_record_id: pmoRecordId, p_key: idempotencyKey, p_tier: externalTier, p_operation:
operation, p_payload: opts.payload ?? null, p_digest: opts.payloadDigest ?? null, p_actor:
opts.actorUserId ?? null }).single()` then `mapRow`; on error preserve `error.code` (same shape as the
generic insert). Non-timesheets domains: byte-for-byte unchanged. Verify: `cd supabase/functions &&
deno test --allow-env adapter-dispatch/moneyOutboxDeps.test.ts` (existing push tests stay green); `cd
pmo-portal && npm run typecheck`. *(No `dispatch.ts` change — the branch lives in the dep, covering both
the sync `pushAfterApprove` path and any dep-consuming caller.)*

**T6 — FE DAL RED (AC-TSC-012, "no ERP call").** Write
`pmo-portal/src/lib/db/timesheetTransition.reopenApproved.test.ts`: mock `supabase.rpc`; assert
`reopenApprovedTimesheet(id)` calls `rpc('transition_timesheet', { p_timesheet_id: id, p_to: 'Draft' })`
and issues **no** adapter/push/repositories call. Verify: `cd pmo-portal && npm test -- src/lib/db/timesheetTransition.reopenApproved.test.ts` → **fails** (fn absent).

**T7 — FE DAL GREEN + map mirror.** Edit `pmo-portal/src/lib/db/timesheetTransition.ts`: (a) extend
`LEGAL_TIMESHEET_TRANSITIONS.Approved` to `['Draft']`; (b) add `reopen: status === 'Approved' &&
isApprover && !isOwner` to `timesheetActions(...)`; (c) add `reopenApprovedTimesheet(id)` (calls
`transition_timesheet(id,'Draft')` — `org_id` never sent); (d) add `listReopenableApprovedTimesheets(selfId)`
(`.from('timesheets').select('*, owner:profiles!timesheets_user_id_fkey(full_name), entries:timesheet_entries(*,
project:projects(name,code)), mirror:timesheet_erp_mirror!timesheet_erp_mirror_timesheet_id_fkey(ts_number,
push_state, erp_cancelled_at)').eq('status','Approved').neq('user_id', selfId).order('week_start_date',
{ascending:false})` — RLS `timesheets_select` manager-of clause + `timesheet_erp_mirror_select` scope it).
Verify: T6 green; `npm run typecheck`.

**T8 — FE hook + Approvals section RED (AC-TSC-R3, F5 honesty).** Write
`pmo-portal/pages/__tests__/Approvals.reopen.test.tsx` (RTL): a report's `Approved` sheet with **no**
mirror (`ts_number` null) renders a "Re-open for correction" button; clicking it calls
`transition_timesheet('Draft')` and toasts success; a sheet with `mirror.ts_number` set renders the
**honest note** "Already pushed to ERP — correction path coming" and **no** re-open button (not a disabled
button); a `push_state` `pending`/`pushing` sheet renders "Push in progress"; on RPC `P0001
'reopen-erp-document-held'` the toast states the reason. Gate the section behind `canApproveTimesheets`.
Verify: `cd pmo-portal && npm test -- pages/__tests__/Approvals.reopen.test.tsx` → **fails**.

**T9 — FE hook + Approvals section GREEN.** Edit `pmo-portal/src/hooks/useTimesheetApproval.ts`: add
`useReopenableApprovedTimesheets()` (mirror `useTimesheetsAwaitingApproval`) + a `reopenApproved` mutation
(calls `reopenApprovedTimesheet`, invalidates `awaitingApprovalKey` + `ownTimesheetsKey`). Edit
`pmo-portal/pages/Approvals.tsx`: add a `ReopenableApprovedSection` (sibling of `PushAttentionSection`,
DESIGN.md tokens) rendering when `canApproveTimesheets && data?.length`; per-row affordance per T8. Classify
RPC errors (`reopen-erp-document-held` / `reopen-push-in-flight`) to an honest toast. Verify: T8 green.

**T10 — Pre-push gate (binding).** From repo root:
`scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db'`; then `cd pmo-portal && npm run
verify`. Both must be green before PR. (Full suite, not just touched files — `CLAUDE.md` binding.)

## 5. Slice B seams (where Slice B extends — F4)

1. **`transition_timesheet` `Approved→Draft` arm:** add the **cancel-confirmed ADMIT branch** (FR-TSC-008
   full) at the marked `⛔ SLICE B SEAM`: intent `consumed` + cancel outbox `confirmed` + mirror
   tombstoned ⇒ a **pushed** sheet may flip. Slice A's two refuse checks STAY (they remain the fail-closed
   default for any non-cancel-confirmed state).
2. **`timesheet_correction_intent` table + `reopen_approved_timesheet` RPC** (spec §4.1/§4.2): the
   two-system orchestration (authority → retire-pending → create-intent → enqueue-cancel). Slice A's FE
   `reopenApprovedTimesheet` DAL fn is the stable call site Slice B rewires from `transition_timesheet` to
   `reopen_approved_timesheet`.
3. **`cancel_origin` column on `timesheet_erp_mirror`** (spec §4.3) + `external_ref_lineage` cancellation
   uniqueness + `caused_by` (spec §4.4). None added by Slice A.
4. **The `pending`-retire logic (FR-TSC-009 full):** Slice A **fails closed** on `pending` (refuses). If
   user-friendliness demands retiring a stuck `pending`, Slice B adds the atomic retire-to-terminal — Slice
   A's refuse is the safe default and does not block that.
5. **Served gate intent-branch (FR-TSC-007):** Slice A adds no dispatch command, so `isTimesheetPush` is
   untouched. Slice B branches cancel on an open correction intent there.

## 6. OUT OF SCOPE — Slice B (do NOT build; if a task drifts here, stop)

The entire **`tsc:` cancel operation** and its machinery: the `timesheet_correction_intent` table; the
`reopen_approved_timesheet` / `confirm_timesheet_cancel` / `complete_timesheet_reopen` RPCs; the
operation-aware cancel finalizer; the correction-cancel reconcile pass; the cancel-specific recovery probe;
server-side target resolution + the timesheet-cancel adapter path; the `cancel_origin` discriminator;
`external_ref_lineage` cancellation uniqueness + `caused_by`; atomic origin CAS; the desk-vs-PMO cancel
interleave; surface-honesty for a *pending cancel* (FR-TSC-070 — Slice A has no pending-cancel state); the
re-push-as-new-document path (FR-TSC-050/051); the Approved-terminal sweep rewrites (spec §13 sites 1–8).
All spike-gated served-fn e2e (AC-TSC-011/041/082) and every ERP-list oracle assertion are Slice B.

## 7. Traceability (ADR-0010 — one owning layer per AC)

| AC | Requirement(s) | Owning layer | Proof file |
|---|---|---|---|
| AC-TSC-021 | FR-TSC-001, NFR-TSC-REG-001 (map + 4 states + byte-for-byte) | **pgTAP** | `supabase/tests/0151_timesheet_reopen_authority.test.sql` |
| AC-TSC-020 | FR-TSC-020/021 (approver admits; owner/bystander 42501; SoD-ordered) | **pgTAP** | `supabase/tests/0151_timesheet_reopen_authority.test.sql` |
| AC-TSC-R1 | FR-TSC-008/009/010, scoped (race-safe "no confirmed ERP document" precondition; named lock) | **pgTAP** | `supabase/tests/0151_timesheet_reopen_precondition.test.sql` |
| AC-TSC-R2 | FENCE 2 push-side (sync push insert re-verifies Approved under the named lock; refuses on Draft) | **pgTAP** | `supabase/tests/0151_timesheet_push_insert_recheck.test.sql` |
| AC-TSC-012 | FR-TSC-060 (un-pushed re-opens; no ERP call, no intent, no failure) | **pgTAP** (flip) + **Vitest** (DAL issues no ERP I/O) | precondition file (e) + `pmo-portal/src/lib/db/timesheetTransition.reopenApproved.test.ts` |
| AC-TSC-010 | FR-TSC-010/011, scoped (live doc blocks re-open; sheet stays Approved) | **pgTAP** | `supabase/tests/0151_timesheet_reopen_precondition.test.sql` (a) |
| AC-TSC-R3 | FENCE 5 UI (re-open for un-pushed; honest note for pushed; gated by `can()`) | **Vitest RTL** | `pmo-portal/pages/__tests__/Approvals.reopen.test.tsx` |

> The spec's served-fn e2e HTTP-oracle ACs (AC-TSC-007/008-full/009-full/011/032/040/042/052/053/054/070/
> 080/082/091) are **Slice B**. Slice A's "no ERP call" is structural (the re-open RPC does no ERP I/O),
> proven at the DB (the transition) + DAL (Vitest); the served-boundary HTTP assertion is trivially true
> here and owned by Slice B.

## 8. Self-verification

- ✅ Every task has an exact path + exact verify command (T1–T10).
- ✅ No task performs ERP I/O: the re-open is `transition_timesheet` only; the lone dispatch-path change
  (T5) adds a lock + status re-check to the **existing** push insert — no new command, no outbox row from
  the re-open, no cancel. (F3.)
- ✅ The race-safe precondition (FENCE 2) has its own task (T2) and its own pgTAP proof
  (`0151_timesheet_reopen_precondition.test.sql`): live-doc refuse, the after-commit-before-mirror
  `committed` seam refuse, the bare-`pending` refuse, and the un-pushed admit. The push-side serialization
  has its own task (T3) + pgTAP proof (`0151_timesheet_push_insert_recheck.test.sql`), and T3(d) proves
  the two sides observe each other under the named lock. (F2.)
- ✅ Slice B seams are listed (§5): the `Approved→Draft` cancel-confirmed admit branch, the intent table +
  `reopen_approved_timesheet` RPC, `cancel_origin`, lineage uniqueness, the pending-retire, and the served
  intent-branch — all extension points, none migrated away. (F4.)
- ✅ Authority is the approver population + Admin, never the owner, RPC-enforced + pgTAP-proven (T1/T4, F1).
- ✅ One migration (`0151`); 0152 unused; 0153/0154 untouched.
