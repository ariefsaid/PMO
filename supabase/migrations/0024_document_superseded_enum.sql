-- 0024_document_superseded_enum.sql — Add 'Superseded' to doc_status enum.
-- Reversibility (pre-prod): `supabase db reset`.
-- (enum/value rollback requires recreating the enum — additive-only pre-prod)

alter type doc_status add value 'Superseded' after 'Closed';
