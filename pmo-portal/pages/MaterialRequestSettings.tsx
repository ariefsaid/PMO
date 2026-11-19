import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DateField, ListState, RecordSection, RecordStack, SelectField, TextField, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { useAuth } from '@/src/auth/useAuth';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useUsers } from '@/src/hooks/useUsers';
import { useApprovalChain, useMaterialRequestCutoff, useMaterialRequestMutations, useStandIns } from '@/src/hooks/useMaterialRequests';
import type { ChainStepInput } from '@/src/lib/repositories/materialRequests';
import type { Role } from '@/src/auth/AuthContext';
import { formatDay } from '@/src/lib/format';
import { useLabels, useRefusalText, useUserNames } from './materialRequests/shared';

const ROLES: Role[] = ['Engineer', 'Project Manager', 'Finance', 'Executive', 'Admin'];

const ChainEditor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const chain = useApprovalChain();
  const labels = useLabels();
  const m = useMaterialRequestMutations();
  const canManage = usePermission()('manage', 'approvalChain');
  const [draft, setDraft] = useState<ChainStepInput[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const steps: ChainStepInput[] = draft ?? (chain.data ?? []).map((s) => ({ role: s.role, label: s.label, onlyOverPlan: s.onlyOverPlan }));
  const edit = (i: number, p: Partial<ChainStepInput>) => setDraft(steps.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setDraft(n); };
  const save = async () => {
    setError(null);
    try { await m.setChain.mutateAsync(steps); setDraft(null); toast(t('settings.chainSaved', 'Approval chain saved'), t('settings.chainSavedSub', 'Requests already sent keep their steps.'), 'success'); }
    catch (err) { setError(refusal(err)); }
  };
  const valid = steps.length > 0 && steps.every((s) => s.label.trim());
  return (
    <RecordSection title={t('settings.chain', 'Approval chain')} subline={t('settings.chainSub', 'Steps are taken in this order. A change applies to new requests only.')}>
      {chain.isPending && <ListState variant="loading" rows={2} />}
      {chain.isError && <ListState variant="error" title={t('settings.chainError', "Couldn't load the chain")} onRetry={() => void chain.refetch()} />}
      {chain.data && <>
        {error && <FormErrorStrip>{error}</FormErrorStrip>}
        {steps.length === 0 && <p className="text-muted-foreground">{t('settings.noChain', 'No steps yet. Requests cannot be sent until a chain exists.')}</p>}
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={i} className="space-y-2 rounded-md border border-border p-3" data-testid="chain-step">
              <p className="font-medium">{t('settings.stepN', 'Step {{n}}', { n: i + 1 })}</p>
              <SelectField label={t('settings.role', 'Role')} value={s.role} onChange={(v) => edit(i, { role: v as Role })} fullWidth disabled={!canManage}
                options={ROLES.map((r) => ({ value: r, label: labels.role[r] ?? r }))} />
              <TextField label={t('settings.purpose', 'What this step checks')} value={s.label} onChange={(v) => edit(i, { label: v })} disabled={!canManage} />
              <Checkbox checked={s.onlyOverPlan} disabled={!canManage} onChange={(v) => edit(i, { onlyOverPlan: v })}
                label={t('settings.onlyOverPlan', 'Only when a line is over plan')} />
              {canManage && <span className="flex gap-2">
                <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)}>{t('settings.moveUp', 'Move up')}</Button>
                <Button variant="ghost" size="sm" disabled={i === steps.length - 1} onClick={() => move(i, 1)}>{t('settings.moveDown', 'Move down')}</Button>
                <Button variant="ghost" size="sm" onClick={() => setDraft(steps.filter((_, j) => j !== i))}>{t('settings.removeStep', 'Remove step')}</Button>
              </span>}
            </li>
          ))}
        </ol>
        <CanWrite entity="approvalChain" action="manage">
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDraft([...steps, { role: 'Project Manager', label: '', onlyOverPlan: false }])}>{t('settings.addStep', 'Add step')}</Button>
            <Button variant="primary" disabled={!draft || !valid} loading={m.setChain.isPending} onClick={() => void save()}>{t('settings.saveChain', 'Save chain')}</Button>
          </div>
        </CanWrite>
      </>}
    </RecordSection>
  );
};

const CutoffEditor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const cutoff = useMaterialRequestCutoff();
  const m = useMaterialRequestMutations();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = value ?? (cutoff.data ? cutoff.data.slice(0, 5) : '');
  const save = async () => {
    setError(null);
    try { await m.setCutoff.mutateAsync(shown ? shown : null); setValue(null); toast(t('settings.cutoffSaved', 'Cut-off saved'), undefined, 'success'); }
    catch (err) { setError(refusal(err)); }
  };
  return (
    <RecordSection title={t('settings.cutoff', 'Daily cut-off')} subline={t('settings.cutoffSub', 'A request needed tomorrow must be sent before this time. Leave empty for no cut-off.')}>
      {cutoff.isError && <ListState variant="error" title={t('settings.cutoffError', "Couldn't load the cut-off")} onRetry={() => void cutoff.refetch()} />}
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      {!cutoff.isError && <div className="flex flex-wrap items-end gap-2">
        <TextField label={t('settings.cutoffTime', 'Time (24-hour, e.g. 12:00)')} type="time" value={shown} onChange={setValue} />
        <CanWrite entity="approvalChain" action="manage">
          <Button variant="primary" disabled={value === null} loading={m.setCutoff.isPending} onClick={() => void save()}>{t('settings.saveCutoff', 'Save cut-off')}</Button>
        </CanWrite>
      </div>}
    </RecordSection>
  );
};

const StandInEditor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const may = usePermission();
  const refusal = useRefusalText();
  const name = useUserNames();
  const { data: users } = useUsers();
  const standIns = useStandIns();
  const m = useMaterialRequestMutations();
  const isAdmin = currentUser?.role === 'Admin';
  const [delegator, setDelegator] = useState(currentUser?.id ?? '');
  const [standIn, setStandIn] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const people = (users ?? []).filter((u) => u.status === 'active').map((u) => ({ value: u.id, label: u.full_name }));
  const may_ = may('manage', 'standIn', { record: { delegator_id: delegator }, currentUserId: currentUser?.id });
  const add = async () => {
    setError(null);
    try { await m.setStandIn.mutateAsync({ delegatorId: delegator, standInId: standIn, startsOn: from, endsOn: to }); setStandIn(''); setFrom(''); setTo(''); toast(t('settings.standInSaved', 'Stand-in saved'), undefined, 'success'); }
    catch (err) { setError(refusal(err)); }
  };
  const live = (standIns.data ?? []).filter((s) => !s.revokedAt);
  return (
    <RecordSection title={t('settings.standIn', 'Stand-ins')} subline={t('settings.standInSub', 'Someone who can approve in your place for a date range. One hop only: a stand-in cannot hand it on.')}>
      {standIns.isError && <ListState variant="error" title={t('settings.standInError', "Couldn't load stand-ins")} onRetry={() => void standIns.refetch()} />}
      {live.length === 0 && standIns.data && <p className="mb-3 text-muted-foreground">{t('settings.noStandIns', 'No stand-ins set.')}</p>}
      <ul className="mb-3 space-y-2">
        {live.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="stand-in-row">
            <span>{t('settings.standInRow', '{{standIn}} for {{delegator}}, {{from}} to {{to}}', { standIn: name(s.standInId), delegator: name(s.delegatorId), from: formatDay(s.startsOn), to: formatDay(s.endsOn) })}</span>
            {may('manage', 'standIn', { record: { delegator_id: s.delegatorId }, currentUserId: currentUser?.id }) &&
              <Button variant="ghost" size="sm" onClick={() => void m.revokeStandIn.mutateAsync(s.id)}>{t('settings.revoke', 'End')}</Button>}
          </li>
        ))}
      </ul>
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      <div className="space-y-2">
        {isAdmin && <SelectField label={t('settings.delegator', 'Person who is away')} value={delegator} onChange={setDelegator} fullWidth options={people} />}
        <SelectField label={t('settings.standInPerson', 'Stand-in')} required value={standIn} onChange={setStandIn} fullWidth
          options={[{ value: '', label: t('settings.chooseStandIn', 'Choose a colleague') }, ...people.filter((p) => p.value !== delegator)]} />
        <DateField label={t('settings.from', 'From')} required value={from} onChange={setFrom} fullWidth />
        <DateField label={t('settings.to', 'To')} required value={to} min={from || undefined} onChange={setTo} fullWidth />
        <Button variant="primary" disabled={!may_ || !standIn || !from || !to} loading={m.setStandIn.isPending} onClick={() => void add()}>{t('settings.addStandIn', 'Add stand-in')}</Button>
      </div>
    </RecordSection>
  );
};

/** Approval settings for material requests: the org chain and cut-off (Admin edits, everyone reads) and stand-ins (own, or Admin's). */
const MaterialRequestSettingsPage: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const navigate = useNavigate();
  return (
    <div>
      <BackBar label={t('form.back', 'Material requests')} onBack={() => navigate('/material-requests')} />
      <h1 className="mb-4 text-xl font-semibold">{t('settings.title', 'Approval settings')}</h1>
      <RecordStack>
        <ChainEditor />
        <CutoffEditor />
        <StandInEditor />
      </RecordStack>
    </div>
  );
};
export default MaterialRequestSettingsPage;
