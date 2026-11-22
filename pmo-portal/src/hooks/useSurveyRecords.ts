import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import type { RecordSurveyInput } from '@/src/lib/db/surveyRecords';

/** One work order's survey records (survey-cap-record). */
export function useSurveyRecords(workOrderId: string | undefined) {
  return useOrgQuery(['survey-records', workOrderId], () => repositories.surveyRecord.list(workOrderId as string), { enabled: Boolean(workOrderId) });
}

/** A survey write refreshes the list and the project's billing facts (the certified quantity feeds the claim form). */
export function useSurveyMutations(workOrderId: string, projectId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['survey-records', orgId, workOrderId] });
    void qc.invalidateQueries({ queryKey: ['project-billing', orgId, projectId] });
  };
  const record = useMutation({ mutationFn: (input: RecordSurveyInput) => repositories.surveyRecord.record(input), onSettled: refresh });
  const confirm = useMutation({ mutationFn: (id: string) => repositories.surveyRecord.confirm(id), onSettled: refresh });
  const discard = useMutation({ mutationFn: (id: string) => repositories.surveyRecord.discard(id), onSettled: refresh });
  return { record, confirm, discard };
}
