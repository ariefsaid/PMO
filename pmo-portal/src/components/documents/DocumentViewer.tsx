import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button, Drawer, Icon } from '@/src/components/ui';
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

function Preview({ result, name, onRenderError, t }: { result: PreviewResult; name: string; onRenderError: () => void; t: TFunction }) {
  switch (result.mode) {
    case 'image':
      return <img src={result.url} alt={name} onError={onRenderError} className="mx-auto max-h-[70dvh] max-w-full object-contain" />;
    case 'pdf':
      return <iframe src={result.url} title={name} tabIndex={0} className="h-[70dvh] min-h-[320px] w-full border-0" />;
    case 'embed':
      return (
        <>
          <iframe
            src={result.url}
            title={name}
            tabIndex={0}
            sandbox={EMBED_SANDBOX}
            referrerPolicy="no-referrer"
            className="h-[70dvh] min-h-[320px] w-full border-0"
          />
          {/* A blank public-viewer frame is indistinguishable from success: the escape hatch is always shown. */}
          {result.provider === 'office-online' && (
            <p className="mt-2 text-support text-muted-foreground">{t('viewer.officeBlankHint', 'If the preview stays blank, download the file.')}</p>
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
        <Link to="/integrations" className="touch-target inline-flex h-8 items-center rounded-lg border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent">
          {t('viewer.openIntegrations', 'Open My integrations')}
        </Link>
      )}
      {CAN_RETRY.has(kind) && onRetry && <RetryButton seconds={kind === 'rate_limited' ? retryAfterSeconds ?? 0 : 0} onRetry={onRetry} t={t} />}
    </div>
  );
}

function Actions({ target, hideDownload, t }: { target: DocumentViewTarget; hideDownload: boolean; t: TFunction }) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  useEffect(() => { setDownloadError(null); }, [target.key]);

  async function download() {
    if (!target.download) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await target.download();
    } catch (err) {
      // FR-010: say why. A sanitized AppError carries its own reason; anything else is the generic line.
      setDownloadError(err instanceof AppError ? err.message : t('viewer.downloadFailed', 'The file could not be downloaded.'));
    } finally {
      setDownloading(false);
    }
  }

  const place = target.sourceLabel;
  return (
    <>
      {downloadError && <p role="alert" className="w-full text-support text-destructive-text">{downloadError}</p>}
      {target.download && !hideDownload && (
        <Button variant="outline" size="sm" loading={downloading} onClick={() => void download()}>
          <Icon name="download" />
          {t('viewer.download', 'Download')}
        </Button>
      )}
      {target.openInSource && (
        <Button
          variant="outline"
          size="sm"
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

/** The side panel. Pure rendering of the provider's state: it never fetches and never writes a record. */
export function DocumentViewer({ state, onClose, onRetry, onRenderError }: DocumentViewerProps) {
  const { t } = useTranslation('documentViewer');
  if (state.phase === 'closed') return null;
  const { target } = state;
  const hideDownload = state.phase === 'failed' && state.kind === 'no_file';

  return (
    <Drawer
      open
      width="lg"
      title={target.name}
      subtitle={t('viewer.sourceLabel', 'Source: {{place}}', { place: target.sourceLabel })}
      onClose={onClose}
      footer={<div className="flex w-full flex-wrap items-center justify-end gap-2"><Actions target={target} hideDownload={hideDownload} t={t} /></div>}
    >
      <div className="flex min-w-0 flex-col gap-3">
        {target.latestNotice && (
          <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-support text-foreground">
            {t('viewer.latestNotice', 'Latest in {{place}}. This is not the approved version.', { place: target.sourceLabel })}
          </p>
        )}
        {state.phase === 'loading' && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 text-support text-muted-foreground">
            <Icon name="refresh" className="animate-spin motion-reduce:animate-none" />
            {t('viewer.loading', 'Loading preview…')}
          </div>
        )}
        {state.phase === 'failed' && (
          <Failure kind={state.kind} place={target.sourceLabel} retryAfterSeconds={state.retryAfterSeconds} onRetry={onRetry} t={t} />
        )}
        {state.phase === 'ready' && <Preview result={state.result} name={target.name} onRenderError={onRenderError} t={t} />}
        {target.extra}
      </div>
    </Drawer>
  );
}
