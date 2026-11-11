import { useTranslation } from 'react-i18next';
import { useFeature } from '@/src/auth/useFeature';
import { useMicrosoftDocuments } from '@/src/hooks/useMicrosoftDocuments';
import type { UploadFailureKind } from '@/src/lib/m365/uploadClient';

/**
 * Where a record's files go (FR-007, D6): the org's default SharePoint library when one is set, else private
 * PMO storage. `unknown` while the settings read is pending or failed: a settings failure is never "no
 * library" (the rule `useMicrosoftDocuments` documents), so the caller disables upload instead of guessing.
 */
export type UploadDestination = { kind: 'microsoft' } | { kind: 'private' } | { kind: 'unknown' };

export function useUploadDestination(): UploadDestination {
  const m365 = useFeature('m365_integration');
  const { defaultLibrary, isPending, defaultError } = useMicrosoftDocuments();
  if (!m365) return { kind: 'private' };
  // Only the org default decides the destination; a connection status failure is reported by the upload itself.
  if (defaultError || isPending) return { kind: 'unknown' };
  return defaultLibrary ? { kind: 'microsoft' } : { kind: 'private' };
}

/** The recovery copy for a failed SharePoint upload. It always says nothing was saved or swapped. */
export function useUploadFailureText(): (kind: UploadFailureKind, opts?: { purchase?: boolean }) => string {
  const { t } = useTranslation('documentViewer');
  return (kind, opts) => {
    switch (kind) {
      case 'folder': return t('upload.folderUnavailable', 'This record has no SharePoint folder yet. Create the folder, then upload again. Nothing was saved.');
      case 'consent': return t('upload.consentNeeded', 'Uploading to SharePoint needs one more permission from Microsoft. Reconnect, then upload again. Nothing was saved.');
      case 'connection': return t('upload.connectionNeeded', 'Connect your Microsoft account, then upload again. Nothing was saved.');
      case 'access': return t('upload.accessDenied', 'Microsoft refused the upload. Check your access to the record folder. Nothing was saved.');
      case 'entitlement': return t('upload.entitlement', "Your organisation isn't set up for Microsoft documents. Nothing was saved.");
      case 'invalid': return t('upload.invalidFile', 'This file is too large or its type is not accepted. Choose another file. Nothing was saved.');
      // Purchase attachments have no Microsoft picker to link from, so they get a recovery that exists.
      case 'attach': return opts?.purchase
        ? t('upload.linkLaterPurchase', 'The file is in SharePoint but was not recorded here. Tell an administrator or attach it again.')
        : t('upload.linkLater', 'The file is in SharePoint but could not be attached here. Link it from the Microsoft picker.');
      default: return t('upload.unavailable', 'Microsoft could not store the file. Try again. Nothing was saved.');
    }
  };
}
