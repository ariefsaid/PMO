import React, { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/src/auth/AuthContext';
import { Button, TextField, useToast } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { EquipmentTargetsContext, useEquipmentTargets, useSetEquipmentTargets } from '@/src/hooks/useEquipmentTargets';
import { DEFAULT_EQUIPMENT_TARGETS } from '@/src/lib/db/equipmentAvailability';

/** #2701: the availability target, the use target and the escalation limit are organisation settings. Both pieces here
 *  render nothing extra (defaults, no form) when signed out. */
const useHasProviders = (): boolean => Boolean(useContext(AuthContext));

const Loaded: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const q = useEquipmentTargets();
  return <EquipmentTargetsContext.Provider value={q.data ?? DEFAULT_EQUIPMENT_TARGETS}>{children}</EquipmentTargetsContext.Provider>;
};
export const EquipmentTargetsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  useHasProviders() ? <Loaded>{children}</Loaded> : <>{children}</>;

const Form: React.FC<{ onProblem: (headline: string) => void }> = ({ onProblem }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const data = useContext(EquipmentTargetsContext);
  const save = useSetEquipmentTargets();
  const [av, setAv] = useState<string | null>(null);
  const [ut, setUt] = useState<string | null>(null);
  const [lim, setLim] = useState<string | null>(null);
  const avValue = av ?? (data.availability_target_pct != null ? String(data.availability_target_pct) : '');
  const utValue = ut ?? (data.utilisation_target_pct != null ? String(data.utilisation_target_pct) : '');
  const limValue = lim ?? String(data.escalation_down_days);
  return (
    <div className="mb-3 flex flex-wrap items-end gap-2">
      <TextField label={t('equipment:availability.availabilityTarget', 'Availability target (%)')} inputMode="decimal" value={avValue} onChange={setAv} />
      <TextField label={t('equipment:availability.utilisationTarget', 'Use target (%)')} inputMode="decimal" value={utValue} onChange={setUt} />
      <TextField label={t('equipment:availability.escalationLimit', 'Escalate after more than (days down)')} inputMode="numeric" value={limValue} onChange={setLim} />
      <Button variant="outline" disabled={save.isPending || !limValue} onClick={() => {
        void save.mutateAsync({ availability: avValue.trim() || null, utilisation: utValue.trim() || null, escalationDays: limValue.trim() })
          .then(() => { setAv(null); setUt(null); setLim(null); toast(t('equipment:availability.targetsSaved', 'Targets saved'), undefined, 'success'); })
          .catch((err: unknown) => onProblem(classifyMutationError(err).headline));
      }}>{t('equipment:availability.saveTargets', 'Save targets')}</Button>
    </div>
  );
};
export const EquipmentTargetSettings: React.FC<{ onProblem: (headline: string) => void }> = ({ onProblem }) =>
  useHasProviders() ? <Form onProblem={onProblem} /> : null;
