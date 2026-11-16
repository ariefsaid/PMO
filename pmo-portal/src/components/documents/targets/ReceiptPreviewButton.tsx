import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@/src/components/ui';
import { useViewerOnDemand } from '../viewerContext';
import { storageTarget, type SignedUrlAccessor } from './storage';

export interface ReceiptPreviewButtonProps {
  id: string;
  fileName: string;
  filePath: string | null;
  /** The parent-authorized accessor (`useExpenseReceipts().download`). */
  getSignedUrl: SignedUrlAccessor;
  onDownload?: () => void | Promise<void>;
  /** Icon-only trigger (phone rows); the accessible name stays "Preview receipt". */
  iconOnly?: boolean;
  /** Short visible text (a phone row); the accessible name stays "Preview receipt". */
  label?: string;
}

/** "Preview receipt": opens the shared viewer dialog over the claim's own authorized signed-URL accessor. */
export function ReceiptPreviewButton({ id, fileName, filePath, getSignedUrl, onDownload, iconOnly = false, label }: ReceiptPreviewButtonProps) {
  const { t } = useTranslation();
  const viewer = useViewerOnDemand();
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={iconOnly || label ? t('expenses.receipts.preview', 'Preview receipt') : undefined}
      onClick={(e) => viewer.open(storageTarget({ key: `receipt:${id}`, name: fileName, filePath, getSignedUrl, download: onDownload }), e.currentTarget)}
    >
      <Icon name="eye" />{!iconOnly && (label ?? t('expenses.receipts.preview', 'Preview receipt'))}
    </Button>
  );
}
