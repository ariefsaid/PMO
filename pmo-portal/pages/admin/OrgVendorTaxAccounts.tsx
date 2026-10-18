/** Existing Admin-owned vendor tax settings, now using reviewed company-chart choices. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { repositories } from '@/src/lib/repositories';
import { listBudgetPostingAccountCatalogue } from '@/src/lib/repositories/budgetProjection';
import { taxSetupChoices, type TaxSetupPurpose } from '@/src/lib/accounting/taxSetupChoices';
import type { BudgetPostingAccount } from '@/src/lib/budget/categoryAccountMap';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, Combobox, FieldError, ListState, useToast } from '@/src/components/ui';
import type { ComboboxOption } from '@/src/components/ui';
import type { OrgVendorTaxAccounts as Accounts } from '@/src/lib/db/orgs';

const QUERY_KEY = 'org-vendor-tax-accounts';
const NO_ACCOUNTS: BudgetPostingAccount[] = [];
type AccountField = 'inputVatAccount' | 'pph23PayableAccount' | 'pph42PayableAccount';
type VendorTaxPurpose = Exclude<TaxSetupPurpose, 'receipt-withholding'>;

const fields: { key: AccountField; purpose: VendorTaxPurpose; labelKey: string; label: string; emptyKey: string; empty: string }[] = [
  { key: 'inputVatAccount', purpose: 'input-vat', labelKey: 'uxs11.inputVatLabel', label: 'Input VAT account', emptyKey: 'uxs11.noAssetAccounts', empty: 'No enabled Asset accounts are available. Ask your accounting administrator to add a suitable account to the ERP chart.' },
  { key: 'pph23PayableAccount', purpose: 'pph23', labelKey: 'uxs11.pph23Label', label: 'PPh 23 payable account', emptyKey: 'uxs11.noLiabilityAccounts', empty: 'No enabled Liability accounts are available. Ask your accounting administrator to add a suitable account to the ERP chart.' },
  { key: 'pph42PayableAccount', purpose: 'pph42', labelKey: 'uxs11.pph42Label', label: 'PPh 4(2) payable account', emptyKey: 'uxs11.noLiabilityAccounts', empty: 'No enabled Liability accounts are available. Ask your accounting administrator to add a suitable account to the ERP chart.' },
];

function accountOption(account: BudgetPostingAccount, staleLabel?: string): ComboboxOption {
  return {
    value: account.account,
    label: account.account,
    sub: [account.accountNumber, account.parentAccount].filter(Boolean).join(' · ') || staleLabel,
  };
}

function valueOption(value: string, choices: BudgetPostingAccount[], staleLabel?: string): ComboboxOption {
  const account = choices.find((candidate) => candidate.account === value);
  return account ? accountOption(account) : { value, label: value, sub: staleLabel };
}

export default function OrgVendorTaxAccounts() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const binding = useErpnextBinding();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inputVat, setInputVat] = useState('');
  const [pph23, setPph23] = useState('');
  const [pph42, setPph42] = useState('');
  const [error, setError] = useState<string>();
  const [remoteChanged, setRemoteChanged] = useState(false);
  const hydrated = useRef(false);
  const savedBaseline = useRef<Accounts | null>(null);
  const draft = useCallback((): Accounts => ({ inputVatAccount: inputVat || null, pph23PayableAccount: pph23 || null, pph42PayableAccount: pph42 || null }), [inputVat, pph23, pph42]);
  const orgId = currentUser?.org_id;
  const queryKey = [QUERY_KEY, orgId];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getVendorTaxAccounts(), enabled: !!currentUser });
  const hasActiveBinding = binding.data?.status === 'active' && !binding.isError;
  const catalogue = useQuery({
    queryKey: ['uxs11', 'account-catalogue', orgId],
    queryFn: listBudgetPostingAccountCatalogue,
    enabled: Boolean(canManage && orgId && hasActiveBinding),
  });
  const allCandidates = catalogue.data?.accounts ?? NO_ACCOUNTS;
  const candidates = useMemo(() => ({
    inputVat: taxSetupChoices(allCandidates, 'input-vat'),
    pph23: taxSetupChoices(allCandidates, 'pph23'),
    pph42: taxSetupChoices(allCandidates, 'pph42'),
  }), [allCandidates]);
  const loadOptions = useMemo<Record<VendorTaxPurpose, () => Promise<ComboboxOption[]>>>(() => ({
    'input-vat': async () => candidates.inputVat.map((account) => accountOption(account)),
    pph23: async () => candidates.pph23.map((account) => accountOption(account)),
    pph42: async () => candidates.pph42.map((account) => accountOption(account)),
  }), [candidates]);

  useEffect(() => {
    if (!query.isSuccess) return;
    const remote: Accounts = {
      inputVatAccount: query.data.inputVatAccount ?? null,
      pph23PayableAccount: query.data.pph23PayableAccount ?? null,
      pph42PayableAccount: query.data.pph42PayableAccount ?? null,
    };
    if (!hydrated.current) {
      hydrated.current = true;
      savedBaseline.current = remote;
      setInputVat(remote.inputVatAccount ?? '');
      setPph23(remote.pph23PayableAccount ?? '');
      setPph42(remote.pph42PayableAccount ?? '');
      return;
    }
    const baseline = savedBaseline.current;
    const local = draft();
    const isDirty = !!baseline && JSON.stringify(local) !== JSON.stringify({
      inputVatAccount: baseline.inputVatAccount ?? null,
      pph23PayableAccount: baseline.pph23PayableAccount ?? null,
      pph42PayableAccount: baseline.pph42PayableAccount ?? null,
    });
    if (isDirty) {
      if (JSON.stringify(remote) !== JSON.stringify(baseline)) setRemoteChanged(true);
      return;
    }
    if (JSON.stringify(remote) === JSON.stringify(baseline)) return;
    savedBaseline.current = remote;
    setInputVat(remote.inputVatAccount ?? '');
    setPph23(remote.pph23PayableAccount ?? '');
    setPph42(remote.pph42PayableAccount ?? '');
    setRemoteChanged(false);
  }, [draft, query.data, query.isSuccess]);

  const mutation = useMutation({
    mutationFn: (value: Accounts) => repositories.orgSettings.setVendorTaxAccounts(value),
    onSuccess: (_result, value) => {
      savedBaseline.current = value;
      setRemoteChanged(false);
      void qc.invalidateQueries({ queryKey });
      toast(t('uxs11.vendorTaxSaved', 'Vendor tax accounts saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  });

  const current = query.data;
  const dirty = !current
    || inputVat !== (current.inputVatAccount ?? '')
    || pph23 !== (current.pph23PayableAccount ?? '')
    || pph42 !== (current.pph42PayableAccount ?? '');
  const notConfigured = t('uxs11.notConfigured', 'Not configured');
  const saved = {
    inputVatAccount: current?.inputVatAccount ?? null,
    pph23PayableAccount: current?.pph23PayableAccount ?? null,
    pph42PayableAccount: current?.pph42PayableAccount ?? null,
  };
  const values = { inputVatAccount: inputVat || null, pph23PayableAccount: pph23 || null, pph42PayableAccount: pph42 || null };
  const valueAllowed = (key: AccountField, choices: BudgetPostingAccount[]) => {
    const value = values[key];
    return value === saved[key] || value === null || choices.some((account) => account.account === value);
  };
  const canSave = valueAllowed('inputVatAccount', candidates.inputVat)
    && valueAllowed('pph23PayableAccount', candidates.pph23)
    && valueAllowed('pph42PayableAccount', candidates.pph42);
  const canBrowse = canManage && hasActiveBinding && catalogue.isSuccess;
  const commonStatus = binding.isPending
    ? t('uxs11.checkingBinding', 'Checking ERPNext setup…')
    : binding.isError
      ? null
      : !hasActiveBinding
      ? t('uxs11.bindingRequired', 'An active ERPNext organization connection is needed to load these choices. Ask your accounting administrator to review the connection.')
      : catalogue.isPending
        ? t('uxs11.loadingAccounts', 'Loading chart accounts…')
        : null;

  return (
    <section aria-labelledby="vendor-tax-accounts-heading">
      <h2 id="vendor-tax-accounts-heading" tabIndex={-1} className="scroll-mt-4 text-[15px] font-semibold">
        {t('uxs11.vendorTaxHeading', 'Vendor bill tax accounts')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('uxs11.vendorTaxIntro', 'Choose the company-chart accounts used for input VAT and tax withheld from vendor bills. Input VAT candidates use Asset accounts; PPh payable candidates use Liability accounts.')}
      </p>
      <div className="mt-3 max-w-md">
        {query.isError ? (
          <ListState variant="error" title={t('uxs11.vendorTaxLoadError', "Couldn't load the tax accounts")} onRetry={() => void query.refetch()} />
        ) : query.isPending ? (
          <ListState variant="loading" rows={3} />
        ) : canManage ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setError(undefined);
              mutation.mutate(draft());
            }}
            className="space-y-3"
          >
            {remoteChanged && (
              <div role="status" className="rounded-md bg-secondary px-3 py-2 text-[13px] text-secondary-foreground">
                <p>{t('uxs11.vendorTaxRemoteChanged', 'The saved accounts changed. Your edits are kept; reload the saved values to discard them.')}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
                  const remote = query.data;
                  if (!remote) return;
                  const values = { inputVatAccount: remote.inputVatAccount ?? null, pph23PayableAccount: remote.pph23PayableAccount ?? null, pph42PayableAccount: remote.pph42PayableAccount ?? null };
                  savedBaseline.current = values;
                  setInputVat(values.inputVatAccount ?? ''); setPph23(values.pph23PayableAccount ?? ''); setPph42(values.pph42PayableAccount ?? '');
                  setRemoteChanged(false); setError(undefined);
                }}>{t('uxs11.reloadSaved', 'Reload saved values')}</Button>
              </div>
            )}
            {commonStatus && <p role="status" className="text-[13px] text-muted-foreground">{commonStatus}</p>}
            {binding.isError && <div role="status" className="space-y-2 text-[13px] text-muted-foreground"><p>{t('uxs11.bindingLoadError', "Couldn't check ERPNext setup. Retry before deciding whether a connection is needed.")}</p><Button type="button" variant="outline" size="sm" onClick={() => void binding.refetch()}>{t('uxs11.retryBinding', 'Check setup again')}</Button></div>}
            {hasActiveBinding && catalogue.isError && <ListState variant="error" title={t('uxs11.catalogueLoadError', "Couldn't load chart accounts")} onRetry={() => void catalogue.refetch()} />}
            {fields.map((field) => {
              const value = values[field.key];
              const fieldCandidates = candidates[field.key === 'inputVatAccount' ? 'inputVat' : field.key === 'pph23PayableAccount' ? 'pph23' : 'pph42'];
              return (
                <div key={field.key} className="space-y-1.5">
                  <Combobox
                    label={t(field.labelKey, field.label)}
                    value={value}
                    selectedOption={value ? valueOption(value, fieldCandidates, catalogue.isSuccess
                      ? t('uxs11.savedChoiceUnavailable', 'Saved value is not in the current chart; it remains saved until replaced.')
                      : undefined) : null}
                    onChange={(next) => {
                      if (field.key === 'inputVatAccount') setInputVat(next);
                      else if (field.key === 'pph23PayableAccount') setPph23(next);
                      else setPph42(next);
                      setError(undefined);
                    }}
                    onClear={() => {
                      if (field.key === 'inputVatAccount') setInputVat('');
                      else if (field.key === 'pph23PayableAccount') setPph23('');
                      else setPph42('');
                      setError(undefined);
                    }}
                    clearable={Boolean(value && !mutation.isPending)}
                    loadOptions={loadOptions[field.purpose]}
                    noun={t('uxs11.accountNoun', 'account')}
                    placeholder={t('uxs11.accountPlaceholder', 'Choose an account')}
                    searchPlaceholder={t('uxs11.accountSearch', 'Search account name or number')}
                    disabled={mutation.isPending || !canBrowse}
                  />
                  {canBrowse && fieldCandidates.length === 0 && <p className="text-[13px] text-muted-foreground">{t(field.emptyKey, field.empty)}</p>}
                </div>
              );
            })}
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" variant="outline" disabled={mutation.isPending || !dirty || !canSave}>
              {t('uxs11.saveVendorTax', 'Save accounts')}
            </Button>
          </form>
        ) : (
          <>
            <dl className="space-y-1 text-[13px]">
              <div><dt className="inline text-muted-foreground">{t('uxs11.inputVatLabel', 'Input VAT account')}: </dt><dd className="inline">{current?.inputVatAccount ?? notConfigured}</dd></div>
              <div><dt className="inline text-muted-foreground">{t('uxs11.pph23Label', 'PPh 23 payable account')}: </dt><dd className="inline">{current?.pph23PayableAccount ?? notConfigured}</dd></div>
              <div><dt className="inline text-muted-foreground">{t('uxs11.pph42Label', 'PPh 4(2) payable account')}: </dt><dd className="inline">{current?.pph42PayableAccount ?? notConfigured}</dd></div>
            </dl>
            <p className="mt-2 text-[13px] text-muted-foreground">{t('uxs11.onlyAdmin', 'Only an Admin can change this.')}</p>
          </>
        )}
      </div>
    </section>
  );
}
