import { useEffect, useState } from 'react';
import { formatMoneyInputValue } from '@/src/lib/format';
import { parseStandaloneTaxFacts } from '@/src/lib/taxTreatment';

/** Keep the existing manual-tax path; a stated rate makes the tax amount a calculated field. */
export function useStandaloneTaxFields(
  amountRaw: string,
  treatmentRaw: string,
  taxAmountRaw: string,
  onTaxAmountChange: (value: string) => void,
  initialRate = '',
  initialBase = '1',
) {
  const [rateRaw, setRateRaw] = useState(initialRate);
  const [baseRaw, setBaseRaw] = useState(initialBase);
  const facts = parseStandaloneTaxFacts(treatmentRaw, taxAmountRaw, amountRaw, rateRaw, baseRaw);
  const hasRate = rateRaw.trim() !== '';
  const calculatedAmount = hasRate && facts ? formatMoneyInputValue(facts.taxAmount) : null;
  useEffect(() => {
    if (calculatedAmount !== null && calculatedAmount !== taxAmountRaw) {
      onTaxAmountChange(calculatedAmount);
    }
  }, [calculatedAmount, taxAmountRaw, onTaxAmountChange]);
  return { rateRaw, setRateRaw, baseRaw, setBaseRaw, facts, hasRate };
}
