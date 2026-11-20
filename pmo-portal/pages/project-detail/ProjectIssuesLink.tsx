import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useFeature } from '@/src/auth/useFeature';

/** Open the incident register scoped to this project when the organisation has the module. */
export function ProjectIssuesLink({ projectId }: { projectId: string }) {
  const enabled = useFeature('incidents');
  const { t } = useTranslation('project');
  if (!enabled) return null;
  return (
    <div className="mb-4">
      <Link className="text-control text-primary underline-offset-2 hover:underline" to={`/incidents?project=${encodeURIComponent(projectId)}`}>
        {t('projectDetail.projectIncidents', 'Project incidents')}
      </Link>
    </div>
  );
}
