import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Icon } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { OVERDUE_AFTER_DAYS } from '@/src/lib/selectors/approvalUrgency';
import { approvalChain, type ApprovalChainSource, type ApprovalChainStep } from '@/src/lib/procurement/approvalChain';

/**
 * #2058 — one line under the record header: who asked, who approved or decides next, and the wait.
 * Read-only; the decision gates and the transition are untouched.
 */
export const ApprovalChainStrip: React.FC<{ procurement: ApprovalChainSource; className?: string }> = ({ procurement, className }) => {
  const { t } = useTranslation('procurementRecord');
  const steps = useMemo(() => approvalChain(procurement), [procurement]);
  if (!steps) return null;

  const who = (step: ApprovalChainStep) => step.names.length > 0
    ? step.names.join(` ${t('chain.or', 'or')} `)
    : step.kind === 'requested'
      ? t('procurement:approvalRow.unknownRequester', 'Unknown requester')
      : t('chain.anApprover', 'An approver');

  const detail = (step: ApprovalChainStep) => {
    if (step.kind === 'next') {
      return step.waitingDays > 0
        ? t('chain.waitingDays', { count: step.waitingDays, defaultValue_one: 'Waiting {{count}} day', defaultValue_other: 'Waiting {{count}} days' })
        : t('chain.waitingUnderDay', 'Waiting under a day');
    }
    return step.at ? formatDay(step.at) : null;
  };

  return (
    <ol aria-label={t('chain.label', 'Approval chain')} className={['flex flex-wrap items-center gap-x-3 gap-y-2 text-control', className].filter(Boolean).join(' ')}>
      {steps.map((step, index) => {
        const done = step.kind !== 'next';
        const late = step.kind === 'next' && step.waitingDays >= OVERDUE_AFTER_DAYS;
        const role = step.kind === 'requested'
          ? t('chain.requested', 'Requested')
          : step.kind === 'approved'
            ? t('chain.approved', 'Approved')
            : t('chain.next', 'Next');
        const when = detail(step);
        return (
          <li key={step.kind} className="flex min-w-0 items-center gap-2">
            {index > 0 && <Icon name="chev" className="size-3.5 shrink-0 text-muted-foreground" />}
            <Avatar name={step.names[0] ?? null} size="xs" decorative />
            <span className="min-w-0 font-medium text-foreground">{who(step)}</span>
            <span className="text-muted-foreground">{role}</span>
            {when && <span className={late ? 'font-medium text-destructive-text' : 'text-muted-foreground'}>{when}</span>}
            <Icon name={done ? 'check' : 'clock'} className={done ? 'size-3.5 shrink-0 text-success-text' : 'size-3.5 shrink-0 text-muted-foreground'} />
            <span className="sr-only">{done ? t('chain.done', 'Done') : t('chain.waiting', 'Waiting')}</span>
          </li>
        );
      })}
    </ol>
  );
};
