import { useEquipmentPlanSettings } from '@/src/hooks/useEquipmentPlans';
import { useHidePricesEnabled } from '@/src/hooks/useHidePrices';
import { useIdleCostEnabled } from '@/src/hooks/useIdleCost';
import { useIssueClosingReportSettings } from '@/src/hooks/useIssueClosingReport';
import { useLabourCostEnabled } from '@/src/hooks/useLabourCost';
import { useLeaveSettings } from '@/src/hooks/useLeave';
import { useThreeWayMatchSettings } from '@/src/hooks/useMatchSettingsAndLines';
import { usePaymentChannelsOn } from '@/src/hooks/usePaymentChannels';
import { usePurchaseOrderSettings } from '@/src/hooks/usePurchaseOrderSettings';
import { usePurchaseTypesEnabled } from '@/src/hooks/usePurchaseTypes';
import { useDsrStockSettings } from '@/src/hooks/useDsrStockIssue';
import { useReservationSettings } from '@/src/hooks/useStockReservations';
import { usePerformanceSettings } from '@/src/hooks/useWorkOrderPerformance';
import { useRevenuePlanSettings } from '@/src/hooks/useWorkOrderRevenuePlan';
import type { OrgSettingKey } from '@/src/lib/orgSettingsCatalogue';

/**
 * On/off for the settings that are not on the switch module yet, read through their own hook (#2746). `undefined` means not read
 * yet or not readable, and the row then shows no state. A setting with no entry here has no cheap boolean read (a mode, a number,
 * a list, or a read that reports "off" while loading) and the page shows only its link.
 */
const useLeaveRequestsStatus = () => useLeaveSettings().data?.enabled;
const usePerformanceIndicesStatus = () => usePerformanceSettings().data?.enabled;
const useRevenuePlanStatus = () => useRevenuePlanSettings().data?.enabled;
const useIssueClosingReportStatus = () => { const q = useIssueClosingReportSettings(); return q.data === undefined ? undefined : q.data?.enabled === true; };
const useStockReservationsStatus = () => useReservationSettings().data?.enabled;
const useDsrStockIssueStatus = () => useDsrStockSettings().data?.enabled;
const usePurchaseTypesStatus = () => usePurchaseTypesEnabled().data;
const useThreeWayMatchStatus = () => { const q = useThreeWayMatchSettings(); return q.data === undefined ? undefined : q.data?.enabled === true; };
const usePurchaseOrderPrintStatus = () => usePurchaseOrderSettings().data?.enabled;
const usePaymentChannelsStatus = () => { const c = usePaymentChannelsOn(); return c.query.data === undefined ? undefined : c.on; };
const useHidePricesStatus = () => useHidePricesEnabled().data;
const useLabourCostStatus = () => useLabourCostEnabled().data;
const useIdleCostStatus = () => useIdleCostEnabled().data;
const useEquipmentPlanStatus = () => useEquipmentPlanSettings().data?.enabled;

export const STATUS_HOOKS = {
  leaveRequests: useLeaveRequestsStatus,
  performanceIndices: usePerformanceIndicesStatus,
  revenuePlan: useRevenuePlanStatus,
  issueClosingReport: useIssueClosingReportStatus,
  stockReservations: useStockReservationsStatus,
  dsrStockIssue: useDsrStockIssueStatus,
  purchaseTypes: usePurchaseTypesStatus,
  threeWayMatch: useThreeWayMatchStatus,
  purchaseOrderPrint: usePurchaseOrderPrintStatus,
  paymentChannels: usePaymentChannelsStatus,
  hidePrices: useHidePricesStatus,
  labourCost: useLabourCostStatus,
  idleCost: useIdleCostStatus,
  equipmentPlan: useEquipmentPlanStatus,
} satisfies Partial<Record<OrgSettingKey, () => boolean | undefined>>;

export type StatusKey = keyof typeof STATUS_HOOKS;
