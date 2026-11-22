import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ListState, RecordSection, RecordStack, TextField, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { usePermission } from '@/src/auth/usePermission';
import { usePurchaseTypeMutations, usePurchaseTypes, usePurchaseTypesEnabled } from '@/src/hooks/usePurchaseTypes';
import { purchaseTypeRefusal, type PurchaseType } from '@/src/lib/repositories/purchaseTypes';

const REFUSAL_DEFAULTS: Record<string, string> = {
  ADMIN_ONLY: 'Only an Admin can change purchase types.', OFF: 'Purchase types are not turned on.', UNAVAILABLE: 'That type is not available.',
  PERIOD_REQUIRED: 'A rental purchase needs a rental period.', PERIOD_NOT_ALLOWED: 'Only a rental purchase has a rental period.',
  IN_USE: 'Purchases use this type. Retire it and add a new one instead.', INVALID: 'Check the name: 1 to 60 characters.',
  FIXED: 'The type and rental period are set when the purchase is created.',
};

/** The text of a refusal in the user's language; falls back to the server's own message for a code we have no string for. */
const useRefusalText = () => {
  const { t } = useTranslation('purchaseTypes');
  return (error: unknown): string => {
    const r = purchaseTypeRefusal(error);
    return r ? t(`refusal.${r.key}`, REFUSAL_DEFAULTS[r.key] ?? r.message) : (error instanceof Error ? error.message : String(error));
  };
};

const TypeRow: React.FC<{ type: PurchaseType | null; canManage: boolean; nextPosition: number; onDone?: () => void }> = ({ type, canManage, nextPosition, onDone }) => {
  const { t } = useTranslation('purchaseTypes');
  const { toast } = useToast();
  const refusal = useRefusalText();
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
    <li className="space-y-2 rounded-md border border-border p-3" data-testid={type ? 'purchase-type-row' : 'purchase-type-new'}>
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      {type && !type.active && <p className="text-sm text-muted-foreground">{t('settings.retired', 'Retired')}</p>}
      <TextField label={t('settings.name', 'Name')} value={name} onChange={setName} disabled={!canManage} />
      <TextField label={t('settings.nameId', 'Name in Bahasa Indonesia')} value={nameId} onChange={setNameId} disabled={!canManage} />
      <Checkbox checked={isRental} onChange={setIsRental} disabled={!canManage} label={t('settings.isRental', 'This type has a rental period')} />
      {canManage && (
        <span className="flex flex-wrap gap-2">
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
        <ul className="space-y-3">
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
