import { useEffect, useState } from 'react';
import { findSurvey, surveysLive, type SurveyKey } from '@/src/lib/analytics';
import { useFeedbackSurveysEnabled } from '@/src/hooks/useFeedbackSurveys';

const RETRY_MS = 1500;
const MAX_TRIES = 8;

/**
 * The PostHog id of a published survey, or null: the org switch is off, analytics is not live, or the owner has
 * not published it. The SDK starts after first render (parent effect) and loads surveys over the network, so the
 * lookup retries for ~12 s instead of assuming the first answer is final.
 */
export function useSurveyId(key: SurveyKey): string | null {
  const enabled = useFeedbackSurveysEnabled();
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(null);
    if (!enabled || !surveysLive()) return;
    let alive = true;
    let tries = 0;
    const look = () => {
      tries += 1;
      findSurvey(key, (found) => {
        if (!alive || !found) return;
        setId(found);
        clearInterval(timer);
      });
      if (tries >= MAX_TRIES) clearInterval(timer);
    };
    const timer = setInterval(look, RETRY_MS);
    look();
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [enabled, key]);
  return id;
}
