import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, ListState, RecordHeader, RecordSection, buttonClasses } from '@/src/components/ui';
import { usePersonChecklist } from '@/src/hooks/useClearance';
import { usePerson } from '@/src/hooks/useDocumentExpiry';
import { ExpiryDocumentsCard } from './ExpiryDocumentsCard';
import { usePermission } from '@/src/auth/usePermission';
import { MarkLeftDialog } from '../admin/MarkLeftDialog';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';

/** A person's record (#2542): name, code and their expiring documents. The roster increment extends it. */
const PersonDetail: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { personId = '' } = useParams();
  const q = usePerson(personId);
  const [leaving, setLeaving] = useState(false);
  const mayMarkLeft = usePermission()('archive', 'person');
  // #2707: the checklist link exists only while the organisation setting is on and the role may read it.
  const clearanceOn = useOrgSwitch('clearance').data === true;
  const mayViewClearance = usePermission()('view', 'personClearance');
  const showClearance = clearanceOn && mayViewClearance;
  const checklist = usePersonChecklist(personId, showClearance);
  if (q.isPending) return <ListState variant="loading" rows={3} />;
  if (q.isError) return <ListState variant="error" title={t('equipment:people.error', "Couldn't load this person")}
    sub={t('equipment:expiry.errorSub', 'The request failed. Check your connection and try again.')} onRetry={() => void q.refetch()} retryLabel={t('equipment:usage.retry', 'Retry')} />;
  if (!q.data) return <ListState variant="empty" title={t('equipment:people.notFound', 'This person was not found')}
    sub={t('equipment:people.notFoundSub', 'They may have been archived, or you may not have access.')}
    action={{ label: t('equipment:expiry.title', 'Expiring documents'), onClick: () => navigate('/equipment/expiring') }} />;
  return (
    <div>
      <RecordHeader name={q.data.name} status={<span className="record-id">{q.data.code}</span>}
        actions={mayMarkLeft ? <Button variant="ghost" onClick={() => setLeaving(true)}>{t('administration:people.markLeft', 'Mark as left')}</Button> : undefined} />
      {/* Walk H2: the checklist read as an empty heading when it was a text link; it is a section with its progress and an Open action. */}
      {showClearance && (
        <RecordSection className="mb-[var(--space-section)]" data-testid="person-clearance-section"
          title={t('administration:clearance.person.link', 'Cleared-for-site checklist')}
          actions={<Link to={`/administration/clearance/${q.data.id}`} className={buttonClasses('outline', 'sm')}>{t('administration:clearance.person.open', 'Open checklist')}</Link>}>
          <p className="text-control text-muted-foreground">
            {checklist.isPending ? t('common:ui.listState.loading', 'Loading…')
              : checklist.isError ? t('administration:clearance.person.loadError', 'Couldn’t load this checklist')
              : t('administration:clearance.person.progress', '{{done}} of {{count}} done', { done: checklist.data.filter((r) => r.state === 'done' || r.state === 'expiring').length, count: checklist.data.length })}
          </p>
        </RecordSection>
      )}
      <ExpiryDocumentsCard kind="person" subjectId={q.data.id} />
      <MarkLeftDialog person={leaving ? q.data : null} onClose={() => setLeaving(false)} />
    </div>
  );
};
export default PersonDetail;
