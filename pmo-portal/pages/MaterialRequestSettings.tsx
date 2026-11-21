import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, DateField, ListState, RecordSection, RecordStack, SelectField, TextField, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { useAuth } from '@/src/auth/useAuth';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useUsers } from '@/src/hooks/useUsers';
import { useApprovalChain, useDeliveryNoteSettings, useMaterialRequestCutoff, useMaterialRequestMutations, useStandIns } from '@/src/hooks/useMaterialRequests';
import type { ChainStepInput } from '@/src/lib/repositories/materialRequests';
import type { Role } from '@/src/auth/AuthContext';
import { formatDay } from '@/src/lib/format';
import { useLabels, useRefusalText, useUserNames } from './materialRequests/useMaterialRequestText';
import { UsageThresholdsEditor } from './materialRequests/UsageThresholdsEditor';
import { ApproverInboxSetting } from './materialRequests/ApproverInboxSetting';

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
        <Button variant="primary" disabled={value === null} loading={m.setCutoff.isPending} onClick={() => void save()}>{t('settings.saveCutoff', 'Save cut-off')}</Button>
      </div>}
    </RecordSection>
  );
};

const DeliveryNoteEditor: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const refusal = useRefusalText();
  const dnQuery = useDeliveryNoteSettings();
  const m = useMaterialRequestMutations();
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null);
  const [blocksDraft, setBlocksDraft] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = enabledDraft ?? (dnQuery.data?.enabled ?? false);
  const blocks = blocksDraft ?? (dnQuery.data?.signatureBlocks?.length ? dnQuery.data.signatureBlocks : ['Dispatched by', 'Delivered by', 'Received by']);

  const editBlock = (index: number, val: string) => {
    const next = [...blocks];
    next[index] = val;
    setBlocksDraft(next);
  };

  const removeBlock = (index: number) => {
    if (blocks.length <= 1) return;
    setBlocksDraft(blocks.filter((_, i) => i !== index));
  };

  const addBlock = () => {
    setBlocksDraft([...blocks, '']);
  };

  const dirty = enabledDraft !== null || blocksDraft !== null;
  const valid = !enabled || (blocks.length > 0 && blocks.every((b) => b.trim().length > 0));

  const save = async () => {
    setError(null);
    try {
      await m.setDeliveryNoteSettings.mutateAsync({
        enabled,
        signatureBlocks: blocks.map((b) => b.trim()).filter(Boolean),
      });
      setEnabledDraft(null);
      setBlocksDraft(null);
      toast(t('settings.deliveryNoteSaved', 'Delivery note settings saved'), undefined, 'success');
    } catch (err) {
      setError(refusal(err));
    }
  };

  return (
    <RecordSection
      title={t('settings.deliveryNote', 'Printable delivery note')}
      subline={t('settings.deliveryNoteSub', 'Generate a printable delivery note with signature blocks for approved material requests.')}
    >
      {dnQuery.isPending && <ListState variant="loading" rows={2} />}
      {dnQuery.isError && (
        <ListState
          variant="error"
          title={t('settings.deliveryNoteError', "Couldn't load delivery note settings")}
          onRetry={() => void dnQuery.refetch()}
        />
      )}
      {dnQuery.data && (
        <div className="space-y-4" data-testid="delivery-note-settings-editor">
          {error && <FormErrorStrip>{error}</FormErrorStrip>}
          <div className="flex items-center gap-2">
            <Checkbox
              checked={enabled}
              onChange={(checked) => setEnabledDraft(checked)}
              label={t('settings.deliveryNoteEnabled', 'Enable printable delivery note')}
            />
            <span className="text-sm font-medium text-foreground cursor-pointer" onClick={() => setEnabledDraft(!enabled)}>
              {t('settings.deliveryNoteEnabled', 'Enable printable delivery note')}
            </span>
          </div>

          {enabled && (
            <div className="space-y-3 pt-2 border-t border-border">
              <p className="text-sm font-medium text-foreground">
                {t('settings.signatureBlocks', 'Signature blocks')}
              </p>
              <div className="space-y-2">
                {blocks.map((block, idx) => (
                  <div key={idx} className="flex items-center gap-2" data-testid={`signature-block-input-${idx}`}>
                    <TextField
                      label={`${t('settings.signatureBlock', 'Signature block')} ${idx + 1}`}
                      hideLabel
                      value={block}
                      onChange={(v) => editBlock(idx, v)}
                      placeholder={`Block ${idx + 1}`}
                      fullWidth
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={blocks.length <= 1}
                      onClick={() => removeBlock(idx)}
                      aria-label={`${t('settings.removeSignatureBlock', 'Remove')} ${idx + 1}`}
                    >
                      {t('settings.removeSignatureBlock', 'Remove')}
                    </Button>
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addBlock}>
                {t('settings.addSignatureBlock', 'Add signature block')}
              </Button>
            </div>
          )}

          <div className="pt-2">
            <Button
              variant="primary"
              disabled={!dirty || !valid}
              loading={m.setDeliveryNoteSettings.isPending}
              onClick={() => void save()}
              data-testid="save-delivery-note-settings-button"
            >
              {t('settings.saveDeliveryNote', 'Save delivery note settings')}
            </Button>
          </div>
        </div>
      )}
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
  const revoke = async (id: string) => {
    setError(null);
    try { await m.revokeStandIn.mutateAsync(id); } catch (err) { setError(refusal(err)); }
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
              <Button variant="ghost" size="sm" onClick={() => void revoke(s.id)}>{t('settings.revoke', 'End')}</Button>}
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

/** Approval settings for material requests: the org chain and cut-off (the cut-off is shown to Admins only) and stand-ins (own, or Admin's). */
const MaterialRequestSettingsPage: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const navigate = useNavigate();
  return (
    <div>
      <BackBar label={t('form.back', 'Material requests')} onBack={() => navigate('/material-requests')} />
      <h1 className="mb-4 text-xl font-semibold">{t('settings.title', 'Approval settings')}</h1>
      <RecordStack>
        <ChainEditor />
        <CanWrite entity="approvalChain" action="manage"><CutoffEditor /><ApproverInboxSetting /></CanWrite>
        <CanWrite entity="approvalChain" action="manage"><DeliveryNoteEditor /></CanWrite>
        <CanWrite entity="approvalChain" action="manage"><UsageThresholdsEditor /></CanWrite>
        <StandInEditor />
      </RecordStack>
    </div>
  );
};
export default MaterialRequestSettingsPage;
