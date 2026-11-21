import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ListState, RecordSection, RecordStack, SelectField, TextField, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { usePermission } from '@/src/auth/usePermission';
import { usePlanRefusalText } from '@/src/hooks/usePlanRefusalText';
import { useEquipmentPlanSettings, usePlanCategories, usePlanSettingsMutations } from '@/src/hooks/useEquipmentPlans';
import { type ApprovalStep, type PlanCategory } from '@/src/lib/repositories/equipmentPlans';

const CategoryRow: React.FC<{ category: PlanCategory | null; canManage: boolean; nextPosition: number }> = ({ category, canManage, nextPosition }) => {
  const { t } = useTranslation('equipmentPlans');
  const { toast } = useToast();
  const refusal = usePlanRefusalText();
  const m = usePlanSettingsMutations();
  const [name, setName] = useState(category?.name ?? '');
  const [nameId, setNameId] = useState(category?.nameId ?? '');
  const [error, setError] = useState<string | null>(null);
  const dirty = !category || name !== category.name || nameId !== (category.nameId ?? '');
  const save = async () => {
    setError(null);
    try {
      await m.upsertCategory.mutateAsync({ id: category?.id ?? null, name: name.trim(), nameId: nameId.trim() || null, position: category?.position ?? nextPosition });
      toast(t('settings.saved', 'Plan settings updated'), undefined, 'success');
      if (!category) { setName(''); setNameId(''); }
    } catch (err) { setError(refusal(err)); }
  };
  const toggle = async () => {
    if (!category) return;
    setError(null);
    try { await m.setCategoryActive.mutateAsync({ id: category.id, active: !category.active }); } catch (err) { setError(refusal(err)); }
  };
  return (
    <li className="space-y-2 rounded-md border border-border p-3" data-testid={category ? 'plan-category-row' : 'plan-category-new'}>
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      {category && !category.active && <p className="text-sm text-muted-foreground">{t('settings.retired', 'Retired')}</p>}
      <TextField label={t('settings.name', 'Name')} value={name} onChange={setName} disabled={!canManage} />
      <TextField label={t('settings.nameId', 'Name in Bahasa Indonesia')} value={nameId} onChange={setNameId} disabled={!canManage} />
      {canManage && (
        <span className="flex flex-wrap gap-2">
          <Button variant={category ? 'outline' : 'primary'} size="sm" disabled={!dirty || !name.trim()} loading={m.upsertCategory.isPending} onClick={() => void save()}>
            {category ? t('settings.save', 'Save') : t('settings.add', 'Add category')}
          </Button>
          {category && <Button variant="ghost" size="sm" onClick={() => void toggle()}>{category.active ? t('settings.retire', 'Retire') : t('settings.restore', 'Restore')}</Button>}
        </span>
      )}
    </li>
  );
};

const SwitchSection: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const { t } = useTranslation('equipmentPlans');
  const { toast } = useToast();
  const refusal = usePlanRefusalText();
  const settings = useEquipmentPlanSettings();
  const m = usePlanSettingsMutations();
  const [draft, setDraft] = useState<{ enabled?: boolean; step?: ApprovalStep; self?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const enabled = draft.enabled ?? settings.data?.enabled ?? false;
  const step = draft.step ?? settings.data?.approvalStep ?? 'spend_approvers';
  const self = draft.self ?? settings.data?.allowSelfApproval ?? false;
  const save = async () => {
    setError(null);
    try { await m.setSettings.mutateAsync({ enabled, approvalStep: step, allowSelfApproval: self }); setDraft({}); toast(t('settings.saved', 'Plan settings updated'), undefined, 'success'); }
    catch (err) { setError(refusal(err)); }
  };
  return (
    <RecordSection title={t('settings.switchTitle', 'Use the monthly plan')} subline={t('settings.switchSub', 'When on, planners list the month\'s equipment and services.')}>
      {settings.isError && <ListState variant="error" title={t('settings.loadError', "Couldn't load the plan settings")} onRetry={() => void settings.refetch()} />}
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      {!settings.isError && (
        <div className="space-y-3">
          <Checkbox checked={enabled} onChange={(v) => setDraft({ ...draft, enabled: v })} disabled={!canManage || settings.isPending} label={t('settings.enabled', 'The monthly plan is on')} />
          <SelectField label={t('settings.stepLabel', 'Approval step')} value={step} onChange={(v) => setDraft({ ...draft, step: v as ApprovalStep })} disabled={!canManage || settings.isPending}
            options={[{ value: 'spend_approvers', label: t('settings.step.spend_approvers', 'The spend approvers of the project') }, { value: 'senior_role', label: t('settings.step.senior_role', 'Anyone whose role can approve spend') }]} fullWidth />
          <Checkbox checked={self} onChange={(v) => setDraft({ ...draft, self: v })} disabled={!canManage || settings.isPending} label={t('settings.selfApproval', 'The author may approve their own plan')} />
          {canManage && <Button variant="primary" size="sm" disabled={Object.keys(draft).length === 0} loading={m.setSettings.isPending} onClick={() => void save()}>{t('settings.save', 'Save')}</Button>}
        </div>
      )}
    </RecordSection>
  );
};

const CategoryList: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const { t } = useTranslation('equipmentPlans');
  const settings = useEquipmentPlanSettings();
  const categories = usePlanCategories();
  if (!settings.data?.enabled) return null;
  const list = categories.data ?? [];
  return (
    <RecordSection title={t('settings.categoriesTitle', 'Plan categories')} subline={t('settings.categoriesSub', 'Your own list. Rename, add or retire them.')}>
      {categories.isPending && <ListState variant="loading" rows={3} />}
      {categories.isError && <ListState variant="error" title={t('settings.loadError', "Couldn't load the plan settings")} onRetry={() => void categories.refetch()} />}
      {categories.data && list.length === 0 && <p className="text-muted-foreground">{t('settings.empty', 'No categories yet.')}</p>}
      {categories.data && (
        <ul className="space-y-3">
          {list.map((c) => <CategoryRow key={`${c.id}:${c.name}:${c.nameId ?? ''}`} category={c} canManage={canManage} nextPosition={0} />)}
          {canManage && <CategoryRow key={`new-${list.length}`} category={null} canManage nextPosition={list.length + 1} />}
        </ul>
      )}
    </RecordSection>
  );
};

/** Admin screen for the monthly plan (#2700): the switch, the approval step, the self-approval setting and the category list. Other roles see it read-only. */
const EquipmentPlanSettingsPage: React.FC = () => {
  const { t } = useTranslation('equipmentPlans');
  const navigate = useNavigate();
  const canManage = usePermission()('manage', 'equipmentPlan');
  return (
    <div>
      <BackBar label={t('settings.back', 'Monthly plan')} onBack={() => navigate('/equipment-plans')} />
      <h1 className="mb-4 text-xl font-semibold">{t('settings.title', 'Monthly plan settings')}</h1>
      {!canManage && <p className="mb-3 text-muted-foreground">{t('settings.adminOnly', 'Only an Admin can change the plan settings.')}</p>}
      <RecordStack>
        <SwitchSection canManage={canManage} />
        <CategoryList canManage={canManage} />
      </RecordStack>
    </div>
  );
};
export default EquipmentPlanSettingsPage;
