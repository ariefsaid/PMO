import React from 'react';
import { Link } from 'react-router';
import { Icon } from '@/src/components/ui/icons';
import { Tooltip } from '@/src/components/ui/Tooltip';
import type { AttentionItem } from './AttentionList';

export interface ApprovalStripProps {
  items: AttentionItem[];
}

const TONE_ICON_STYLES: Record<AttentionItem['tone'], string> = {
  warn: 'text-warning-foreground',
  lost: 'text-destructive-text',
  neutral: 'text-muted-foreground',
};

export const ApprovalStrip: React.FC<ApprovalStripProps> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const link = (
          <Link
            to={item.href}
            className="inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 text-sm text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {item.icon && <Icon name={item.icon} className={`size-4 shrink-0 ${TONE_ICON_STYLES[item.tone]}`} />}
            <span className="font-bold tabular-nums">{item.count}</span>
            {' '}
            <span>{item.label}</span>
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
};
