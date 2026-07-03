/**
 * AssistantPanel — the persistent in-app agent drawer (ADR-0040 Option A).
 *
 * DUAL FOCUS CONTRACT (D-A2-1):
 *   Desktop (≥1024px): role="complementary", NON-modal, NO focus-trap, NO background inert,
 *     Tab exits freely to <main>. Keep-mounted, root inert when closed (D-A2-6).
 *   Mobile (<1024px): role="dialog" aria-modal, full focus-trap + background inert + scrim +
 *     body-scroll-lock (mirrors AppShell mobile drawer).
 *
 * Esc CLOSES the panel (D-A2-4; never cancels). Stop button cancels via runtime.control.
 * Mounted + inert when closed (no unmount) so transcript state survives close→open.
 * Plain-text assistant rendering only — NO dangerouslySetInnerHTML (D-A2-8, NFR-AP-SEC-002).
 *
 * FR-AP-002/004/006/007/008..023; NFR-AP-A11Y-001/002/003/005.
 */
import React, { useEffect, useRef, useCallback, useId, useState } from 'react';
import { Icon } from '@/src/components/ui/icons';
import { useFocusTrap } from '@/src/hooks/useFocusTrap';
import { useAssistantPanel } from '@/src/hooks/useAssistantPanel';
import { listAgentThreads } from '@/src/lib/db/agentThreads';
import type { AgentThreadListItem } from '@/src/lib/db/agentThreads';
import { rateAgentEvent } from '@/src/lib/db/agentEvents';
import type { AgentRunStatus } from '@/src/lib/agent/runtime/port';
import { Transcript } from './Transcript';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { ThreadList } from './ThreadList';
import { StuckRunBanner } from './StuckRunBanner';

// ── Desktop/mobile breakpoint ─────────────────────────────────────────────────
// The panel goes modal-sheet at 1024px (D-A2-1, design-plan §1.5).
const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(() => {
    // In jsdom, matchMedia is not implemented — default to desktop (true).
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') {
      return true;
    }
    return window.matchMedia(DESKTOP_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia === 'undefined') return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}

// ── Error card ────────────────────────────────────────────────────────────────
interface ErrorCardProps {
  onRetry: () => void;
}

const ErrorCard: React.FC<ErrorCardProps> = ({ onRetry }) => (
  <div
    role="alert"
    aria-live="assertive"
    className="mx-4 my-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm"
  >
    <p className="font-medium text-destructive">Something went wrong</p>
    <p className="mt-0.5 text-xs text-muted-foreground">
      The assistant ran into a problem. Try again.
    </p>
    <button
      type="button"
      onClick={onRetry}
      aria-label="Retry"
      className="mt-2 rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
    >
      Retry
    </button>
  </div>
);

// ── Out-of-credits card (FR-AUC-016, NFR-AUC-A11Y-001/002) ─────────────────────
const OutOfCreditsCard: React.FC = () => (
  <div
    role="status"
    aria-live="polite"
    className="mx-4 my-2 rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm"
  >
    <p className="font-medium text-foreground">
      You&apos;ve used up your assistant credits for now — contact your admin to request more.
    </p>
  </div>
);

// ── Streaming indicator ───────────────────────────────────────────────────────
const StreamingIndicator: React.FC = () => (
  <div
    aria-live="polite"
    aria-atomic="true"
    className="px-4 py-1 text-xs text-muted-foreground motion-reduce:animate-none"
  >
    Working…
  </div>
);

// ── Main panel component ──────────────────────────────────────────────────────

export const AssistantPanel: React.FC = () => {
  const {
    open,
    transcript,
    phase,
    runId,
    closePanel,
    send,
    stop,
    retry,
    newConversation,
    approve,
    deny,
    chipStateMap,
    isStuck,
    lastProgressAt,
    openThread,
  } = useAssistantPanel();

  const isDesktop = useIsDesktop();
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [composerValue, setComposerValue] = React.useState('');
  const titleId = useId();

  // ── ThreadList — collapsible History region (FR-AGP-020, AC-AGP-019) ─────
  // Lazily fetched: listAgentThreads() only fires once the region is expanded,
  // so the DAL never runs while the panel is merely open/idle.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threads, setThreads] = useState<AgentThreadListItem[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [threadsError, setThreadsError] = useState(false);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((wasOpen) => {
      const next = !wasOpen;
      if (next) {
        setThreadsLoading(true);
        setThreadsError(false);
        void listAgentThreads()
          .then((rows) => setThreads(rows))
          .catch(() => setThreadsError(true))
          .finally(() => setThreadsLoading(false));
      }
      return next;
    });
  }, []);

  const handleOpenThread = useCallback(
    (threadId: string, latestRunId: string | null) => {
      // ADR-0043 (FR-AGP-021): resume-on-open. listAgentThreads() now returns each
      // thread's latestRunId (a PostgREST embed on agent_runs, agentThreads.ts) so we
      // can resume its most recent run directly. A thread with no runs yet
      // (latestRunId null — created but never sent) has nothing to fetch: just close
      // History and let the panel show its current (empty) transcript state, no crash.
      // threadId is forwarded to openThread solely to populate agent_thread_resumed's
      // thread_id analytics property (FR-APH-010) — the DB query itself is still scoped
      // by runId alone (RLS scopes ownership; review round item 6, dead param dropped).
      if (latestRunId !== null) {
        void openThread(latestRunId, threadId);
      }
      setHistoryOpen(false);
    },
    [openThread],
  );

  // ── StuckRunBanner status mapping ────────────────────────────────────────
  // RunPhase (hook-level) -> AgentRunStatus (StuckRunBanner's active-state check).
  const bannerStatus: AgentRunStatus =
    phase === 'running' ? 'running' : phase === 'needs-approval' ? 'needs-approval' : 'completed';

  // ── Staleness re-render tick (FR-AGP-022) ────────────────────────────────
  // isStuck is a point-in-time derivation (now - lastProgressAt). The hook's own 5s server-
  // heartbeat poll (useAssistantPanel.ts, review round item 2) already forces a re-render on
  // this same cadence by updating `lastProgressAt` state — so the banner surfaces without a
  // second, purely-local tick here (this component previously owned that timer as a bare
  // force-rerender; it moved into the hook so the SAME tick can also poll the server).

  const handleRate = useCallback(
    (eventId: string, rating: 'up' | 'down', reason?: Parameters<typeof rateAgentEvent>[2]) => {
      void rateAgentEvent(eventId, rating, reason);
    },
    [],
  );

  // ── Focus-trap (mobile only) ─────────────────────────────────────────────
  const onTrapKeyDown = useFocusTrap(panelRef, isDesktop /* suspended on desktop */);

  // ── Focus management (D-A2-1, NFR-AP-A11Y-002) ──────────────────────────
  useEffect(() => {
    if (open) {
      // Capture the trigger element before we move focus
      triggerRef.current = document.activeElement as HTMLElement | null;
      // Defer past the render commit so the DOM is committed (AppShell pattern)
      const t = setTimeout(() => {
        const root = panelRef.current;
        if (!root) return;
        // Focus the composer textarea (primary action)
        const textarea = root.querySelector<HTMLElement>('textarea');
        if (textarea) {
          textarea.focus();
        } else {
          // Fall back to first focusable in the panel
          const first = root.querySelector<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          (first ?? root).focus();
        }
      }, 0);
      return () => clearTimeout(t);
    } else if (triggerRef.current) {
      triggerRef.current.focus();
      triggerRef.current = null;
    }
  }, [open]);

  // ── Esc closes the panel (D-A2-4 — never cancels) ───────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        closePanel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closePanel]);

  // ── Body scroll-lock on mobile while open ────────────────────────────────
  useEffect(() => {
    if (!isDesktop && open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open, isDesktop]);

  // ── Background inert on mobile while open ────────────────────────────────
  useEffect(() => {
    if (!isDesktop && open) {
      // Make the background inert on mobile (the panel is modal)
      const main = document.getElementById('main');
      const railPersistent = document.querySelector('.rail-persistent');
      if (main) main.setAttribute('inert', '');
      if (railPersistent) railPersistent.setAttribute('inert', '');
      return () => {
        if (main) main.removeAttribute('inert');
        if (railPersistent) railPersistent.removeAttribute('inert');
      };
    }
  }, [open, isDesktop]);

  // ── Callbacks ─────────────────────────────────────────────────────────────
  const handleSend = useCallback(() => {
    // Block send while running, awaiting an approval decision (A3), or out of credits
    // (FR-AUC-016) — the Composer's disabled prop already hard-blocks the UI, this guard
    // is defense-in-depth against a programmatic/Enter-key send bypassing the disabled DOM.
    if (!composerValue.trim() || phase === 'running' || phase === 'needs-approval' || phase === 'out-of-credits') return;
    const text = composerValue;
    setComposerValue('');
    void send(text);
  }, [composerValue, phase, send]);

  const handleStop = useCallback(() => {
    void stop();
  }, [stop]);

  const handleRetry = useCallback(() => {
    void retry();
  }, [retry]);

  const handleChipPick = useCallback((question: string) => {
    setComposerValue(question);
  }, []);

  const handleNewConversation = useCallback(() => {
    newConversation();
    setComposerValue('');
  }, [newConversation]);

  // ── Determine if we show the empty state ─────────────────────────────────
  const isEmpty = transcript.length === 0;

  // ── Desktop non-modal vs mobile modal role/attributes ────────────────────
  const desktopProps = {
    role: 'complementary' as const,
    'aria-label': 'Agent assistant',
  };

  const mobileProps = {
    role: 'dialog' as const,
    'aria-modal': true as const,
    'aria-labelledby': titleId,
  };

  const roleProps = isDesktop ? desktopProps : mobileProps;

  // ── Panel element — keep-mounted, inert when closed (D-A2-6) ─────────────
  // On desktop: fixed right overlay (z-[40]), non-modal, border-left + shadow
  // On mobile: full-screen modal sheet (z-[60])
  const panelClasses = isDesktop
    ? [
        'fixed right-0 top-0 z-[40] flex flex-col bg-card',
        'border-l border-border',
        'shadow-[0_4px_24px_hsl(240_10%_8%/0.12),0_1px_4px_hsl(240_10%_8%/0.06)]',
        // Desktop drawer width
        'w-[400px] h-full',
      ].join(' ')
    : [
        'fixed inset-0 z-[60] flex flex-col bg-card',
      ].join(' ');

  // The panel + its mobile scrim wrapper must apply the onKeyDown for focus trap
  const panelContent = (
    <>
      {/* Mobile scrim — only rendered on mobile when open */}
      {!isDesktop && open && (
        <div
          aria-hidden
          className="fixed inset-0 bg-foreground/40"
          onClick={closePanel}
        />
      )}

      <section
        ref={panelRef}
        {...roleProps}
        // inert when closed (D-A2-6). React 19 maps boolean true → bare `inert`.
        inert={open ? undefined : true}
        onKeyDown={!isDesktop ? onTrapKeyDown : undefined}
        // Keep-mounted (D-A2-6) but VISUALLY hidden when closed: `inert` alone only
        // removes interactivity — the fixed 400px (desktop) / full-screen (mobile)
        // overlay would otherwise stay on screen after close. `hidden` (display:none)
        // removes it from layout + the a11y tree while preserving the mounted React
        // tree (transcript state). Closed-state unit tests query via querySelector, so
        // display:none does not hide it from them.
        className={open ? panelClasses : `${panelClasses} hidden`}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div
          className="flex flex-shrink-0 items-center justify-between border-b border-border px-4"
          style={{ height: 'var(--header-h, 56px)' }}
        >
          <h2
            id={titleId}
            className="text-[18px] font-semibold text-foreground"
          >
            Assistant
          </h2>
          <div className="flex items-center gap-1">
            {/* ADR-0043 (FR-AGP-020): History toggle — expands the ThreadList region. */}
            <button
              type="button"
              onClick={toggleHistory}
              aria-label="History"
              aria-expanded={historyOpen}
              className="touch-target grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring [&_svg]:size-[17px]"
            >
              <Icon name="clock" />
            </button>
            {/* New conversation */}
            <button
              type="button"
              onClick={handleNewConversation}
              aria-label="New conversation"
              className="touch-target grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring [&_svg]:size-[17px]"
            >
              <Icon name="refresh" />
            </button>
            {/* Close */}
            <button
              type="button"
              onClick={closePanel}
              aria-label="Close assistant"
              className="touch-target grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring [&_svg]:size-[17px]"
            >
              <Icon name="x" />
            </button>
          </div>
        </div>

        {/* ── History region (collapsible ThreadList, FR-AGP-020/AC-AGP-019) ── */}
        {historyOpen && (
          <>
            {threadsLoading && (
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                Loading conversations…
              </p>
            )}
            {threadsError && (
              <p role="alert" className="border-b border-border px-4 py-2 text-xs text-destructive">
                Couldn&apos;t load your conversations.
              </p>
            )}
            {!threadsLoading && !threadsError && (
              <ThreadList threads={threads} onOpen={handleOpenThread} />
            )}
          </>
        )}

        {/* ── Transcript region ────────────────────────────────────────── */}
        {/* The Transcript always renders its role="log" aria-live="polite" container so
            the live region is always present in the DOM (AC-AP-021; NFR-AP-A11Y-003).
            EmptyState is rendered inside Transcript when transcript is empty. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* ADR-0043 (FR-AGP-022): stuck-run banner, keyed on the hook's heartbeat-
              staleness derivation — independent of SSE liveness. */}
          {isStuck && runId && (
            <StuckRunBanner
              status={bannerStatus}
              lastProgressAt={lastProgressAt}
              onRetry={handleRetry}
              onCancel={handleStop}
            />
          )}
          <Transcript
            transcript={transcript}
            emptySlot={isEmpty ? <EmptyState onPick={handleChipPick} /> : null}
            chipStateMap={chipStateMap}
            onApprove={() => void approve()}
            onDeny={() => void deny()}
            onRate={handleRate}
          />

          {/* Streaming indicator — shows while run is active or awaiting approval re-POST */}
          {(phase === 'running') && <StreamingIndicator />}

          {/* NFR-AW-A11Y-003: approval-awaiting status announcement, distinct from the
              streaming "Working…" indicator. SR users learn WHY input is blocked. */}
          {phase === 'needs-approval' && (
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="px-4 py-1 text-xs text-muted-foreground"
            >
              A write action awaits your decision
            </div>
          )}

          {/* Error card */}
          {phase === 'error' && <ErrorCard onRetry={handleRetry} />}

          {/* Out-of-credits card (FR-AUC-016) — distinct from the generic ErrorCard */}
          {phase === 'out-of-credits' && <OutOfCreditsCard />}
        </div>

        {/* ── Composer ─────────────────────────────────────────────────── */}
        <Composer
          value={composerValue}
          onChange={setComposerValue}
          onSend={handleSend}
          onStop={handleStop}
          running={phase === 'running' || phase === 'needs-approval'}
          needsApproval={phase === 'needs-approval'}
          disabled={phase === 'out-of-credits'}
        />
      </section>
    </>
  );

  // On mobile, render inside a container so the trap keyDown reaches the scrim too
  if (!isDesktop) {
    return (
      <div
        className={`fixed inset-0 z-[60] ${open ? 'block' : 'hidden'}`}
        onKeyDown={onTrapKeyDown}
      >
        {panelContent}
      </div>
    );
  }

  return panelContent;
};
