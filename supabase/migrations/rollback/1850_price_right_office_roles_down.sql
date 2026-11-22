-- rollback/1850_price_right_office_roles_down.sql: removes exactly the 11 rows 1850 added.
delete from public.built_in_role_capabilities
 where capability = 'sees_prices'
   and role_key in ('project_administrator','engineer','planner','quantity_surveyor','material_coordinator','storekeeper',
                    'site_supervisor','quality_inspector','safety_officer','equipment_officer','hr_officer');
