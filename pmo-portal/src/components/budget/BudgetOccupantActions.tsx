import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, useToast } from '@/src/components/ui';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  createDraftFromErpBudget,
  inspectBudgetOccupant,
  listRefusedOccupantAccounts,
  replaceErpBudget,
  type ErpBudgetOccupant,
} from '@/src/lib/repositories/budgetOccupant';

/**
 * ECA-6 (#1603): the two ways forward when ERPNext already holds a budget PMO did not create. Shown beside the refused
 * push to Admin and Finance. "Replace" asks first, naming the exact ERP budget; the server records that consent and
 * the push goes through the ordinary path. PMO never amends an ERP budget without it.
 */
export default function BudgetOccupantActions({
  projectId,
  versionId,
  fiscalYear,
  onOpenDraft,
}: {
  projectId: string;
  versionId: string;
  fiscalYear: string;
  onOpenDraft?: (draftVersionId: string) => void;
}) {
  const { t } = useTranslation('project');
  const { realRole } = useEffectiveRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = React.useState<ErpBudgetOccupant | null>(null);
  const allowed = realRole === 'Admin' || realRole === 'Finance';
  const accounts = useQuery<string[]>({
    queryKey: ['budget-occupant-accounts', versionId, fiscalYear],
    queryFn: () => listRefusedOccupantAccounts(versionId, fiscalYear),
    enabled: allowed,
  });
  const refreshPush = () => queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
  const fail = (error: unknown) => {
    const { headline, detail } = classifyMutationError(error);
    toast(headline, detail, 'warning');
  };

  const useDraft = useMutation({
    mutationFn: (account: string) => createDraftFromErpBudget(projectId, fiscalYear, account),
    onSuccess: async (draftVersionId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['budget-versions'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
      ]);
      toast(t('budgetOccupant.draftCreated', 'Draft created'), t('budgetOccupant.draftCreatedDetail', 'The ERP figures are now a draft version. Review it, then activate it when you are ready.'), 'success');
      onOpenDraft?.(draftVersionId);
    },
    onError: fail,
  });
  const askToReplace = useMutation({
    mutationFn: (account: string) => inspectBudgetOccupant(projectId, fiscalYear, account),
    onSuccess: setConfirming,
    onError: fail,
  });
  const replace = useMutation({
    mutationFn: (occupant: ErpBudgetOccupant) => replaceErpBudget(projectId, occupant),
    onSuccess: (result) => {
      if (result.pushState === 'pushed') {
        toast(t('budgetOccupant.replaced', 'ERP budget replaced'), t('budgetOccupant.replacedDetail', 'ERPNext now holds PMO’s active budget.'), 'success');
      } else {
        toast(t('budgetOccupant.notReplaced', 'The ERP budget was not replaced'), t('budgetOccupant.notReplacedDetail', 'The push did not complete. The reason is shown on the budget.'), 'warning');
      }
    },
    onError: fail,
    onSettled: () => { setConfirming(null); void refreshPush(); },
  });

  if (!allowed || accounts.isPending || accounts.isError || !accounts.data) return null;
  return (
    <>
      {accounts.data.map((account) => (
        <span key={account || 'project'} className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" data-testid="budget-occupant-actions">
          {account && <span>{account}</span>}
          <Button variant="ghost" size="sm" loading={useDraft.isPending && useDraft.variables === account} onClick={() => useDraft.mutate(account)}>
            {t('budgetOccupant.useAsDraft', 'Use the ERP figures as a draft')}
          </Button>
          <Button variant="ghost" size="sm" loading={askToReplace.isPending && askToReplace.variables === account} onClick={() => askToReplace.mutate(account)}>
            {t('budgetOccupant.replace', 'Replace the ERP budget with this version')}
          </Button>
        </span>
      ))}
      <ConfirmDialog
        open={confirming !== null}
        tone="destructive"
        title={t('budgetOccupant.confirmTitle', 'Replace ERP budget {{name}}?', { name: confirming?.erpBudgetName })}
        description={confirming?.erpAccount
          ? t('budgetOccupant.confirmDescription', 'Replace ERP budget {{name}} for {{account}}, {{year}}, with PMO’s active version? The ERP copy will be amended.', { name: confirming.erpBudgetName, account: confirming.erpAccount, year: confirming.fiscalYear })
          : t('budgetOccupant.confirmDescriptionYear', 'Replace ERP budget {{name}} for {{year}} with PMO’s active version? The ERP copy will be amended.', { name: confirming?.erpBudgetName, year: confirming?.fiscalYear })}
        confirmLabel={t('budgetOccupant.confirmLabel', 'Replace ERP budget')}
        loading={replace.isPending}
        onConfirm={() => confirming && replace.mutate(confirming)}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
