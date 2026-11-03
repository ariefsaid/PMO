import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { useProcurementBulkTransition } from '@/src/hooks/useProcurementDetail';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';

export type ProcurementBulkController = ReturnType<typeof useProcurementBulkApprove>;

export function useProcurementBulkApprove(rows: ProcurementWithRefs[]) {
  const { t } = useTranslation();
  const transition = useProcurementBulkTransition();
  const { toast } = useToast();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  const approvableIds = useMemo(() => new Set(rows.map((row) => row.id)), [rows]);
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter((id) => approvableIds.has(id))),
    [approvableIds, selected],
  );

  useEffect(() => {
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => approvableIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [approvableIds]);
  useEffect(() => {
    if (confirmOpen && effectiveSelected.size === 0) setConfirmOpen(false);
  }, [confirmOpen, effectiveSelected]);

  const allSelected = approvableIds.size > 0 && effectiveSelected.size === approvableIds.size;
  const someSelected = effectiveSelected.size > 0 && !allSelected;
  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggleSelected = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSelectAll = () => setSelected(allSelected ? new Set() : new Set(approvableIds));

  const commit = async () => {
    const selectedRows = rows.filter((row) => effectiveSelected.has(row.id));
    if (selectedRows.length === 0) {
      setConfirmOpen(false);
      return;
    }

    setRunning(true);
    // Each row is its own transition RPC. One stale or unauthorized row must not roll back the
    // others, and the server re-evaluates routing and SoD for every request.
    const results = await Promise.allSettled(
      selectedRows.map((row) => transition.mutateAsync({ id: row.id, to: 'Approved' })),
    );
    const failedRows = selectedRows.filter((_, index) => results[index].status === 'rejected');
    const approved = results.length - failedRows.length;
    const shownFailedTitles = failedRows.slice(0, 3).map((row) => row.title).join(', ');
    const moreFailed = failedRows.length > 3
      ? t('procurement:procurementBulk.toast.more', ' and {{count}} more', { count: failedRows.length - 3 })
      : '';
    const failureSummary = t(
      'procurement:procurementBulk.toast.failureRows',
      'Could not approve: {{titles}}{{more}}',
      { titles: shownFailedTitles, more: moreFailed },
    );

    setRunning(false);
    setConfirmOpen(false);
    exitSelection();

    if (failedRows.length === 0) {
      toast(
        t('procurement:procurementBulk.toast.allOk.headline', 'Purchases approved'),
        t('procurement:procurementBulk.toast.allOk.detail', '{{count}} approved', { count: approved }),
        'success',
      );
    } else if (approved === 0) {
      toast(
        t('procurement:procurementBulk.toast.noneOk.headline', "Couldn't approve purchases"),
        t('procurement:procurementBulk.toast.noneOk.detail', '{{count}} failed. {{rows}}', { count: failedRows.length, rows: failureSummary }),
        'warning',
      );
    } else {
      toast(
        t('procurement:procurementBulk.toast.partial.headline', 'Partially approved'),
        t('procurement:procurementBulk.toast.partial.detail', '{{ok}} approved, {{failed}} failed. {{rows}}', {
          ok: approved,
          failed: failedRows.length,
          rows: failureSummary,
        }),
        'warning',
      );
    }
  };

  return {
    total: rows.length,
    selecting,
    setSelecting,
    selected,
    effectiveSelected,
    approvableIds,
    allSelected,
    someSelected,
    toggleSelected,
    toggleSelectAll,
    exitSelection,
    confirmOpen,
    setConfirmOpen,
    running,
    commit,
  };
}
