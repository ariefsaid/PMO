import React, { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { useRemoteStringDraft } from '@/src/hooks/useRemoteStringDraft';
import { repositories } from '@/src/lib/repositories';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { listBudgetPostingAccountCatalogue } from '@/src/lib/repositories/budgetProjection';
import { accountOption } from '@/src/lib/accounting/accountOption';
import { taxSetupChoices } from '@/src/lib/accounting/taxSetupChoices';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, Combobox, FieldError, ListState, useToast } from '@/src/components/ui';
import type { ComboboxOption } from '@/src/components/ui';
import type { OrgWithholdingAccounts } from '@/src/lib/db/orgs';
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
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getWithholdingAccounts(), enabled: !!currentUser, ...SESSION_QUERY_OPTIONS });
  const hasActiveBinding = binding.data?.status === 'active' && !binding.isError;
  // One remote-synced draft per account: the default, then one per tax article (#1275).
  const defaultDraft = useRemoteStringDraft({ remote: query.data?.defaultAccount, isSuccess: query.isSuccess });
  const pph23Draft = useRemoteStringDraft({ remote: query.data?.pph23Account, isSuccess: query.isSuccess });
  const pph42Draft = useRemoteStringDraft({ remote: query.data?.pph42Account, isSuccess: query.isSuccess });
  const fields = [
    { key: 'default', draft: defaultDraft, label: t('administration:admin.receiptWithholding.defaultLabel', 'Default account'), noun: t('administration:admin.receiptWithholding.defaultNoun', 'default account') },
    { key: 'pph23', draft: pph23Draft, label: t('administration:admin.receiptWithholding.pph23Label', 'PPh 23 prepaid account'), noun: t('administration:admin.receiptWithholding.pph23Noun', 'PPh 23 account') },
    { key: 'pph42', draft: pph42Draft, label: t('administration:admin.receiptWithholding.pph42Label', 'PPh 4(2) prepaid account'), noun: t('administration:admin.receiptWithholding.pph42Noun', 'PPh 4(2) account') },
  ] as const;
  const catalogue = useQuery({
    queryKey: ['uxs11', 'account-catalogue', orgId],
    queryFn: listBudgetPostingAccountCatalogue,
    enabled: Boolean(canManage && orgId && hasActiveBinding),
  });
  const candidates = catalogue.data ? taxSetupChoices(catalogue.data.accounts, 'receipt-withholding') : [];
  const loadOptions = useCallback(async () =>
    taxSetupChoices(catalogue.data?.accounts ?? [], 'receipt-withholding').map((account) => accountOption(account)),
  [catalogue.data]);

  const mutation = useMutation({
    mutationFn: (value: OrgWithholdingAccounts) => repositories.orgSettings.setWithholdingAccounts(value),
    onSuccess: (_result, value) => {
      defaultDraft.acceptSaved(value.defaultAccount);
      pph23Draft.acceptSaved(value.pph23Account);
      pph42Draft.acceptSaved(value.pph42Account);
      void qc.invalidateQueries({ queryKey });
      toast(t('uxs11.withholdingSaved', 'Receipt withholding account saved'), undefined, 'success');
    },
    onError: (err) => {
      const classified = classifyMutationError(err);
      setError(classified.detail || classified.headline);
    },
  });

  // A draft is savable when empty or still a candidate; a saved value gone from the chart stays until replaced.
  const choiceOk = (draft: string, dirty: boolean) => draft === '' || !dirty || candidates.some((account) => account.account === draft);
  const dirty = fields.some((f) => f.draft.dirty);
  const canSaveDraft = fields.every((f) => choiceOk(f.draft.draft, f.draft.dirty));
  const remoteChanged = fields.some((f) => f.draft.remoteChanged);
  const canBrowse = canManage && hasActiveBinding && catalogue.isSuccess;
  const notConfigured = t('uxs11.notConfigured', 'Not configured');
  const draftValues = (): OrgWithholdingAccounts => ({
    defaultAccount: defaultDraft.draft || null, pph23Account: pph23Draft.draft || null, pph42Account: pph42Draft.draft || null,
  });
  const readOnlyValues = [query.data?.defaultAccount, query.data?.pph23Account, query.data?.pph42Account];

  return <section aria-labelledby="withholding-account-heading">
    <h2 id="withholding-account-heading" tabIndex={-1} className="scroll-mt-4 text-group font-semibold">
      {t('uxs11.withholdingHeading', 'Receipt withholding')}
    </h2>
    <p className="mt-1 text-control text-muted-foreground">
      {t('uxs11.withholdingIntro', 'Asset account for income tax withheld by clients. Set it before recording a receipt with withholding.')}
    </p>
    <p className="mt-1 text-control text-muted-foreground">
      {t('administration:admin.receiptWithholding.fallbackHint', 'Receipts without their own account post to the default.')}
    </p>
    <div className="mt-3 max-w-md">
      {query.isError ? <ListState variant="error" title={t('uxs11.withholdingLoadError', "Couldn't load the tax-prepaid account")} onRetry={() => void query.refetch()} />
        : query.isPending ? <ListState variant="loading" rows={3} />
        : canManage ? <form onSubmit={(event) => { event.preventDefault(); setError(undefined); mutation.mutate(draftValues()); }} className="space-y-3">
          {remoteChanged && (
            <div role="status" className="rounded-md bg-secondary px-3 py-2 text-control text-secondary-foreground">
              <p>{t('uxs11.withholdingRemoteChanged', 'The saved account changed. Your edit is kept; reload the saved value to discard it.')}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => {
                fields.forEach((f) => f.draft.reload());
                setError(undefined);
              }}>{t('uxs11.reloadSaved', 'Reload saved value')}</Button>
            </div>
          )}
          {fields.map(({ key, draft: d, label, noun }) => {
            const candidate = candidates.find((account) => account.account === d.draft);
            const isStaleSavedChoice = Boolean(d.draft && !candidate && !d.dirty && catalogue.isSuccess);
            const isUnavailableDraftChoice = Boolean(d.draft && !candidate && d.dirty && catalogue.isSuccess);
            const selectedOption: ComboboxOption | null = !d.draft
              ? null
              : candidate
                ? accountOption(candidate)
                : {
                    value: d.draft,
                    label: d.draft,
                    sub: isStaleSavedChoice
                      ? t('uxs11.savedChoiceUnavailable', 'Saved value is not in the current chart')
                      : undefined,
                  };
            return <div key={key} className="space-y-1.5">
              <Combobox
                label={label}
                value={d.draft || null}
                selectedOption={selectedOption}
                onChange={(value) => { d.setDraft(value); setError(undefined); }}
                onClear={() => { d.setDraft(''); setError(undefined); }}
                clearable={Boolean(d.draft && !mutation.isPending)}
                error={isUnavailableDraftChoice ? t('v024Polish.accountDraftUnavailable', 'This unsaved choice is no longer available in the current chart. Choose another account or clear this field.') : undefined}
                loadOptions={loadOptions}
                noun={noun}
                placeholder={t('uxs11.withholdingPlaceholder', 'Choose an Asset account')}
                searchPlaceholder={t('uxs11.accountSearch', 'Search account name or number')}
                disabled={mutation.isPending || !canBrowse}
                clearWhileDisabled
              />
              {isStaleSavedChoice && <p className="text-control text-muted-foreground">{t('uxs11.savedChoiceUnavailable', 'Saved value is not in the current chart')}</p>}
            </div>;
          })}
          {binding.isPending && <p role="status" className="text-control text-muted-foreground">{t('uxs11.checkingBinding', 'Checking ERPNext setup…')}</p>}
          {binding.isError && <div role="status" className="space-y-2 text-control text-muted-foreground"><p>{t('uxs11.bindingLoadError', "Couldn't check ERPNext setup. Retry before deciding whether a connection is needed.")}</p><Button type="button" variant="outline" size="sm" onClick={() => void binding.refetch()}>{t('uxs11.retryBinding', 'Check setup again')}</Button></div>}
          {!binding.isPending && !binding.isError && !hasActiveBinding && <p role="status" className="text-control text-muted-foreground">{t('uxs11.bindingRequired', 'An active ERPNext connection is needed to load these choices.')}</p>}
          {hasActiveBinding && catalogue.isPending && <p role="status" className="text-control text-muted-foreground">{t('uxs11.loadingAccounts', 'Loading chart accounts…')}</p>}
          {hasActiveBinding && catalogue.isError && <ListState variant="error" title={t('uxs11.catalogueLoadError', "Couldn't load chart accounts")} onRetry={() => void catalogue.refetch()} />}
          {canBrowse && candidates.length === 0 && <p role="status" className="text-control text-muted-foreground">{t('uxs11.noAssetAccounts', 'No enabled Asset accounts in the ERP chart.')}</p>}
          {error && <FieldError>{error}</FieldError>}
          <Button type="submit" variant="outline" disabled={mutation.isPending || !dirty || !canSaveDraft}> {t('uxs11.saveWithholding', 'Save account')}</Button>
        </form> : <>
          <dl className="space-y-1 text-control">
            {fields.map(({ key, label }, index) => <div key={key}><dt className="inline text-muted-foreground">{label}: </dt><dd className="inline">{readOnlyValues[index] ?? notConfigured}</dd></div>)}
          </dl>
          <p className="mt-2 text-control text-muted-foreground">{t('uxs11.onlyAdmin', 'Only an Admin can change this.')}</p>
        </>}
    </div>
  </section>;
}
