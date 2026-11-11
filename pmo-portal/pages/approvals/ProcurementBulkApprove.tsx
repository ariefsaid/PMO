/* Bulk approval controls for procurement rows in the unified approvals inbox. */
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ConfirmDialog, Icon } from '@/src/components/ui';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import type { ProcurementBulkController } from './useProcurementBulkApprove';
import { formatCurrency } from '@/src/lib/format';

export function ProcurementBulkSelect({ controller }: { controller: ProcurementBulkController }) {
  const { t } = useTranslation();
  if (!controller.approvableIds.size || controller.selecting) return null;
  return (
    <Button variant="outline" size="sm" onClick={() => controller.setSelecting(true)}>
      <Icon name="check" />
      {t('procurement:procurementBulk.select', 'Select purchases')}
    </Button>
  );
}

export function ProcurementBulkToolbar({ controller }: { controller: ProcurementBulkController }) {
  const { t } = useTranslation();
  if (!controller.selecting) return null;
  const count = controller.effectiveSelected.size;
  const eligible = controller.approvableIds.size;
  const scope = eligible === controller.total
    ? eligible === 1
      ? t('procurement:procurementBulk.scopeOne', 'The 1 purchase request in this queue can be approved.')
      : t('procurement:procurementBulk.scopeAll', 'All {{count}} purchase requests in this queue can be approved.', { count: eligible })
    : t('procurement:procurementBulk.scopeSome', '{{eligible}} of {{total}} purchase requests in this queue can be approved.', {
        eligible,
        total: controller.total,
      });

  return (
    <div role="group" aria-label={t('procurement:procurementBulk.groupLabel', 'Bulk approve purchases')} className="mb-3 flex flex-wrap items-center gap-2.5 rounded-lg bg-primary/[0.06] px-3 py-2.5">
      <p className="basis-full text-control text-muted-foreground">{scope}</p>
      <Checkbox
        checked={controller.allSelected ? true : controller.someSelected ? 'mixed' : false}
        onChange={controller.toggleSelectAll}
        label={t('procurement:procurementBulk.selectAll', 'Select all purchase requests')}
        disabled={controller.running}
      />
      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-control font-semibold tabular text-muted-foreground">
        {t('procurement:procurementBulk.selectedCount', '{{count}} selected', { count })}
      </span>
      <span className="flex-1" />
      <Button variant="primary" size="sm" disabled={count === 0 || controller.running} loading={controller.running} onClick={() => controller.setConfirmOpen(true)}>
        <Icon name="check" />
        {t('procurement:procurementBulk.approveN', 'Approve {{count}}', { count })}
      </Button>
      <Button variant="outline" size="sm" onClick={controller.exitSelection} disabled={controller.running}>
        {t('procurement:procurementBulk.clear', 'Clear')}
      </Button>
    </div>
  );
}

export function ProcurementBulkConfirm({
  controller,
  procurements,
}: {
  controller: ProcurementBulkController;
  procurements: ProcurementWithRefs[];
}) {
  const { t } = useTranslation();
  if (!controller.confirmOpen || controller.effectiveSelected.size === 0) return null;
  const selectedRows = procurements.filter((row) => controller.effectiveSelected.has(row.id));
  const count = selectedRows.length;
  const evidenceLimit = 8;
  const title = count === 1
    ? t('procurement:procurementBulk.confirmTitleOne', 'Approve 1 purchase request?')
    : t('procurement:procurementBulk.confirmTitleMany', 'Approve {{count}} purchase requests?', { count });

  return (
    <ConfirmDialog
      open
      tone="default"
      title={title}
      description={(
        <span className="block">
          {t('procurement:procurementBulk.confirmDescription', 'Each purchase is approved separately. If one cannot be approved, the others can still be completed.')}
          <span className="mt-2 block space-y-0.5">
            {selectedRows.slice(0, evidenceLimit).map((row) => (
              <span key={row.id} className="block text-control">
                {row.title} · <span className="tabular">{formatCurrency(row.total_value, row.currency)}</span>
              </span>
            ))}
            {count > evidenceLimit && (
              <span className="block text-control text-muted-foreground">
                {t('procurement:procurementBulk.confirmMore', '{{count}} more selected', { count: count - evidenceLimit })}
              </span>
            )}
          </span>
        </span>
      )}
      confirmLabel={t('procurement:procurementBulk.approveN', 'Approve {{count}}', { count })}
      loading={controller.running}
      onCancel={() => controller.setConfirmOpen(false)}
      onConfirm={controller.commit}
    />
  );
}
