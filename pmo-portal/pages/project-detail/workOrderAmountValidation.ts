import { parseMoneyInputAtScale } from '@/src/lib/format';
import { parseTaxFacts } from '@/src/lib/taxTreatment';

export type WorkOrderAmountIssue = 'value' | 'treatmentRequired' | 'taxAmount' | 'inclusiveTaxTooLarge';

/**
 * Shared value + tax-basis rules for the create form and the set-value dialog (#1549). Returns
 * the failing field per issue; each form maps issues to its own copy. Mirrors
 * `work_orders_inclusive_tax_within_value` (0197 §6): inclusive tax cannot exceed the value.
 */
export const validateWorkOrderAmount = (
  rawValue: string,
  taxTreatment: string,
  taxAmount: string,
): Partial<Record<'value' | 'taxTreatment' | 'taxAmount', WorkOrderAmountIssue>> => {
  const issues: Partial<Record<'value' | 'taxTreatment' | 'taxAmount', WorkOrderAmountIssue>> = {};
  const value = parseMoneyInputAtScale(rawValue, 2);
  if (value === null || value < 0) issues.value = 'value';
  const tax = parseTaxFacts(taxTreatment, taxAmount);
  if (!taxTreatment.trim()) issues.taxTreatment = 'treatmentRequired';
  else if (tax === null) issues.taxAmount = 'taxAmount';
  if (tax !== null && value !== null && tax.taxTreatment === 'inclusive' && tax.taxAmount > value) {
    issues.taxAmount = 'inclusiveTaxTooLarge';
  }
  return issues;
};
