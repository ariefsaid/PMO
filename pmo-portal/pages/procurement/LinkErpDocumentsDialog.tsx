import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, type ComboboxOption, type SubmitError } from '@/src/components/ui';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useLinkErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { erpLinkReasonText } from './erpLinkReasons';

const CLOSED = new Set(['Cancelled', 'Rejected']);
/** A Requested purchase takes no documents until it is approved (the server refuses it); it is left out and explained. */
const AWAITING_APPROVAL = 'Requested';

/** FR-PFE-025 — the projects every chosen document allows: the scoped project, else the intersection of the documents'
 *  attributed projects; null = unconstrained (no document is attributed to a project). */
function allowedProjects(docs: ErpPurchaseRow[], projectId?: string): ReadonlySet<string> | null {
  if (projectId) return new Set([projectId]);
  const attributed = docs.filter((d) => d.projectIds.length > 0);
  if (attributed.length === 0) return null;
  return new Set(attributed[0].projectIds.filter((p) => attributed.every((d) => d.projectIds.includes(p))));
}

export interface LinkErpDocumentsDialogProps {
  docs: ErpPurchaseRow[];
  /** Project scope: only that project's purchases are offered. */
  projectId?: string;
  onClose: () => void;
  onLinked: (procurementId: string) => void;
  /** Some documents linked and some were refused: the dialog closes and hands the refusals back to show beside the list. */
  onPartiallyLinked?: (headline: string, refusals: string[]) => void;
}

/** FR-PFE-020 — pick an open purchase and link the documents to it. The server re-checks supplier, project, currency and gates. */
export const LinkErpDocumentsDialog: React.FC<LinkErpDocumentsDialogProps> = ({ docs, projectId, onClose, onLinked, onPartiallyLinked }) => {
  const { t } = useTranslation('finance');
  const { data: purchases } = useProcurements();
  const link = useLinkErpDocuments();
  const [target, setTarget] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const { options, awaiting } = useMemo(() => {
    const allowed = allowedProjects(docs, projectId);
    const inScope = (purchases ?? []).filter((p) => !CLOSED.has(String(p.status))
      && (allowed === null || (p.project_id !== null && allowed.has(p.project_id))));
    return {
      options: inScope
        .filter((p) => p.status !== AWAITING_APPROVAL)
        .map<ComboboxOption>((p) => ({ value: p.id, label: p.title, sub: [p.vendor?.name, String(p.status)].filter(Boolean).join(' · ') })),
      awaiting: inScope.filter((p) => p.status === AWAITING_APPROVAL).length,
    };
  }, [purchases, docs, projectId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    try {
      const res = await link.mutateAsync({
        rows: docs.map((d) => ({ erp_doctype: d.doctype, erp_name: d.name, procurement_id: target })),
      });
      const refused = res.results.filter((r) => r.outcome === 'refused');
      const lines = refused.map((r) => `${r.erp_name ?? ''}: ${erpLinkReasonText(r.reason, t)}`);
      if (refused.length > 0 && refused.length < docs.length && onPartiallyLinked) {
        onPartiallyLinked(
          t('erpLinks.someLinked', '{{linked}} of {{total}} documents were linked. The rest were not:', { linked: docs.length - refused.length, total: docs.length }),
          lines,
        );
        return;
      }
      if (refused.length > 0) {
        setSubmitError({
          headline: t('erpLinks.noneLinked', 'Nothing was linked.'),
          // Spans, not a list: the modal renders `action` inside a <p>.
          action: lines.map((line) => <span key={line} className="block text-muted-foreground">{line}</span>),
        });
        return;
      }
      onLinked(target);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSubmitError({ headline, detail });
    }
  };

  const title = docs.length === 1
    ? t('erpLinks.dialogTitleOne', 'Link {{name}} to a purchase', { name: docs[0].name })
    : t('erpLinks.dialogTitleMany', 'Link {{count}} documents to a purchase', { count: docs.length });

  return (
    <EntityFormModal
      open
      title={title}
      subtitle={t('erpLinks.dialogSub', 'The purchase’s status follows the documents linked to it. Nothing is sent to ERPNext.')}
      submitLabel={t('erpLinks.link', 'Link')}
      cancelLabel={t('erpLinks.cancel', 'Cancel')}
      onSubmit={(e) => void submit(e)}
      onClose={onClose}
      loading={link.isPending}
      submitDisabled={!target}
      disabledReason={t('erpLinks.choosePurchaseFirst', 'Choose a purchase first.')}
      submitError={submitError}
    >
      <Combobox
        label={t('erpLinks.purchase', 'Purchase')}
        noun={t('erpLinks.purchaseNoun', 'open purchase')}
        value={target}
        selectedOption={options.find((o) => o.value === target) ?? null}
        onChange={(v) => setTarget(v)}
        loadOptions={async () => options}
        placeholder={t('erpLinks.choosePurchase', 'Choose a purchase…')}
        required
      />
      {awaiting > 0 && (
        <p className="mt-2 text-[12.5px] text-muted-foreground">
          {projectId
            ? t('erpLinks.awaitingApprovalProject', '{{count}} purchases on this project are waiting for approval. They can take documents once approved.', { count: awaiting })
            : t('erpLinks.awaitingApproval', '{{count}} purchases are waiting for approval. They can take documents once approved.', { count: awaiting })}
        </p>
      )}
    </EntityFormModal>
  );
};
