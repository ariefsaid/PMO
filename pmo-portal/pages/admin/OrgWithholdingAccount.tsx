import React, { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { useRemoteStringDraft } from '@/src/hooks/useRemoteStringDraft';
import { orgSettingsRepository } from '@/src/lib/repositories/admin';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { listBudgetPostingAccountCatalogue } from '@/src/lib/repositories/budgetProjection';
import { accountOption } from '@/src/lib/accounting/accountOption';
import { taxSetupChoices } from '@/src/lib/accounting/taxSetupChoices';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, Combobox, FieldError, ListState, useToast } from '@/src/components/ui';
import type { ComboboxOption } from '@/src/components/ui';
import { useTranslation } from 'react-i18next';

const ACCOUNT_QUERY_KEY = 'org-withholding-account';

export default function OrgWithholdingAccount() {
  const { t } = useTranslation();
  const { currentUser } = useAuth();
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const binding = useErpnextBinding();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [error, setError] = useState<string>();
  const orgId = currentUser?.org_id;
  const queryKey = [ACCOUNT_QUERY_KEY, orgId];
  const query = useQuery({ queryKey, queryFn: () => orgSettingsRepository.getWithholdingAccount(), enabled: !!currentUser, ...SESSION_QUERY_OPTIONS });
  const hasActiveBinding = binding.data?.status === 'active' && !binding.isError;
  const { draft, setDraft, dirty, remoteChanged, acceptSaved, reload } = useRemoteStringDraft({ remote: query.data, isSuccess: query.isSuccess });
  const catalogue = useQuery({
    queryKey: ['uxs11', 'account-catalogue', orgId],
    queryFn: listBudgetPostingAccountCatalogue,
    enabled: Boolean(canManage && orgId && hasActiveBinding),
  });
  const candidates = catalogue.data ? taxSetupChoices(catalogue.data.accounts, 'receipt-withholding') : [];
  const candidate = candidates.find((account) => account.account === draft);
  const isStaleSavedChoice = Boolean(draft && !candidate && !dirty && catalogue.isSuccess);
  const isUnavailableDraftChoice = Boolean(draft && !candidate && dirty && catalogue.isSuccess);
  const loadOptions = useCallback(async () =>
    taxSetupChoices(catalogue.data?.accounts ?? [], 'receipt-withholding').map((account) => accountOption(account)),
  [catalogue.data]);
  const selectedOption: ComboboxOption | null = !draft
    ? null
    : candidate
      ? accountOption(candidate)
      : {
          value: draft,
          label: draft,
          sub: isStaleSavedChoice
            ? t('uxs11.savedChoiceUnavailable', 'Saved value is not in the current chart')
            : undefined,
        };

  const mutation = useMutation({
    mutationFn: (value: string | null) => orgSettingsRepository.setWithholdingAccount(value),
    onSuccess: (_result, value) => {
      acceptSaved(value);
      void qc.invalidateQueries({ queryKey });
      toast(t('uxs11.withholdingSaved', 'Receipt withholding account saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  });

  const canSaveDraft = draft === '' || Boolean(candidate);
  const canBrowse = canManage && hasActiveBinding && catalogue.isSuccess;
  const readOnlyValue = query.data ?? t('uxs11.notConfigured', 'Not configured');
  const savedContext = isStaleSavedChoice
    ? t('uxs11.savedChoiceUnavailable', 'Saved value is not in the current chart')
    : t('uxs11.receiptWithholdingContext', 'Asset account for client withholding received');

  return <section aria-labelledby="withholding-account-heading">
    <h2 id="withholding-account-heading" tabIndex={-1} className="scroll-mt-4 text-[15px] font-semibold">
      {t('uxs11.withholdingHeading', 'Receipt withholding')}
    </h2>
    <p className="mt-1 text-[13px] text-muted-foreground">
      {t('uxs11.withholdingIntro', 'Choose the Asset account used for income tax withheld by clients. An Admin must configure it before a receipt with withholding can be recorded.')}
    </p>
    <div className="mt-3 max-w-md">
      {query.isError ? <ListState variant="error" title={t('uxs11.withholdingLoadError', "Couldn't load the tax-prepaid account")} onRetry={() => void query.refetch()} />
        : query.isPending ? <ListState variant="loading" rows={1} />
        : canManage ? <form onSubmit={(event) => { event.preventDefault(); setError(undefined); mutation.mutate(draft || null); }} className="space-y-3">
          {remoteChanged && (
            <div role="status" className="rounded-md bg-secondary px-3 py-2 text-[13px] text-secondary-foreground">
              <p>{t('uxs11.withholdingRemoteChanged', 'The saved account changed. Your edit is kept; reload the saved value to discard it.')}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
                reload();
                setError(undefined);
              }}>{t('uxs11.reloadSaved', 'Reload saved value')}</Button>
            </div>
          )}
          <Combobox
            label={t('uxs11.withholdingLabel', 'Tax-prepaid account')}
            value={draft || null}
            selectedOption={selectedOption}
            onChange={(value) => { setDraft(value); setError(undefined); }}
            onClear={() => { setDraft(''); setError(undefined); }}
            clearable={Boolean(draft && !mutation.isPending)}
            error={isUnavailableDraftChoice ? t('v024Polish.accountDraftUnavailable', 'This unsaved choice is no longer available in the current chart. Choose another account or clear this field.') : undefined}
            loadOptions={loadOptions}
            noun={t('uxs11.accountNoun', 'account')}
            placeholder={t('uxs11.withholdingPlaceholder', 'Choose an Asset account')}
            searchPlaceholder={t('uxs11.accountSearch', 'Search account name or number')}
            disabled={mutation.isPending || !canBrowse}
            clearWhileDisabled
          />
          <p className="text-[13px] text-muted-foreground">{savedContext}</p>
          {binding.isPending && <p role="status" className="text-[13px] text-muted-foreground">{t('uxs11.checkingBinding', 'Checking ERPNext setup…')}</p>}
          {binding.isError && <div role="status" className="space-y-2 text-[13px] text-muted-foreground"><p>{t('uxs11.bindingLoadError', "Couldn't check ERPNext setup. Retry before deciding whether a connection is needed.")}</p><Button type="button" variant="outline" size="sm" onClick={() => void binding.refetch()}>{t('uxs11.retryBinding', 'Check setup again')}</Button></div>}
          {!binding.isPending && !binding.isError && !hasActiveBinding && <p role="status" className="text-[13px] text-muted-foreground">{t('uxs11.bindingRequired', 'An active ERPNext organization connection is needed to load these choices. Ask your accounting administrator to review the connection.')}</p>}
          {hasActiveBinding && catalogue.isPending && <p role="status" className="text-[13px] text-muted-foreground">{t('uxs11.loadingAccounts', 'Loading chart accounts…')}</p>}
          {hasActiveBinding && catalogue.isError && <ListState variant="error" title={t('uxs11.catalogueLoadError', "Couldn't load chart accounts")} onRetry={() => void catalogue.refetch()} />}
          {canBrowse && candidates.length === 0 && <p role="status" className="text-[13px] text-muted-foreground">{t('uxs11.noAssetAccounts', 'No enabled Asset accounts are available. Ask your accounting administrator to add a suitable account to the ERP chart.')}</p>}
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" variant="outline" disabled={mutation.isPending || !dirty || !canSaveDraft}> {t('uxs11.saveWithholding', 'Save account')}</Button>
        </form> : <p className="text-[13px]">{readOnlyValue}<span className="ml-2 text-muted-foreground">{t('uxs11.onlyAdmin', 'Only an Admin can change this.')}</span></p>}
    </div>
  </section>;
}
