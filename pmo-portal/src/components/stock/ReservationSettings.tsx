import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SelectField, TextField } from '@/src/components/ui';
import { useReservationRefresh, useReservationSettings } from '@/src/hooks/useStockReservations';
import { stockReservationsRepository as repo, type BorrowMode, type ReservationSettings as Settings } from '@/src/lib/repositories/stockReservations';
import { useStockErrorText } from './useStockErrorText';

const ROLES = ['Engineer', 'Project Manager', 'Finance', 'Executive', 'Admin'] as const;

/** How borrowing from a reservation is handled and who approves it (#2693). Reservations themselves are on for everyone (#2746). Renders nothing until the setting has been read, so a screen without it shows no new control. */
export const ReservationSettings: React.FC = () => {
  const { t } = useTranslation('stock');
  const q = useReservationSettings();
  const refresh = useReservationRefresh();
  const errorText = useStockErrorText();
  const [error, setError] = useState('');
  const [label, setLabel] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: (s: Settings) => repo.setSettings(s),
    onSuccess: async () => { setError(''); await refresh(); },
    onError: (err) => setError(errorText(err)),
  });
  if (!q.data) return null;
  const s = q.data;
  const shownLabel = label ?? s.borrowLabel ?? '';
  const apply = (patch: Partial<Settings>) => change.mutate({ ...s, ...patch });
  return (
    <div className="space-y-2">
      <div className="space-y-3">
          <SelectField label={t('reservations.settings.mode')} value={s.borrowMode} onChange={(v) => apply({ borrowMode: v as BorrowMode })}
            options={[{ value: 'approve', label: t('reservations.settings.modeApprove') }, { value: 'warn', label: t('reservations.settings.modeWarn') }]} helper={t('reservations.settings.modeHelp')} />
          <SelectField label={t('reservations.settings.role')} value={s.borrowRole ?? ''} placeholder={t('reservations.settings.roleNone')}
            onChange={(v) => apply({ borrowRole: v || null, borrowLabel: v ? (s.borrowLabel ?? t('reservations.settings.labelDefault')) : null })}
            options={ROLES.map((r) => ({ value: r, label: r }))} helper={t('reservations.settings.roleHelp')} />
          {s.borrowRole && (
            <TextField label={t('reservations.settings.label')} value={shownLabel} onChange={setLabel}
              onBlur={() => { if (label !== null && label.trim() && label.trim() !== s.borrowLabel) apply({ borrowLabel: label.trim() }); }} />
          )}
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  );
};
