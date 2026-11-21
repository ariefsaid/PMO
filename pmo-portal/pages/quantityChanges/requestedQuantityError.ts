import { useTranslation } from 'react-i18next';
import type { RequestedQuantityError } from '@/src/lib/quantityChangeRules';

/** The words for a refused requested quantity (literal keys, so the catalogue gates and the tests see them). */
export function useRequestedQuantityErrorText() {
  const { t } = useTranslation('quantityChanges');
  return (error: RequestedQuantityError | 'required', figures: { contract: number; figure: number }): string => {
    switch (error) {
      case 'required': return t('raise.errors.required', 'Required');
      case 'invalid': return t('raise.errors.invalid', 'A positive number with at most 3 decimals');
      case 'not_above_contract': return t('raise.errors.not_above_contract', { defaultValue: 'Must be above the contract quantity of {{contract}}', contract: figures.contract });
      case 'below_trigger': return t('raise.errors.below_trigger', { defaultValue: 'Cannot be below {{figure}}', figure: figures.figure });
    }
  };
}
