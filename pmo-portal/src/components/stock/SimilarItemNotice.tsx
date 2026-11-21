import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { IndexedStockItem } from '@/src/lib/stockSimilarity';

export type SimilarCheckState = 'loading' | 'failed' | 'ready';

export interface SimilarItemNoticeProps {
  matches: readonly IndexedStockItem[];
  /** `failed` means the item list did not load, so silence would read as "no duplicates". */
  checkState: SimilarCheckState;
  className?: string;
}

/**
 * Advisory near-duplicate warning for a new stock item name (#2692). `role="status"` — the person is
 * mid-form and the notice is information, not an error; nothing is invalid and the create button is
 * untouched. Each match links to the existing item's ledger in a new tab so the half-typed form is
 * not lost. Amber tokens are the AA pair the readiness gate uses.
 */
export const SimilarItemNotice: React.FC<SimilarItemNoticeProps> = ({ matches, checkState, className }) => {
  const { t } = useTranslation('stock');
  if (checkState === 'loading') return null;

  if (checkState === 'failed') {
    return (
      <p role="status" className={cn('text-control text-muted-foreground', className)}>
        {t('setup.form.item.similar.checkUnavailable')}
      </p>
    );
  }
  if (matches.length === 0) return null;

  return (
    <div
      role="status"
      data-testid="similar-item-notice"
      className={cn('flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/12 px-3.5 py-3 text-control', className)}
    >
      <Icon name="alert" className="mt-px size-[17px] shrink-0 text-[hsl(var(--warning-icon))]" />
      <div className="min-w-0">
        <p className="font-semibold text-warning-foreground">{t('setup.form.item.similar.title')}</p>
        <p className="mt-px text-muted-foreground">{t('setup.form.item.similar.body')}</p>
        <ul aria-label={t('setup.form.item.similar.listLabel')} className="mt-1.5 space-y-1">
          {matches.map((match) => (
            <li key={match.id} className="min-w-0">
              <Link
                to={`/stock/ledger?item=${match.id}`}
                target="_blank"
                rel="noreferrer"
                className="touch-target inline-flex min-h-9 max-w-full min-w-0 items-center gap-1 rounded-sm font-medium text-warning-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="truncate">{match.code} · {match.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
