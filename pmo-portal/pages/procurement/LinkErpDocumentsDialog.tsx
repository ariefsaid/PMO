import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Combobox, EntityFormModal, type ComboboxOption, type SubmitError } from '@/src/components/ui';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useLinkErpDocuments } from '@/src/hooks/useErpPurchaseLinks';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ErpPurchaseRow } from '@/src/lib/repositories/erpPurchases';
import { useProcurementStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatCurrency } from '@/src/lib/format';
import { erpLinkReasonText, erpPreTaxAmount } from './erpLinkReasons';

/** Never offered as "open": closed purchases, and Paid ones (nothing left to commit; review 2b). */
const CLOSED = new Set(['Cancelled', 'Rejected', 'Paid']);
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
  /** Some documents linked and some were refused: the dialog closes and hands both back to show beside the list. */
  onPartiallyLinked?: (result: PartialLink) => void;
}

export interface PartialLink { procurementId: string; linked: number; refused: string[] }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
/** The one value every document shares, or null when they differ. */
const shared = (values: (string | null)[]) => (new Set(values.map(norm)).size === 1 ? values[0] : null);

/** FR-PFE-020 — pick an open purchase and link the documents to it. The server re-checks supplier, project, currency and gates. */
export const LinkErpDocumentsDialog: React.FC<LinkErpDocumentsDialogProps> = ({ docs, projectId, onClose, onLinked, onPartiallyLinked }) => {
  const { t } = useTranslation('finance');
  const { data: purchases } = useProcurements();
  const link = useLinkErpDocuments();
  const [target, setTarget] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const stageLabel = useProcurementStatusLabel();
  const docSupplier = shared(docs.map((d) => d.supplier));
  const docCurrency = shared(docs.map((d) => d.currency));

  const { options, awaiting } = useMemo(() => {
    const allowed = allowedProjects(docs, projectId);
    const inScope = (purchases ?? []).filter((p) => !CLOSED.has(String(p.status))
      && (allowed === null || (p.project_id !== null && allowed.has(p.project_id))));
    // Review 2b: prevent refusals instead of reporting them — matching purchases first, the others marked.
    const scored = inScope
      .filter((p) => p.status !== AWAITING_APPROVAL)
      .map((p) => {
        const otherSupplier = Boolean(docSupplier && p.vendor?.name && norm(p.vendor.name) !== norm(docSupplier));
        const otherCurrency = Boolean(docCurrency && p.currency && norm(p.currency) !== norm(docCurrency));
        const badges = [
          otherSupplier ? t('erpLinks.differentSupplier', 'different supplier') : null,
          otherCurrency ? t('erpLinks.differentCurrency', 'different currency') : null,
        ].filter((mark): mark is string => Boolean(mark));
        const option: ComboboxOption = {
          value: p.id,
          label: p.title,
          badges,
          sub: [p.vendor?.name, stageLabel(String(p.status))].filter(Boolean).join(' · '),
        };
        return { option, rank: (otherSupplier ? 1 : 0) + (otherCurrency ? 1 : 0) };
      });
    return {
      options: scored.sort((a, b) => a.rank - b.rank).map((s) => s.option),
      awaiting: inScope.filter((p) => p.status === AWAITING_APPROVAL).length,
    };
  }, [purchases, docs, projectId, docSupplier, docCurrency, stageLabel, t]);

  // Review 11: what is being linked, in one line — count · supplier · pre-tax amount (per currency).
  const summary = useMemo(() => {
    const totals = new Map<string, number>();
    for (const d of docs) {
      const amount = erpPreTaxAmount(d);
      if (amount !== null && d.currency) totals.set(d.currency, (totals.get(d.currency) ?? 0) + amount);
    }
    const suppliers = new Set(docs.map((d) => norm(d.supplier)).filter(Boolean)).size;
    return [
      t('erpLinks.documentCount', '{{count}} documents', { count: docs.length }),
      docSupplier ?? (suppliers > 1 ? t('erpLinks.supplierCount', '{{count}} suppliers', { count: suppliers }) : null),
      totals.size > 0 ? [...totals].map(([currency, amount]) => formatCurrency(amount, currency)).join(' + ') : null,
    ].filter(Boolean).join(' · ');
  }, [docs, docSupplier, t]);

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
        onPartiallyLinked({ procurementId: target, linked: docs.length - refused.length, refused: lines });
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
      <p className="mb-3 text-[13px] text-foreground tabular">{summary}</p>
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
