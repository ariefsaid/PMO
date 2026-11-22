import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { GateNotice, PageHeader, StatusPill } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { ORG_SETTINGS, ORG_SETTING_GROUPS, orgSettingKeys, type OrgSettingGroup, type OrgSettingKey } from '@/src/lib/orgSettingsCatalogue';
import type { OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';
import { orgSettingGroupLabels, orgSettingText } from '@/src/lib/orgSettingsText';
import { STATUS_HOOKS, type StatusKey } from './allSettingsStatus';

/**
 * Administration › All settings (#2746). Every organisation switch and setting group, by the job it enables, with whether it is
 * on and a link to where it is changed. The list is the catalogue (`orgSettingsCatalogue.ts`); nothing here is written by hand
 * per setting. A row shows on/off only where a cheap read exists (the switch module, or the setting's own hook); the rest are a link.
 */
const Status: React.FC<{ on: boolean | undefined }> = ({ on }) => {
  const { t } = useTranslation();
  if (on === undefined) return null;
  return <StatusPill variant="neutral">{on ? t('allSettings.on', 'On') : t('allSettings.off', 'Off')}</StatusPill>;
};

const MigratedStatus: React.FC<{ switchKey: OrgSwitchKey }> = ({ switchKey }) => (
  <Status on={useOrgSwitch(switchKey).data} />
);

const MappedStatus: React.FC<{ settingKey: StatusKey }> = ({ settingKey }) => {
  const useStatus = STATUS_HOOKS[settingKey];
  return <Status on={useStatus()} />;
};

const hasStatusHook = (key: OrgSettingKey): key is StatusKey => key in STATUS_HOOKS;

const Row: React.FC<{ settingKey: OrgSettingKey; name: string; summary: string }> = ({ settingKey, name, summary }) => {
  const entry: (typeof ORG_SETTINGS)[OrgSettingKey] = ORG_SETTINGS[settingKey];
  return (
    <li className="flex min-h-11 flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0 flex-1 basis-64">
        <Link to={entry.route} className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline">{name}</Link>
        <p className="text-control text-muted-foreground">{summary}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-control text-muted-foreground">
        {'switch' in entry ? <MigratedStatus switchKey={entry.switch} /> : hasStatusHook(settingKey) ? <MappedStatus settingKey={settingKey} /> : null}
        <span>{entry.writers.join(', ')}</span>
      </div>
    </li>
  );
};

export default function AllSettings() {
  const { t } = useTranslation();
  const canView = usePermission()('view', 'user');
  const text = orgSettingText(t);
  const groups = orgSettingGroupLabels(t);
  return (
    <div className="min-w-0">
      <PageHeader title={t('allSettings.title', 'All settings')} />
      {!canView ? (
        <GateNotice variant="blocked">
          {t('admin.access.denied', "Administration is an Admin, Executive, or platform Operator area. You don't have access.")}
        </GateNotice>
      ) : (
        <div className="space-y-8">
          {ORG_SETTING_GROUPS.map((group: OrgSettingGroup) => {
            const keys = orgSettingKeys.filter((k) => ORG_SETTINGS[k].group === group);
            return (
              <section key={group} aria-labelledby={`all-settings-${group}`}>
                <h2 id={`all-settings-${group}`} className="text-group font-semibold">{groups[group]}</h2>
                <ul className="mt-3 divide-y divide-border">
                  {keys.map((k) => <Row key={k} settingKey={k} name={text[k].name} summary={text[k].summary} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
