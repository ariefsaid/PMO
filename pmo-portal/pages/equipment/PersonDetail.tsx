import React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState, RecordHeader } from '@/src/components/ui';
import { usePerson } from '@/src/hooks/useDocumentExpiry';
import { ExpiryDocumentsCard } from './ExpiryDocumentsCard';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';

/** A person's record (#2542): name, code and their expiring documents. The roster increment extends it. */
const PersonDetail: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { personId = '' } = useParams();
  const q = usePerson(personId);
  // #2707: the checklist link exists only while the organisation setting is on and the role may read it.
  const clearanceOn = useOrgSwitch('clearance').data === true;
  const mayViewClearance = usePermission()('view', 'personClearance');
  const showClearance = clearanceOn && mayViewClearance;
  if (q.isPending) return <ListState variant="loading" rows={3} />;
  if (q.isError) return <ListState variant="error" title={t('equipment:people.error', "Couldn't load this person")}
    sub={t('equipment:expiry.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />;
  if (!q.data) return <ListState variant="empty" title={t('equipment:people.notFound', 'This person was not found')}
    sub={t('equipment:people.notFoundSub', 'They may have been archived, or you may not have access.')}
    action={{ label: t('equipment:expiry.title', 'Expiring documents'), onClick: () => navigate('/equipment/expiring') }} />;
  return (
    <div>
      <RecordHeader name={q.data.name} status={<span className="record-id">{q.data.code}</span>} />
      {showClearance && (
        <p className="mb-3">
          <Link to={`/administration/clearance/${q.data.id}`} className="text-control font-medium underline-offset-2 hover:underline">
            {t('administration:clearance.person.link', 'Cleared-for-site checklist')}
          </Link>
        </p>
      )}
      <ExpiryDocumentsCard kind="person" subjectId={q.data.id} />
    </div>
  );
};
export default PersonDetail;
