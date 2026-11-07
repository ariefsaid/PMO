import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Checkbox, ConfirmDialog, TextArea, Toolbar, useToast } from '@/src/components/ui';
import { useBudgetArchiveTargets, useBudgetMutations, useBudgetActivationPrecheck } from '@/src/hooks/useBudget';
import { repositories } from '@/src/lib/repositories';
import type { BudgetArchiveTarget, BudgetVersionWithItems } from '@/src/lib/db/budgets';

/** A staged, not-yet-committed budget mutation awaiting the ConfirmDialog
 *  (owner rule: nothing writes on a single click). B1-B5 + delete-line-item. */
type PendingBudgetConfirm =
  | { kind: 'create'; name: string }
  | { kind: 'activate'; id: string; label: string }
  | { kind: 'clone'; id: string; label: string }
  | { kind: 'return'; id: string; label: string }
  | { kind: 'resubmit'; id: string; label: string }
  /** #1462 — `targets` is the SERVER's inventory for this version; `cancellable` is true only when it
   *  says EVERY named target is eligible. The surface never re-derives either. */
  | { kind: 'archive'; id: string; label: string; targets: BudgetArchiveTarget[]; cancellable: boolean; cancelErp: boolean }
  | { kind: 'deleteDraft'; id: string; label: string }
  | { kind: 'deleteLineItem'; id: string; label: string };

interface VersionActionsOptions {
  projectId: string;
  versions: BudgetVersionWithItems[];
  draftVersion: BudgetVersionWithItems | undefined;
  canActivate: boolean;
  canReturn: boolean;
  canConfirmActivation: boolean;
  hasOpenLineBuffers: boolean;
  soleOperator: boolean;
  activateBlockedReason: string | null;
  readinessMessages: string[];
  archiveTargetsQuery: ReturnType<typeof useBudgetArchiveTargets>;
  activationPrecheckQuery: ReturnType<typeof useBudgetActivationPrecheck>;
  mutations: ReturnType<typeof useBudgetMutations>;
  setSelectedVersionId: React.Dispatch<React.SetStateAction<string | null>>;
  setDraftEditorOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setBudgetView: (view: 'actual' | 'forecast') => void;
}

type ArchiveConfirm = Extract<PendingBudgetConfirm, { kind: 'archive' }>;

/**
 * #1462 — the ONE place the archive decision is derived from the server's inventory.
 *
 * Cancellation is offered ONLY when the server says every named target is eligible: the RPC rejects the
 * whole cancel request atomically, so a partial offer would be a promise the server cannot keep. Legacy
 * rows carry a year and a document name and NOTHING else — no account is invented for them, and a
 * null/stale-witness or unavailable-binding row still appears in the list (it is a reason to warn, never
 * a reason to hide a possibly-live ERP control).
 */
export function budgetArchiveConfirmFromTargets(
  id: string,
  label: string,
  targets: readonly BudgetArchiveTarget[],
): ArchiveConfirm {
  const cancellable = targets.length > 0 && targets.every((target) => target.eligible);
  return {
    kind: 'archive',
    id,
    label,
    targets: [...targets],
    cancellable,
    cancelErp: cancellable,
  };
}

export function useBudgetVersionActions({ projectId, versions, draftVersion, canActivate, canReturn, canConfirmActivation, hasOpenLineBuffers, soleOperator, activateBlockedReason, readinessMessages, activationPrecheckQuery, mutations, setSelectedVersionId, setDraftEditorOpen, setBudgetView }: VersionActionsOptions) {
  const { t } = useTranslation('finance');
  const { toast, dismiss: dismissToast } = useToast();
  const queryClient = useQueryClient();
  const activationNoticeId = useRef<number | null>(null);
  const dismissActivationNotice = () => {
    if (activationNoticeId.current !== null) dismissToast(activationNoticeId.current);
    activationNoticeId.current = null;
  };
  const [newVersionName, setNewVersionName] = useState('');
  const [showNewVersionForm, setShowNewVersionForm] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<PendingBudgetConfirm | null>(null);
  const versionLabel = (id: string): string => {
    const version = versions.find((item) => item.id === id);
    return version ? version.name + ' (v' + version.version + ')' : id;
  };
  const requestCreate = (name: string) => {
    dismissActivationNotice();
    setPendingConfirm({ kind: 'create', name });
  };
  const requestActivate = (id: string) => {
    if (!canActivate || hasOpenLineBuffers || draftVersion?.id !== id) return;
    dismissActivationNotice();
    void activationPrecheckQuery.refetch();
    setPendingConfirm({ kind: 'activate', id, label: versionLabel(id) });
  };
  const requestReturn = (id: string) => {
    if (!canReturn || draftVersion?.id !== id) return;
    dismissActivationNotice();
    setReturnReason('');
    setPendingConfirm({ kind: 'return', id, label: versionLabel(id) });
  };
  const requestResubmit = (id: string) => {
    dismissActivationNotice();
    setPendingConfirm({ kind: 'resubmit', id, label: versionLabel(id) });
  };
  const requestClone = (id: string) => {
    dismissActivationNotice();
    setPendingConfirm({ kind: 'clone', id, label: versionLabel(id) });
  };
  const requestArchive = async (id: string) => {
    dismissActivationNotice();
    try {
      // #1462 — the server owns the inventory AND the eligibility verdict. A failed read aborts the
      // dialog: "could not read" must never render as "nothing is live".
      const targets = await repositories.budget.listArchiveTargets(id);
      setPendingConfirm(budgetArchiveConfirmFromTargets(id, versionLabel(id), targets));
    } catch (error) {
      toast(t('financeCopy.actionFailed', 'Action failed'), error instanceof Error ? error.message : undefined, 'warning');
    }
  };
  const requestDeleteDraft = (id: string) => {
    dismissActivationNotice();
    setPendingConfirm({ kind: 'deleteDraft', id, label: versionLabel(id) });
  };
  const requestDeleteLineItem = (id: string) => {
    dismissActivationNotice();
    setPendingConfirm({ kind: 'deleteLineItem', id, label: id });
  };

  const commitBudgetConfirm = async () => {
    const confirm = pendingConfirm;
    if (!confirm) return;
    try {
      switch (confirm.kind) {
        case 'create': {
          // #1472 FR-001: a UI-created version defaults to whole-project mode, named explicitly at
          // the repository boundary — the import path keeps its own per_year semantics untouched.
          const created = await mutations.createVersion.mutateAsync({ projectId, name: confirm.name, budgetMode: 'whole_project' });
          // BU-1: the new Draft is the version in view, as after "Clone to revise".
          setSelectedVersionId(created.id);
          setBudgetView('actual');
          setShowNewVersionForm(false);
          setNewVersionName('');
          setPendingConfirm(null);
          toast(t('financeCopy.budgetVersionCreated', 'Budget version created'), confirm.name, 'success');
          break;
        }
        case 'activate': {
          if (!canActivate || !canConfirmActivation || hasOpenLineBuffers || draftVersion?.id !== confirm.id) return;
          const { pushState } = await mutations.activate.mutateAsync(confirm.id);
          void queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
          setPendingConfirm(null);
          if (pushState === 'failed') {
            activationNoticeId.current = toast(
              t('financeCopy.versionActivatedERPNotUpdated', 'Version activated, but ERPNext was not updated'),
              t('projectDetail.budget.erpReviewHint', "{{version}}. The budget is active; ask Finance or an administrator to review ERP enforcement.", { version: confirm.label }),
              'warning',
            );
          } else if (pushState === 'nothing-to-push') {
            toast(
              t('financeCopy.versionActivatedNothingSent', 'Version activated: nothing was sent to ERPNext'),
              t('financeCopy.noBudgetLinesToPush', '{{version}} has no budget lines, so no ERPNext Budget was created. Add lines and activate a new version to enforce one.', { version: confirm.label }),
              'warning',
            );
          } else {
            toast(t('financeCopy.versionActivated', 'Version activated'), confirm.label, 'success');
          }
          break;
        }
        case 'return':
          if (!canReturn || draftVersion?.id !== confirm.id || !returnReason.trim()) return;
          await mutations.returnVersion.mutateAsync({ versionId: confirm.id, reason: returnReason.trim() });
          setPendingConfirm(null);
          toast(t('projectDetail.budget.draftReturnedToast', 'Draft returned'), confirm.label, 'success');
          break;
        case 'resubmit':
          await mutations.resubmitVersion.mutateAsync(confirm.id);
          setPendingConfirm(null);
          toast(t('projectDetail.budget.draftResubmitted', 'Draft resubmitted for approval'), confirm.label, 'success');
          break;
        case 'clone': {
          const newDraftId = await mutations.cloneVersion.mutateAsync(confirm.id);
          setPendingConfirm(null);
          setSelectedVersionId(newDraftId);
          setDraftEditorOpen(false);
          setBudgetView('actual');
          toast(t('financeCopy.versionCloned', 'Version cloned'), t('financeCopy.newDraftFrom', 'New draft from {{version}}', { version: confirm.label }), 'success');
          break;
        }
        case 'archive': {
          const result = await mutations.archive.mutateAsync({ versionId: confirm.id, cancelErp: confirm.cancelErp });
          void queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
          void queryClient.invalidateQueries({ queryKey: ['budget-archive-live-targets'] });
          setPendingConfirm(null);
          if (confirm.cancelErp && result.queuedCount > 0) {
            toast(
              t('budgetArchive.versionArchivedCancellationQueued'),
              t('budgetArchive.cancellationQueuedDetail', { count: result.queuedCount }),
              'success',
            );
          } else if (confirm.cancelErp) {
            // The operator asked to cancel, but the server queued nothing. Say so instead of claiming
            // success — a cancellation that was not queued has not removed any ERP control.
            toast(
              t('budgetArchive.cancellationNotQueued', 'Version archived, but no ERPNext cancellation was queued'),
              t('budgetArchive.archivedStillLiveWarning', { count: result.liveTargetCount }),
              'warning',
            );
          } else if (result.liveTargetCount > 0) {
            toast(
              t('financeCopy.versionArchived', 'Version archived'),
              t('budgetArchive.archivedStillLiveWarning', { count: result.liveTargetCount }),
              'warning',
            );
          } else {
            toast(t('financeCopy.versionArchived', 'Version archived'), confirm.label, 'success');
          }
          break;
        }
        case 'deleteDraft':
          await mutations.deleteDraft.mutateAsync(confirm.id);
          setPendingConfirm(null);
          toast(t('financeCopy.draftDeleted', 'Draft deleted'), confirm.label, 'success');
          break;
        case 'deleteLineItem':
          await mutations.deleteLineItem.mutateAsync(confirm.id);
          setPendingConfirm(null);
          toast(t('financeCopy.lineItemDeleted', 'Line item deleted'), undefined, 'success');
          break;
      }
    } catch (error) {
      // #1462 — a refused cancellation keeps the dialog OPEN with the actionable message, so the
      // operator can switch to "archive without cancellation" instead of losing the decision context.
      if (confirm.kind !== 'archive') setPendingConfirm(null);
      toast(t('financeCopy.actionFailed', 'Action failed'), error instanceof Error ? error.message : undefined, 'warning');
    }
  };

  const confirmInFlight = mutations.createVersion.isPending || mutations.activate.isPending || mutations.returnVersion.isPending || mutations.resubmitVersion.isPending || mutations.cloneVersion.isPending ||
    mutations.archive.isPending || mutations.deleteDraft.isPending || mutations.deleteLineItem.isPending;
  const confirmCopy: Record<PendingBudgetConfirm['kind'], { tone: 'default' | 'destructive'; title: string; confirmLabel: string }> = {
    create: { tone: 'default', title: t('financeCopy.createBudgetVersion', 'Create budget version?'), confirmLabel: t('financeCopy.createVersion', 'Create version') },
    activate: { tone: 'default', title: t('financeCopy.makeThisTheActiveBudget', 'Make this the active budget?'), confirmLabel: t('financeCopy.activateVersion', 'Activate version') },
    return: { tone: 'default', title: t('projectDetail.budget.returnVersionTitle', 'Return this draft to the drafter?'), confirmLabel: t('projectDetail.budget.returnVersionConfirm', 'Return draft') },
    resubmit: { tone: 'default', title: t('projectDetail.budget.resubmitVersion', 'Resubmit for approval'), confirmLabel: t('projectDetail.budget.resubmitVersion', 'Resubmit for approval') },
    clone: { tone: 'default', title: t('financeCopy.cloneToANewDraft', 'Clone to a new draft?'), confirmLabel: t('financeCopy.cloneVersion', 'Clone version') },
    archive: { tone: 'destructive', title: t('financeCopy.archiveThisVersion', 'Archive this version?'), confirmLabel: t('financeCopy.archiveVersion', 'Archive version') },
    deleteDraft: { tone: 'destructive', title: t('financeCopy.deleteThisDraft', 'Delete this draft?'), confirmLabel: t('financeCopy.deleteDraft', 'Delete draft') },
    deleteLineItem: { tone: 'destructive', title: t('financeCopy.deleteThisLineItem', 'Delete this line item?'), confirmLabel: t('financeCopy.delete', 'Delete') },
  };
  const describeConfirm = (confirm: PendingBudgetConfirm): React.ReactNode => {
    switch (confirm.kind) {
      case 'create': return t('financeCopy.confirmCreateDescription', 'This creates a new Draft budget version named "{{name}}".', { name: confirm.name });
      case 'activate': return [
      soleOperator
        ? t('financeCopy.confirmSoleOperatorActivation', "You're the only person in this organisation, so you can activate a budget you prepared yourself. Once a colleague joins, a second person will need to activate it.")
        : t('financeCopy.confirmActivateDescription', 'This makes {{version}} the live active budget and supersedes the current active version.', { version: confirm.label }),
      ...(!canActivate && activateBlockedReason ? [activateBlockedReason] : []),
      ...readinessMessages,
    ].join(' ');
      case 'return': return (
      <div className="flex flex-col gap-3">
        <p>{t('projectDetail.budget.returnVersionDescription', '{{version}} goes back to its drafter and leaves the approval queue until it is resubmitted.', { version: confirm.label })}</p>
        <TextArea
          label={t('projectDetail.budget.returnReasonLabel', 'Reason for returning')}
          helper={t('projectDetail.budget.returnReasonHelper', 'The drafter sees this reason. Their changes are kept and the draft stays editable.')}
          value={returnReason}
          onChange={setReturnReason}
          maxLength={1000}
          required
          fullWidth
        />
      </div>
    );
      case 'resubmit': return t('projectDetail.budget.draftReady', 'This draft is ready for an eligible approver to activate.');
      case 'clone': return t('financeCopy.confirmCloneDescription', 'This copies {{version}} into a new editable Draft.', { version: confirm.label });
      case 'archive': return (
      <div className="flex flex-col gap-3">
        <p>{t('financeCopy.confirmArchiveDescription', 'This removes {{version}} as the active budget. You can clone it later to revise.', { version: confirm.label })}</p>
        {confirm.targets.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-foreground">
              {t('budgetArchive.stillLiveList', 'ERPNext Budget documents that may still be live:')}
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground" aria-label={t('budgetArchive.stillLiveListAria', 'ERPNext Budget documents that may still be live')}>
              {confirm.targets.map((target, index) => {
                const year = target.to_fiscal_year ? `${target.fiscal_year}–${target.to_fiscal_year}` : target.fiscal_year;
                return (
                  <li key={`${target.source_kind}:${target.fiscal_year}:${target.erp_budget_name}:${index}`}>
                    {target.source_kind === 'legacy'
                      ? t('budgetArchive.legacyTargetLine', '{{year}} — {{name}} (older push)', { year, name: target.erp_budget_name })
                      : t('budgetArchive.targetLine', '{{year}} — {{name}}', { year, name: target.erp_budget_name })}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {confirm.targets.length > 0 && !confirm.cancellable && (
          <p role="alert" className="text-sm text-foreground">
            {t('budgetArchive.cancellationUnavailableWarning', 'PMO cannot cancel these automatically because their ownership or status could not be proven. Archiving will not remove them — cancel them in ERPNext, or retry once the other change has settled.')}
          </p>
        )}
        {confirm.cancellable && (
          <div className="flex items-start gap-2">
            <Checkbox
              label={t('budgetArchive.alsoCancelErpBudgets', { count: confirm.targets.length })}
              labelledBy="budget-archive-cancel-label"
              checked={confirm.cancelErp}
              onChange={(checked) => setPendingConfirm((current) => current?.kind === 'archive' ? { ...current, cancelErp: checked } : current)}
            />
            <span
              id="budget-archive-cancel-label"
              className="cursor-pointer text-sm text-foreground"
              onClick={() => setPendingConfirm((current) => current?.kind === 'archive' ? { ...current, cancelErp: !current.cancelErp } : current)}
            >
              {t('budgetArchive.alsoCancelErpBudgets', { count: confirm.targets.length })}
            </span>
          </div>
        )}
      </div>
    );
      case 'deleteDraft': return t('financeCopy.confirmDeleteDraftDescription', 'This permanently deletes the draft {{version}}. This cannot be undone.', { version: confirm.label });
      case 'deleteLineItem': return t('financeCopy.confirmDeleteLineItemDescription', 'This permanently removes the line item from the draft. This cannot be undone.');
    }
    const exhaustive: never = confirm;
    return exhaustive;
  };
  const budgetConfirm = pendingConfirm && (
    <ConfirmDialog
      open
      tone={confirmCopy[pendingConfirm.kind].tone}
      title={confirmCopy[pendingConfirm.kind].title}
      description={describeConfirm(pendingConfirm)}
      confirmLabel={confirmCopy[pendingConfirm.kind].confirmLabel}
      loading={confirmInFlight}
      confirmDisabled={(pendingConfirm.kind === 'return' && !returnReason.trim()) || (pendingConfirm.kind === 'activate' && (!canConfirmActivation || !canActivate || hasOpenLineBuffers || pendingConfirm.id !== draftVersion?.id))}
      restoreFocusFallback={() => document.querySelector<HTMLElement>('#budget-primary-action, #budget-versions-trigger')}
      onCancel={() => setPendingConfirm(null)}
      onConfirm={() => void commitBudgetConfirm()}
    />
  );

  const newVersionForm = renderNewVersionForm({ onSubmit: requestCreate, onCancel: () => setShowNewVersionForm(false), value: newVersionName, onChange: setNewVersionName, t });
  return { newVersionForm, showNewVersionForm, setShowNewVersionForm, pendingConfirm, budgetConfirm, dismissActivationNotice, requestActivate, requestReturn, requestResubmit, requestClone, requestArchive, requestDeleteDraft, requestDeleteLineItem };
}

// ---------------------------------------------------------------------------
// New version form
// ---------------------------------------------------------------------------
const renderNewVersionForm = ({ onSubmit, onCancel, value, onChange, t }: {
  /** Stages a create-version confirm (no write on click). */
  onSubmit: (name: string) => void;
  onCancel: () => void;
  value: string;
  onChange: (v: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
}) => {
  return (
    <Toolbar standalone className="items-center">
    <input
      type="text"
      aria-label={t('financeCopy.versionName', "Version name")}
      placeholder={t('financeCopy.versionNameEGBudgetV1', "Version name (e.g. Budget v1)")}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[13.5px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      autoFocus
    />
    <Button variant="primary" onClick={() => value.trim() && onSubmit(value.trim())} disabled={!value.trim()}>
      {t('financeCopy.create', "Create")}</Button>
    <Button variant="outline" onClick={onCancel}>
      {t('financeCopy.cancel', "Cancel")}</Button>
    </Toolbar>
  );
};
