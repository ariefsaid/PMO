import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StatusPill, Switch, useToast } from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { usePermission } from '@/src/auth/usePermission';
import { useFeedbackSurveysEnabled } from '@/src/hooks/useFeedbackSurveys';

/**
 * Administration > Organization integrations: the org Admin's own switch for the feedback widget and surveys (#1532 S9).
 * (The Features section is Operator-only, so the Admin's switch lives where an org Admin already configures the org.)
 * Admin sees a switch; everyone else the state.
 * UX only: `admin_set_feedback_surveys` (0419) re-checks the Admin role.
 */
export const FeedbackSurveysSetting: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const canAct = usePermission();
  const on = useFeedbackSurveysEnabled();
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => repositories.orgFeature.setFeedbackSurveys(enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgFeatures'] }),
    onError: (err: unknown) => {
      const { headline, detail } = classifyMutationError(err, {});
      toast(headline, detail, 'warning');
    },
  });
  const label = 'Feedback and surveys';
  return (
    <div className="mt-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] font-medium">{label}</span>
        {canAct('manage', 'orgFeedback') ? (
          <Switch checked={on} onChange={() => mutation.mutate(!on)} label={label} disabled={mutation.isPending} />
        ) : (
          <StatusPill variant={on ? 'won' : 'neutral'}>{on ? 'On' : 'Off'}</StatusPill>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        A Feedback button in the header and, at most once every 30 days, a short question after a first task or a
        quarterly check-in. Never shown while someone is filling in a form. Answers carry no record contents.
      </p>
    </div>
  );
};
