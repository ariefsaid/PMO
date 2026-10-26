import React from 'react';
import { cn } from '@/src/components/ui/cn';
import { PageHeading } from '@/src/components/ui/PageHeading';

export interface DashPageHeadProps {
  title: string;
  sub: string;
  actions?: React.ReactNode;
}

/** Page head — title + sub, on tokens (replaces the legacy gray/dark heading). */
export const DashPageHead: React.FC<DashPageHeadProps> = ({ title, sub, actions }) => (
  <PageHeading kind="dashboard" title={title} scope={sub} actions={actions} />
);

/** Two-up chart row that stacks to a single column below ~900px.
 * items-start: each card sizes to its own content — prevents the taller sibling
 * from leaving large empty voids in shorter chart cards (I1 fix). */
export const DashGrid: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className,
  children,
}) => (
  <div className={cn('grid grid-cols-1 items-start gap-4 min-[920px]:grid-cols-2', className)}>{children}</div>
);
