import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImportButton } from '@/src/components/import';
import { makeClientTakeoffImportDescriptor } from '@/src/lib/import';
import { Button, ConfirmDialog, ListState, RecordSection, StatusPill, type StatusVariant } from '@/src/components/ui';
import { useOptionalToast } from '@/src/components/ui/Toast';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import type { Action } from '@/src/auth/policy';
import { useClientRequisitionMutations, useWorkOrderClientMaterial } from '@/src/hooks/useClientRequisitions';
import { useStockItems, useStockKeepers, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { useStockTags } from '@/src/hooks/useStockSiteWork';
import { rollupClientRequisitions, rollupEvents, type CsrLineFigures } from '@/src/lib/clientRequisitionRollup';
import type { ClientRequisitionLineRow, ClientRequisitionRow, ClientRequisitionStatus } from '@/src/lib/repositories/clientRequisitions';
import { formatDay, formatNumberExact } from '@/src/lib/format';
import { PickupDialog, ReleaseDialog, RequisitionFormDialog, ReservationDialog, type RequisitionDraftLine } from './ClientMaterialDialogs';
import { useSubmitError, type Option } from './clientMaterialText';

interface Props {
  workOrderId: string;
  projectId: string;
  /** The work order's status: a Closed or Cancelled work order takes no new requisition. */
  workOrderStatus: string;
  /** The work order's allocation rows as "item code - description" options (optional link of a line to a contract line). */
  allocationOptions: Option[];
}

const STATUS_VARIANT: Record<ClientRequisitionStatus, StatusVariant> = { draft: 'draft', open: 'progress', cancelled: 'neutral' };

type Dialog =
  | { kind: 'new' }
  | { kind: 'edit'; requisition: ClientRequisitionRow }
  | { kind: 'reserve' | 'release' | 'pickup'; line: ClientRequisitionLineRow; figures: CsrLineFigures }
  | { kind: 'cancel'; requisition: ClientRequisitionRow };

const Figure: React.FC<{ label: string; value: string; testId?: string }> = ({ label, value, testId }) => (
  <div className="min-w-0">
    <dt className="text-control text-muted-foreground">{label}</dt>
    <dd className="tabular-nums font-medium" data-testid={testId}>{formatNumberExact(Number(value))}</dd>
  </div>
);

/**
 * Client material (#2585, FR-CSR-018..020): what each requisition asked the client to release for this work order, what
 * the client has reserved, what has been collected and what is still to collect. Figures are derived from the event and
 * pickup rows (never stored); an item in two units shows twice (AC-CSR-002); a work order with no requisition shows an
 * empty state, not zeros (AC-CSR-003). Every action is gated by can() and enforced by the csr_* RPCs.
 */
export const ClientMaterialSection: React.FC<Props> = ({ workOrderId, projectId, workOrderStatus, allocationOptions }) => {
  const { t } = useTranslation('workOrders');
  const { t: tAll } = useTranslation();
  const submitError = useSubmitError();
  const may = usePermission();
  const userId = useAuth().currentUser?.id;
  const { realRole, effectiveRole } = useEffectiveRole();
  const viewOnly = realRole !== effectiveRole;                  // view-as is view-only (ADR-0016)
  const q = useWorkOrderClientMaterial(workOrderId);
  const m = useClientRequisitionMutations();
  const toast = useOptionalToast();
  const tags = useStockTags();
  const zeroCostTagIds = useMemo(() => (tags.data ?? []).filter((tg) => tg.zero_cost).map((tg) => tg.id), [tags.data]);
  const zeroCostTagSet = useMemo(() => new Set(zeroCostTagIds), [zeroCostTagIds]);
  const items = useStockItems(
    { tagIds: zeroCostTagIds, limit: 1000 },
    { enabled: Boolean(tags.data) && zeroCostTagIds.length > 0 },
  );
  const units = useStockUnits();
  const warehouses = useStockWarehouses();
  const keepers = useStockKeepers();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const title = t('clientMaterial.title', 'Client material');
  const data = q.data;
  const openLines = useMemo(() => (data?.lines ?? []).filter((l) => l.requisitionStatus === 'open'), [data?.lines]);
  const sums = useMemo(() => rollupEvents(data?.events ?? [], data?.pickups ?? []), [data?.events, data?.pickups]);
  const rollup = useMemo(() => rollupClientRequisitions(openLines, sums), [openLines, sums]);
  const figuresByLine = useMemo(() => new Map(rollupClientRequisitions(data?.lines ?? [], sums).lines.map((f) => [f.lineId, f])), [data?.lines, sums]);

  // Items offered on the form: only those whose tag is zero-cost (the organisation names the tag; the rule is the flag).
  const unitCode = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.code])), [units.data]);
  const formItems = useMemo(
    () => (items.data ?? []).filter((i) => i.tag_id && zeroCostTagSet.has(i.tag_id)).map((i) => ({ id: i.id, code: i.code, name: i.name, unit: unitCode.get(i.unit_id) ?? '' })),
    [items.data, zeroCostTagSet, unitCode],
  );

  // Receiving locations: site, yard and staging locations of this project; a keeper offers the ones they keep, an Admin all.
  const projectLocations = useMemo(
    () => (warehouses.data ?? []).filter((w) => w.project_id === projectId && ['site', 'yard', 'staging'].includes(w.kind)),
    [warehouses.data, projectId],
  );
  const myKept = useMemo(() => new Set((keepers.data ?? []).filter((k) => k.user_id === userId).map((k) => k.warehouse_id)), [keepers.data, userId]);
  // Only an Admin may record a pickup without keeping the location (the policy's keeper test fails for them): any location of the project.
  const isKeeper = projectLocations.some((w) => myKept.has(w.id));
  const isAdmin = may('recordPickup', 'clientRequisition', { currentUserId: userId, record: { status: 'open', isKeeper: false, viewOnly } });
  const pickupLocations: Option[] = projectLocations
    .filter((w) => isAdmin || myKept.has(w.id))
    .map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` }));

  const takeoffDescriptor = useMemo(() => makeClientTakeoffImportDescriptor({
    workOrderId,
    items: (items.data ?? []).filter((i) => i.tag_id && zeroCostTagSet.has(i.tag_id))
      .map((i) => ({ id: i.id, code: i.code, name: i.name, wholeOnly: (units.data ?? []).find((u) => u.id === i.unit_id)?.whole_only === true })),
  }, tAll), [workOrderId, items.data, units.data, zeroCostTagSet, tAll]);

  const woOpen = workOrderStatus === 'Draft' || workOrderStatus === 'Issued';
  const canCreate = woOpen && may('create', 'clientRequisition', { record: { viewOnly } });

  const act = (fn: () => Promise<unknown>) => {
    setActionError(null);
    void fn().catch((err: unknown) => setActionError(submitError(err).headline));
  };

  const statusLabel = (s: ClientRequisitionStatus) =>
    s === 'draft' ? t('clientMaterial.status.draft', 'Draft') : s === 'open' ? t('clientMaterial.status.open', 'Open') : t('clientMaterial.status.cancelled', 'Cancelled');

  const newButton = canCreate ? (
    <>
      <ImportButton entity="clientRequisition" descriptor={takeoffDescriptor} onImported={() => void q.refetch()} label={t('clientMaterial.importTakeoff', 'Import take-off')} />
      <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'new' })}>{t('clientMaterial.newRequisition', 'New requisition')}</Button>
    </>
  ) : undefined;

  if (q.isPending) return <RecordSection title={title}><ListState variant="loading" rows={3} /></RecordSection>;
  if (q.isError || !data) {
    return <RecordSection title={title}><ListState variant="error" title={t('clientMaterial.error', "Couldn't load the client material")} onRetry={() => void q.refetch()} /></RecordSection>;
  }

  const draftInitial = (r: ClientRequisitionRow): { clientReference: string; lines: RequisitionDraftLine[] } => ({
    clientReference: r.clientReference ?? '',
    lines: data.lines.filter((l) => l.requisitionId === r.id).map((l) => ({
      stockItemId: l.itemId, takeoff: l.takeoffQuantity, requested: l.requestedQuantity === l.takeoffQuantity ? '' : l.requestedQuantity, allocationId: '',
    })),
  });

  return (
    <RecordSection title={title} actions={newButton} data-testid="client-material-section">
      {actionError && <p role="alert" className="mb-3 text-control text-destructive" data-testid="csr-action-error">{actionError}</p>}
      {data.requisitions.length === 0 ? (
        <p className="text-control text-muted-foreground" data-testid="csr-empty">{t('clientMaterial.empty', 'No client material has been requested for this work order yet.')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {rollup.items.length > 0 && (
            <div className="flex flex-col gap-4" data-testid="csr-totals">
              {rollup.items.map((it) => (
                <div key={`${it.itemId}-${it.unit}`} data-testid={`csr-total-${it.itemId}-${it.unit}`}>
                  <h3 className="font-medium">{it.itemName} <span className="text-muted-foreground">({it.unit})</span></h3>
                  <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-5">
                    <Figure label={t('clientMaterial.requested', 'Requested')} value={it.requested} testId="csr-requested" />
                    <Figure label={t('clientMaterial.reserved', 'Reserved')} value={it.reserved} testId="csr-reserved" />
                    <Figure label={t('clientMaterial.collected', 'Collected')} value={it.collected} testId="csr-collected" />
                    <Figure label={t('clientMaterial.stillToCollect', 'Still to collect')} value={it.stillToCollect} testId="csr-still" />
                    <Figure label={t('clientMaterial.awaiting', 'Awaiting reservation')} value={it.awaitingReservation} testId="csr-awaiting" />
                  </dl>
                </div>
              ))}
            </div>
          )}
          <ul className="flex flex-col gap-5">
            {data.requisitions.map((r) => {
              const lines = data.lines.filter((l) => l.requisitionId === r.id);
              const events = data.events.filter((e) => e.requisitionId === r.id && ['reserved', 'released'].includes(e.kind));
              const pickups = data.pickups.filter((p) => p.requisitionId === r.id);
              const rec = { status: r.status, created_by: r.createdBy, hasPickup: pickups.length > 0, isKeeper, viewOnly };
              const allow = (a: Action) => may(a, 'clientRequisition', { currentUserId: userId, record: rec });
              return (
                <li key={r.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0" data-testid={`csr-${r.number}`}>
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium tabular-nums">{r.number}</span>
                      <StatusPill variant={STATUS_VARIANT[r.status]}>{statusLabel(r.status)}</StatusPill>
                      {r.clientReference && <span className="text-control text-muted-foreground">{t('clientMaterial.clientReference', 'Client reference {{ref}}', { ref: r.clientReference })}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {allow('edit') && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'edit', requisition: r })}>{t('clientMaterial.edit', 'Edit')}</Button>}
                      {allow('send') && <Button size="sm" variant="primary" onClick={() => act(() => m.send.mutateAsync({ id: r.id }))}>{t('clientMaterial.send', 'Send to client')}</Button>}
                      {allow('cancel') && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'cancel', requisition: r })}>{t('clientMaterial.cancel', 'Cancel')}</Button>}
                    </div>
                  </div>
                  <ul className="mt-2 divide-y divide-border">
                    {lines.map((l) => {
                      const f = figuresByLine.get(l.id);
                      if (!f) return null;
                      return (
                        <li key={l.id} className="flex flex-col gap-2 py-2" data-testid={`csr-line-${l.id}`}>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                            <span>{l.itemCode} · {l.itemName} <span className="text-muted-foreground">({l.unit})</span></span>
                            <span className="text-control tabular-nums text-muted-foreground" data-testid="csr-line-figures">
                              {t('clientMaterial.lineFigures', 'Requested {{requested}} · reserved {{reserved}} · collected {{collected}} · still to collect {{still}}', {
                                requested: formatNumberExact(Number(f.requested)), reserved: formatNumberExact(Number(f.reserved)),
                                collected: formatNumberExact(Number(f.collected)), still: formatNumberExact(Number(f.stillToCollect)),
                              })}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {allow('recordReservation') && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'reserve', line: l, figures: f })}>{t('clientMaterial.recordReservation', 'Record reservation')}</Button>}
                            {allow('recordRelease') && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'release', line: l, figures: f })}>{t('clientMaterial.recordRelease', 'Record release')}</Button>}
                            {allow('recordPickup') && <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'pickup', line: l, figures: f })}>{t('clientMaterial.recordPickup', 'Record pickup')}</Button>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {(events.length > 0 || pickups.length > 0) && (
                    <details className="mt-2" data-testid={`csr-history-${r.number}`}>
                      <summary className="cursor-pointer text-control text-muted-foreground">{t('clientMaterial.history', 'Reservations and pickups')}</summary>
                      <ul className="mt-2 flex flex-col gap-1 text-control tabular-nums">
                        {events.map((e) => (
                          <li key={e.id}>
                            {e.kind === 'reserved'
                              ? t('clientMaterial.historyReserved', 'Reserved {{n}} · {{ref}}{{date}}', { n: formatNumberExact(Number(e.quantity)), ref: e.clientReference ?? '', date: e.eventOn ? ` · ${formatDay(e.eventOn)}` : '' })
                              : t('clientMaterial.historyReleased', 'Released {{n}} · {{reason}}', { n: formatNumberExact(Number(e.quantity)), reason: e.reason ?? '' })}
                          </li>
                        ))}
                        {pickups.map((p) => (
                          <li key={p.id}>
                            {t('clientMaterial.historyPickup', 'Collected {{n}} · {{date}}{{who}}{{paper}}', {
                              n: formatNumberExact(Number(p.quantity)), date: formatDay(p.pickedUpOn),
                              who: p.collector ? ` · ${p.collector}` : '', paper: p.paperReference ? ` · ${p.paperReference}` : '',
                            })}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {dialog?.kind === 'new' && (
        <RequisitionFormDialog title={t('clientMaterial.form.newTitle', 'New client requisition')} submitLabel={t('clientMaterial.form.create', 'Create requisition')}
          items={formItems} allocationOptions={allocationOptions} initial={{ clientReference: '', lines: [] }} onClose={() => setDialog(null)}
          onSave={(v) => m.create.mutateAsync({ workOrderId, clientReference: v.clientReference, lines: v.lines.map((l) => ({ ...l })), clientRequestId: crypto.randomUUID() })} />
      )}
      {dialog?.kind === 'edit' && (
        <RequisitionFormDialog title={t('clientMaterial.form.editTitle', 'Edit client requisition')} submitLabel={t('clientMaterial.form.save', 'Save changes')}
          items={formItems} allocationOptions={allocationOptions} initial={draftInitial(dialog.requisition)} onClose={() => setDialog(null)}
          onSave={(v) => m.updateDraft.mutateAsync({ id: dialog.requisition.id, clientReference: v.clientReference, lines: v.lines.map((l) => ({ ...l })) })} />
      )}
      {dialog?.kind === 'reserve' && (
        <ReservationDialog line={dialog.line} figures={dialog.figures} onClose={() => setDialog(null)}
          onSave={(v) => m.recordReservation.mutateAsync({ lineId: dialog.line.id, ...v, clientRequestId: crypto.randomUUID() })} />
      )}
      {dialog?.kind === 'release' && (
        <ReleaseDialog line={dialog.line} figures={dialog.figures} onClose={() => setDialog(null)}
          onSave={(v) => m.recordRelease.mutateAsync({ lineId: dialog.line.id, ...v, clientRequestId: crypto.randomUUID() })} />
      )}
      {dialog?.kind === 'pickup' && (
        <PickupDialog line={dialog.line} figures={dialog.figures} locations={pickupLocations} onClose={() => setDialog(null)}
          onSave={(v) => m.recordPickup.mutateAsync({ lineId: dialog.line.id, ...v, clientRequestId: crypto.randomUUID() }).then((res) => {
            if (res?.slipFailed) toast?.toast(t('clientMaterial.pickup.slipFailed', 'Pickup recorded, but the slip photo was not saved. Add it under Attachments on the receipt.'), undefined, 'warning');
          })} />
      )}
      {dialog?.kind === 'cancel' && (
        <ConfirmDialog open tone="destructive" title={t('clientMaterial.cancelTitle', 'Cancel this requisition?')}
          description={t('clientMaterial.cancelBody', '{{number}} keeps its history but takes no more reservations or pickups.', { number: dialog.requisition.number })}
          confirmLabel={t('clientMaterial.cancelConfirm', 'Cancel requisition')} cancelLabel={t('clientMaterial.cancelKeep', 'Keep it')}
          loading={m.cancel.isPending} error={m.cancel.isError ? submitError(m.cancel.error).headline : undefined}
          onCancel={() => { m.cancel.reset(); setDialog(null); }}
          onConfirm={() => void m.cancel.mutateAsync({ id: dialog.requisition.id }).then(() => setDialog(null)).catch(() => undefined)} />
      )}
    </RecordSection>
  );
};
