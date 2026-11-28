# Plan: job role step rights

Spec: `docs/specs/job-role-step-rights.spec.md`. One migration (`2803`), one policy-table edit, two UI gates.

Every grant is held-only (`actor_holds_job_role`): a person with no job role gains nothing, and the access-level lists stay as they were.

| AC | Job role | Database rule changed | Screen gate | Proof (owning layer) |
|---|---|---|---|---|
| AC-RR-001 | engineer | `work_orders_engineer_insert` / `_update` (Draft only; issuing stays in `transition_work_order`) | `workOrder` create/edit | pgTAP `2803_job_role_work_order_rights`; e2e `JOB-RR-engineer-capture` |
| AC-RR-002 | engineer | `rate_catalogue_items_engineer_read`, `rate_catalogue_variants_engineer_read` (rates and stage weights follow their items; price-visibility deny stays) | `rateCatalogue` view | pgTAP work_order_rights |
| AC-RR-003 | engineer | `set_work_order_area_group`, `set_work_order_check_in_area` role lists | `workOrder` create (check-in settings) | pgTAP work_order_rights |
| AC-RR-004 | engineer | `set_work_order_plan` role list + four `work_order_plan_lines_engineer_*` policies | `workOrderPlan` view/manage | pgTAP work_order_rights |
| AC-RR-005 | engineer | `billing_steps_view` capability + five claim read-scope policies (read only) | `progressClaim`, `billingStage` view | pgTAP work_order_rights |
| AC-RR-006 | planner | `check_task_work_order` insert guard, `tasks_planner_update`, link-only branch in `enforce_assignee_status_only`, `task_dependencies_planner_write` | `task` `linkWorkOrder` | pgTAP `2803_job_role_planner`; e2e `JOB-RR-planner-schedule` |
| AC-RR-007 | hr_officer | `attendance_hr_officer_read` | none needed (read) | pgTAP `2803_job_role_attendance_read`; e2e `JOB-RR-attendance-review` |
| AC-RR-008 | project_administrator | `equipment_usage_entries_project_administrator_read` | `equipmentUsage` view; amounts follow `equipmentCosting` | pgTAP `2803_job_role_equipment_read`; unit ProjectEquipmentPanel |
| AC-RR-009 | project_administrator | `scheduled_reports` managed-by value, read policy, save/enable/archive RPCs | `scheduledReport` manage/edit | pgTAP `2803_job_role_scheduled_reports`; e2e `JOB-RR-scheduled-reports` |

Mutation checks: each rule carries a `-- mut:rr_*` marker; breaking it turns its pgTAP file red (results in the slice report).
Rollback: `rollback/2803_job_role_step_rights_down.sql` (applied and re-applied on the spare server).
