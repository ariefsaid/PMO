import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import type { NeedsItem, NeedsTone } from './useNeedsYou';

export interface NeedsYouListProps {
  items: NeedsItem[];
  isPending?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  className?: string;
}

export const NeedsYouList: React.FC<NeedsYouListProps> = ({
  items,
  isPending = false,
  isError = false,
  onRetry,
  className = '',
}) => {
  const { t } = useTranslation('dashboard');
  if (isPending) return <ListState variant="loading" rows={Math.max(items.length, 3)} testId="needs-you-loading" className={className} />;
  if (isError) return (
    <ListState
      variant="error"
      title={t('needs.error', "Couldn't load what needs your attention")}
      sub={t('needs.errorSub', 'Retry to check the latest items.')}
      onRetry={onRetry}
      className={className}
    />
  );
  if (items.length === 0) return (
    <p role="status" className={`py-3 text-[13px] text-muted-foreground ${className}`}>
      {t('needs.nothing', 'Nothing waiting for you')}
    </p>
  );

  const toneLabel: Record<NeedsTone, string> = {
    warn: t('needs.statusAttention', 'Needs attention'),
    neutral: t('needs.statusInfo', 'On track'),
    lost: t('needs.statusOverdue', 'Overdue'),
  };

  return (
    <ul aria-label={t('needs.listLabel', 'Needs you')} className={`divide-y divide-border ${className}`}>
      {items.map((item) => (
        <li key={item.id}>
          <Link
            to={item.href}
            data-testid={`needs-row-${item.id}`}
            className="flex min-h-11 items-center gap-3 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="w-10 shrink-0 text-right text-[18px] font-bold tabular" aria-label={t('needs.count', '{{count}} items', { count: item.count })}>
              {item.count}
            </span>
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="inline-flex shrink-0 items-center text-[11.5px] text-muted-foreground">
                <span>{toneLabel[item.tone]}</span>
              </span>
              <span className="min-w-0 text-[13.5px]">{item.label}</span>
            </span>
            {item.amount != null && <span className="shrink-0 text-right text-[13px] font-semibold tabular">{item.amount}</span>}
            <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
};
