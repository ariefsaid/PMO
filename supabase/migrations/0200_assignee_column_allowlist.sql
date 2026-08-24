-- 0200_assignee_column_allowlist.sql — #532: invert the tasks column pin from a deny-list to a
-- fail-closed allowlist.
--
-- Behaviour changed, in one sentence: an Engineer assignee may now change ONLY `status` (and
-- `completed_at`, which is not really theirs — see §B). Everything else on `tasks`, including every
-- column added to the table from today onward, is refused.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- THE DEFECT IS THE POLARITY, not the length of the list.
--
-- `enforce_assignee_status_only` (0016 → 0093 → 0140 → 0146 → 0199 §4) enumerates the columns an
-- assignee may NOT change. `tasks` has 17 columns; the assignee branch named 12. The five it did not
-- name were writable by any Engineer assignee, verified by probe as `UPDATE 1` against a `42501`
-- control on `name`:
--
--   milestone_id       point the task at ANOTHER PROJECT's milestone. Every server-side rollup joins
--                      tasks through `milestone_id` and never through `project_id` (0023:68,95 ·
--                      0026:33 · 0033:167 · 0141:42,76 · 0145:42,77), so this MOVES a project's
--                      delivery percentage from outside that project. Nothing requires the milestone
--                      to belong to the task's own project — see the open note at the end of §D.
--   tombstoned_at      hide the row from every DAL read and from the agent.
--   source_updated_at  freeze future ClickUp mirror updates for that task.
--   completed_at       escapes the pin, but is neutralised downstream (§B).
--   status             the one the pin exists to permit.
--
-- A deny-list fails OPEN on every future column, so this recurs each time `tasks` grows — it already
-- recurred three times. Both branches are therefore rewritten as a whole-row jsonb diff over a named
-- allowlist: a column nobody has thought about is refused, and admitting one is a deliberate edit
-- here. 0193's `work_orders` freeze took the same whole-body approach.
--
-- Reversibility (pre-production, ADR-0006): `supabase db reset`. Manual reverse: re-run 0199 §4's
-- `enforce_assignee_status_only` body verbatim.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ── §A — the two allowlists ─────────────────────────────────────────────────────────────────────
--
-- EXTERNALLY-OWNED branch: UNCHANGED behaviour, restated. 0199 §4 named 13 columns as read-only
-- while ClickUp owns the domain; the allowlist is the complement of that list, derived by reading it
-- rather than by deciding afresh — {milestone_id, completed_at, tombstoned_at, source_updated_at},
-- the mirror-metadata and PMO-enhancement columns. `tasks_external_owned_rls.test.sql` asserts the
-- manager milestone-only write (AC-CUA-021) and this migration must not disturb it.
--
-- ASSIGNEE branch: {status, completed_at}. `status` is the entire point of the trigger.
--
-- ── §B — why `completed_at` is in the assignee allowlist ────────────────────────────────────────
--
-- Because it is not client-writable regardless, and leaving it OUT would refuse a legitimate write.
-- Verified two ways rather than assumed:
--
--   (1) `stamp_task_completed_at` (0199 §4) reassigns `new.completed_at` on EVERY branch of its
--       body — from `status` on a Done transition, from `old.completed_at` otherwise. The only path
--       that returns without reassigning is the service-role + externally-owned early return, which
--       is not the assignee path.
--
--   (2) FIRING ORDER, read from `pg_trigger` rather than inferred from the migration text.
--       PostgreSQL fires BEFORE ROW triggers in trigger-NAME order:
--
--         tasks_assignee_status_only       enforce_assignee_status_only     BEFORE UPDATE  ← 1st
--         tasks_check_parent_same_project  check_tasks_parent_same_project  BEFORE UPDATE  ← 2nd
--         trg_stamp_task_completed_at      stamp_task_completed_at          BEFORE UPDATE  ← 3rd
--
--       The pin runs FIRST. So the stamp has not yet corrected anything when the pin looks at NEW: a
--       client that puts `completed_at` in its payload reaches the pin with a genuinely changed
--       value, and a pin that denied it would reject the write outright instead of ignoring it.
--       That ordering is exactly why the column must be allowed at the pin and controlled at the
--       stamp. `assignee_column_allowlist` oracles in first_class_tasks.test.sql pin both halves.
--
-- ── §C — THE SERVER-AUTHORITY EXEMPTION, and why it is not DD-WO-8's rejected one ───────────────
--
-- Without it this change cannot ship. The write-role early return tests
-- `auth_role() in ('Admin','Executive','Project Manager','Finance')`, and `auth_role()` reads
-- `profiles.role` for `auth.uid()`. A server-side writer with no request JWT — `seed.sql`, a
-- migration, a pgTAP fixture — answers NULL, fails that test, and falls THROUGH to the assignee
-- branch. Today that is survivable only because `milestone_id` is one of the columns escaping the
-- deny-list; the moment it is pinned, `seed.sql`'s sixteen `update tasks set milestone_id` statements
-- fail. #525 tried exactly that and reverted it.
--
-- The gate is `auth.uid() is null` — "there is no authenticated portal caller". Chosen over
-- `auth_role() is null` because it is the NARROWER of the two: a caller who presents a JWT but has no
-- `profiles` row (offboarded and hard-deleted, or a forged sub) answers NULL from `auth_role()` and
-- would be exempted by it, but answers a uuid from `auth.uid()` and stays pinned. Both answer NULL
-- for the writers we actually need to exempt, so nothing is lost by taking the tighter one.
--
-- ⚑ VERIFIED BY PROBE, because the whole exemption rests on this and it is the opposite of the
-- intuition that a definer runs "as the owner". `auth.uid()` resolves from the `request.jwt.claims`
-- GUC, which is transaction-local and NOT part of the executing DB role, so it survives into a
-- SECURITY DEFINER function:
--
--     set local role authenticated;
--     set local request.jwt.claims = '{"sub":"…e1","role":"authenticated"}';   -- an Engineer
--                              current_user   auth.uid()   auth_role()
--     outside (invoker)        authenticated  …e1          Engineer
--     inside SECURITY DEFINER  postgres       …e1          Engineer      ← claims survive
--     no JWT at all            postgres       <null>       <null>        ← seed / migration writer
--     '{"role":"service_role"}' (no sub)      <null>       <null>
--
-- So a definer RPC invoked by an Engineer still answers 'Engineer' here and is still pinned. This is
-- what makes the exemption materially different from the one DD-WO-8 REFUSED on the work-order
-- freeze: `actor_bypasses_rls()` keys on the executing DB ROLE, which a definer RPC changes to the
-- table owner, so exempting it exempts precisely the writer the freeze exists to stop. Keying on the
-- CALLER's identity does not, because a definer cannot launder the caller's identity away.
--
-- WHAT THE EXEMPTION DOES ADMIT, stated plainly: a `service_role` write (role claim, no `sub`) to a
-- NOT-externally-owned project may now change any task column. Today such a write is refused — but
-- refused by ACCIDENT, as a side effect of `auth_role()` being NULL, not by a decision anyone
-- recorded. Accepted, for one reason: `service_role` holds the secret key and carries BYPASSRLS, so
-- it can already `delete` the row and re-`insert` it with any values it likes. The pin was never a
-- control over that writer, only a speed bump, and pretending otherwise would be the security
-- theatre this repo keeps finding. The controls that DO bind service_role are key custody and the
-- edge-function authz layer, neither of which lives in this trigger.
--
-- The reachable surface of `auth.uid() is null` over PostgREST is therefore: `anon` (the anon key is
-- a JWT with a role claim and no sub) — which holds SELECT only on `public.tasks`, no UPDATE grant,
-- asserted by its own oracle so a future grant sweep cannot quietly widen this; and `service_role`,
-- above. An `authenticated` caller always carries a `sub`.
--
-- ⚑ Note the tension with 0093's own reasoning, quoted at 0098:60-61 — "an explicit service_role JWT
-- claim, not a bare null check". That rule is kept where 0093 put it (the externally-owned branch's
-- early return, untouched below). The null check is added ONLY on the assignee branch, where the
-- alternative is not "a stricter check" but a deny-list that fails open forever.
--
-- ── §D — the bodies ─────────────────────────────────────────────────────────────────────────────
create or replace function public.enforce_assignee_status_only()
  returns trigger language plpgsql set search_path = public as $$
declare
  -- §A. Complement of 0199 §4's 13-column externally-owned deny-list. Behaviour-preserving.
  k_external_allowed constant text[] :=
    array['milestone_id','completed_at','tombstoned_at','source_updated_at'];
  -- §A/§B. The assignee's real scope. Every other column — including every column added to `tasks`
  -- after today — is refused without anyone having to remember to add it to a list.
  k_assignee_allowed constant text[] := array['status','completed_at'];
begin
  -- 0093's service-role mirror bypass, unchanged.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
     and public.task_domain_externally_owned(new.project_id) then
    return new;
  end if;

  if public.task_domain_externally_owned(new.project_id) then
    if to_jsonb(new) - k_external_allowed is distinct from to_jsonb(old) - k_external_allowed then
      -- Message byte-preserved from 0093/0140/0146/0199 — asserted verbatim elsewhere.
      raise exception 'task native fields are read-only while tasks are externally-owned'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if auth_role() in ('Admin','Executive','Project Manager','Finance') then
    return new;
  end if;

  -- §C. Server authority: no authenticated portal caller, so there is no assignee to pin. This is
  -- what lets `seed.sql`, migrations and pgTAP fixtures write native fields; without it the write-
  -- role early return above fails for them and they land in the assignee branch.
  if auth.uid() is null then
    return new;
  end if;

  if to_jsonb(new) - k_assignee_allowed is distinct from to_jsonb(old) - k_assignee_allowed then
    -- Message byte-preserved from 0016 onward — first_class_tasks.test.sql matches it verbatim, and
    -- the new oracles match it too, so a DIFFERENT 42501 gate moving in front of this one reddens
    -- them rather than passing them for the wrong reason.
    raise exception 'only the task status may be changed by its assignee' using errcode = '42501';
  end if;
  return new;
end; $$;

comment on function public.enforce_assignee_status_only() is
  '#532: the tasks column pin, as a FAIL-CLOSED ALLOWLIST. Assignee may change {status, '
  'completed_at}; while externally-owned, {milestone_id, completed_at, tombstoned_at, '
  'source_updated_at}. Anything else — including any column added to `tasks` in future — is refused '
  'by a whole-row jsonb diff. The `auth.uid() is null` exemption is server authority (seed, '
  'migrations, service_role); it does NOT exempt a SECURITY DEFINER RPC, because request.jwt.claims '
  'is transaction-local and survives the definer switch (probed, 0200 §C).';

-- ⚑ FOUND WHILE DOING THIS, NOT FIXED HERE, and recorded so it is not re-discovered a fourth time:
-- nothing constrains a task's `milestone_id` to a milestone of the task's OWN `project_id`. §1 of
-- 0199 added `tasks_milestone_needs_project` (a milestone requires SOME project) but not that it be
-- the RIGHT one. A write-role user can therefore still attach a task to another project's milestone
-- and move that project's delivery percentage — this migration closes the ASSIGNEE door onto that
-- harm, not the manager one. Its own ticket; a cross-column FK or a trigger, plus a decision about
-- what should happen to existing rows.
-- → CLOSED by 0202_task_milestone_same_project.sql (#538): a composite FK, MATCH SIMPLE, replacing
--   the single-column one; 0199 §1's CHECK is KEPT because the two cover disjoint halves of the
--   space. The survey found 0 mismatched rows, so nothing had to be repaired or grandfathered.
