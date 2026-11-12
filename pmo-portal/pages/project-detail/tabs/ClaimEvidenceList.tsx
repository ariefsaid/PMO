import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { statusLabel, statusVariantOf } from '@/src/lib/status/statusMap';
import type { ClaimEvidenceRef } from '@/src/lib/db/progressBilling';

/**
 * The evidence list on a billing claim (C4, DS part2-billing-tm #4).
 *
 * What the drawer used to print was the STORED row: a raw `document_id` UUID and a raw
 * `document_status` string. Neither is a word a person reads; both are machinery. This renders
 * the document by its own title (looked up in the project register the caller already loaded),
 * its revision through a translated label, and the status through the ONE status map — and links
 * each row to that document in the register, so the id still does something useful.
 *
 * Shared by the billing tab's claim drawer and the work-orders claim drawer: one repair, both
 * places, so the two cannot drift apart again.
 */
export interface ClaimEvidenceListProps {
  evidence: ClaimEvidenceRef[];
  projectId: string;
  /** The project's document register, when the caller already has it; the title is the label. */
  documents?: ReadonlyArray<{ id: string; title: string | null }>;
}

export const ClaimEvidenceList: React.FC<ClaimEvidenceListProps> = ({
  evidence,
  projectId,
  documents = [],
}) => {
  const { t } = useTranslation(['project', 'status']);
  return (
    <ul className="mt-2 divide-y divide-border text-sm">
      {evidence.map((item) => {
        const title = documents.find((doc) => doc.id === item.document_id)?.title ?? null;
        return (
          <li key={item.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <Link
                to={`/projects/${encodeURIComponent(projectId)}/documents?open=${encodeURIComponent(item.document_id)}`}
                className="font-medium text-primary-text hover:underline"
              >
                {title ?? t('projectDetail.billing.evidence.document', 'Evidence document')}
              </Link>
              {item.document_revision && (
                <span className="ml-1.5 text-muted-foreground">
                  {t('projectDetail.billing.evidence.revision', 'rev {{revision}}', {
                    revision: item.document_revision,
                  })}
                </span>
              )}
            </span>
            <StatusPill variant={statusVariantOf('document', item.document_status)}>
              {statusLabel('document', item.document_status, t)}
            </StatusPill>
          </li>
        );
      })}
    </ul>
  );
};

export default ClaimEvidenceList;
