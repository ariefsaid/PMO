import { useContext, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { QueryClientContext } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useFeedbackSurveysEnabled } from '@/src/hooks/useFeedbackSurveys';
import { useSurveyId } from '@/src/hooks/useSurveyId';
import {
  buildSurveyContext,
  canShowSurvey,
  onCoreFlowCompleted,
  setSurveyViewer,
  showSurvey,
  surveysLive,
} from '@/src/lib/analytics';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import {
  dayInZone,
  isActiveUser,
  isPastFirstWeek,
  momentRefusal,
  readActiveDays,
  recordActiveDay,
} from '@/src/lib/analytics/surveyPolicy';

const TICK_MS = 2000;
const NPS_AFTER_MS = 60_000;
const RECHECK_MS = 60_000;

const editableFocused = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
};

/**
 * Prompted surveys (#1532 S9), mounted once in the shell. Renders nothing; at most one survey per session:
 *   - "[PMO] First core flow" (1-5) after the first budget / invoice / payment / purchase success,
 *   - "[PMO] NPS" for active users, a minute into the session.
 * A prompt waits for a safe moment (no dialog, no focused field, no save in flight, no create/edit route,
 * three quiet seconds), never appears in the user's first week or when the org Admin switched surveys off,
 * and PostHog has the last word (`canShowSurvey`: wait period, targeting, already seen). The 30-day cap
 * is that PostHog wait period, set on each survey.
 */
export const SurveyHost: React.FC = () => {
  const enabled = useFeedbackSurveysEnabled();
  const { currentUser } = useAuth();
  const { pathname } = useLocation();
  // Read the in-flight save count at tick time. Optional context: the shell tests mount without a client.
  const queryClient = useContext(QueryClientContext);
  const flowId = useSurveyId('firstFlow');
  const npsId = useSurveyId('nps');

  const live = useRef({ enabled, pathname, queryClient, flowId, npsId, createdAt: currentUser?.created_at });
  live.current = { enabled, pathname, queryClient, flowId, npsId, createdAt: currentUser?.created_at };
  useEffect(() => setSurveyViewer({ enabled, createdAt: currentUser?.created_at }), [enabled, currentUser?.created_at]);
  const startedAt = useRef(Date.now());
  const lastInteractionAt = useRef(Date.now());
  const flowDone = useRef(false);
  const shown = useRef(false);
  const retryAfter = useRef(0);

  useEffect(() => {
    recordActiveDay(localStorage, dayInZone(Date.now(), getActiveLocale().timezone));
    const touch = () => (lastInteractionAt.current = Date.now());
    window.addEventListener('keydown', touch, true);
    window.addEventListener('pointerdown', touch, true);
    const offFlow = onCoreFlowCompleted(() => (flowDone.current = true));
    const tick = setInterval(() => {
      const s = live.current;
      const now = Date.now();
      if (shown.current || !s.enabled || !surveysLive() || now < retryAfter.current) return;
      if (!isPastFirstWeek(s.createdAt, now)) return;
      const today = dayInZone(now, getActiveLocale().timezone);
      const id = flowDone.current && s.flowId
        ? s.flowId
        : now - startedAt.current >= NPS_AFTER_MS && s.npsId && isActiveUser(readActiveDays(localStorage), today)
          ? s.npsId
          : null;
      if (!id) return;
      const refusal = momentRefusal({
        now,
        lastInteractionAt: lastInteractionAt.current,
        openDialogs: document.querySelectorAll('[role="dialog"],[aria-modal="true"]').length,
        editableFocused: editableFocused(),
        mutationsInFlight: s.queryClient?.isMutating() ?? 0,
        pathname: s.pathname,
      });
      if (refusal) return;
      if (!canShowSurvey(id)) {
        retryAfter.current = now + RECHECK_MS;
        return;
      }
      shown.current = true;
      showSurvey(id, buildSurveyContext(s.pathname));
    }, TICK_MS);
    return () => {
      clearInterval(tick);
      offFlow();
      window.removeEventListener('keydown', touch, true);
      window.removeEventListener('pointerdown', touch, true);
    };
  }, []);

  return null;
};
