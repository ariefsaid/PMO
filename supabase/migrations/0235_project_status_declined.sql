-- 0235_project_status_declined.sql — #774: a "Declined" terminal pre-award outcome (declined to bid /
-- withdrew), distinct from 'Loss Tender'. Enum value ONLY: ALTER TYPE ... ADD VALUE cannot be used
-- in the transaction that adds it, so every statement that names 'Declined' lives in 0236.
-- Reversibility: Postgres cannot drop an enum value; see rollback/0235_project_status_declined_down.sql.
alter type project_status add value if not exists 'Declined';
