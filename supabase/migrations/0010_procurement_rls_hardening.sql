-- 0010_procurement_rls_hardening.sql — close the procurement direct-UPDATE SoD bypass (MED follow-up).
-- Same class as MED-TS-2 / MED-PR-1 (both fixed). Forward-only, additive (grant-level only); reversibility
-- contract is `supabase db reset` (pre-production, ADR-0006). No new ADR: a direct application of the
-- proven MED-PR-1 column-lockdown shape (0008_project_revenue.sql A6) to the procurement aggregate.
--
-- VULNERABILITY: procurements_update (0002_rls.sql) is a coarse row-level `for all` gate (org + 4-role,
-- WITH CHECK only). It lets a trusted 4-role insider directly
--   update procurements set status='Paid', approved_by_id=self, pr_number='PR-…', …
-- bypassing transition_procurement (0006) — its legal-map (P0001), its role×transition matrix, and its
-- separation-of-duties checks (42501). The transition RPC is meant to be the SOLE authority for the
-- state-machine columns. Likewise the doc-number columns are minted only by the creation/transition RPCs.
--
-- Postgres semantics (the MED-PR-1 lesson): Supabase's bootstrap grants a TABLE-level UPDATE to
-- `authenticated`, which covers ALL columns and is NOT reduced by a column-level REVOKE (that is a NO-OP).
-- So we must (1) revoke the table-wide UPDATE, then (2) re-grant UPDATE only on the columns that stay
-- client-writable. The omitted columns thus become writable ONLY by the security-definer RPCs (which run
-- as the function owner and so retain write after this revoke — confirmed: transition_procurement /
-- create_procurement_quotation / _receipt / _invoice are unaffected).

-- ============================================================================
-- procurements: lock the 6 state-machine columns to transition_procurement (0006).
-- State columns (status, pr_number, po_number, approved_by_id, approval_notes, rejection_notes) are
-- RPC-only (transition_procurement authority); direct UPDATE revoked to preserve the legal-map + the
-- role×transition matrix + SoD. The remaining columns stay client-updatable for legit Draft edits
-- (title, total_value, vendor_id, project_id, requested_by_id, code, created_at, org_id, updated_at, id).
-- (auditor option b; FR-PROC-001..009, ADR-0011/0012)
-- ============================================================================
revoke update on procurements from authenticated;
grant  update (id, org_id, code, title, project_id, requested_by_id, total_value, vendor_id,
               created_at, updated_at)
  on procurements to authenticated;

-- ============================================================================
-- Children (defense-in-depth — lower stakes; the minter RPC is the real authority): the doc-number
-- columns are minted ONLY by create_procurement_quotation / _receipt / _invoice (0006). Lock them so a
-- 4-role insider cannot direct-`update … set vq_number/gr_number/vi_number=…` and forge a doc number.
-- Revoke the table-wide UPDATE, then re-grant the non-number columns.
-- ============================================================================
-- procurement_quotations: vq_number is minter-only.
revoke update on procurement_quotations from authenticated;
grant  update (id, org_id, procurement_id, vendor_id, reference, total_amount, received_date,
               is_selected, file_url)
  on procurement_quotations to authenticated;

-- procurement_receipts: gr_number is minter-only.
revoke update on procurement_receipts from authenticated;
grant  update (id, org_id, procurement_id, receipt_date, status, created_at)
  on procurement_receipts to authenticated;

-- procurement_invoices: vi_number is minter-only.
revoke update on procurement_invoices from authenticated;
grant  update (id, org_id, procurement_id, invoice_date, status, created_at)
  on procurement_invoices to authenticated;
