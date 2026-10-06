import type { AgingBucket, ExpenseClaimStatus, ExpenseKind, ExpenseType } from '@/src/lib/db/expenseClaims';

type Translate = (key: string, fallback: string) => string;

/** Literal `t()` calls so every label is visible to the i18n catalogue gates (the budgetCategoryLabel idiom). */
export function expenseStatusLabel(status: ExpenseClaimStatus, t: Translate): string {
  switch (status) {
    case 'Draft': return t('expenses.status.draft', 'Draft');
    case 'Submitted': return t('expenses.status.submitted', 'Submitted');
    case 'Approved': return t('expenses.status.approved', 'Approved');
    case 'Rejected': return t('expenses.status.rejected', 'Rejected');
    case 'Paid': return t('expenses.status.paid', 'Paid');
    case 'Cancelled': return t('expenses.status.cancelled', 'Cancelled');
    default: return String(status);
  }
}

export function expenseKindLabel(kind: ExpenseKind, t: Translate): string {
  return kind === 'advance' ? t('expenses.kind.advance', 'Cash advance') : t('expenses.kind.claim', 'Expense claim');
}

export function expenseTypeLabel(type: ExpenseType, t: Translate): string {
  switch (type) {
    case 'Travel': return t('expenses.type.travel', 'Travel');
    case 'Accommodation': return t('expenses.type.accommodation', 'Accommodation');
    case 'Meals': return t('expenses.type.meals', 'Meals');
    case 'Local transport': return t('expenses.type.localTransport', 'Local transport');
    case 'Other': return t('expenses.type.other', 'Other');
    default: return String(type);
  }
}

export function agingBucketLabel(bucket: AgingBucket, t: Translate): string {
  switch (bucket) {
    case '0-30': return t('expenses.aging.bucket.upTo30', '0–30 days');
    case '31-60': return t('expenses.aging.bucket.d31to60', '31–60 days');
    case '61-90': return t('expenses.aging.bucket.d61to90', '61–90 days');
    default: return t('expenses.aging.bucket.over90', 'Over 90 days');
  }
}
