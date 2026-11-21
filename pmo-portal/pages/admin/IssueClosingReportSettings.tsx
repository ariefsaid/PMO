import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardPad,
  FieldError,
  Icon,
  ListState,
  SelectField,
  Switch,
  TextField,
  useToast,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import {
  useIssueClosingReportSettings,
  useUpdateIssueClosingReportSettings,
  useIssueDepartmentGroups,
  useIssueDepartmentGroupMutations,
} from '@/src/hooks/useIssueClosingReport';
import type { IssueDepartmentGroup } from '@/src/lib/db/issueClosingReport';

export const IssueClosingReportSettings: React.FC = () => {
  const { t } = useTranslation('administration');
  const { toast } = useToast();
  const may = usePermission();
  const canManage = may('manage', 'siteReportLists') || may('edit', 'incident');

  const settingsQuery = useIssueClosingReportSettings();
  const updateSettings = useUpdateIssueClosingReportSettings();
  const groupsQuery = useIssueDepartmentGroups();
  const { save: saveGroup, remove: removeGroup } = useIssueDepartmentGroupMutations();

  const [newName, setNewName] = useState('');
  const [newTypes, setNewTypes] = useState('');
  const [editingGroup, setEditingGroup] = useState<IssueDepartmentGroup | null>(null);
  const [error, setError] = useState<string>();

  if (!canManage) return null;

  const onToggleEnabled = async (enabled: boolean) => {
    try {
      await updateSettings.mutateAsync({ enabled });
      toast(t('issueClosingReport.saved', 'Settings saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const onGroupingModeChange = async (grouping_mode: 'type' | 'department_groups') => {
    try {
      await updateSettings.mutateAsync({ grouping_mode });
      toast(t('issueClosingReport.saved', 'Settings saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(undefined);

    const types = newTypes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    try {
      await saveGroup.mutateAsync({
        name: newName.trim(),
        issue_types: types,
      });
      setNewName('');
      setNewTypes('');
      toast(t('issueClosingReport.groupSaved', 'Department group saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  const handleUpdateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGroup || !editingGroup.name.trim()) return;
    setError(undefined);

    try {
      await saveGroup.mutateAsync({
        id: editingGroup.id,
        name: editingGroup.name.trim(),
        issue_types: editingGroup.issue_types,
      });
      setEditingGroup(null);
      toast(t('issueClosingReport.groupSaved', 'Department group saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    try {
      await removeGroup.mutateAsync(id);
      toast(t('issueClosingReport.groupDeleted', 'Department group deleted'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const settings = settingsQuery.data;

  return (
    <section id="issue-closing-report-settings" tabIndex={-1} className="scroll-mt-4 space-y-6" aria-labelledby="issue-closing-report-heading">
      <div>
        <h2 id="issue-closing-report-heading" className="text-group font-semibold tracking-[-0.01em]">
          {t('issueClosingReport.title', 'Issue closing-time report')}
        </h2>
        <p className="mt-1 max-w-prose text-control text-muted-foreground">
          {t('issueClosingReport.helper', 'Enable the closing-time report and configure department groupings.')}
        </p>
      </div>

      <Card>
        <CardPad className="space-y-6 p-6">
          {/* Enable Switch */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <span className="block text-sm font-medium text-foreground">
                {t('issueClosingReport.enableLabel', 'Enable closing-time report')}
              </span>
              <span className="block text-control text-muted-foreground">
                {t('issueClosingReport.enableHelper', 'Makes the closing-time report available on the Incidents register.')}
              </span>
            </div>
            <Switch
              checked={settings?.enabled ?? false}
              onChange={(next) => onToggleEnabled(next)}
              disabled={updateSettings.isPending}
              data-testid="toggle-closing-report-enabled"
            />
          </div>

          {/* Grouping Mode */}
          <div className="border-t border-border pt-4">
            <SelectField
              id="admin-report-grouping-mode"
              label={t('issueClosingReport.groupingMode', 'Default grouping')}
              value={settings?.grouping_mode ?? 'type'}
              onChange={(val) => onGroupingModeChange(val as 'type' | 'department_groups')}
              options={[
                { value: 'type', label: t('issueClosingReport.modeType', 'By issue type') },
                { value: 'department_groups', label: t('issueClosingReport.modeDepartmentGroups', 'By custom department groups') },
              ]}
              disabled={updateSettings.isPending}
            />
          </div>
        </CardPad>
      </Card>

      {/* Department Groups Editor */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">
            {t('issueClosingReport.groupsTitle', 'Department groups')}
          </h3>
          <p className="text-control text-muted-foreground">
            {t('issueClosingReport.groupsHelper', 'Map issue types to named departments for reporting.')}
          </p>
        </div>

        {error && <FieldError id="dept-group-error">{error}</FieldError>}

        {groupsQuery.isPending ? (
          <ListState variant="loading" rows={3} />
        ) : (groupsQuery.data ?? []).length === 0 ? (
          <p className="text-control text-muted-foreground italic">
            {t('issueClosingReport.empty', 'No department groups configured yet. Issues will group by raw issue type.')}
          </p>
        ) : (
          <ul className="divide-y divide-border border border-border rounded-control bg-card">
            {(groupsQuery.data ?? []).map((grp) => (
              <li key={grp.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                {editingGroup?.id === grp.id ? (
                  <form onSubmit={handleUpdateGroup} className="flex-1 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <TextField
                        label={t('issueClosingReport.groupName', 'Department name')}
                        value={editingGroup.name}
                        onChange={(name) => setEditingGroup({ ...editingGroup, name })}
                      />
                      <TextField
                        label={t('issueClosingReport.issueTypes', 'Issue types (comma-separated)')}
                        value={editingGroup.issue_types.join(', ')}
                        onChange={(raw) =>
                          setEditingGroup({
                            ...editingGroup,
                            issue_types: raw.split(',').map((s) => s.trim()).filter(Boolean),
                          })
                        }
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="submit" variant="primary" size="sm" disabled={saveGroup.isPending}>
                        {t('issueClosingReport.save', 'Save')}
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingGroup(null)}>
                        {t('issueClosingReport.cancel', 'Cancel')}
                      </Button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div>
                      <div className="font-semibold text-foreground">{grp.name}</div>
                      <div className="text-control text-muted-foreground">
                        {grp.issue_types.length > 0
                          ? grp.issue_types.join(', ')
                          : t('issueClosingReport.noTypes', 'No types mapped')}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingGroup(grp)}
                      >
                        <Icon name="pencil" />
                        {t('issueClosingReport.edit', 'Edit')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteGroup(grp.id)}
                        disabled={removeGroup.isPending}
                      >
                        <Icon name="trash" />
                        {t('issueClosingReport.delete', 'Delete')}
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add Group Form */}
        <Card>
          <CardPad className="p-4">
            <h4 className="text-sm font-semibold mb-3">
              {t('issueClosingReport.addGroup', 'Add department group')}
            </h4>
            <form onSubmit={handleAddGroup} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField
                  label={t('issueClosingReport.groupName', 'Department name')}
                  placeholder={t('issueClosingReport.groupNamePlaceholder', 'e.g. Civil & Earthworks')}
                  value={newName}
                  onChange={setNewName}
                />
                <TextField
                  label={t('issueClosingReport.issueTypes', 'Issue types (comma-separated)')}
                  placeholder={t('issueClosingReport.issueTypesPlaceholder', 'e.g. Civil, Excavation, Concrete')}
                  value={newTypes}
                  onChange={setNewTypes}
                />
              </div>
              <Button type="submit" variant="primary" size="sm" disabled={!newName.trim() || saveGroup.isPending}>
                <Icon name="plus" />
                {t('issueClosingReport.addGroup', 'Add department group')}
              </Button>
            </form>
          </CardPad>
        </Card>
      </div>
    </section>
  );
};

export default IssueClosingReportSettings;
