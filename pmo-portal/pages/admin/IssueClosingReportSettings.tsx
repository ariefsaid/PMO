import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  FieldError,
  Icon,
  ListState,
  SelectField,
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
  const [editingTypes, setEditingTypes] = useState('');
  const [error, setError] = useState<string>();

  if (!canManage) return null;

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
        issue_types: editingTypes.split(',').map((s) => s.trim()).filter(Boolean),
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
    <section id="issue-closing-report-settings" tabIndex={-1} className="scroll-mt-4 space-y-4" aria-labelledby="issue-closing-report-heading">
      <div>
        <h2 id="issue-closing-report-heading" className="text-group font-semibold tracking-[-0.01em]">
          {t('issueClosingReport.title', 'Issue closing-time report')}
        </h2>
        <p className="mt-1 max-w-prose text-control text-muted-foreground">
          {t('issueClosingReport.helper', 'Choose how the closing-time report groups issues, and set up department groups.')}
        </p>
      </div>

      <div className="max-w-sm">
        {settingsQuery.isError ? <ListState variant="error" title={t('administration:orgSwitch.loadError', "Couldn't load this setting")} onRetry={() => void settingsQuery.refetch()} /> : settingsQuery.isPending ? <ListState variant="loading" rows={1} /> : <SelectField
          id="admin-report-grouping-mode"
          label={t('issueClosingReport.groupingMode', 'Default grouping')}
          value={settings?.grouping_mode ?? 'type'}
          onChange={(val) => onGroupingModeChange(val as 'type' | 'department_groups')}
          options={[
            { value: 'type', label: t('issueClosingReport.modeType', 'By issue type') },
            { value: 'department_groups', label: t('issueClosingReport.modeDepartmentGroups', 'By custom department groups') },
          ]}
          disabled={updateSettings.isPending}
        />}
      </div>

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

        {groupsQuery.isError ? <ListState variant="error" title={t('administration:orgSwitch.loadError', "Couldn't load this setting")} onRetry={() => void groupsQuery.refetch()} /> : groupsQuery.isPending ? (
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
                        value={editingTypes}
                        onChange={setEditingTypes}
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
                        onClick={() => { setEditingGroup(grp); setEditingTypes(grp.issue_types.join(', ')); }}
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
        <div className="border-t border-border pt-4">
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
        </div>
      </div>
    </section>
  );
};

export default IssueClosingReportSettings;
