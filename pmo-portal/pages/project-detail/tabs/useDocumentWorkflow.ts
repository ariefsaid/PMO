import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast, type RowMenuItem } from '@/src/components/ui';
import { useDocumentMutations } from '@/src/hooks/useDocuments';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { DocStatus, ProjectDocumentRow } from '@/src/lib/db/documents';
import { isMicrosoftFolder } from './documentUtils';

/** A pending status transition launched from a row. */
interface PendingTransition {
  doc: ProjectDocumentRow;
  to: DocStatus;
  /** Confirm button verb, e.g. "Issue document". */
  verb: string;
}

export function useDocumentWorkflow({ canWriteDocs, canApprove, currentUserId, transition }: {
  canWriteDocs: boolean;
  canApprove: boolean;
  currentUserId: string | null;
  transition: ReturnType<typeof useDocumentMutations>['transition'];
}) {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const [pending, setPending] = useState<PendingTransition | null>(null);
  const [sodBlocked, setSodBlocked] = useState<ProjectDocumentRow | null>(null);
  // Used as a row-menu label AND as the identity the drawer filters that row out by.
  const reviewUnavailableLabel = t(
    'projectDetail.documents.action.whyUnavailable',
    'Why is review unavailable?',
  );

  // approver ≠ author (Document approval SoD): the author can never approve/reject their own doc.
  const isOwnDocument = (d: ProjectDocumentRow) =>
    !!currentUserId && d.author_id === currentUserId;

  /** The status actions available on a row, per the workflow + SoD + role gates. */
  const statusActions = (d: ProjectDocumentRow): RowMenuItem[] => {
    // A Microsoft folder is a reference only: it is never issued, approved or closed.
    if (isMicrosoftFolder(d)) return [];
    const items: RowMenuItem[] = [];
    // Draft → Issued (a non-approval move: any document write-role).
    if (d.status === 'Draft' && canWriteDocs) {
      items.push({ label: t('projectDetail.documents.action.issue', 'Issue'), onClick: () => setPending({ doc: d, to: 'Issued', verb: t('projectDetail.documents.verb.issue', 'Issue document') }) });
    }
    // Issued → Approved / Rejected (the SoD step: approver must NOT be the author).
    if (d.status === 'Issued' && canApprove) {
      if (isOwnDocument(d)) {
        // Author of their own document: the approve/reject path is hidden; expose the reason.
        items.push({ label: reviewUnavailableLabel, onClick: () => setSodBlocked(d) });
      } else {
        items.push({ label: t('projectDetail.documents.action.approve', 'Approve'), onClick: () => setPending({ doc: d, to: 'Approved', verb: t('projectDetail.documents.verb.approve', 'Approve document') }) });
        items.push({ label: t('projectDetail.documents.action.reject', 'Reject'), onClick: () => setPending({ doc: d, to: 'Rejected', verb: t('projectDetail.documents.verb.reject', 'Reject document') }), danger: true });
      }
    }
    // Approved → Closed (terminal close-out: any document write-role).
    if (d.status === 'Approved' && canWriteDocs) {
      items.push({ label: t('projectDetail.documents.action.close', 'Close'), onClick: () => setPending({ doc: d, to: 'Closed', verb: t('projectDetail.documents.verb.close', 'Close document') }) });
    }
    // Rejected → Draft (rework path) / Rejected → Closed (abandon path). AC-W3-B2.
    // These are non-approval moves (same gate as Draft→Issued / Approved→Closed: canWriteDocs).
    // The SoD approver≠author rule applies only to the Issued→Approved/Rejected step; not here.
    if (d.status === 'Rejected' && canWriteDocs) {
      items.push({ label: t('projectDetail.documents.action.reopen', 'Reopen for revision'), onClick: () => setPending({ doc: d, to: 'Draft', verb: t('projectDetail.documents.verb.reopen', 'Reopen for revision') }) });
      items.push({ label: t('projectDetail.documents.action.close', 'Close'), onClick: () => setPending({ doc: d, to: 'Closed', verb: t('projectDetail.documents.verb.close', 'Close document') }) });
    }
    return items;
  };

  const allowedStatusTargets = (doc: ProjectDocumentRow): DocStatus[] => {
    if (isMicrosoftFolder(doc)) return [];
    if (doc.status === 'Draft' && canWriteDocs) return ['Issued'];
    if (doc.status === 'Issued' && canApprove && !isOwnDocument(doc)) return ['Approved', 'Rejected'];
    if (doc.status === 'Approved' && canWriteDocs) return ['Closed'];
    if (doc.status === 'Rejected' && canWriteDocs) return ['Draft', 'Closed'];
    return [];
  };
  const onTransitionConfirm = async () => {
    if (!pending) return;
    const { doc, to } = pending;
    try {
      await transition.mutateAsync({ id: doc.id, status: to });
      // ⚑ `to` is a raw DB status folded into an English sentence. The shell is
      // translatable; the status word itself still arrives in English (see handover).
      toast(
        `${t('projectDetail.documents.toast.transitioned', 'Document')} ${to.toLowerCase()}`,
        doc.title,
        'success',
      );
      setPending(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
      setPending(null);
    }
  };

  return { pending, setPending, sodBlocked, setSodBlocked, reviewUnavailableLabel, isOwnDocument, statusActions, allowedStatusTargets, onTransitionConfirm };
}
