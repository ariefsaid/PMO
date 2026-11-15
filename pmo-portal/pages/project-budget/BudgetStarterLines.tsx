import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrencyCents, parseMoneyInputAtScale } from '@/src/lib/format';
import { Button, NumberField } from '@/src/components/ui';
import type { NewLineItem } from '@/src/lib/db/budgets';
import { Constants, type Enums } from '@/src/lib/supabase/database.types';

const BUDGET_CATEGORIES = Constants.public.Enums.budget_category;
type Category = Enums<'budget_category'>;

interface BudgetStarterLinesProps {
  currency: string;
  onCreateLineItem: (item: NewLineItem) => Promise<unknown>;
  /** True while any amount is typed and not yet saved (drives the leave guard and blocks activation). */
  onDirtyChange: (dirty: boolean) => void;
  onSaveError?: (err: unknown) => void;
  onSaved?: (count: number) => void;
}

/**
 * A first budget, from nothing: every organisation budget category is already listed, so a new person
 * only types an amount beside the categories they need and saves once. Each line is written with the
 * same create call as "+ Add line item"; a line that fails keeps its typed amount and its error, so a
 * failed save never loses work.
 */
const BudgetStarterLines: React.FC<BudgetStarterLinesProps> = ({ currency, onCreateLineItem, onDirtyChange, onSaveError, onSaved }) => {
  const { t } = useTranslation('finance');
  const [amounts, setAmounts] = useState<Partial<Record<Category, string>>>({});
  const [errors, setErrors] = useState<Partial<Record<Category, string>>>({});
  const [saving, setSaving] = useState(false);
  const typed = BUDGET_CATEGORIES.filter((category) => (amounts[category] ?? '').trim() !== '');
  const dirty = typed.length > 0;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const parse = (value: string): number | null | 'invalid' => {
    if (value.trim() === '') return null;
    const parsed = parseMoneyInputAtScale(value, 2);
    return parsed === null || parsed <= 0 ? 'invalid' : parsed;
  };
  const amountError = t('budgetStarter.amountInvalid', 'Enter an amount above 0, up to 2 decimals');
  const total = typed.reduce((sum, category) => {
    const parsed = parse(amounts[category] ?? '');
    return typeof parsed === 'number' ? sum + parsed : sum;
  }, 0);

  const save = async () => {
    const nextErrors: Partial<Record<Category, string>> = {};
    for (const category of typed) if (parse(amounts[category] ?? '') === 'invalid') nextErrors[category] = amountError;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || typed.length === 0) return;
    setSaving(true);
    const remaining: Partial<Record<Category, string>> = {};
    let saved = 0;
    let failure: unknown = null;
    for (const category of typed) {
      const amount = parse(amounts[category] ?? '') as number;
      try {
        await onCreateLineItem({ category, description: null, budgeted_amount: amount, fiscal_year: null });
        saved += 1;
      } catch (err) {
        remaining[category] = amounts[category];
        failure ??= err;
      }
    }
    setSaving(false);
    setAmounts(remaining);
    if (failure) {
      setErrors(Object.fromEntries(Object.keys(remaining).map((category) => [category, t('budgetStarter.notSaved', 'Not saved; try again')])));
      onSaveError?.(failure);
    }
    if (saved > 0) onSaved?.(saved);
  };

  return (
    <section aria-labelledby="budget-starter-heading" className="min-w-0 space-y-3" data-testid="budget-starter-lines">
      <h4 id="budget-starter-heading" className="text-base font-semibold text-foreground">{t('budgetStarter.title', 'Enter an amount per category')}</h4>
      <ul className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {BUDGET_CATEGORIES.map((category) => (
          <li key={category} className="min-w-0">
            <NumberField
              label={budgetCategoryLabel(category, t)}
              value={amounts[category] ?? ''}
              onChange={(value) => {
                setAmounts((current) => ({ ...current, [category]: value }));
                if (errors[category]) setErrors((current) => { const next = { ...current }; delete next[category]; return next; });
              }}
              onBlur={() => { if (parse(amounts[category] ?? '') === 'invalid') setErrors((current) => ({ ...current, [category]: amountError })); }}
              prefix={currency}
              localeAware
              fullWidth
              disabled={saving}
              error={errors[category]}
            />
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('financeCopy.total', 'Total')} <span className="tabular font-semibold text-foreground">{formatCurrencyCents(total, currency)}</span>
        </p>
        <Button variant="primary" className="touch-target" onClick={() => void save()} loading={saving} disabled={saving || typed.length === 0}>
          {typed.length === 0
            ? t('budgetStarter.saveNone', 'Save lines')
            : t('budgetStarter.save', { count: typed.length, defaultValue_one: 'Save {{count}} line', defaultValue_other: 'Save {{count}} lines' })}
        </Button>
      </div>
    </section>
  );
};

export default BudgetStarterLines;
