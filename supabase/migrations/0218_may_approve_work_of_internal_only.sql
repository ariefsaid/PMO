-- 0218_may_approve_work_of_internal_only.sql — #612 item 4 (isolation-probe follow-up to #490).
-- may_approve_work_of(approver, author) is a SECURITY DEFINER predicate that reads two profiles and
-- answers "is approver the author's line manager or outranks them". 0178 granted it to authenticated
-- and anon; 0210 §2 revoked anon. With the authenticated grant any signed-in user could ask it about any
-- two profile ids and learn whether a manager relation / rank order exists between them — across orgs
-- (the body's `approver.org_id = author.org_id` join only makes a cross-org pair FALSE; the caller's own org is
-- never consulted, so the answer is still an answer). No policy, trigger
-- or view calls it; its only callers are transition_project and transition_work_order, themselves
-- SECURITY DEFINER (owner postgres), so no client role needs EXECUTE. The sibling assert_org_destroyable
-- lost its member grant the same way in 0214. Same shape as 0210 §1: service_role keeps it.
--
-- Reversibility (ADR-0006): supabase db reset. Manual rollback:
--   grant execute on function public.may_approve_work_of(uuid, uuid) to authenticated;

revoke execute on function public.may_approve_work_of(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.may_approve_work_of(uuid, uuid) to service_role;
