import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, SelectField, StatusPill, TextField, useToast } from '@/src/components/ui';
import { useSafetyList, useSafetyMutations } from '@/src/hooks/useSafetyDays';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import type { SafetyDayDetail } from '@/src/lib/db/safetyDays';

const stamp = (iso: string) => `${formatDay(iso)} ${new Date(iso).toTimeString().slice(0, 5)}`;

/** Permit to work (FR-DSF-005): number, type from the client's list, valid-from to valid-to, issued by; recorded only (OQ-DSF-2). */
export const PermitsPart: React.FC<{ detail: SafetyDayDetail; editable: boolean }> = ({ detail, editable }) => {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const m = useSafetyMutations();
  const types = useSafetyList('permit_type');
  const date = detail.day.work_date;
  const [number, setNumber] = useState('');
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState('07:00');
  const [to, setTo] = useState('17:00');
  const [issuedBy, setIssuedBy] = useState('');
  const fail = (err: unknown) => { const { headline, detail: d } = classifyMutationError(err); toast(headline, d, 'warning'); };
  const orderOk = from <= to;
  const ok = number.trim() && /^\d{2}:\d{2}$/.test(from) && /^\d{2}:\d{2}$/.test(to) && orderOk;
  const typeLabel = (id: string | null) => types.data?.find((x) => x.id === id)?.label;

  const add = async () => {
    try {
      await m.savePermit.mutateAsync({
        dayId: detail.day.id, permitNumber: number, typeId: typeId || null, issuedBy,
        validFrom: new Date(`${date}T${from}:00`).toISOString(), validTo: new Date(`${date}T${to}:00`).toISOString(),
      });
      setNumber(''); setIssuedBy('');
    } catch (err) { fail(err); }
  };
  return (
    <RecordSection title={t('permits.title', 'Permit to work')} data-testid="safety-permits">
      {detail.permits.length === 0 && <p className="text-muted-foreground">{t('permits.none', 'No permit recorded')}</p>}
      <ul className="divide-y divide-border">
        {detail.permits.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2" data-testid="safety-permit-row">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{p.permit_number}</span>
              {typeLabel(p.type_id) && <span className="text-muted-foreground">{typeLabel(p.type_id)}</span>}
              <span className="tabular-nums">{stamp(p.valid_from)} – {stamp(p.valid_to)}</span>
              {p.issued_by && <span className="text-muted-foreground">{t('permits.issuedBy', { defaultValue: 'Issued by {{name}}', name: p.issued_by })}</span>}
              <StatusPill variant={p.state === 'open' ? 'open' : 'won'}>{p.state === 'open' ? t('permits.open', 'Open') : t('permits.closed', 'Closed')}</StatusPill>
            </span>
            {editable && (
              <span className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void m.setPermitState.mutateAsync({ id: p.id, state: p.state === 'open' ? 'closed' : 'open' }).catch(fail)}>{p.state === 'open' ? t('permits.close', 'Close') : t('permits.reopen', 'Reopen')}</Button>
                <Button variant="ghost" size="sm" onClick={() => void m.deletePermit.mutateAsync(p.id).catch(fail)}>{t('form.remove', 'Remove')}</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (ok) void add(); }}>
          <TextField label={t('permits.number', 'Permit number')} value={number} onChange={setNumber} required />
          {(types.data?.length ?? 0) > 0 && (
            <SelectField label={t('permits.type', 'Permit type')} value={typeId} onChange={setTypeId} options={[{ value: '', label: t('permits.typeNone', 'No type') }, ...(types.data ?? []).map((x) => ({ value: x.id, label: x.label }))]} />
          )}
          <TextField label={t('permits.validFrom', 'Valid from')} type="time" value={from} onChange={setFrom} required />
          <TextField label={t('permits.validTo', 'Valid to')} type="time" value={to} onChange={setTo} required error={orderOk ? undefined : t('permits.order', 'Valid-to must not be before valid-from')} />
          <TextField label={t('permits.issuer', 'Issued by')} value={issuedBy} onChange={setIssuedBy} />
          <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={!ok || m.savePermit.isPending} data-testid="safety-permit-add">{t('permits.add', 'Add permit')}</Button></div>
        </form>
      )}
    </RecordSection>
  );
};
