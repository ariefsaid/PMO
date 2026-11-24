import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RecordSection, SelectField } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useCrews } from '@/src/hooks/useCrews';
import { useWorkOrderLists } from '@/src/hooks/useWorkOrderLists';
import { repositories } from '@/src/lib/repositories';
import type { SiteReportForm } from './siteReportForm';

interface Props {
  form: Pick<SiteReportForm, 'crewId' | 'personId' | 'areaId'>;
  editable: boolean;
  onChange: (patch: Partial<SiteReportForm>) => void;
}

/**
 * Who the report is for and which area prices it (docs/specs/site-report-crew-link.spec.md, areas-and-area-rates.spec.md).
 * Both are optional: a report may name a crew, or a named person when no crew applies, and may name an area that overrides its
 * work order's area for the rate. The section stays out of the way of a read-only report with no link, and the area choice stays
 * out of the way of an organisation with no areas.
 */
export const SiteReportWho: React.FC<Props> = ({ form, editable, onChange }) => {
  const { t } = useTranslation('siteReport');
  const orgId = useAuth().currentUser?.org_id;
  const crews = useCrews();
  const people = useQuery({
    queryKey: ['daily-site-reports', orgId, 'lookup', 'link-people'],
    queryFn: () => repositories.dailySiteReport.listLinkPeople(),
    enabled: Boolean(orgId) && (editable || Boolean(form.personId)),
    staleTime: 300_000,
  });
  const { liveAreas, areas } = useWorkOrderLists();
  const crewOptions = useMemo(() => (crews.data ?? []).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })), [crews.data]);
  const personOptions = useMemo(() => (people.data ?? []).map((p) => ({ value: p.id, label: p.name })), [people.data]);
  const areaOptions = useMemo(() => {
    const live = liveAreas.map((a) => ({ value: a.id, label: a.name }));
    const kept = form.areaId && !live.some((o) => o.value === form.areaId) ? areas.filter((a) => a.id === form.areaId).map((a) => ({ value: a.id, label: a.name })) : [];
    return [...live, ...kept];
  }, [liveAreas, areas, form.areaId]);
  const showArea = areaOptions.length > 0;
  if (!editable && !form.crewId && !form.personId && !form.areaId) return null;
  return (
    <RecordSection title={t('who.title', 'Crew and area')}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={t('who.crew', 'Crew')} value={form.crewId} disabled={!editable}
          onChange={(v) => onChange(v ? { crewId: v, personId: '' } : { crewId: '' })}
          options={[{ value: '', label: t('who.noCrew', 'No crew') }, ...crewOptions]} />
        <SelectField label={t('who.person', 'Person (when no crew applies)')} value={form.personId} disabled={!editable || Boolean(form.crewId)}
          onChange={(v) => onChange({ personId: v })}
          options={[{ value: '', label: t('who.noPerson', 'No person') }, ...personOptions]}
          helper={form.crewId ? t('who.personHelp', 'A report names a crew or a person, not both. Clear the crew to name a person.') : undefined} />
        {showArea && (
          <SelectField label={t('who.area', 'Rate area')} value={form.areaId} disabled={!editable} onChange={(v) => onChange({ areaId: v })}
            options={[{ value: '', label: t('who.areaDefault', "The work order's area") }, ...areaOptions]}
            helper={t('who.areaHelp', "Prices the report's lines at that area's rates. Leave it to use the work order's area.")} />
        )}
      </div>
    </RecordSection>
  );
};
