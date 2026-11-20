import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImportButton } from '@/src/components/import';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useUsers } from '@/src/hooks/useUsers';
import { useVendorOptions } from '@/src/hooks/useFkOptions';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { CREW_QUERY_ROOTS, useCrews } from '@/src/hooks/useCrews';
import { makeCrewImportDescriptor, makeCrewMemberImportDescriptor } from '@/src/lib/import';
import { crewRepository } from '@/src/lib/repositories/crews';

/**
 * "Import crews" and "Import crew members" on the Crews page (#2551). The reference lists (disciplines, users,
 * vendors, people, roles) are read once through the repository seam and RLS scopes them; nothing carries an org id.
 * The buttons render only for those who may create a crew (the wizard's own gate); RLS stays the authority.
 */
export const CrewImports: React.FC = () => {
  const { t } = useTranslation(['import', 'crews']);
  const may = usePermission();
  const allowed = may('create', 'crew');
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  const users = useUsers({ enabled: allowed });
  const vendors = useVendorOptions();
  const disciplines = useCostDisciplines(allowed);
  const crews = useCrews();
  const workers = useQuery({ queryKey: ['crew-import-workers', orgId], queryFn: () => crewRepository.workerRefs(), enabled: allowed && Boolean(orgId) });
  const roles = useQuery({ queryKey: ['crew-import-roles', orgId], queryFn: () => crewRepository.allRoles(), enabled: allowed && Boolean(orgId) });

  const crewDescriptor = useMemo(() => makeCrewImportDescriptor({
    disciplines: (disciplines.data ?? []).map((d) => ({ id: d.id, name: d.name })),
    controllers: (users.data ?? []).filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.full_name ?? u.email ?? u.id })),
    vendors: (vendors.data ?? []).map((v) => ({ id: v.value, name: v.sub ?? v.label })),
    existingCodes: async () => (await crewRepository.list()).map((c) => c.code),
  }, t), [disciplines.data, users.data, vendors.data, t]);

  const memberDescriptor = useMemo(() => makeCrewMemberImportDescriptor({
    crews: (crews.data ?? []).map((c) => ({ id: c.id, code: c.code })),
    workers: workers.data ?? [],
    roles: roles.data ?? [],
    existing: () => crewRepository.allMembers(),
  }, t), [crews.data, workers.data, roles.data, t]);

  if (!allowed) return null;
  const refresh = () => { void Promise.all([...CREW_QUERY_ROOTS, 'crew-import-workers', 'crew-import-roles'].map((r) => qc.invalidateQueries({ queryKey: [r] }))); };
  return (
    <>
      <ImportButton entity="crew" descriptor={crewDescriptor} onImported={refresh} label={t('crews:importCrews', 'Import crews')} />
      <ImportButton entity="crew" descriptor={memberDescriptor} onImported={refresh} label={t('crews:importMembers', 'Import crew members')} />
    </>
  );
};
