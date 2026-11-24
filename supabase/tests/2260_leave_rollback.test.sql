-- Run the shipped 2260 rollback, then re-run 2042's established HR Officer/HR Manager rights proof.
-- The 2042 test is the behavioral oracle for the restored leave-on-behalf grant.
\ir ../migrations/rollback/2260_leave_person_manager_routing_down.sql
\ir 2042_people_team_role_rights.test.sql
