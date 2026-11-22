-- 1850: the price right is held by every job role except Foreman and Field user (spec price-visibility-roles, FR-001/FR-004).
-- The list stays data: one `sees_prices` row per role that holds the right. 1200 gave it to the 12 managers, Buyer, Finance Officer
-- and Billing Officer; this adds the 11 remaining officer roles, leaving only the two light-account roles without a row.
-- Rollback: supabase/migrations/rollback/1850_price_right_office_roles_down.sql
-- role key, capability (ONE tuple per line: the parity test parses this).
insert into public.built_in_role_capabilities (role_key, capability) values
('project_administrator','sees_prices'),
('engineer','sees_prices'),
('planner','sees_prices'),
('quantity_surveyor','sees_prices'),
('material_coordinator','sees_prices'),
('storekeeper','sees_prices'),
('site_supervisor','sees_prices'),
('quality_inspector','sees_prices'),
('safety_officer','sees_prices'),
('equipment_officer','sees_prices'),
('hr_officer','sees_prices');
