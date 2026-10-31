import React from 'react';
import { useLocation } from 'react-router';
import { Icon } from '@/src/components/ui/icons';
import { buildSurveyContext, showSurvey } from '@/src/lib/analytics';
import { useSurveyId } from '@/src/hooks/useSurveyId';

export const FEEDBACK_TRIGGER_ID = 'pmo-feedback-trigger';

/**
 * The always-available Feedback button in the header (#1532 S9). User-initiated: it opens PostHog's own
 * survey popover beside the button and nothing else ever opens it. Absent when the org Admin switched
 * feedback off, the user opted out, or the survey is not published. The session id rides on every
 * answer, so a demo-org answer links to its replay; the page context is module + route template only.
 */
export const FeedbackWidget: React.FC = () => {
  const { pathname } = useLocation();
  const id = useSurveyId('feedback');
  if (!id) return null;
  // ponytail: one English word, also the usual Indonesian UI term; a feature namespace + catalogue entry if it ever needs translating.
  const label = 'Feedback';
  return (
    <button
      id={FEEDBACK_TRIGGER_ID}
      type="button"
      onClick={() => showSurvey(id, buildSurveyContext(pathname), `#${FEEDBACK_TRIGGER_ID}`)}
      className="touch-target flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] text-muted-foreground transition-[border-color,box-shadow] hover:border-primary/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring max-[921px]:w-9 max-[921px]:justify-center max-[921px]:px-0 [&_svg]:size-[15px]"
    >
      <Icon name="message" />
      <span className="max-[921px]:sr-only">{label}</span>
    </button>
  );
};
