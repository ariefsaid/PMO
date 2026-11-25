/** Where a notification's `metadata.entity` leads, shared by the bell and the field account's list (#2887). */
import type { NotificationListItem as NotificationRow } from '@/src/lib/db/notifications';

/** `metadata.entity.type` → the record's base list route. Only types with a
 * routable `/x/:id` detail page are resolvable (App.tsx route table); an
 * unrecognized type falls back to mark-read-only (no navigation). */
const ENTITY_ROUTE_BASE: Record<string, string> = {
  procurement_case: '/procurement',
  incident: '/incidents',
  project: '/projects',
  company: '/companies',
  contact: '/contacts',
  opportunity: '/sales',
  expense_claim: '/expenses',
  sales_invoice: '/sales-invoices',
  material_request: '/material-requests',
  quantity_change_request: '/quantity-changes',
  daily_site_report: '/site-reports',
  subcontract_certificate: '/subcontract-certificates',
  // #2800: an overdue close-out item opens its work order; an overdue clearance item opens that person's checklist.
  work_order: '/work-orders',
  person_clearance: '/administration/clearance',
};

/** Workflow hand-offs (#788) whose destination is a queue/list page with no `/x/:id` detail route:
 * a submitted timesheet opens the approvals page, an assigned task opens My tasks. */
const ENTITY_LIST_ROUTE: Record<string, string> = {
  timesheet: '/timesheets',
  task: '/my-tasks',
  imprest_plan: '/imprest',
  imprest_replenishment: '/imprest',
  expiry_document: '/equipment/expiring',
  equipment_plan: '/equipment-plans',
};

interface NotificationEntity {
  type?: string;
  id?: string;
  label?: string;
}

interface NotificationMetadata {
  entity?: NotificationEntity;
  run_id?: string;
}

export function readMetadata(metadata: NotificationRow['metadata']): NotificationMetadata {
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata as NotificationMetadata;
  }
  return {};
}

export function entityRoute(entity: NotificationEntity | undefined): string | null {
  if (entity?.type && ENTITY_LIST_ROUTE[entity.type]) return ENTITY_LIST_ROUTE[entity.type];
  if (!entity?.type || !entity.id) return null;
  const base = ENTITY_ROUTE_BASE[entity.type];
  return base ? `${base}/${entity.id}` : null;
}


