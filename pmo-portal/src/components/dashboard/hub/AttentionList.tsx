import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { Icon, type IconName } from '@/src/components/ui/icons';
import { Tooltip } from '@/src/components/ui/Tooltip';

export interface AttentionItem {
  id: string;
  tone: 'warn' | 'lost' | 'neutral';
  icon: IconName;
  count: React.ReactNode;
  label: string;
  sub?: string;
  amount?: React.ReactNode;
  href: string;
  tooltip?: string;
}

export interface AttentionListProps {
  items: AttentionItem[];
  title?: string;
  compact?: boolean;
}

const TONE_STYLES: Record<AttentionItem['tone'], string> = {
  warn: 'bg-warning/10 text-warning-foreground',
  lost: 'bg-destructive/10 text-destructive-text',
  neutral: 'bg-muted text-muted-foreground',
};

const AttentionRows: React.FC<{ items: AttentionItem[]; compact?: boolean }> = ({ items, compact = false }) => (
  <ul className="divide-y divide-border">
    {items.map((item) => {
      const link = (
        <Link
          to={item.href}
          className={`grid min-h-12 w-full grid-cols-[2rem_auto_minmax(0,1fr)_1rem] items-center gap-x-3 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${compact ? 'px-0' : 'px-4'}`}
        >
          <span className={`inline-flex size-8 shrink-0 items-center justify-center rounded-md ${TONE_STYLES[item.tone]}`}>
            <Icon name={item.icon} className="size-4" />
          </span>
          <span className="whitespace-nowrap text-right text-base font-bold tabular-nums">{item.count}</span>
          {' '}
          <span className="grid min-w-0 grid-cols-1 items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <span className="min-w-0">
              <span className="block text-sm font-medium">{item.label}</span>
              {item.sub && <span className="block text-xs text-muted-foreground">{item.sub}</span>}
            </span>
            {item.amount != null && (
              <span className="text-right text-sm font-semibold tabular-nums">{item.amount}</span>
            )}
          </span>
          <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      );

      return (
        <li key={item.id}>
          {item.tooltip ? <Tooltip content={item.tooltip}>{link}</Tooltip> : link}
        </li>
      );
    })}
  </ul>
);

export const AttentionList: React.FC<AttentionListProps> = ({ items, title, compact = false }) => {
  const { t } = useTranslation('dashboard');
  if (items.length === 0) return null;

  if (compact || title == null) return <AttentionRows items={items} compact={compact} />;

  return (
    <Card>
      <CardHead
        level={2}
        actions={
          <span className="text-xs font-normal text-muted-foreground">
            {t('needs.count', {
              count: items.length,
              defaultValue: items.length === 1 ? '{{count}} item' : '{{count}} items',
            })}
          </span>
        }
      >
        {title}
      </CardHead>
      <AttentionRows items={items} />
    </Card>
  );
};
