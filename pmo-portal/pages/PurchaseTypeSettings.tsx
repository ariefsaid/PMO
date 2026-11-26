import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ListState, RecordSection, RecordStack, TextField, useToast } from '@/src/components/ui';
import { useRefusalLine } from '@/src/lib/refusals';
import { BackBar } from '@/src/components/shell';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { usePermission } from '@/src/auth/usePermission';
import { usePurchaseTypeMutations, usePurchaseTypes, usePurchaseTypesEnabled } from '@/src/hooks/usePurchaseTypes';
import { type PurchaseType } from '@/src/lib/repositories/purchaseTypes';

const TypeRow: React.FC<{ type: PurchaseType | null; canManage: boolean; nextPosition: number; onDone?: () => void }> = ({ type, canManage, nextPosition, onDone }) => {
  const { t } = useTranslation('purchaseTypes');
  const { toast } = useToast();
  const refusal = useRefusalLine();
  const m = usePurchaseTypeMutations();
  const [name, setName] = useState(type?.name ?? '');
  const [nameId, setNameId] = useState(type?.nameId ?? '');
  const [isRental, setIsRental] = useState(type?.isRental ?? false);
  const [error, setError] = useState<string | null>(null);
  const dirty = !type || name !== type.name || nameId !== (type.nameId ?? '') || isRental !== type.isRental;
  const save = async () => {
    setError(null);
    try {
      await m.upsert.mutateAsync({ id: type?.id ?? null, name: name.trim(), nameId: nameId.trim() || null, isRental, position: type?.position ?? nextPosition });
      toast(t('settings.saved', 'Purchase types updated'), undefined, 'success');
      if (!type) { setName(''); setNameId(''); setIsRental(false); onDone?.(); }
    } catch (err) { setError(refusal(err)); }
  };
  const toggleActive = async () => {
    if (!type) return;
    setError(null);
    try { await m.setActive.mutateAsync({ id: type.id, active: !type.active }); } catch (err) { setError(refusal(err)); }
  };
  return (
    <li className="grid items-end gap-3 border-b border-border py-3 last:border-b-0 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(10rem,1fr)_11rem]" data-testid={type ? 'purchase-type-row' : 'purchase-type-new'}>
      {error && <div className="md:col-span-2 xl:col-span-4"><FormErrorStrip>{error}</FormErrorStrip></div>}
      {type && !type.active && <p className="text-sm text-muted-foreground md:col-span-2 xl:col-span-4">{t('settings.retired', 'Retired')}</p>}
      <TextField label={t('settings.name', 'Name')} value={name} onChange={setName} disabled={!canManage} wrapperClassName="min-w-0" />
      <TextField label={t('settings.nameId', 'Name in Bahasa Indonesia')} value={nameId} onChange={setNameId} disabled={!canManage} wrapperClassName="min-w-0" />
      <div className="flex min-h-10 items-center"><Checkbox checked={isRental} onChange={setIsRental} disabled={!canManage} label={t('settings.isRental', 'This type has a rental period')}>{t('settings.isRental', 'This type has a rental period')}</Checkbox></div>
      {canManage && (
        <span className="flex min-h-10 flex-wrap items-center gap-2">
          <Button variant={type ? 'outline' : 'primary'} size="sm" disabled={!dirty || !name.trim()} loading={m.upsert.isPending} onClick={() => void save()}>
            {type ? t('settings.save', 'Save') : t('settings.add', 'Add type')}
          </Button>
          {type && <Button variant="ghost" size="sm" onClick={() => void toggleActive()}>{type.active ? t('settings.retire', 'Retire') : t('settings.restore', 'Restore')}</Button>}
        </span>
      )}
    </li>
  );
};

const TypeList: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const { t } = useTranslation('purchaseTypes');
  const enabled = usePurchaseTypesEnabled();
  const types = usePurchaseTypes();
  if (!enabled.data) return null;
  const list = types.data ?? [];
  return (
    <RecordSection title={t('settings.listTitle', 'Types')} subline={t('settings.listSub', 'These are your own types. Rename, add or retire them. Only types marked as having a rental period can be extended.')}>
      {types.isPending && <ListState variant="loading" rows={3} />}
      {types.isError && <ListState variant="error" title={t('settings.loadError', "Couldn't load purchase types")} onRetry={() => void types.refetch()} />}
      {types.data && list.length === 0 && <p className="text-muted-foreground">{t('settings.empty', 'No types yet.')}</p>}
      {types.data && (
        <ul>
          {list.map((x) => <TypeRow key={`${x.id}:${x.name}:${x.nameId ?? ''}:${x.isRental}`} type={x} canManage={canManage} nextPosition={0} />)}
          {canManage && <TypeRow key={`new-${list.length}`} type={null} canManage nextPosition={list.length + 1} />}
        </ul>
      )}
    </RecordSection>
  );
};

/** Admin screen for the organisation's purchase types (#2697): the list. Purchase types are on for everyone (#2746) and hidden with the Purchasing extras module. Other roles see it read-only. */
const PurchaseTypeSettingsPage: React.FC = () => {
  const { t } = useTranslation('purchaseTypes');
  const navigate = useNavigate();
  const canManage = usePermission()('manage', 'purchaseType');
  return (
    <div>
      <BackBar label={t('settings.back', 'Procurement')} onBack={() => navigate('/procurement')} />
      <h1 className="mb-4 text-xl font-semibold">{t('settings.title', 'Purchase types')}</h1>
      {!canManage && <p className="mb-3 text-muted-foreground">{t('settings.adminOnly', 'Only an Admin can change purchase types.')}</p>}
      <RecordStack>
        <TypeList canManage={canManage} />
      </RecordStack>
    </div>
  );
};
export default PurchaseTypeSettingsPage;
