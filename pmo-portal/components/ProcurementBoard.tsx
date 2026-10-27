import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React from 'react';
import { Kanban, KanbanCard, KanbanColumn } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { NeedsYouReason } from '@/pages/procurement/blocks/needsYou';
import { useTranslation } from 'react-i18next';
import { figureForListRow, totalsByCurrency, type ProcurementListRole } from '@/pages/procurement/list/model';
import { MoneyTotalLines } from '@/pages/procurement/list/MoneyTotalLines';

interface ProcurementBoardProps {
  procurements: ProcurementWithRefs[];
  /** Drill into the procurement lifecycle detail (opens a workspace record tab). */
  onOpen: (procurement: ProcurementWithRefs) => void;
  /** Currently-open procurement id — highlights its card. */
  selectedId?: string;
  /** Amount visibility follows the same frontend role scope as the Procurement list. */
  viewerRole?: ProcurementListRole;
  /** Needs-you rationale is shown on every board card while that tab is active. */
  needsYouReasons?: ReadonlyMap<string, { result: NeedsYouReason; text: string }>;
}

type BoardStageKey = 'request' | 'approved' | 'ordered' | 'received' | 'paid';

const BOARD_STAGES: Array<{
  key: BoardStageKey;
  label: string;
  fallback: string;
  statuses: readonly string[];
}> = [
  { key: 'request', label: 'board.request', fallback: 'Request', statuses: ['Draft', 'Requested'] },
  { key: 'approved', label: 'board.approved', fallback: 'Approved', statuses: ['Approved', 'Vendor Quoted', 'Quote Selected'] },
  { key: 'ordered', label: 'board.ordered', fallback: 'Ordered', statuses: ['Ordered'] },
  { key: 'received', label: 'board.received', fallback: 'Received', statuses: ['Received'] },
  { key: 'paid', label: 'board.paid', fallback: 'Paid', statuses: ['Vendor Invoiced', 'Paid'] },
];

/** Initial-letter avatar tile for the requester (categorical, non-interactive). */
const Initial: React.FC<{ name: string | undefined }> = ({ name }) => {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden
      title={name ?? undefined}
      className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground"
    >
      {initial}
    </span>
  );
};

/** A compact procurement card with a computed amount, its basis, and any current action reason. */
const PrCard: React.FC<{
  pr: ProcurementWithRefs;
  selected: boolean;
  role: ProcurementListRole;
  reason?: string;
  onActivate: () => void;
}> = ({ pr, selected, role, reason, onActivate }) => {
  const { t } = useTranslation('procurementList');
  const figure = figureForListRow(pr, role);
  const amount = figure.unknown || figure.amount === null ? '—' : formatCurrency(figure.amount, pr.currency);
  const amountKind = figure.kind ? t(`money.kind.${figure.kind}`, figure.kind) : t('money.unavailable', 'Amount unavailable');
  const tooltip = t(role === 'Engineer' ? 'money.engineer' : 'money.mostReal', role === 'Engineer'
    ? 'Request amount only. Supplier invoice and payment amounts are not shown.'
    : 'Most real amount: paid, then supplier invoice, then purchase order, then request.');
  const statusLabel = pr.status === 'Vendor Invoiced'
    ? t('status.invoiceToPay', 'Supplier invoice to pay')
    : pr.status === 'Paid' ? t('status.paid', 'Paid') : undefined;

  return (
    <KanbanCard selected={selected} onActivate={onActivate} aria-label={t('board.open', { title: pr.title, defaultValue: `Open ${pr.title}` })}>
      <div className="line-clamp-2 text-[13px] font-semibold leading-snug" title={pr.title}>
        {pr.title}
      </div>
      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
        {pr.code ?? pr.id.slice(0, 8)}
      </div>
      <span
        title={tooltip}
        aria-label={`${amount} ${amountKind}. ${tooltip}`}
        tabIndex={0}
        className="mt-2 inline-flex flex-col text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[15px] font-semibold tabular">{amount}</span>
        <span className="text-[11px] text-muted-foreground">{amountKind}</span>
      </span>
      {reason && <div className="mt-2 text-[12px] font-medium text-warning-foreground">{reason}</div>}
      {statusLabel && <div className="mt-1 text-[11px] text-muted-foreground">{statusLabel}</div>}
      <div className="mt-2.5 flex items-center gap-2 border-t border-border/70 pt-2">
        <Initial name={pr.requested_by?.full_name} />
        {/* Keep the card as a single activation target; project navigation remains on the detail page. */}
        <span
          aria-label={pr.project?.name ? `Project: ${projectDisplayName(pr.project)}` : undefined}
          title={pr.project && projectDisplayName(pr.project) !== pr.project.name ? pr.project.name : undefined}
          className="truncate text-[11px] text-muted-foreground"
        >
          {pr.project ? projectDisplayName(pr.project) : '—'}
        </span>
      </div>
    </KanbanCard>
  );
};

/** Five workflow columns. Rejected and cancelled records remain available in Table and Grouped views. */
const ProcurementBoard: React.FC<ProcurementBoardProps> = ({
  procurements,
  onOpen,
  selectedId,
  viewerRole,
  needsYouReasons,
}) => {
  const { t } = useTranslation('procurementList');
  const byStage = new Map<BoardStageKey, ProcurementWithRefs[]>(BOARD_STAGES.map(({ key }) => [key, []]));
  for (const procurement of procurements) {
    const stage = BOARD_STAGES.find(({ statuses }) => statuses.includes(procurement.status));
    if (stage) byStage.get(stage.key)?.push(procurement);
  }

  return (
    <Kanban aria-label={t('board.label', 'Procurement by stage')}>
      {BOARD_STAGES.map(({ key, label, fallback }) => {
        const items = byStage.get(key) ?? [];
        const totals = totalsByCurrency(items, viewerRole);
        const tooltip = t(viewerRole === 'Engineer' ? 'money.engineer' : 'money.mostReal', viewerRole === 'Engineer'
          ? 'Request amount only. Supplier invoice and payment amounts are not shown.'
          : 'Most real amount per procurement: paid, then supplier invoice, then purchase order, then request. Summed by currency.');
        const stageTitle = t(label, fallback);
        return (
          <div key={key} data-testid={`prstage-${key}`} className="flex min-w-0 flex-col">
            <KanbanColumn
              title={stageTitle}
              dotColor={key === 'paid' ? 'hsl(var(--success))' : 'hsl(var(--muted-foreground))'}
              count={items.length}
              totals={<MoneyTotalLines totals={totals} tooltip={tooltip} testId={`prstage-${key}-totals`} className="items-end" />}
              emptyMessage={t('board.empty', { stage: stageTitle, defaultValue: `No procurements at ${stageTitle}` })}
            >
              {items.map((procurement) => (
                <PrCard
                  key={procurement.id}
                  pr={procurement}
                  selected={procurement.id === selectedId}
                  role={viewerRole}
                  reason={needsYouReasons?.get(procurement.id)?.text}
                  onActivate={() => onOpen(procurement)}
                />
              ))}
            </KanbanColumn>
          </div>
        );
      })}
    </Kanban>
  );
};

export default ProcurementBoard;
