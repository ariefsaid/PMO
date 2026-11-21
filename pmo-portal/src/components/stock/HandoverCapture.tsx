import React from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, SelectField, TextField } from '@/src/components/ui';
import { FileInput } from '@/src/components/ui/FormFields';
import type { HandoverProofType } from '@/src/lib/repositories/stockTransfers';
import type { HandoverValue } from './handoverValue';

interface Props {
  idPrefix: string;
  value: HandoverValue;
  onChange: (v: HandoverValue) => void;
  /** Which proofs the person may give here (a tag may require only paper or only a confirmation). */
  proofs?: HandoverProofType[];
  signerName: string;          // the logged-in person's name, shown as who signs
  disabled?: boolean;
}

/** Phone-first handover capture: take the photos with the camera, name the signer (a guest types a name). Used at send, receive and later proof. */
export const HandoverCapture: React.FC<Props> = ({ idPrefix, value, onChange, proofs = ['in_app', 'paper'], signerName, disabled }) => {
  const { t } = useTranslation('stock');
  const set = (patch: Partial<HandoverValue>) => onChange({ ...value, ...patch });
  const pick = (key: 'goods' | 'person' | 'paper') => (e: React.ChangeEvent<HTMLInputElement>) => set({ [key]: e.currentTarget.files?.[0] ?? null } as Partial<HandoverValue>);
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-4" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{t('handover.title')}</legend>
      {proofs.length > 1 && (
        <SelectField label={t('handover.proofType')} value={value.proofType} onChange={(v) => set({ proofType: v as HandoverProofType })}
          options={proofs.map((p) => ({ value: p, label: t(p === 'in_app' ? 'handover.proofInApp' : 'handover.proofPaper') }))} />
      )}
      <Checkbox label={t('handover.guestToggle')} checked={value.guest} onChange={(c) => set({ guest: c === true, guestName: c === true ? value.guestName : '' })}>
        {t('handover.guestToggle')}
      </Checkbox>
      {value.guest ? (
        <div className="space-y-1">
          <TextField id={`${idPrefix}-guest-name`} label={t('handover.guestName')} value={value.guestName} onChange={(v) => set({ guestName: v })} required autoComplete="off" />
          <p className="text-sm text-muted-foreground">{t('handover.guestHelp', { host: signerName })}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('handover.signingAs', { name: signerName })}</p>
      )}
      {value.proofType === 'in_app' ? (
        <>
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-goods`} className="block text-sm font-medium">{t('handover.goodsPhoto')}</label>
            <FileInput id={`${idPrefix}-goods`} accept="image/*" capture="environment" onChange={pick('goods')} className="block w-full text-sm" />
          </div>
          <div className="space-y-1">
            <label htmlFor={`${idPrefix}-person`} className="block text-sm font-medium">{t('handover.personPhoto')}</label>
            <FileInput id={`${idPrefix}-person`} accept="image/*" capture="user" onChange={pick('person')} className="block w-full text-sm" />
          </div>
        </>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-paper`} className="block text-sm font-medium">{t('handover.paperPhoto')}</label>
          <FileInput id={`${idPrefix}-paper`} accept="image/*,application/pdf" capture="environment" onChange={pick('paper')} className="block w-full text-sm" />
        </div>
      )}
    </fieldset>
  );
};
