import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/src/components/ui';
import { projectReference, type MicrosoftReferenceInput } from '@/src/lib/m365/reference';
import { getItem } from '@/src/lib/m365/graphClient';
import { useDocumentLinkPermissions } from '@/src/components/m365/DocumentLinkPermissions';
import type { LinkArgs } from '@/src/hooks/useDocuments';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { ProjectDocumentRow } from '@/src/lib/db/documents';

/** The Microsoft entry point in flight: a new document seeded from a reference, or linking an existing Draft. */
type MicrosoftEntryTarget = { kind: 'create' } | { kind: 'link'; doc: ProjectDocumentRow };

export function useDocumentMicrosoft(
  documentLinkPermissions: ReturnType<typeof useDocumentLinkPermissions>,
  link: { mutateAsync: (args: LinkArgs) => Promise<unknown> },
  unlink: { mutateAsync: (id: string) => Promise<unknown> },
  onCreateReference: (reference: MicrosoftReferenceInput) => void,
) {
  const { t } = useTranslation('project');
  const { toast } = useToast();
  const [microsoftEntry, setMicrosoftEntry] = useState<MicrosoftEntryTarget | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<ProjectDocumentRow | null>(null);
  const [latestRevision, setLatestRevision] = useState<{ parent: ProjectDocumentRow; reference: MicrosoftReferenceInput } | null>(null);
  const [latestBusy, setLatestBusy] = useState<string | null>(null);
  // Re-read the file's CURRENT identity from Microsoft before offering the revision form. Failure
  // never creates anything and never discloses a raw Microsoft body (generic reviewed copy only).
  const startLatestRevision = async (parent: ProjectDocumentRow) => {
    const current = projectReference(parent);
    if (!current || latestBusy || !documentLinkPermissions.projectCreate()) return;
    setLatestBusy(parent.id);
    try {
      const item = await getItem(current);
      if (item.item_kind !== 'file') throw new Error('not-a-file');
      setLatestRevision({
        parent,
        reference: { drive_id: item.drive_id, item_id: item.item_id, web_url: item.web_url, name: item.name, item_kind: 'file' },
      });
    } catch {
      toast(
        t('m365Documents.latestFailedTitle', 'Could not read the latest file'),
        t('m365Documents.latestFailed', 'Microsoft could not load this file. Check access and SharePoint availability with your Microsoft admin, or retry.'),
        'warning',
      );
    } finally {
      setLatestBusy(null);
    }
  };

  const onUnlinkConfirm = async () => {
    if (!unlinkTarget || !documentLinkPermissions.projectEdit(unlinkTarget.author_id, unlinkTarget.status)) return;
    const target = unlinkTarget;
    try {
      await unlink.mutateAsync(target.id);
      toast(t('m365Documents.unlinked', 'Reference removed'), target.title, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
    setUnlinkTarget(null);
  };

  const onSelectReference = async (reference: MicrosoftReferenceInput) => {
    if (!microsoftEntry) return;
    if (microsoftEntry.kind === 'link') {
      if (!documentLinkPermissions.projectEdit(microsoftEntry.doc.author_id, microsoftEntry.doc.status)) return;
      // Rejections stay in the picker so its persistent error remains visible.
      await link.mutateAsync({ id: microsoftEntry.doc.id, reference });
      toast(t('m365Documents.linked', 'Microsoft item linked'), microsoftEntry.doc.title, 'success');
      setMicrosoftEntry(null);
    } else {
      if (!documentLinkPermissions.projectCreate()) return;
      // Unmount the picker before the metadata dialog takes focus.
      setMicrosoftEntry(null);
      onCreateReference(reference);
    }
  };

  return { microsoftEntry, setMicrosoftEntry, unlinkTarget, setUnlinkTarget, latestRevision, setLatestRevision, startLatestRevision, onUnlinkConfirm, onSelectReference };
}
