/**
 * Every organisation switch and setting group the app has, in one place (#2746). A person who has to find a setting should not
 * need to know which screen it lives on: the "All settings" page and the command palette read this list. The six switches
 * already on the module (`orgSwitches.ts`) point at it with `switch`; the rest are listed here with who may change them and
 * the route where they are set, and move onto the module when they are next touched.
 *
 * `covers` names what each entry owns in the code: its setting hook, its `*_settings` table, its `organizations.<column>`. A unit
 * test derives those names from the hooks, the migrations and the audit trigger, and fails when one has no entry, so a new
 * setting cannot ship unlisted. Names and one-line summaries are in `orgSettingsText.ts` (English and Bahasa).
 *
 * Not listed, on purpose: master data and defaults that are not a switch (tax default, fiscal year start, project number pattern,
 * document and site-report lists, account maps, terminology, role names), and Operator-owned feature entitlements (ADR-0049).
 * A preset such as "contractor" is a list of these keys (`OrgSettingPreset`); none is defined until it is ruled.
 */
import type { Role } from '@/src/auth/AuthContext';
import type { Entity } from '@/src/auth/policy';
import type { OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';

/** The job the setting enables, in the order the page shows them. */
export const ORG_SETTING_GROUPS = ['people', 'site', 'stock', 'purchasing', 'money', 'equipment', 'notifications', 'integrations'] as const;
export type OrgSettingGroup = (typeof ORG_SETTING_GROUPS)[number];

export interface OrgSettingEntry {
  group: OrgSettingGroup;
  /** The roles the server write accepts (the module's `writers` for a migrated switch). */
  writers: readonly Role[];
  /** Where it is changed: a path with an optional #anchor. */
  route: string;
  /** The `can('manage', …)` entity that gates its card, when one exists; a unit test pins it to `writers`. */
  manage?: Entity;
  /** Set once the setting is on the switch module: its on/off is read through `useOrgSwitch`. */
  switch?: OrgSwitchKey;
  /** On for every organisation since #2746 (no card, no switch): the page shows "On for everyone" and a module hides the feature. */
  alwaysOn?: true;
  /** What the code names for it: hook names, `*_settings` tables, `organizations.<column>`. */
  covers: readonly string[];
}

export const ORG_SETTINGS = {
  // The five modules (#2746): one switch each; off hides the module's screens, nothing is deleted.
  modulePeopleCrews: { group: 'people', writers: ['Admin'], route: '/administration/modules#module-people-crews', manage: 'orgAccounting', switch: 'modulePeopleCrews', covers: ['organizations.module_people_crews'] },
  moduleSiteDay: { group: 'site', writers: ['Admin'], route: '/administration/modules#module-site-day', manage: 'orgAccounting', switch: 'moduleSiteDay', covers: ['organizations.module_site_day'] },
  moduleStock: { group: 'stock', writers: ['Admin'], route: '/administration/modules#module-stock', manage: 'orgAccounting', switch: 'moduleStock', covers: ['organizations.module_stock'] },
  modulePurchasingExtras: { group: 'purchasing', writers: ['Admin'], route: '/administration/modules#module-purchasing-extras', manage: 'orgAccounting', switch: 'modulePurchasingExtras', covers: ['organizations.module_purchasing_extras'] },
  moduleBillingExtras: { group: 'money', writers: ['Admin'], route: '/administration/modules#module-billing-extras', manage: 'orgAccounting', switch: 'moduleBillingExtras', covers: ['organizations.module_billing_extras'] },
  crewLoans: { group: 'people', alwaysOn: true, writers: ['Admin'], route: '/administration/modules#module-people-crews', manage: 'orgAccounting', switch: 'crewLoans', covers: ['organizations.crew_loans_enabled'] },
  builtInRoles: { group: 'people', alwaysOn: true, writers: ['Admin'], route: '/administration/modules#module-people-crews', manage: 'orgAccounting', switch: 'builtInRoles', covers: ['organizations.built_in_roles_enabled'] },
  clearance: { group: 'people', alwaysOn: true, writers: ['Admin'], route: '/administration/modules#module-people-crews', manage: 'clearanceItem', switch: 'clearance', covers: ['organizations.clearance_checklist_enabled'] },
  leaveRequests: { group: 'people', alwaysOn: true, writers: ['Admin'], route: '/leave?view=settings', manage: 'leaveRequest', covers: ['organizations.leave_requests_enabled', 'organizations.leave_approver_role', 'useLeaveSettings', 'useLeaveEnabled'] },
  phoneCheckIn: { group: 'people', writers: ['Admin'], route: '/crews', covers: ['organizations.phone_check_in_supervisor_role'] },
  attendanceTarget: { group: 'people', writers: ['Admin'], route: '/administration/projects#attendance-target', manage: 'attendanceTarget', covers: ['organizations.attendance_target_rate'] },
  crewTools: { group: 'people', writers: ['Admin', 'Project Manager'], route: '/crews?view=tools', covers: ['org_crew_tool_settings', 'useToolSettings'] },
  safetyRecords: { group: 'site', alwaysOn: true, writers: ['Admin'], route: '/administration/projects#safety-records', manage: 'safetyLists', switch: 'safetyRecords', covers: ['organizations.safety_records_enabled'] },
  performanceIndices: { group: 'site', alwaysOn: true, writers: ['Admin'], route: '/administration/projects#org-performance-indices', manage: 'orgPerformanceIndices', covers: ['organizations.performance_indices_enabled', 'organizations.performance_band_low', 'organizations.performance_band_high', 'usePerformanceSettings'] },
  revenuePlan: { group: 'site', alwaysOn: true, writers: ['Admin'], route: '/administration/projects#revenue-plan-settings', manage: 'revenuePlanSettings', covers: ['org_revenue_plan_settings', 'useRevenuePlanSettings'] },
  issueClosingReport: { group: 'site', alwaysOn: true, writers: ['Admin', 'Executive', 'Project Manager'], route: '/administration/projects#issue-closing-report-settings', covers: ['issue_closing_report_settings', 'useIssueClosingReportSettings'] },
  quantityChangeLimit: { group: 'site', writers: ['Admin'], route: '/quantity-changes', manage: 'quantityChange', covers: ['organizations.quantity_change_limit'] },
  orderReceiving: { group: 'stock', writers: ['Admin'], route: '/stock/new/receive', manage: 'orderReceiving', covers: ['order_receiving_settings', 'useOrderReceivingEnabled'] },
  stockTransfers: { group: 'stock', writers: ['Admin'], route: '/stock/setup', manage: 'warehouse', covers: ['organizations.stock_transfer_mode', 'organizations.stock_proof_timing', 'useTransferSettings'] },
  stockWoTransfers: { group: 'stock', alwaysOn: true, writers: ['Admin'], route: '/stock/setup', manage: 'warehouse', switch: 'stockWoTransfers', covers: ['organizations.stock_wo_transfers'] },
  stockReservations: { group: 'stock', alwaysOn: true, writers: ['Admin'], route: '/stock/setup', manage: 'warehouse', covers: ['organizations.stock_reservations', 'organizations.reservation_borrow_mode', 'organizations.reservation_borrow_role', 'organizations.reservation_borrow_label', 'useReservationSettings', 'useReservationsEnabled'] },
  dsrStockIssue: { group: 'stock', writers: ['Admin'], route: '/stock/setup', manage: 'warehouse', covers: ['organizations.dsr_stock_issue', 'organizations.dsr_stock_issue_items', 'useDsrStockSettings'] },
  woIssueThreshold: { group: 'stock', writers: ['Admin'], route: '/stock/setup', manage: 'warehouse', covers: ['work_order_stock_settings'] },
  purchaseTypes: { group: 'purchasing', alwaysOn: true, writers: ['Admin'], route: '/purchase-types/settings', manage: 'purchaseType', covers: ['org_purchase_type_settings', 'usePurchaseTypesEnabled'] },
  purchaseLinePlanning: { group: 'purchasing', alwaysOn: true, writers: ['Admin'], route: '/administration/accounting#line-planning-heading', manage: 'orgAccounting', covers: ['organizations.purchase_line_planning', 'useLinePlanningEnabled'] },
  threeWayMatch: { group: 'purchasing', writers: ['Admin'], route: '/administration/accounting#org-three-way-match', manage: 'threeWayMatchSettings', covers: ['org_three_way_match_settings', 'useThreeWayMatchSettings'] },
  purchaseOrderPrint: { group: 'purchasing', alwaysOn: true, writers: ['Admin'], route: '/administration/accounting#po-print-settings-heading', manage: 'orgAccounting', covers: ['purchase_order_settings', 'usePurchaseOrderSettings'] },
  paymentChannels: { group: 'purchasing', alwaysOn: true, writers: ['Admin'], route: '/administration/accounting#payment-channels-heading', manage: 'orgAccounting', covers: ['org_payment_channel_settings', 'usePaymentChannelsOn'] },
  spendApprovalTiers: { group: 'purchasing', writers: ['Admin'], route: '/administration/accounting#spend-approvers', manage: 'orgAccounting', covers: ['spend_approval_settings'] },
  hidePrices: { group: 'purchasing', writers: ['Admin'], route: '/administration/clearance#org-hide-prices', manage: 'orgAccounting', covers: ['organizations.hide_prices_from_requesters', 'useHidePricesEnabled'] },
  materialRequests: { group: 'purchasing', writers: ['Admin'], route: '/material-requests/settings', manage: 'approvalChain', covers: ['material_request_settings', 'useDeliveryNoteSettings', 'useApproverInboxSetting'] },
  procurementGates: { group: 'purchasing', writers: ['Admin'], route: '/administration/accounting#procurement-gates-heading', manage: 'orgAccounting', covers: [] },
  billingPlan: { group: 'money', writers: ['Admin', 'Finance'], route: '/finance/billing-plan', covers: ['org_billing_plan_settings', 'useBillingPlanSettings'] },
  billingSteps: { group: 'money', writers: ['Admin', 'Finance'], route: '/finance/billing-board', covers: ['org_billing_step_settings'] },
  stockIssueCost: { group: 'money', writers: ['Admin'], route: '/administration/accounting#stock-issue-cost-heading', manage: 'stockIssueCostSettings', covers: ['stock_issue_cost_settings', 'useStockIssueCostSettings'] },
  labourCost: { group: 'money', writers: ['Admin', 'Finance'], route: '/administration/cost-attribution#labour-cost-settings', manage: 'labourCost', covers: ['labour_cost_settings', 'useLabourCostEnabled'] },
  idleCost: { group: 'money', alwaysOn: true, writers: ['Admin', 'Finance'], route: '/administration/modules#module-billing-extras', manage: 'labourCost', covers: ['idle_cost_settings', 'useIdleCostEnabled'] },
  disciplineProfit: { group: 'money', alwaysOn: true, writers: ['Admin'], route: '/administration/modules#module-billing-extras', manage: 'orgAccounting', switch: 'disciplineProfit', covers: ['organizations.discipline_profit_enabled'] },
  equipmentPlan: { group: 'equipment', writers: ['Admin'], route: '/equipment-plans/settings', manage: 'equipmentPlan', covers: ['org_equipment_plan_settings', 'useEquipmentPlanSettings'] },
  equipmentTargets: { group: 'equipment', writers: ['Admin'], route: '/equipment/availability', covers: ['organizations.equipment_availability_target_pct', 'organizations.equipment_utilisation_target_pct', 'organizations.equipment_escalation_down_days'] },
  emailNotifications: { group: 'notifications', writers: ['Admin'], route: '/administration/integrations#email-notifications-title', manage: 'orgEmailNotifications', covers: ['email_org_settings', 'email_event_settings'] },
  scheduledReports: { group: 'notifications', writers: ['Admin'], route: '/administration/integrations#email-notifications-title', manage: 'orgEmailNotifications', covers: [] },
  m365DefaultLibrary: { group: 'integrations', writers: ['Admin'], route: '/administration/integrations#m365-default-library', covers: ['org_m365_document_settings'] },
  feedbackSurveys: { group: 'notifications', writers: ['Admin'], route: '/administration/integrations', covers: ['useFeedbackSurveysEnabled'] },
} satisfies Record<string, OrgSettingEntry>;

export type OrgSettingKey = keyof typeof ORG_SETTINGS;
export const orgSettingKeys = Object.keys(ORG_SETTINGS) as OrgSettingKey[];
/** A preset is a list of keys to turn on together. */
export type OrgSettingPreset = readonly OrgSettingKey[];
