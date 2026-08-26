import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { isTaxTreatment } from '@/src/lib/taxTreatment';

/**
 * TaxBasisLabel — `OD-TAX-1` §2: **no bare number anywhere the treatment exists.**
 *
 * The owner declined to pick a single tax basis, because there is no one Indonesian convention:
 * commercial contracts and vendor agreements are normally quoted EXCLUSIVE of PPN ("harga belum
 * termasuk PPN"), government/SOE tender contracts INCLUSIVE, the contract value being the all-in
 * ceiling. A contractor working both sides reads the two side by side every day, so a figure that
 * does not state its basis is not a smaller statement than one that does — it is a DIFFERENT and
 * possibly wrong one, off by the tax rate.
 *
 * ⛔ THE BASIS COMES FROM THE ROW. This component takes the treatment stored on the record whose
 * money it sits beside, never the org default (`useOrgTaxDefault`), which pre-selects a form and is
 * never consulted at read time. Feeding it a fallback would re-interpret every historical row the
 * next time an Admin flipped the setting — the #478 defect, which no later inference undoes.
 *
 * ⚑ AN UNKNOWN TREATMENT RENDERS NOTHING. `null`, `''` and any out-of-domain string return null,
 * not a guess and not a placeholder dash. A NULL treatment is legitimate — 0197 pairs it with a
 * zero contract value, where there is no figure to qualify — and inventing "excl. PPN" for it would
 * put a confident claim where the database deliberately holds none.
 */
export interface TaxBasisLabelProps {
  /** The treatment stored on THIS record. `string | null` because that is the column's type. */
  treatment: string | null | undefined;
  className?: string;
  /** Overrides the default `tax-basis` testid where a surface renders several figures. */
  testId?: string;
}

export const TaxBasisLabel: React.FC<TaxBasisLabelProps> = ({ treatment, className, testId }) => {
  const { t } = useTranslation();
  if (!isTaxTreatment(treatment)) return null;
  // ⚑ Two literal keys, never a key built from the value. The i18n completeness gate scans
  // source for literal key strings and reports a computed key's catalogue entries as ORPHANS —
  // which is the right alarm: a key nothing statically references is a key nothing can prove is
  // still live, and it would go on being translated long after the code stopped reading it.
  const label =
    treatment === 'inclusive'
      ? t('tax.basis.inclusive', 'incl. PPN')
      : t('tax.basis.exclusive', 'excl. PPN');
  return (
    <span
      data-testid={testId ?? 'tax-basis'}
      data-tax-basis={treatment}
      className={cn('text-[11px] font-normal text-muted-foreground', className)}
    >
      {label}
    </span>
  );
};

export default TaxBasisLabel;
