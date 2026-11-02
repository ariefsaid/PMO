import type { TFunction } from 'i18next';
import type { CompanyType } from '@/src/lib/db/companies';

/**
 * The display label for each `company_type` value, resolved once per render. The VALUE is the
 * database enum and is never translated (it is filter state, an export cell, and a policy input);
 * only the label a person reads is. One map so the filter segment, the shared company form's Type
 * select and the row pill can never drift into three different words for the same type. Shared by
 * the directory (toolbar + pills) and the one company form — a single definition both read.
 */
export const typeLabels = (t: TFunction): Record<CompanyType, string> => ({
  Client: t('companies.type.client', 'Client'),
  Vendor: t('companies.type.vendor', 'Supplier'),
  Internal: t('companies.type.internal', 'Internal'),
});
