/**
 * #876 slice 2 (DD-VWH-12) — the ERPNext accounts a vendor bill's entered VAT and PPh post to. Admin-only (the
 * organizations UPDATE policy + column grants, 0273; `can('manage','orgAccounting')` mirrors it, UX only). The dispatch
 * checks each in ERPNext on send and refuses naming the setting (ADR-0084 §4).
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import type { OrgVendorTaxAccounts as Accounts } from '@/src/lib/db/orgs';

const QUERY_KEY = 'org-vendor-tax-accounts';

export default function OrgVendorTaxAccounts() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inputVat, setInputVat] = useState('');
  const [pph23, setPph23] = useState('');
  const [pph42, setPph42] = useState('');
  const [error, setError] = useState<string>();
  const queryKey = [QUERY_KEY, currentUser?.org_id];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getVendorTaxAccounts(), enabled: !!currentUser });
  useEffect(() => {
    if (!query.isSuccess) return;
    setInputVat(query.data.inputVatAccount ?? '');
    setPph23(query.data.pph23PayableAccount ?? '');
    setPph42(query.data.pph42PayableAccount ?? '');
  }, [query.data, query.isSuccess]);
  const mutation = useMutation({
    mutationFn: (value: Accounts) => repositories.orgSettings.setVendorTaxAccounts(value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      toast(t('admin.vendorTaxAccounts.saved', 'Tax accounts saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  });
  const current = query.data;
  const dirty = !current
    || inputVat.trim() !== (current.inputVatAccount ?? '')
    || pph23.trim() !== (current.pph23PayableAccount ?? '')
    || pph42.trim() !== (current.pph42PayableAccount ?? '');
  const helper = t('admin.vendorTaxAccounts.helper', 'Enter the exact ERPNext account name. Leave blank if not used.');
  const notConfigured = t('admin.vendorTaxAccounts.notConfigured', 'Not configured');

  return (
    <section aria-labelledby="vendor-tax-accounts-heading">
      <h2 id="vendor-tax-accounts-heading" className="text-[15px] font-semibold">
        {t('admin.vendorTaxAccounts.heading', 'Vendor bill tax accounts')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('admin.vendorTaxAccounts.intro', "The ERPNext accounts PMO posts a vendor bill's VAT and tax withheld to. Required before a bill with these amounts can be sent to ERPNext.")}
      </p>
      <div className="mt-3 max-w-md">
        {query.isError ? (
          <ListState variant="error" title={t('admin.vendorTaxAccounts.loadError', "Couldn't load the tax accounts")} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <ListState variant="loading" rows={3} />
        ) : canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError(undefined);
              mutation.mutate({ inputVatAccount: inputVat.trim() || null, pph23PayableAccount: pph23.trim() || null, pph42PayableAccount: pph42.trim() || null });
            }}
            className="space-y-3"
          >
            <TextField label={t('admin.vendorTaxAccounts.inputVat', 'Input VAT account')} value={inputVat} onChange={setInputVat}
              maxLength={140} disabled={mutation.isPending} helper={helper} />
            <TextField label={t('admin.vendorTaxAccounts.pph23', 'PPh 23 payable account')} value={pph23} onChange={setPph23}
              maxLength={140} disabled={mutation.isPending} helper={helper} />
            <TextField label={t('admin.vendorTaxAccounts.pph42', 'PPh 4(2) payable account')} value={pph42} onChange={setPph42}
              maxLength={140} disabled={mutation.isPending} helper={helper} />
            <FieldError>{error}</FieldError>
            <Button type="submit" variant="outline" disabled={mutation.isPending || !dirty}>
              {t('admin.vendorTaxAccounts.save', 'Save accounts')}
            </Button>
          </form>
        ) : (
          <>
            <dl className="space-y-1 text-[13px]">
              <div><dt className="inline text-muted-foreground">{t('admin.vendorTaxAccounts.inputVat', 'Input VAT account')}: </dt><dd className="inline">{current?.inputVatAccount ?? notConfigured}</dd></div>
              <div><dt className="inline text-muted-foreground">{t('admin.vendorTaxAccounts.pph23', 'PPh 23 payable account')}: </dt><dd className="inline">{current?.pph23PayableAccount ?? notConfigured}</dd></div>
              <div><dt className="inline text-muted-foreground">{t('admin.vendorTaxAccounts.pph42', 'PPh 4(2) payable account')}: </dt><dd className="inline">{current?.pph42PayableAccount ?? notConfigured}</dd></div>
            </dl>
            <p className="mt-2 text-[13px] text-muted-foreground">{t('admin.vendorTaxAccounts.onlyAdmin', 'Only an Admin can change these.')}</p>
          </>
        )}
      </div>
    </section>
  );
}
