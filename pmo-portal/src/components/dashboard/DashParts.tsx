import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead } from '@/src/components/ui/Card';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { cn } from '@/src/components/ui/cn';

/** Colour means exception only: overdue / over budget = red (`lost`), waiting on someone = amber (`warn`), the rest grey. */
export type DashTone = 'lost' | 'warn' | 'neutral';

const COUNT_TONE: Record<DashTone, string> = {
  lost: 'text-destructive-text',
  warn: 'text-warning-foreground',
  neutral: 'text-foreground',
};

export interface WaitRow {
  id: string;
  /** The number the row is about (or a short phrase such as "At least 3"). */
  count: React.ReactNode;
  label: string;
  /** Money or hours the row stands for, right-aligned. */
  amount?: React.ReactNode;
  /** One short fact after the label ("oldest 118 days overdue"). */
  detail?: string;
  href: string;
  tone: DashTone;
}

const Chevron = () => <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />;

/**
 * "Waits on you": one row per kind of decision or exception, each a link to the fix. The first row is the
 * screen's dominant thing (largest, first in reading order). Nothing waiting is one plain line.
 */
export const WaitsOnYou: React.FC<{
  rows: WaitRow[];
  pending?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** Overrides the shared title ("Waits on you"). */
  title?: string;
  emptyLabel?: string;
  testId?: string;
}> = ({ rows, pending = false, error = false, onRetry, title, emptyLabel, testId = 'waits-on-you' }) => {
  const { t } = useTranslation('dashboard');
  return (
    <Card data-testid={testId} aria-label={title ?? t('home.waits', 'Waits on you')}>
      <CardHead level={2}>{title ?? t('home.waits', 'Waits on you')}</CardHead>
      {pending ? <div className="px-4 pb-4"><ListState variant="loading" rows={1} className="h-11 overflow-hidden" /></div>
        : error ? <div className="px-4 pb-4"><ListState variant="error" title={t('home.waitsError', "Couldn't load what waits on you")} onRetry={onRetry} /></div>
          : rows.length === 0 ? <p className="px-4 pb-4 text-control text-muted-foreground">{emptyLabel ?? t('home.waitsNone', 'Nothing waits on you.')}</p>
            : (
              <ul className="divide-y divide-border px-4 pb-1">
                {rows.map((row, index) => (
                  <li key={row.id}>
                    <Link
                      to={row.href}
                      className="grid min-h-11 grid-cols-[3.25rem_minmax(0,1fr)_auto_1rem] items-center gap-x-3 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className={cn('whitespace-nowrap text-right font-bold tabular', index === 0 ? 'text-[23px] leading-none' : 'text-[18px] leading-none', COUNT_TONE[row.tone])}>{row.count}</span>
                      <span className="min-w-0">
                        <span className={cn('block text-control', index === 0 ? 'font-semibold' : 'font-medium')}>{row.label}</span>
                        {row.detail && <span className="block text-control text-muted-foreground">{row.detail}</span>}
                      </span>
                      <span className="text-right text-control font-semibold tabular">{row.amount}</span>
                      <Chevron />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
    </Card>
  );
};

export interface ProjectRow {
  id: string;
  name: string;
  /** What needs the person, in a few words ("9 overdue tasks · 1 purchase to approve"). */
  reason: string | null;
  /** 0–100, or null when unknown. */
  delivery: number | null;
  /** Percent of budget used (can pass 100), or null when unknown. */
  budgetUsed: number | null;
  status: string;
  /** Red pill and red budget figure. */
  offTrack: boolean;
  href: string;
  /** Tooltip: the contractual name when a short name is shown. */
  title?: string;
}

const pct = (value: number | null) => value === null ? '—' : `${Math.round(value)}%`;

/**
 * Projects as ONE compact list: name · reason · delivery % · budget used % · status. A column nobody has a value
 * for is not drawn. Rows that need nothing (`reason` null, not off track) are quiet single lines at the end.
 */
export const ProjectRows: React.FC<{
  title: string;
  rows: ProjectRow[];
  pending?: boolean;
  error?: boolean;
  onRetry?: () => void;
  /** "All 7 projects" link. */
  allLink?: { to: string; label: string };
  emptyLabel: string;
  /** One quiet line under the list (e.g. "6 projects can't be checked against budget"). */
  footer?: React.ReactNode;
  testId?: string;
}> = ({ title, rows, pending = false, error = false, onRetry, allLink, emptyLabel, footer, testId = 'project-rows' }) => {
  const { t } = useTranslation('dashboard');
  const showDelivery = rows.some((row) => row.delivery !== null);
  const showBudget = rows.some((row) => row.budgetUsed !== null);
  const showReason = rows.some((row) => row.reason);
  const cols = ['minmax(0,1.5fr)', showReason ? 'minmax(0,1.3fr)' : null, showDelivery ? '5.5rem' : null, showBudget ? '5.5rem' : null, '10rem'].filter(Boolean).join(' ');
  const sorted = [...rows.filter((row) => row.offTrack || row.reason), ...rows.filter((row) => !row.offTrack && !row.reason)];
  return (
    <Card data-testid={testId}>
      <CardHead level={2} actions={allLink ? <Link to={allLink.to} className="inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{allLink.label}<Icon name="chev" className="size-4" /></Link> : undefined}>{title}</CardHead>
      <div className="px-4 pb-2">
        {pending ? <ListState variant="loading" rows={3} />
          : error ? <ListState variant="error" title={t('home.projectsError', "Couldn't load projects")} onRetry={onRetry} />
            : sorted.length === 0 ? <p className="pb-2 text-control text-muted-foreground">{emptyLabel}</p>
              : (
                <>
                  <div aria-hidden="true" style={{ gridTemplateColumns: cols }} className="hidden gap-x-3 pb-1 text-control text-muted-foreground min-[900px]:grid">
                    <span>{t('home.colProject', 'Project')}</span>{showReason && <span>{t('home.colNeeds', 'Needs you')}</span>}
                    {showDelivery && <span className="text-right">{t('home.colDelivery', 'Delivery')}</span>}
                    {showBudget && <span className="text-right">{t('home.colBudget', 'Budget used')}</span>}
                    <span className="text-right">{t('home.colStatus', 'Status')}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {sorted.map((row) => {
                      const quiet = !row.offTrack && !row.reason;
                      return (
                        <li key={row.id}>
                          <Link
                            to={row.href}
                            title={row.title}
                            style={{ '--cols': cols } as React.CSSProperties}
                            className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 py-2.5 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring min-[900px]:[grid-template-columns:var(--cols)]"
                          >
                            <span className={cn('min-w-0 text-control', quiet ? 'font-normal' : 'font-semibold')}>{row.name}</span>
                            <span className="min-[900px]:order-5 min-[900px]:justify-self-end"><StatusPill record="project" state={row.status} /></span>
                            {showReason && <span className={cn('col-span-2 min-w-0 text-control min-[900px]:order-2 min-[900px]:col-span-1', row.offTrack ? 'text-destructive-text' : 'text-muted-foreground')}>{row.reason ?? ''}</span>}
                            {(showDelivery || showBudget) && (
                              <span className="col-span-2 flex gap-4 text-control tabular text-muted-foreground min-[900px]:contents">
                                {showDelivery && <span className="min-[900px]:order-3 min-[900px]:text-right"><span className="min-[900px]:hidden">{t('home.colDelivery', 'Delivery')} </span>{pct(row.delivery)}</span>}
                                {showBudget && <span className={cn('min-[900px]:order-4 min-[900px]:text-right', row.offTrack && row.budgetUsed !== null && row.budgetUsed >= 90 && 'font-semibold text-destructive-text')}><span className="min-[900px]:hidden">{t('home.colBudget', 'Budget used')} </span>{pct(row.budgetUsed)}</span>}
                              </span>
                            )}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
        {footer && !pending && !error && <p className="pt-2 text-control text-muted-foreground">{footer}</p>}
      </div>
    </Card>
  );
};

/** Secondary blocks that have no page of their own: closed until asked for, drawn only once opened. */
export const Analysis: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Card data-testid="dashboard-analysis">
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="flex min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden items-center justify-between gap-2 px-4 text-group font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {title}<Icon name="chev" className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        </summary>
        {open && <div className="grid gap-[var(--space-panel-gap)] p-4 pt-2">{children}</div>}
      </details>
    </Card>
  );
};
