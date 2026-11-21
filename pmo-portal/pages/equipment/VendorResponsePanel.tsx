import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, EntityFormModal, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { formatDuration, useBreakdowns, useClearVendorResponse, useRecordVendorResponse, useVendorNames, useVendorResponseReady } from '@/src/hooks/useVendorResponse';
import type { BreakdownRow } from '@/src/lib/db/equipmentVendorResponse';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatIsoDay } from '@/src/lib/format';
import { vendorResponseSummary } from '@/src/lib/vendorResponse';
import { VendorResponseSummaryTable } from './VendorResponseSummary';

/** The last 12 months, by breakdown start date (the read is bounded to 400 days). */
const yearBefore = (today: string): string => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 365);
  return d.toISOString().slice(0, 10);
};

/** A datetime-local value for an ISO instant (the viewer's local clock), and back. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const RecordDialog: React.FC<{ assetId: string; row: BreakdownRow; onClose: () => void }> = ({ assetId, row, onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const record = useRecordVendorResponse();
  const [responded, setResponded] = useState(toLocalInput(row.responded_at));
  const [reported, setReported] = useState(row.responded_at ? toLocalInput(row.reported_at) : '');
  const [note, setNote] = useState(row.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    try {
      await record.mutateAsync({
        asset_id: assetId, period_start: row.period_start, responded_at: new Date(responded).toISOString(),
        reported_at: reported ? new Date(reported).toISOString() : null, note: note.trim() || null,
      });
      toast(t('equipment:vendorResponse.saved', 'Vendor response saved'), undefined, 'success');
      onClose();
    } catch (err) { setProblem(classifyMutationError(err).headline); }
  };
  return (
    <EntityFormModal open title={t('equipment:vendorResponse.recordTitle', 'Vendor response, breakdown from {{date}}', { date: formatIsoDay(row.period_start) })}
      submitLabel={t('equipment:vendorResponse.save', 'Save response')} onSubmit={(e) => void submit(e)} onClose={onClose}
      submitDisabled={!responded || record.isPending} loading={record.isPending} dirty
      submitError={problem ? { headline: problem } : null}>
      <div className="grid gap-3">
        <TextField label={t('equipment:vendorResponse.respondedAt', 'Vendor responded')} type="datetime-local" value={responded} onChange={setResponded} required />
        <TextField label={t('equipment:vendorResponse.reportedAt', 'Reported (optional, defaults to the start of the first day)')} type="datetime-local" value={reported} onChange={setReported} />
        <TextField label={t('equipment:vendorResponse.note', 'Note (optional)')} value={note} onChange={setNote} />
      </div>
    </EntityFormModal>
  );
};

const Panel: React.FC<{ assetId: string; today: string }> = ({ assetId, today }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const canRecord = may('create', 'equipmentAvailability', { record: { viewOnly: realRole !== effectiveRole } });
  const ids = useMemo(() => [assetId], [assetId]);
  const q = useBreakdowns(ids, yearBefore(today), today);
  const vendorName = useVendorNames();
  const duration = (m: number) => formatDuration(t, m);
  const clear = useClearVendorResponse();
  const [editing, setEditing] = useState<BreakdownRow | null>(null);
  const [removing, setRemoving] = useState<BreakdownRow | null>(null);
  const rows = q.data ?? [];
  // Nothing to show until the machine has broken down at least once: an organisation with none sees no change.
  if (q.isPending || q.isError || rows.length === 0) return null;
  const summary = vendorResponseSummary(rows.flatMap((r) => (r.vendor_id ? [{ vendorId: r.vendor_id, responseMinutes: r.response_minutes }] : [])));
  return (
    <Card className="mb-6">
      <CardHead title={t('equipment:vendorResponse.title', 'Vendor response to breakdowns')} />
      <CardPad>
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li key={r.period_start} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {formatIsoDay(r.period_start)} · {r.vendor_id ? vendorName(r.vendor_id) : t('equipment:vendorResponse.noVendor', 'No rental vendor')}
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{r.response_minutes == null ? t('equipment:vendorResponse.awaiting', 'Awaiting response') : duration(r.response_minutes)}</span>
                {canRecord && r.vendor_id && <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                  {r.responded_at ? t('equipment:vendorResponse.edit', 'Edit') : t('equipment:vendorResponse.record', 'Record response')}</Button>}
                {canRecord && r.responded_at && <Button variant="outline" size="sm" onClick={() => setRemoving(r)}>{t('equipment:vendorResponse.remove', 'Remove')}</Button>}
              </span>
            </li>
          ))}
        </ul>
        {summary.length > 0 && <div className="mt-4"><VendorResponseSummaryTable rows={summary} /></div>}
      </CardPad>
      {editing && <RecordDialog assetId={assetId} row={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={removing !== null} title={t('equipment:vendorResponse.removeTitle', 'Remove this response?')}
        description={t('equipment:vendorResponse.removeBody', 'The breakdown goes back to awaiting a response.')}
        confirmLabel={t('equipment:vendorResponse.remove', 'Remove')} tone="destructive" loading={clear.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (!removing) return; void clear.mutateAsync({ assetId, periodStart: removing.period_start })
          .then(() => { toast(t('equipment:vendorResponse.removed', 'Response removed'), undefined, 'success'); setRemoving(null); })
          .catch(() => setRemoving(null)); }} />
    </Card>
  );
};

/** Mount point for a rented asset's page: nothing for an owned asset or outside the app providers. */
export const VendorResponsePanel: React.FC<{ asset: { id: string; ownership?: string | null }; today: string }> = ({ asset, today }) => {
  const ready = useVendorResponseReady();
  if (!ready || asset.ownership !== 'rented') return null;
  return <Panel assetId={asset.id} today={today} />;
};
export default VendorResponsePanel;
