import React from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { ageInDays } from '@/src/lib/selectors/approvalUrgency';
import type { ChainStep } from '@/src/lib/selectors/approvalChain';

/** Up to two faces per step; more approvers fold into "+n" so the strip stays one line. */
const MAX_FACES = 2;

/**
 * One compact line under a record's header: each approval step with who (initials and role), a tick and the date
 * once done, a clock and how long it has waited on the current step. Nothing renders when the chain is unknown.
 */
export function ApprovalChainStrip({ steps, className }: { steps: ChainStep[] | null | undefined; className?: string }) {
  const { t } = useTranslation('procurement');
  if (!steps || steps.length === 0) return null;
  const roleLabel = (step: ChainStep) =>
    step.role === 'requester'
      ? t('approvalChain.role.requester', 'Requester')
      : step.role === 'admin'
        ? t('approvalChain.role.admin', 'Admin')
        : step.people.length === 0
          ? t('approvalChain.role.anyApprover', 'Any approver')
          : t('approvalChain.role.approver', 'Approver');

  return (
    <ol
      aria-label={t('approvalChain.label', 'Approval steps')}
      data-testid="approval-chain"
      className={['flex flex-wrap items-center gap-x-2 gap-y-1.5 text-control text-muted-foreground', className].filter(Boolean).join(' ')}
    >
      {steps.map((step, index) => {
        const faces = step.people.slice(0, MAX_FACES);
        const more = step.people.length - faces.length;
        const days = ageInDays(step.at);
        return (
          <React.Fragment key={step.key}>
            {index > 0 && <li aria-hidden className="h-px w-4 bg-border" />}
            <li data-state={step.state} data-step={step.key} className="flex min-w-0 items-center gap-1.5">
              {step.state === 'done' ? (
                <Icon name="check" className="size-3.5 shrink-0 text-success-text" />
              ) : (
                <Icon name="clock" className="size-3.5 shrink-0 text-warning-foreground" />
              )}
              {faces.length > 0 && (
                <span className="flex shrink-0 -space-x-1">
                  {faces.map((name) => <Avatar key={name} name={name} size="xs" className="ring-2 ring-background" />)}
                </span>
              )}
              {more > 0 && <span className="shrink-0">+{more}</span>}
              <span className="shrink-0">{roleLabel(step)}</span>
              <span aria-hidden>·</span>
              {step.state === 'done' ? (
                <span className="shrink-0 tabular">
                  <span className="sr-only">{t('approvalChain.doneOn', 'done')} </span>
                  {formatDay(step.at)}
                </span>
              ) : (
                <span className="shrink-0 font-medium text-foreground">
                  {days > 0
                    ? t('approvalChain.waitingDays', { count: days, defaultValue_one: 'waiting {{count}} day', defaultValue_other: 'waiting {{count}} days' })
                    : t('approvalChain.waitingToday', 'waiting since today')}
                </span>
              )}
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}
