import { getAnalyticsConfig } from '@/src/lib/analytics/config';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';

/**
 * Feedback widget + surveys switch (#1532 S9). The demo deployment is always on (owner ruling); a real
 * org is on unless its Admin stored `feedback_surveys = false` (absence = on, FR-ENT-004).
 */
export function useFeedbackSurveysEnabled(): boolean {
  const { data } = useOrgFeatures();
  if (getAnalyticsConfig().demoMode) return true;
  return data?.feedback_surveys ?? true;
}
