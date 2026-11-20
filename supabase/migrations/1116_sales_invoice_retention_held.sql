-- 1116_sales_invoice_retention_held.sql — #2625 (ADR-0105 §4, docs/specs/billing-stages.spec.md FR-RET-021, AC-RET-005).
-- What is due now on a progress claim's invoice is its outstanding balance less the retention still held. The retention
-- lives on the claim (1022, `claim_retention.held`); the claim's PMO invoice has the claim's id. When that invoice is paired,
-- receivables read the ERP copy, so resolve its paired PMO invoice first. This is the one read every receivable view uses:
-- a PostgREST computed field, `select=*,retention_held`, so no screen re-derives the join.
-- SECURITY INVOKER: it reads claim_retention and the paired PMO row through the caller's own RLS, so a hand-built row
-- argument returns no more than the caller can already read (another org's claim, or a role that cannot read claims, reads 0).
-- Read-only; it moves no money and changes no invoice (the ledger stays the oracle, ADR-0048).
-- Proven by supabase/tests/1116_sales_invoice_retention_held.test.sql.
-- Reverse: supabase/migrations/rollback/1116_sales_invoice_retention_held_down.sql.

create or replace function public.retention_held(p_invoice public.sales_invoices) returns numeric
  language sql stable security invoker set search_path = public, pg_temp as $$
  select coalesce((select greatest(cr.held, 0)
                     from public.claim_retention cr
                    where cr.org_id = p_invoice.org_id
                      and cr.claim_id = coalesce(
                        (select pmo.id from public.sales_invoices pmo
                          where pmo.org_id = p_invoice.org_id
                            and pmo.paired_erp_invoice_id = p_invoice.id),
                        p_invoice.id)), 0)::numeric(18,2)
$$;
comment on function public.retention_held(public.sales_invoices) is
  'The claim''s retention still held on this invoice or its paired ERP copy (1022 claim_retention.held; 0 when none). Owed, not due now (ADR-0105).';
revoke all on function public.retention_held(public.sales_invoices) from public, anon;
grant execute on function public.retention_held(public.sales_invoices) to authenticated, service_role;
