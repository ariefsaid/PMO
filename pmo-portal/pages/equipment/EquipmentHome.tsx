import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListPage, ListState, buttonClasses } from '@/src/components/ui';
import { CanWrite, usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useFeature } from '@/src/auth/useFeature';
import { useEquipmentAssetPages } from '@/src/hooks/useEquipment';
import { useEquipmentPlanSettings } from '@/src/hooks/useEquipmentPlans';
import { LIST_LIMIT } from '@/src/lib/db/equipment';
import { AssetFormModal } from './AssetFormModal';
import { EquipmentTargetsProvider } from './EquipmentTargets';
import { MachineStatusSection } from './MachineStatusSection';
import EquipmentUsagePage from './EquipmentUsage';

/** The hours log's own deep links (week, tab, asset) and `?view=hours` open the log; the bare address opens the machines. */
const HOURS_PARAMS = ['week', 'tab', 'asset'] as const;

const MachinesView: React.FC = () => {
  const { t } = useTranslation();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const writeCtx = { record: { viewOnly: realRole !== effectiveRole } };
  const assets = useEquipmentAssetPages();
  const planFeature = useFeature('procurement');
  const plan = useEquipmentPlanSettings();
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const firstPage = assets.data?.pages[0];
  const rows = firstPage?.rows ?? [];
  const canManagePlan = may('manage', 'equipmentPlan', writeCtx);
  const planOn = plan.data?.enabled === true;

  return (
    <ListPage
      title={t('equipment:usage.title', 'Equipment')}
      count={assets.total}
      primaryAction={<CanWrite entity="equipmentAsset" action="create" ctx={writeCtx}>
        <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" />{t('equipment:home.newEquipment', 'New equipment')}</Button>
      </CanWrite>}
    >
      <nav aria-label={t('equipment:home.links', 'Equipment pages')} className="mb-6 flex flex-wrap gap-2">
        <Link className={buttonClasses('outline', 'sm')} to="/equipment?view=hours">{t('equipment:home.hoursLog', 'Hours log')}</Link>
        <Link className={buttonClasses('outline', 'sm')} to="/equipment/availability">{t('equipment:availability.title', 'Availability')}</Link>
        {planFeature && planOn && <Link className={buttonClasses('outline', 'sm')} to="/equipment-plans">{t('equipment:home.monthlyPlan', 'Monthly equipment plan')}</Link>}
        {planFeature && !planOn && plan.data && canManagePlan && <Link className={buttonClasses('outline', 'sm')} to="/equipment-plans/settings">{t('equipment:home.turnOnPlan', 'Turn on the monthly equipment plan')}</Link>}
        <Link className={buttonClasses('outline', 'sm')} to="/equipment/expiring">{t('equipment:nav.expiring', 'Expiring documents')}</Link>
        <Link className={buttonClasses('outline', 'sm')} to="/equipment/assets">{t('equipment:home.register', 'All equipment and rental terms')}</Link>
      </nav>
      {problem && <p role="alert" className="mb-3 text-destructive-text">{problem}</p>}
      {assets.isPending && <ListState variant="loading" shape="table" rows={4} />}
      {assets.isError && <ListState variant="error" title={t('equipment:availability.assetsError', "Couldn't load equipment")} onRetry={() => void assets.refetch()} />}
      {!assets.isPending && !assets.isError && rows.length === 0 && (
        <ListState variant="empty" title={t('equipment:usage.noMachines', 'No machines registered')}
          sub={may('create', 'equipmentAsset', writeCtx) ? t('equipment:home.emptyCan', 'Add the first machine with New equipment.') : t('equipment:usage.noMachinesSub', 'An Admin or Project Manager adds the machines.')} />
      )}
      {!assets.isError && rows.length > 0 && <MachineStatusSection rows={rows} onProblem={setProblem} />}
      {(firstPage?.truncated || rows.length >= LIST_LIMIT) && <p role="status" className="text-sm text-muted-foreground">
        {t('equipment:home.firstPage', 'Showing the first {{count}} machines. The rest are under Availability.', { count: LIST_LIMIT })}</p>}
      {creating && <AssetFormModal onClose={() => setCreating(false)} />}
    </ListPage>
  );
};

/** /equipment: opens on the machines and today's status; the weekly hours log is one tap away. */
const EquipmentHome: React.FC = () => {
  const [params] = useSearchParams();
  const hours = params.get('view') === 'hours' || HOURS_PARAMS.some((key) => params.has(key));
  return <EquipmentTargetsProvider>{hours ? <EquipmentUsagePage /> : <MachinesView />}</EquipmentTargetsProvider>;
};
export default EquipmentHome;
