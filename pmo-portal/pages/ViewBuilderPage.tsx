/**
 * View Builder Page (I4, FR-VB-020..072).
 *
 * Routes: /views/new (mode="create") and /views/:viewId/edit (mode="edit").
 *
 * Responsibilities:
 *   - View metadata form (name, description, scope) — inline form state
 *   - Panel list (PanelList component)
 *   - Panel editor modal (PanelEditorForm component)
 *   - Live preview pane (ViewPreview component)
 *   - Compile-before-save invariant (FR-VB-040, NFR-VB-SEC-004)
 *   - Create/update via useUserViewMutations (FR-VB-041)
 *   - Dirty-discard via the shared in-app navigation guard (OD-VB-8)
 *   - Error classification via classifyMutationError (FR-VB-062)
 *
 * Layering (NFR-VB-LAYER-001): imports from src/lib/viewspec/, src/hooks/useUserViews,
 * src/auth/, src/components/ui/, src/lib/classifyMutationError, react-router.
 * Does NOT import from src/lib/db/* or src/lib/supabase/client.
 *
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useLocation } from 'react-router';
import {
  ListState,
  UnsavedChangesDialog,
  TextField,
  TextArea,
  SelectField,
  FormGrid,
  FormSection,
  Button,
  ConfirmDialog,
  useToast,
  type SelectOption,
} from '@/src/components/ui';
import { useUserView, useUserViewMutations } from '@/src/hooks/useUserViews';
import type { UserViewRow } from '@/src/lib/db/userViews';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { ValidationErrorCode } from '@/src/lib/viewspec/types';
import { MAX_PANELS_PER_VIEW } from '@/src/lib/viewspec/types';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { PanelSpec, CompositionSpec } from '@/src/lib/viewspec/types';
import { isFeatureEnabled } from '@/src/lib/features';
import PanelEditorForm from '@/src/components/builder/PanelEditorForm';
import PanelList from '@/src/components/builder/PanelList';
import ViewPreview from '@/src/components/builder/ViewPreview';
import AIComposerModal from '@/src/components/builder/AIComposerModal';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';

const ViewBuilderPage: React.FC<{ mode: 'create' | 'edit' }> = ({ mode }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ viewId: string }>();
  const location = useLocation();
  const viewId = mode === 'edit' ? (params.viewId ?? '') : undefined;

  const { currentUser } = useAuth();
  const may = usePermission();
  const { toast } = useToast();
  const { create, update } = useUserViewMutations();

  const structurallyEqual = (left: unknown, right: unknown): boolean => {
    if (Object.is(left, right)) return true;
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => structurallyEqual(value, right[index]));
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(leftRecord[key], rightRecord[key]));
  };

  // ── Edit mode: load existing view ────────────────────────────────────────
  const {
    data: existingView,
    isPending: viewLoading,
    isError: viewError,
    errorUpdatedAt: viewErrorUpdatedAt,
    refetch: refetchView,
  } = useUserView(viewId);

  const canEditView = !!existingView && may('edit', 'userView', { currentUserId: currentUser?.id, record: { user_id: existingView.user_id } });

  // ── Metadata form state ───────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'private' | 'shared_org'>('private');

  // ── Panel list state ──────────────────────────────────────────────────────
  const [panels, setPanels] = useState<PanelSpec[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [panelModalOpen, setPanelModalOpen] = useState(false);

  // ── AI Composer state (FR-AS-014..017, AC-AS-011..016) ───────────────────
  const [aiComposerOpen, setAIComposerOpen] = useState(false);
  const [aiDraft, setAIDraft] = useState(false);

  // ── Seed from MyViewsPage navigation state (Task 23 populate path) ───────
  // When navigating from MyViews "Compose with AI", location.state.composedSpec
  // carries the AI-composed spec. Seed panels + draft indicator on mount.
  useEffect(() => {
    const state = location.state as { composedSpec?: CompositionSpec } | null;
    if (mode === 'create' && state?.composedSpec) {
      setPanels(state.composedSpec.panels);
      setAIDraft(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // ── Save error state ──────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [useCachedView, setUseCachedView] = useState(false);

  useEffect(() => {
    setUseCachedView(false);
  }, [viewError, viewErrorUpdatedAt]);

  // ── Original values ref — populated when edit mode loads (for dirty detection) ──
  const initialValuesRef = useRef({
    name: '',
    description: '',
    scope: 'private' as 'private' | 'shared_org',
    panels: [] as PanelSpec[],
  });
  const observedServerVersionRef = useRef<{ id: string; updatedAt: string | null } | null>(null);
  const [remoteConflict, setRemoteConflict] = useState<UserViewRow | null>(null);
  const [panelToRemove, setPanelToRemove] = useState<PanelSpec | null>(null);

  // In create mode: any non-empty field or panel counts as dirty.
  // In edit mode: compare against the values loaded from the existing view.
  const isDirty =
    mode === 'create'
      ? name !== '' || panels.length > 0 || description !== ''
      : name !== initialValuesRef.current.name ||
        description !== initialValuesRef.current.description ||
        scope !== initialValuesRef.current.scope ||
        !structurallyEqual(panels, initialValuesRef.current.panels);

  const applyViewToEditor = useCallback((view: UserViewRow) => {
    const loadedName = view.name;
    const loadedDesc = view.description ?? '';
    const loadedScope = (view.scope as 'private' | 'shared_org') ?? 'private';
    const raw = view.spec as unknown as CompositionSpec;
    const loadedPanels = raw && Array.isArray(raw.panels) ? raw.panels : [];
    setName(loadedName);
    setDescription(loadedDesc);
    setScope(loadedScope);
    setPanels(loadedPanels);
    initialValuesRef.current = {
      name: loadedName,
      description: loadedDesc,
      scope: loadedScope,
      panels: loadedPanels,
    };
    observedServerVersionRef.current = { id: view.id, updatedAt: view.updated_at ?? null };
    setRemoteConflict(null);
  }, []);

  // ── Pre-populate once per view version (FR-VB-070) ────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || !existingView) return;
    const currentVersion = { id: existingView.id, updatedAt: existingView.updated_at ?? null };
    const observedVersion = observedServerVersionRef.current;
    if (observedVersion?.id !== existingView.id) {
      applyViewToEditor(existingView);
      return;
    }
    if (observedVersion.updatedAt === currentVersion.updatedAt) return;

    observedServerVersionRef.current = currentVersion;
    if (isDirty) {
      setRemoteConflict(existingView);
      return;
    }
    applyViewToEditor(existingView);
  }, [mode, existingView, isDirty, applyViewToEditor]);

  // ── Dirty detection for the shared navigation guard ──────────────────────
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const guardLeave = useUnsavedChangesGuard({
    dirty: isDirty,
    guardHistory: true,
    onBlocked: (leave) => {
      setPendingLeave(() => leave);
      setShowDiscardDialog(true);
    },
  });
  const scopeOptions: SelectOption[] = [
    { value: 'private', label: t('viewBuilder.privateScope', 'Private: only you') },
    { value: 'shared_org', label: t('viewBuilder.sharedScope', 'Shared with your organisation') },
  ];

  // ── Panel operations ──────────────────────────────────────────────────────

  const handleAddPanel = () => {
    setEditingIndex(null);
    setPanelModalOpen(true);
  };

  const handleEditPanel = (idx: number) => {
    setEditingIndex(idx);
    setPanelModalOpen(true);
  };

  const handleRemovePanel = (idx: number) => {
    const panel = panels[idx];
    if (panel) setPanelToRemove(panel);
  };

  const confirmRemovePanel = () => {
    if (!panelToRemove) return;
    setPanels((prev) => prev.filter((panel) => panel.id !== panelToRemove.id));
    setPanelToRemove(null);
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setPanels((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleMoveDown = (idx: number) => {
    setPanels((prev) => {
      if (idx === prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const handlePanelConfirm = (panel: PanelSpec) => {
    setPanels((prev) => {
      if (editingIndex !== null) {
        const next = [...prev];
        next[editingIndex] = panel;
        return next;
      }
      return [...prev, panel];
    });
    setPanelModalOpen(false);
    setEditingIndex(null);
  };

  // ── AI Composer: populate panels from composed spec (FR-AS-017, AC-AS-014/015) ──
  const handleComposed = (composedSpec: CompositionSpec) => {
    setPanels(composedSpec.panels);
    setAIDraft(true);
    setAIComposerOpen(false);
    toast('View composed', 'Review and save when ready', 'success');
  };

  // ── Compile-before-save + save (FR-VB-040/041) ───────────────────────────

  const spec: CompositionSpec = useMemo(() => ({ version: 1, panels }), [panels]);

  /** What the author can DO about a refused save, in their language, from the validation code. */
  const validationRemedy = (code: ValidationErrorCode): string => {
    switch (code) {
      case 'UNKNOWN_ENTITY':
        return t('viewBuilder:validation.unknownEntity', 'A panel asks for a data source the app does not have. Open that panel and choose an existing data source.');
      case 'UNKNOWN_COLUMN':
        return t('viewBuilder:validation.unknownColumn', 'A panel uses a column the app does not have. Open that panel and choose an existing column.');
      case 'UNKNOWN_OP':
        return t('viewBuilder:validation.unknownOp', 'A filter compares in a way the app does not support. Open that filter and choose another comparison.');
      case 'NON_NUMERIC_AGGREGATE':
        return t('viewBuilder:validation.nonNumericAggregate', 'A total is asked for on a column that is not a number. Choose a numeric column for the total.');
      case 'INVALID_LIMIT':
        return t('viewBuilder:validation.invalidLimit', 'The row limit is not a valid number. Set a row limit and save again.');
      case 'UNKNOWN_TOKEN':
        return t('viewBuilder:validation.unknownToken', 'A filter value uses a token the app does not know. Remove it, or use $current_team or $current_project.');
      case 'MISSING_REQUIRED_FILTER':
        return t('viewBuilder:validation.missingRequiredFilter', 'This view needs a filter. Add one and save again.');
      case 'UNRESOLVABLE_TOKEN':
        return t('viewBuilder:validation.unresolvableToken', 'A filter uses a token that cannot be filled in here. Replace it with a value.');
      case 'NOT_GROUPABLE_COLUMN':
        return t('viewBuilder:validation.notGroupableColumn', 'This view groups by a column that cannot be grouped. Choose another column.');
      case 'UNKNOWN_PRIMITIVE':
        return t('viewBuilder:validation.unknownPrimitive', 'A panel type is not available in the app. Remove that panel or choose another type.');
      case 'UNSUPPORTED_VERSION':
        return t('viewBuilder:validation.unsupportedVersion', 'This view was built by another version of the builder. Rebuild it and save again.');
    }
  };

  const handleSave = async () => {
    if (!currentUser || (mode === 'edit' && !canEditView)) return;
    setSaveError(null);

    if (panels.length > MAX_PANELS_PER_VIEW) {
      setSaveError(t('viewBuilder.maximumPanelsReached', 'Maximum of {{count}} panels reached.', { count: MAX_PANELS_PER_VIEW }));
      return;
    }

    // Compile-before-save invariant (NFR-VB-SEC-004)
    try {
      const ctx = { userId: currentUser.id, orgId: currentUser.org_id };
      compileCompositionSpec(spec, ctx);
    } catch (err) {
      // C4 (GLM view-builder-new #7): the save error used to be `${code}: ${detail}` — 'UNKNOWN_COLUMN:
      // status' — which is implementation terms, in English, where the author needs a remedy. The code
      // chooses a sentence from the catalogue; `detail` (a column or table name) stays out of it.
      if (err instanceof ValidationError) {
        setSaveError(validationRemedy(err.code));
      } else {
        setSaveError(t('viewBuilder:validation.generic', 'The view is not valid yet. Review the panels and save again.'));
      }
      return;
    }

    const input = {
      name,
      description: description || null,
      // CompositionSpec is JSON-serializable but lacks a string-index signature.
      // Cast to UserViewRow['spec'] (= Json) which is the DB column type.
      spec: spec as unknown as UserViewRow['spec'],
      scope,
    };

    setIsSaving(true);
    try {
      if (mode === 'create') {
        const row = await create.mutateAsync(input);
        setAIDraft(false); // clear draft indicator before navigation (AC-AS-016)
        toast('View created', name, 'success');
        navigate(`/views/${row.id}`);
      } else if (mode === 'edit' && viewId) {
        await update.mutateAsync({ id: viewId, input });
        setAIDraft(false); // clear draft indicator before navigation (AC-AS-016)
        toast('View updated', name, 'success');
        navigate(`/views/${viewId}`);
      }
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSaveError(`${headline} — ${detail}`);
    } finally {
      setIsSaving(false);
    }
  };

  // ── Disabled save conditions ──────────────────────────────────────────────
  const nameIsEmpty = name.trim() === '';
  const noPanel = panels.length === 0;
  const saveDisabled = nameIsEmpty || noPanel || isSaving;
  const hasCachedViewError =
    mode === 'edit' &&
    !viewLoading &&
    viewError &&
    existingView !== undefined &&
    existingView !== null &&
    existingView.archived_at === null;
  const saveBlockedByCachedViewError = hasCachedViewError && !useCachedView;

  // ── Edit-mode guard states (FR-VB-071/072) ───────────────────────────────
  if (mode === 'edit' && viewLoading) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true">
        <div aria-hidden className="skel h-7 w-2/5 rounded" />
        <div aria-hidden className="skel h-5 w-3/5 rounded" />
      </div>
    );
  }

  if (mode === 'edit' && !viewLoading && viewError && !existingView) {
    return (
      <ListState
        variant="error"
        title={t('viewBuilder:viewLoadError', 'Could not load this view.')}
        sub={t('viewBuilder:viewLoadErrorDescription', 'Check your connection and retry.')}
        onRetry={() => {
          setUseCachedView(false);
          void refetchView();
        }}
      />
    );
  }

  if (mode === 'edit' && !viewLoading && (!existingView || existingView.archived_at !== null)) {
    return (
      <ListState
        variant="empty"
        title={t('viewBuilder.viewNotFound', 'View not found.')}
        sub={t('viewBuilder.viewNotFoundDescription', "This view may have been archived or you don't have access.")}
        action={{ label: t('viewBuilder.goToMyViews', 'Go to My Views'), onClick: () => navigate('/views') }}
      />
    );
  }

  if (mode === 'edit' && !canEditView) {
    return <ListState variant="empty" title={t('viewBuilder:editUnavailable', 'You cannot edit this view.')} action={{ label: t('viewBuilder.goToMyViews', 'Go to My Views'), onClick: () => navigate('/views') }} />;
  }

  const pageTitle = mode === 'create'
    ? t('viewBuilder.newView', 'New View')
    : (existingView?.name ? t('viewBuilder.editView', '{{name}}', { name: existingView.name }) : t('viewBuilder.newView', 'New View'));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">{pageTitle}</h1>
          {/* AI-composed draft indicator (AC-AS-015, NFR-AS-A11Y-004) */}
          <div aria-live="polite" aria-atomic="true" className="min-h-[1.25rem]">
            {aiDraft && (
              <span className="text-[12px] font-medium text-warning-foreground">
                {t('viewBuilder.aiDraftReview', 'AI-composed draft: review before saving')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {/* Compose with AI button (FR-AS-014, AC-AS-011/012) — hidden when flags off */}
          {isFeatureEnabled('userViews') && isFeatureEnabled('aiComposer') && (
            <Button
              variant="outline"
              onClick={() => setAIComposerOpen(true)}
              aria-label={t('viewBuilder.composeWithAi', 'Compose view with AI')}
            >
              {t('viewBuilder.composeWithAi', 'Compose view with AI')}
            </Button>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              guardLeave(() => navigate('/views'));
            }}
          >
            {t('viewBuilder.cancel', 'Cancel')}
          </Button>
          <div className="flex flex-col items-start gap-1">
            <Button
              variant="primary"
              disabled={saveDisabled || saveBlockedByCachedViewError}
              aria-disabled={saveDisabled || saveBlockedByCachedViewError}
              aria-describedby={noPanel ? 'view-builder-save-reason' : undefined}
              onClick={handleSave}
            >
              {mode === 'create' ? t('viewBuilder.saveView', 'Save view') : t('viewBuilder.updateView', 'Update view')}
            </Button>
            {noPanel && (
              <p id="view-builder-save-reason" className="text-[14px] leading-[1.43] text-muted-foreground">
                {t('viewBuilder.addAtLeastOnePanel', 'Add at least one panel to save.')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-[13px] text-destructive-text"
        >
          {saveError}
        </div>
      )}

      {hasCachedViewError && (
        <div role="alert" className="mb-4 rounded-md border border-warning/30 bg-warning/[0.07] px-3.5 py-3 text-[13px]">
          <p>{t('viewBuilder:cachedViewLoadError', 'Could not refresh this view. The last loaded version may be out of date; using it could overwrite newer changes.')}</p>
          {useCachedView && (
            <p className="mt-1">{t('viewBuilder:usingCachedView', 'You chose to continue with the last loaded version. Saving may overwrite newer changes.')}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUseCachedView(false);
                void refetchView();
              }}
            >
              {t('viewBuilder:retryView', 'Retry')}
            </Button>
            {!useCachedView && (
              <Button variant="ghost" size="sm" onClick={() => setUseCachedView(true)}>
                {t('viewBuilder:useCachedView', 'Continue with last loaded version')}
              </Button>
            )}
          </div>
        </div>
      )}

      {remoteConflict && (
        <div role="alert" className="mb-4 rounded-md border border-warning/30 bg-warning/[0.07] px-3.5 py-3 text-[13px]">
          <p>{t('viewBuilder:serverVersionChanged', 'The saved view changed while you were editing.')}</p>
          <p className="mt-1">{t('viewBuilder:serverVersionChangedHelp', 'Reload drops the edits you have not saved; continue keeps them.')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => guardLeave(() => applyViewToEditor(remoteConflict))}>
              {t('viewBuilder:reloadSavedView', 'Reload saved view')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoteConflict(null)}>
              {t('viewBuilder:continueEditing', 'Continue editing')}
            </Button>
          </div>
        </div>
      )}

      {/* Metadata section */}
      <FormSection legend={t('viewBuilder.viewDetails', 'View details')}>
        <FormGrid>
          <TextField
            label={t('viewBuilder.viewName', 'View name')}
            required
            aria-required="true"
            value={name}
            onChange={setName}
            maxLength={120}
          />
          <TextArea
            label={t('viewBuilder.description', 'Description')}
            value={description}
            onChange={setDescription}
          />
          <SelectField
            label={t('viewBuilder.scope', 'Scope')}
            value={scope}
            options={scopeOptions}
            onChange={(v) => setScope(v as 'private' | 'shared_org')}
          />
        </FormGrid>
      </FormSection>

      {/* Panel editor section */}
      <FormSection legend={t('viewBuilder.panels', 'Panels')}>
        <PanelList
          panels={panels}
          onEdit={handleEditPanel}
          onRemove={handleRemovePanel}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
        />

        {panels.length < MAX_PANELS_PER_VIEW ? (
          <Button variant="outline" onClick={handleAddPanel} className="mt-3">
            {t('viewBuilder.addPanel', '+ Add panel')}
          </Button>
        ) : (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            {t('viewBuilder.maximumPanelsReached', 'Maximum of {{count}} panels reached.', { count: MAX_PANELS_PER_VIEW })}
          </p>
        )}
      </FormSection>

      {/* Live preview starts once there is a panel to show. */}
      {!noPanel && (
        <FormSection legend={t('viewBuilder.livePreview', 'Live preview')}>
          <ViewPreview spec={spec} />
        </FormSection>
      )}

      {/* Panel editor modal */}
      <PanelEditorForm
        open={panelModalOpen}
        initialPanel={editingIndex !== null ? (panels[editingIndex] ?? null) : null}
        onConfirm={handlePanelConfirm}
        onClose={() => {
          setPanelModalOpen(false);
          setEditingIndex(null);
        }}
      />

      <ConfirmDialog
        open={panelToRemove !== null}
        tone="destructive"
        title={t('viewBuilder:removePanelConfirmTitle', 'Remove this panel?')}
        description={t('viewBuilder:removePanelConfirmDescription', 'The {{primitive}} panel for {{entity}} will be removed from this view draft. Other panels stay.', {
          primitive: panelToRemove?.primitive ?? '',
          entity: panelToRemove?.querySpec.entity ?? '',
        })}
        confirmLabel={t('viewBuilder:removePanelConfirm', 'Remove panel')}
        onConfirm={confirmRemovePanel}
        onCancel={() => setPanelToRemove(null)}
      />

      {/* AI Composer modal (FR-AS-015, AC-AS-013, AC-AS-017, AC-AS-018) */}
      {isFeatureEnabled('userViews') && isFeatureEnabled('aiComposer') && (
        <AIComposerModal
          open={aiComposerOpen}
          onClose={() => setAIComposerOpen(false)}
          onComposed={handleComposed}
        />
      )}

      {/* Dirty-discard confirm (FR-VB-063, OD-VB-8) */}
      <UnsavedChangesDialog
        open={showDiscardDialog}
        onDiscard={() => {
          setShowDiscardDialog(false);
          const leave = pendingLeave;
          setPendingLeave(null);
          if (leave) leave();
          else navigate('/views');
        }}
        onKeepEditing={() => {
          setShowDiscardDialog(false);
          setPendingLeave(null);
        }}
      />
    </div>
  );
};

export default ViewBuilderPage;
