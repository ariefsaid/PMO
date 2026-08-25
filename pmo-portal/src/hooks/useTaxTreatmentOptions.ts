import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TAX_TREATMENT_OPTIONS } from '@/src/lib/taxTreatment';

/**
 * The tax-treatment select's options and placeholder, translated (#566, OD-TAX-1).
 *
 * The VALUE domain comes from `TAX_TREATMENT_OPTIONS` — the one encoding of the shared CHECK
 * constraint (`tax_treatment in ('inclusive','exclusive')`) — so a screen can never invent a third
 * value or misspell one of the two. Only the prose is restated here, once, so every form asking
 * this question asks it in the same words in every language.
 *
 * ⛔ NO default and no "recommended" option TODAY — a pre-selected treatment is a wrong answer
 * indistinguishable from a deliberate one; the placeholder is an empty prompt and submit stays
 * blocked until the user chooses.
 *
 * ⚑ PRECISION, because an earlier comment here misquoted the ruling and #548 is building against
 * it: OD-TAX-1 does NOT forbid pre-selection. It says the org-wide `default_tax_treatment`
 * "PRE-SELECTS ONLY" — the org default may fill the control when composing a NEW row, while the
 * stored per-row value stays authoritative and is NEVER re-derived from the default at read time.
 * There is no pre-selection here only because that column does not exist yet (#548 adds it). When
 * it lands, wiring it into this hook is CORRECT, not a violation.
 */
export function useTaxTreatmentOptions(): {
  options: { value: string; label: string }[];
  placeholder: string;
} {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      options: TAX_TREATMENT_OPTIONS.map((o) => ({
        value: o.value,
        label:
          o.value === 'inclusive'
            ? t('tax.treatment.inclusive', 'Inclusive — the amount already includes tax')
            : t('tax.treatment.exclusive', 'Exclusive — tax is on top of the amount'),
      })),
      placeholder: t('tax.treatment.choose', '— choose —'),
    }),
    [t],
  );
}
