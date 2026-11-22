import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DateField, EntityFormModal, FormGrid, useToast, type SubmitError } from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { useRecordRenewal } from '@/src/hooks/useDocumentExpiry';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

export interface RenewalDoc { id: string; subject_name: string; type_name: string; expires_on: string }

/** A person's direct manager (or an Admin) records the renewal: the new expiry date. The database decides who may, and tells the person. */
const RecordRenewalAction: React.FC<{ doc: RenewalDoc }> = ({ doc }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const renew = useRecordRenewal();
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const form = useEntityForm<{ expires_on: string }>({
    initialValues: { expires_on: '' }, idPrefix: 'renewal', requiredFields: ['expires_on'], module: 'expiry',
    validate: (v) => (v.expires_on ? {} : { expires_on: t('equipment:expiry.renewDateErr', 'Enter the new expiry date') }),
  });
  const close = () => { setOpen(false); setSubmitError(null); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    void form.handleSubmit(async (v) => {
      try {
        await renew.mutateAsync({ id: doc.id, expiresOn: v.expires_on });
        toast(t('equipment:expiry.renewSaved', 'Renewal recorded. {{name}} has been told.', { name: doc.subject_name }), undefined, 'success');
        close();
      } catch (err) { const c = classifyMutationError(err); setSubmitError({ headline: c.headline, detail: c.detail }); }
    });
  };
  return (
    <>
      <Button variant="ghost" size="sm" aria-label={t('equipment:expiry.renewFor', 'Record renewal for {{name}}', { name: doc.subject_name })} onClick={() => setOpen(true)}>
        {t('equipment:expiry.renew', 'Record renewal')}
      </Button>
      {open && (
        <EntityFormModal open title={t('equipment:expiry.renewTitle', 'Record renewal')} submitLabel={t('equipment:expiry.renewSave', 'Record renewal')}
          onSubmit={submit} onClose={close} loading={form.isSubmitting} dirty={form.isDirty} submitError={submitError}
          errorSummary={form.hasAttemptedSubmit ? Object.entries(form.errors).map(([k, m]) => ({ fieldId: form.fieldProps(k as 'expires_on').id, message: String(m) })) : undefined}>
          <FormGrid>
            <p className="col-span-full text-control text-muted-foreground">{doc.subject_name} — {doc.type_name}. {t('equipment:expiry.renewHelp', 'Enter the new expiry date. The person is told once it is saved.')}</p>
            <DateField label={t('equipment:expiry.renewDate', 'New expiry date')} required {...form.fieldProps('expires_on')} />
          </FormGrid>
        </EntityFormModal>
      )}
    </>
  );
};
export default RecordRenewalAction;
