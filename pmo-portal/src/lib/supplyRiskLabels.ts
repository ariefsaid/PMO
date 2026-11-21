import type { StatusVariant } from '@/src/components/ui';
import type { SupplyRiskStatus } from '@/src/lib/supplyRisk';

/** Pill tone for a supply-risk status. The label always carries the meaning; colour only reinforces it. */
export function supplyRiskPillVariant(status: SupplyRiskStatus | string | null | undefined): StatusVariant {
  if (status === 'at_risk') return 'warn';
  if (status === 'inactive') return 'overdue';
  return 'neutral';
}

type Translate = (key: string, defaultValue: string) => string;

/** The localised status label (static keys, so the catalogue gate can see each one). */
export function supplyRiskLabel(t: Translate, status: SupplyRiskStatus | string | null | undefined): string {
  if (status === 'at_risk') return t('supplyRisk:status.at_risk', 'At risk');
  if (status === 'inactive') return t('supplyRisk:status.inactive', 'Inactive');
  return t('supplyRisk:status.active', 'Active');
}
