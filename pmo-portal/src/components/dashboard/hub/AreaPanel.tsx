import React from 'react';
import { Link } from 'react-router';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { Icon } from '@/src/components/ui/icons';

export interface AreaPanelProps {
  title: React.ReactNode;
  openHref: string;
  openLabel: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}

export const AreaPanel: React.FC<AreaPanelProps> = ({ title, openHref, openLabel, meta, children }) => (
  <Card className="min-w-0">
    <CardHead
      level={2}
      actions={
        <Link
          to={openHref}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span>{openLabel}</span>
          <Icon name="chev" className="size-4" />
        </Link>
      }
    >
      {title}
    </CardHead>
    <CardPad className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      {meta != null && <p className="text-xs text-muted-foreground">{meta}</p>}
      {children}
    </CardPad>
  </Card>
);
