import React from 'react';
import { useTranslation } from 'react-i18next';

export interface DecisionContextSummaryProps {
  identity: string;
  amount: string;
  consequence?: string;
}

/** Keeps the caller's authoritative record identity and formatted amount beside a consequential decision. */
export const DecisionContextSummary: React.FC<DecisionContextSummaryProps> = ({ identity, amount, consequence }) => {
  const { t } = useTranslation();
  return (
    <section data-testid="decision-context-summary" aria-label={t('decisionContext.title', 'Decision details')} className="mt-3 rounded-md border border-border bg-muted/50 p-3">
      <dl className="grid gap-1.5 text-sm">
        <div className="flex min-w-0 justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{t('decisionContext.record', 'Record')}</dt>
          <dd className="min-w-0 text-right font-medium">{identity}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{t('decisionContext.amount', 'Amount')}</dt>
          <dd className="tabular text-right font-semibold">{amount}</dd>
        </div>
      </dl>
      {consequence && <p className="mt-2 border-t border-border pt-2 text-sm text-muted-foreground">{consequence}</p>}
    </section>
  );
};
