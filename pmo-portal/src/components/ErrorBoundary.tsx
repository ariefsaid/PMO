import React from 'react';
import i18next from 'i18next';
import { Button, buttonClasses } from '@/src/components/ui';
import { captureHandledError, safeTrack } from '@/src/lib/analytics';

/**
 * App-level error boundary (reliability harden #4).
 *
 * A render-time throw anywhere below this boundary is caught and replaced with a
 * calm, token-styled fallback instead of white-screening the whole SPA. The
 * fallback offers three recoveries:
 *   • Try again  — resets the boundary (clears the error, re-renders children).
 *   • Home       — a real <a href="/"> so it works even if the router itself threw.
 *   • Reload     — full page reload as the last resort.
 *
 * `onReset` lets a parent re-arm whatever it controls (e.g. flip a crashing prop)
 * when the user clicks Try again, in the same tick the boundary clears its state.
 */
export interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** The boundary is a class (no hooks) and may catch before i18n is ready: fall back to English. */
const t = (key: string, fallback: string): string => (i18next.isInitialized ? i18next.t(key, { ns: 'common', defaultValue: fallback }) : fallback);

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Surface to the console so it is observable in dev/CI and captured by any
    // console-forwarding error reporter. We intentionally do not swallow it silently.
    console.error('ErrorBoundary caught a render error:', error, info.componentStack);
    safeTrack(() =>
      captureHandledError({
        name: error.name,
        message: error.message,
        componentStack: info.componentStack ?? undefined,
      }),
    );
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error === null) return this.props.children;

    return (
      <main className="flex min-h-[60vh] w-full items-center justify-center p-6">
        <div role="alert" aria-live="assertive" className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">{t('ui.errorBoundary.title', 'Something went wrong')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('ui.errorBoundary.body', 'The page hit an unexpected error. You can try again, or head back home.')}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={this.handleReset}>
              {t('ui.errorBoundary.retry', 'Try again')}
            </Button>
            <Button variant="outline" onClick={this.handleReload}>
              {t('ui.errorBoundary.reload', 'Reload')}
            </Button>
            {/* Real anchor so navigation works even when the router is the thing that threw. */}
            <a
              href="/"
              className={buttonClasses('outline')}
            >
              {t('ui.errorBoundary.home', 'Home')}
            </a>
          </div>
        </div>
      </main>
    );
  }
}
