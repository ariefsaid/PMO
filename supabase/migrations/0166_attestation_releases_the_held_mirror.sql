-- 0159_attestation_releases_the_held_mirror.sql — let the attestation say the WHOLE thing it is
-- asserting, so the fence's escape hatch actually opens (Luna FU-1a round-12 SHOULD-FIX 2, reproduced
-- against the migrated DB).
--
-- ⚑ THE DEFECT: THE FENCE WORKS, ITS ESCAPE HATCH DOES NOT. 0157 §4 refuses the re-open on THREE
-- independent predicates — a live ERP document, the unknown-outcome WITNESS, and the mirror's own
-- `push_state = 'held'`. `attest_timesheet_no_erp_document` (0157 §5) cleared the WITNESS only, so after
-- a SUCCESSFUL attestation the re-open still refused with the IDENTICAL error code, and no operator
-- action left could clear the third:
--   • `release_outbox_hold` refuses a non-`held` OUTBOX row (0152:79-81), and BOTH producers of this
--     mirror state leave the outbox terminal or absent —
--       (a) 0158's lost-CAS door: `mark_outbox_held` stamps the witness and INSERTs the mirror
--           `push_state='held'` unconditionally (`0158:136-138`), including when its own CAS returned 0;
--           the winning claimant then terminal-fails the outbox on a path with no mirror recorder;
--       (b) the pre-existing sweep park `parkTimesheetMirrorRow(row,'held',
--           'timesheet-push-attempts-exhausted')` (`erpnext-sweep/index.ts:1613`), whose outbox row is by
--           definition NOT `held`;
--   • a `held` mirror is excluded from the sweep's pass-6 queue and pass 1 skips the timesheets domain;
--   • this function touched only the witness, by design.
-- So the operator who did the one thing the product tells them to do got the same refusal back, and
-- their only remaining in-product act (Retry) re-POSTs the original hours — the one act that can
-- permanently foreclose the correction by minting the ERP document Slice A refuses on.
--
-- ── THE FIX: THE SAME STATEMENT, NOT A NEW AUTHORITY ────────────────────────────────────────────────
-- An operator who has just certified "ERPNext holds no Timesheet for this week" has certified EXACTLY
-- the fact that makes `failed` honest and re-drivable. So the attestation's UPDATE also CASes
-- `held → failed` on the mirror — the same transition `release_outbox_hold` already performs on that
-- column (0152 §A), reached by the operator act that has actually established the ERP fact.
--
-- ⚑ AND IT IS DELIBERATELY NARROW, in three ways:
--   1. `held → failed` ONLY (`case … else push_state end`). A `pushed` row is a real ERPNext Timesheet
--      and its history is never rewritten — reachable here only when the document is TOMBSTONED
--      (`erp_cancelled_at` set, which 0157 §2 rule 1 deliberately does not treat as an answer).
--   2. it moves NO outbox row. The two questions 0157 exists to separate stay separate: this answers
--      "does ERPNext hold a document?", `release_outbox_hold` answers "can the backstop retry this?".
--      A still-`held` outbox command therefore keeps refusing the re-open on its own predicate — the
--      fence is not weakened, only the mirror half the operator has actually spoken to is lifted.
--   3. the gate is UNCHANGED and stays where it was: Admin-only, org-re-asserted, active-membership,
--      reason-required, row-locked, audited. Nothing about WHO may attest moves.
--
-- Everything else is byte-for-byte with 0157 §5. `mark_outbox_held`'s unconditional stamp is left as it
-- is: the witness is right to be unconditional (0158's header argues that correctly), and the belt-and-
-- braces alternative of writing `failed` on a lost CAS would only narrow one of the two producers while
-- leaving the sweep park — i.e. it fixes a door, not the missing route out.
--
-- Reversibility (ADR-0006, unreleased): re-apply the 0157 §5 body of
-- `public.attest_timesheet_no_erp_document`. No table, column, ACL or data change — the 0157 grants
-- apply to this same signature and are deliberately restated below only because `create or replace`
-- keeps them (they are re-stated for the same reason 0157 did: this file must be readable alone).

create or replace function public.attest_timesheet_no_erp_document(p_timesheet_id uuid, p_reason text)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_org     uuid;
  v_actor   uuid := auth.uid();
  v_witness timestamptz;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'an attestation must state what was checked in ERPNext' using errcode = 'P0001';
  end if;

  select t.org_id into v_org from public.timesheets t where t.id = p_timesheet_id;
  if v_org is null then
    raise exception 'timesheet not found' using errcode = 'P0002';
  end if;
  -- Org + Admin + active-membership re-assertion — MUST STAY (DEFINER bypasses RLS and this is
  -- directly reachable by any authenticated caller). Same gate as `release_outbox_hold` (0152 §A).
  if v_org is distinct from public.auth_org_id()
     or public.auth_role() is distinct from 'Admin'
     or not public.is_active_member() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  -- Lock + re-read the row: an attestation races the dispatch's own recorder, and the loser must see
  -- the committed truth rather than clear a witness that was stamped after it looked.
  select m.post_submit_unknown_at into v_witness
    from public.timesheet_erp_mirror m
   where m.timesheet_id = p_timesheet_id and m.org_id = v_org
   for update;
  if v_witness is null then
    raise exception 'timesheet has no unknown ERP outcome to attest' using errcode = 'P0001';
  end if;

  -- The §2 trigger's one escape, scoped to THIS timesheet and THIS transaction (`is_local => true`).
  perform set_config('pmo.attested_no_erp_timesheet', p_timesheet_id::text, true);
  update public.timesheet_erp_mirror m
     set post_submit_unknown_at = null,
         -- ⚑ ROUND-12 SHOULD-FIX 2 — the third predicate, cleared by the same certified fact. Without
         -- this the re-open refused with the identical code after a successful attestation and NO
         -- operator action could reach the state (see the header). `failed` is the mirror state the
         -- backstop re-queues, so this restores the recovery route exactly as a release would — and
         -- `else push_state end` keeps a real (or tombstoned) ERP document's history untouched.
         push_state = case when m.push_state = 'held' then 'failed' else m.push_state end,
         -- ⚑ AND IT IS NOW CODE-SHAPED (round-12 MINOR 3, same surface). A `failed` mirror row is
         -- listed by the "ERP pushes needing attention" queue, which runs every `push_error` through
         -- `pushErrorCopy`'s `<code>: <detail>` split. The previous prose ("operator attested (uuid):
         -- …") classified as the token `operator`, so the row an operator reached by doing exactly what
         -- the product asked read back "The push failed for a reason this screen could not be
         -- classified". The actor + reason stay here for ops (and in `log_audit` as the record of
         -- authority); the surface renders only the classified sentence.
         push_error = 'operator-attested-no-erp-document: by ' || v_actor::text || ' — ' || p_reason
   where m.timesheet_id = p_timesheet_id and m.org_id = v_org;
  perform set_config('pmo.attested_no_erp_timesheet', '', true);

  perform public.log_audit(
    'attest_timesheet_no_erp_document',
    v_org,
    v_actor,
    p_timesheet_id,
    jsonb_build_object('reason', p_reason, 'unknown_since', v_witness)
  );
end $$;

revoke all     on function public.attest_timesheet_no_erp_document(uuid, text) from public;
grant  execute on function public.attest_timesheet_no_erp_document(uuid, text) to   authenticated;
revoke execute on function public.attest_timesheet_no_erp_document(uuid, text) from anon;
