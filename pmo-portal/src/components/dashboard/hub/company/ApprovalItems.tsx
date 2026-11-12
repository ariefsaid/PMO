import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/src/components/ui/icons';
import type { ApprovalPopulationEntry } from '@/src/lib/selectors/approvals';
import { approvalItem } from './approvalItem';

/** The first approvals as rows inside "Waits on you" (they render as list items of its list). */
export const ApprovalItems: React.FC<{ entries: ApprovalPopulationEntry[]; limit?: number }> = ({ entries, limit = 5 }) => {
  const { t } = useTranslation('dashboard');
  const translate = (key: string, fallback: string, options?: Record<string, unknown>) => t(key, { defaultValue: fallback, ...(options ?? {}) });
  return (
    <>
      {entries.slice(0, limit).map((entry) => {
        const item = approvalItem(entry, translate);
        const waited = item.days === null ? null : t('home.waitingDays', { count: item.days, defaultValue_one: 'waiting {{count}} day', defaultValue_other: 'waiting {{count}} days' });
        return (
          <li key={item.key} data-testid="approval-item">
            <Link to={item.href} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <span className="min-w-0">
                <span className="block truncate text-control font-medium">{item.what}</span>
                <span className="block truncate text-control text-muted-foreground">{[item.who, waited].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-right text-control font-semibold tabular">{item.amount}</span>
              <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </>
  );
};
