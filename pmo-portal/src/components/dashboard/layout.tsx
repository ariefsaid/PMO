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
  <PageHeading kind="dashboard" title={title} scope={sub} actions={actions} className="[&_[data-page-scope]]:mt-1 [&_[data-page-scope]]:text-sm" />
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

/** Paired dashboard fact: keep its label and foreground value in one eye-span. */
export const DashFact: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  primary?: boolean;
  testId?: string;
}> = ({ label, value, primary = false, testId }) => (
  <div data-testid={testId} className="flex min-w-0 flex-col gap-1">
    <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
    <dd className={cn('min-w-0 break-words tabular text-foreground', primary ? 'text-xl font-bold' : 'text-sm font-semibold')}>{value}</dd>
  </div>
);

/** Inline/row facts use the same pairing without definition-list semantics. */
export const DashValue: React.FC<{ label: React.ReactNode; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col gap-1">
    <div className="text-xs font-semibold text-muted-foreground">{label}</div>
    <div className="min-w-0 text-sm font-semibold tabular text-foreground [&_*]:text-sm [&_*]:font-semibold [&>*]:text-foreground">{children}</div>
  </div>
);
