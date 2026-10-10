import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Icon } from './icons';
import { acquireBackgroundInert } from './backgroundInert';

export interface ReceiptPreviewProps {
  fileName: string;
  getPreviewUrl: () => Promise<string>;
  onDownload?: () => void | Promise<void>;
}

const kindOf = (name: string): 'image' | 'pdf' | 'unsupported' => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext ?? '')) return 'image';
  return ext === 'pdf' ? 'pdf' : 'unsupported';
};

/** Reusable, authorized in-app evidence preview. The caller supplies a short-lived URL accessor. */
export const ReceiptPreview: React.FC<ReceiptPreviewProps> = ({ fileName, getPreviewUrl, onDownload }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const getPreviewUrlRef = useRef(getPreviewUrl);
  getPreviewUrlRef.current = getPreviewUrl;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const kind = kindOf(fileName);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const trigger = triggerRef.current;
    closeRef.current?.focus();
    const releaseInert = acquireBackgroundInert();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], iframe[tabindex]')];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      releaseInert();
      window.setTimeout(() => {
        const target = trigger?.isConnected ? trigger : previouslyFocused;
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, [open]);

  useEffect(() => {
    if (!open || kind === 'unsupported') return;
    let active = true;
    setLoading(true);
    setFailed(false);
    setUrl(null);
    getPreviewUrlRef.current().then((signedUrl) => { if (active) setUrl(signedUrl); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, kind]);

  return <>
    <Button ref={triggerRef} variant="outline" size="sm" onClick={() => setOpen(true)}>
      <Icon name="eye" />{t('expenses.receipts.preview', 'Preview receipt')}
    </Button>
    {open && createPortal(
      <div className="fixed inset-0 z-[800] flex items-center justify-center bg-foreground/40 p-3 sm:p-4">
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="flex max-h-[min(90dvh,900px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-popover">
          <header className="flex min-h-12 items-center gap-3 border-b border-border px-4">
            <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold" title={fileName}>{fileName}</h2>
            {onDownload && <Button variant="outline" size="sm" onClick={() => void onDownload()}>{t('expenses.receipts.downloadOriginal', 'Download original')}</Button>}
            <Button ref={closeRef} variant="ghost" size="sm" aria-label={t('expenses.receipts.close', 'Close')} onClick={() => setOpen(false)}><Icon name="x" /></Button>
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/50 p-3" aria-live="polite">
            {loading && <p className="text-sm text-muted-foreground">{t('expenses.receipts.previewLoading', 'Loading receipt…')}</p>}
            {failed && <div className="text-center"><p role="alert" className="text-sm text-destructive-text">{t('expenses.receipts.previewError', "Couldn't preview this file.")}</p>{onDownload && <div className="mt-3"><Button variant="outline" onClick={() => void onDownload()}>{t('expenses.receipts.downloadOriginal', 'Download original')}</Button></div>}</div>}
            {kind === 'unsupported' && <div className="text-center"><p className="text-sm text-muted-foreground">{t('expenses.receipts.unsupported', 'Preview is not available for this file type.')}</p>{onDownload && <div className="mt-3"><Button variant="outline" onClick={() => void onDownload()}>{t('expenses.receipts.downloadOriginal', 'Download original')}</Button></div>}</div>}
            {!loading && !failed && url && kind === 'image' && <img src={url} alt={fileName} onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />}
            {!loading && !failed && url && kind === 'pdf' && <iframe src={url} title={fileName} className="h-[70dvh] min-h-[320px] w-full border-0" />}
          </div>
        </div>
      </div>, document.body,
    )}
  </>;
};
