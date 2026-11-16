import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Icon } from '@/src/components/ui';
import { ListState } from '@/src/components/ui/ListState';
import { cn } from '@/src/components/ui/cn';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { acquireBackgroundInert } from '@/src/components/ui/backgroundInert';
import {
  overlayBackdropClassName,
  overlayBackdropStyle,
  overlayDesktopContainerClassName,
  overlayFooterClassName,
  overlayHeaderClassName,
  overlayMobileContainerClassName,
} from '@/src/components/ui/OverlaySurface';
import { AppError } from '@/src/lib/appError';
import type { ViewerState } from './viewerContext';
import type { DocumentViewTarget, PreviewFailureKind, PreviewResult } from './types';

/** Embedded providers run scripts and forms of their own origin; nothing else is granted. */
const EMBED_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups';

function failureText(t: TFunction, kind: PreviewFailureKind, place: string): string {
  switch (kind) {
    case 'access_denied':
      return t('failure.accessDenied', "Your Microsoft account can't open this file. Ask the owner for access, or open it in {{place}}.", { place });
    case 'not_connected':
    case 'connection_stale':
      return t('failure.notConnected', 'Connect your Microsoft account to preview this file.');
    case 'consent_needed':
      return t('failure.consentNeeded', 'Reconnect your Microsoft account to preview this file.');
    case 'not_found':
      return t('failure.notFound', 'This file is not available. It may have been moved or deleted.');
    case 'unsupported':
      return t('failure.unsupported', "Preview isn't available for this file type.");
    case 'no_file':
      return t('failure.noFile', 'No file is attached.');
    case 'rate_limited':
      return t('failure.rateLimited', 'Microsoft is busy right now. Try again in a moment.');
    default:
      return t('failure.unavailable', "The preview couldn't be loaded. Try again.");
  }
}

const NEEDS_CONNECTION: ReadonlySet<PreviewFailureKind> = new Set(['not_connected', 'connection_stale', 'consent_needed']);
const CAN_RETRY: ReadonlySet<PreviewFailureKind> = new Set(['unavailable', 'expired', 'rate_limited']);

/** The frame takes the dialog's whole remaining height; the floor keeps it usable when a notice or recovery UI shares the body. */
const FRAME_CLASS = 'min-h-[320px] w-full flex-1 border-0';

function Preview({ result, name, onRenderError, t }: { result: PreviewResult; name: string; onRenderError: () => void; t: TFunction }) {
  switch (result.mode) {
    case 'image':
      // Contained in the area, never scaled past its natural size (no width/height, only maxima).
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <img src={result.url} alt={name} onError={onRenderError} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case 'pdf':
      return <iframe src={result.url} title={name} tabIndex={0} referrerPolicy="no-referrer" className={FRAME_CLASS} />;
    case 'embed':
      return (
        <>
          <iframe
            src={result.url}
            title={name}
            tabIndex={0}
            sandbox={EMBED_SANDBOX}
            referrerPolicy="no-referrer"
            className={FRAME_CLASS}
          />
          {/* A blank public-viewer frame is indistinguishable from success: the escape hatch is always shown. */}
          {result.provider === 'office-online' && (
            <p className="shrink-0 text-support text-muted-foreground">{t('viewer.officeBlankHint', 'If the preview stays blank, download the file.')}</p>
          )}
        </>
      );
    default:
      return <Failure kind="unsupported" place="" t={t} />;
  }
}

function RetryButton({ seconds, onRetry, t }: { seconds: number; onRetry: () => void; t: TFunction }) {
  const [wait, setWait] = useState(seconds);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setInterval(() => setWait((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [wait > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- one interval per countdown
  return (
    <Button variant="outline" disabled={wait > 0} onClick={onRetry}>
      <Icon name="refresh" />
      {wait > 0 ? t('viewer.retryIn', 'Retry in {{seconds}}s', { seconds: wait }) : t('viewer.retry', 'Retry')}
    </Button>
  );
}

function Failure({ kind, place, retryAfterSeconds, onRetry, t }: {
  kind: PreviewFailureKind; place: string; retryAfterSeconds?: number; onRetry?: () => void; t: TFunction;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted/50 p-4">
      <p className="flex items-start gap-2 text-control text-foreground">
        <Icon name="alert" className="mt-0.5 shrink-0 text-muted-foreground" />
        <span>{failureText(t, kind, place)}</span>
      </p>
      {NEEDS_CONNECTION.has(kind) && (
        <Link to="/integrations" className={buttonClasses('outline', 'sm')}>
          {t('viewer.openIntegrations', 'Open My integrations')}
        </Link>
      )}
      {CAN_RETRY.has(kind) && onRetry && <RetryButton seconds={kind === 'rate_limited' ? retryAfterSeconds ?? 0 : 0} onRetry={onRetry} t={t} />}
    </div>
  );
}

/** The authorized download and its failure line. One instance per open document; the line is shown in the body. */
function useDownload(target: DocumentViewTarget, t: TFunction) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [target.key]);

  async function download() {
    if (!target.download) return;
    setDownloading(true);
    setError(null);
    try {
      await target.download();
    } catch (err) {
      // FR-010: say why. A sanitized AppError carries its own reason; anything else is the generic line.
      setError(err instanceof AppError ? err.message : t('viewer.downloadFailed', 'The file could not be downloaded.'));
    } finally {
      setDownloading(false);
    }
  }
  return { downloading, error, download };
}

function Actions({ target, hideDownload, downloading, onDownload, mobile, t }: {
  target: DocumentViewTarget; hideDownload: boolean; downloading: boolean; onDownload: () => void; mobile: boolean; t: TFunction;
}) {
  const place = target.sourceLabel;
  const size = mobile ? undefined : 'sm';
  const touch = mobile ? 'touch-target h-11 flex-1 text-control' : undefined;
  return (
    <>
      {target.download && !hideDownload && (
        <Button variant="outline" size={size} className={touch} loading={downloading} onClick={onDownload}>
          <Icon name="download" />
          {t('viewer.download', 'Download')}
        </Button>
      )}
      {target.openInSource && (
        <Button
          variant="outline"
          size={size}
          className={touch}
          onClick={() => window.open(target.openInSource!.url, '_blank', 'noopener,noreferrer')}
        >
          <Icon name="eye" />
          {t('viewer.openInSource', 'Open in {{place}}', { place })}
        </Button>
      )}
    </>
  );
}

export interface DocumentViewerProps {
  state: ViewerState;
  onClose: () => void;
  onRetry: () => void;
  onRenderError: () => void;
}

/**
 * The viewer dialog: a document is read, so it takes nearly the whole viewport on a desktop and the whole screen
 * on a phone. Pure rendering of the provider's state: it never fetches and never writes a record. Focus trap,
 * Escape, backdrop dismissal and the exit transition come from Base UI's Dialog, as in ConfirmDialog.
 */
export function DocumentViewer({ state, ...rest }: DocumentViewerProps) {
  return state.phase === 'closed' ? null : <ViewerDialog state={state} {...rest} />;
}

function ViewerDialog({ state, onClose, onRetry, onRenderError }: DocumentViewerProps & { state: Exclude<ViewerState, { phase: 'closed' }> }) {
  const { t } = useTranslation('documentViewer');
  const { t: tc } = useTranslation();
  const isDesktop = useIsDesktop();
  const closeRef = useRef<HTMLButtonElement>(null);
  const { target } = state;
  const { downloading, error: downloadError, download } = useDownload(target, t);

  useEffect(() => acquireBackgroundInert(), []);

  const hideDownload = state.phase === 'failed' && state.kind === 'no_file';
  const facts = [target.detail, t('viewer.sourceLabel', 'Source: {{place}}', { place: target.sourceLabel })].filter(Boolean).join(' · ');
  const actions = <Actions target={target} hideDownload={hideDownload} downloading={downloading} onDownload={() => void download()} mobile={!isDesktop} t={t} />;

  return (
    <Dialog.Root open modal="trap-focus" onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        {/* Same band as the other modals (800/810): it opens above a record drawer (780/790) and closing returns to it. */}
        <div data-overlay-layer className={cn('fixed inset-0 z-[800] flex', isDesktop ? 'p-6 lg:p-8' : '')}>
          <Dialog.Backdrop data-testid="viewer-scrim" className={cn('z-[800]', overlayBackdropClassName)} style={overlayBackdropStyle} />
          <Dialog.Popup
            initialFocus={closeRef}
            finalFocus={false}
            onKeyDown={(event) => {
              // A record drawer underneath must not also see this Escape.
              if (event.key === 'Escape') event.stopPropagation();
            }}
            aria-modal="true"
            className={cn(
              isDesktop ? overlayDesktopContainerClassName : overlayMobileContainerClassName,
              'flex h-full w-full flex-col overflow-hidden outline-none',
              !isDesktop && 'rounded-none border-0',
            )}
          >
            <div className={overlayHeaderClassName}>
              <div className="min-w-0 flex-1">
                <Dialog.Title title={target.name} className="truncate text-control font-semibold text-popover-foreground">
                  {target.name}
                </Dialog.Title>
                <Dialog.Description render={<div />} title={facts} className="truncate text-support text-muted-foreground">
                  {facts}
                </Dialog.Description>
              </div>
              {isDesktop && actions}
              <Dialog.Close ref={closeRef} render={<Button variant="ghost" iconOnly aria-label={tc('entityForm.close', 'Close')} />}>
                <Icon name="x" />
              </Dialog.Close>
            </div>

            {/* Body: the document takes all the width and the height left; it scrolls when a notice or recovery UI is stacked with it. */}
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-[var(--space-content-inset)] py-[var(--space-content-inset)]">
              {downloadError && <p role="alert" className="shrink-0 text-support text-destructive-text">{downloadError}</p>}
              {target.latestNotice && (
                <p className="shrink-0 rounded-lg border border-border bg-muted/50 px-3 py-2 text-support text-foreground">
                  {t('viewer.latestNotice', 'Latest in {{place}}. This is not the approved version.', { place: target.sourceLabel })}
                </p>
              )}
              {state.phase === 'loading' && (
                <ListState variant="loading" shape="detail" rows={4} loadingLabel={t('viewer.loading', 'Loading preview…')} loadingRole="status" />
              )}
              {state.phase === 'failed' && (
                <Failure kind={state.kind} place={target.sourceLabel} retryAfterSeconds={state.retryAfterSeconds} onRetry={onRetry} t={t} />
              )}
              {state.phase === 'ready' && <Preview result={state.result} name={target.name} onRenderError={onRenderError} t={t} />}
              {target.extra}
            </div>

            {/* A phone has no room for actions beside the title: they sit at the bottom, within thumb reach. */}
            {!isDesktop && (target.download || target.openInSource) && !(hideDownload && !target.openInSource) && (
              <div className={cn(overlayFooterClassName, 'flex-nowrap')}>{actions}</div>
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
