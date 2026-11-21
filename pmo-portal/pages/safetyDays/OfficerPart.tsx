import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, RecordSection, TextArea, TextField, useToast } from '@/src/components/ui';
import { useSafetyMutations } from '@/src/hooks/useSafetyDays';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatDay } from '@/src/lib/format';
import type { SafetyDayDetail } from '@/src/lib/db/safetyDays';

const count = (v: string) => (/^\d{1,4}$/.test(v) ? Number(v) : null);

/** The safety officer's report (FR-DSF-007): signed entries added to a draft or a locked day, never edited. */
export const OfficerPart: React.FC<{ detail: SafetyDayDetail; mayEnter: boolean }> = ({ detail, mayEnter }) => {
  const { t } = useTranslation('safety');
  const { toast } = useToast();
  const m = useSafetyMutations();
  const [body, setBody] = useState('');
  const [near, setNear] = useState('0');
  const [obs, setObs] = useState('0');
  const ok = body.trim() && body.length <= 4000 && count(near) !== null && count(obs) !== null;
  const add = async () => {
    try {
      await m.addOfficerEntry.mutateAsync({ dayId: detail.day.id, body, nearMisses: count(near) ?? 0, observations: count(obs) ?? 0 });
      setBody(''); setNear('0'); setObs('0');
    } catch (err) { const { headline, detail: d } = classifyMutationError(err); toast(headline, d, 'warning'); }
  };
  return (
    <RecordSection title={t('officer.title', 'Safety officer’s report')} data-testid="safety-officer">
      {detail.officer.length === 0 && <p className="text-muted-foreground">{t('officer.none', 'No report entered')}</p>}
      <ul className="divide-y divide-border">
        {detail.officer.map((e) => (
          <li key={e.id} className="py-3" data-testid="safety-officer-entry">
            <p className="whitespace-pre-wrap">{e.body}</p>
            <p className="mt-1 text-muted-foreground">
              {t('officer.counts', { defaultValue: '{{near}} near misses · {{obs}} observations', near: e.near_misses, obs: e.observations })} · {formatDay(e.created_at)}
            </p>
          </li>
        ))}
      </ul>
      {mayEnter && (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (ok) void add(); }}>
          <div className="sm:col-span-2"><TextArea label={t('officer.body', 'Report')} value={body} onChange={setBody} maxLength={4000} rows={4} required /></div>
          <TextField label={t('officer.near', 'Near misses')} inputMode="numeric" value={near} onChange={setNear} error={count(near) === null ? t('officer.number', 'A whole number') : undefined} />
          <TextField label={t('officer.obs', 'Observations')} inputMode="numeric" value={obs} onChange={setObs} error={count(obs) === null ? t('officer.number', 'A whole number') : undefined} />
          <div className="sm:col-span-2"><Button type="submit" variant="primary" disabled={!ok || m.addOfficerEntry.isPending} data-testid="safety-officer-add">{t('officer.add', 'Add entry')}</Button></div>
        </form>
      )}
    </RecordSection>
  );
};
