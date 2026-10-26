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
 *   - Dirty-discard via useBlocker (OD-VB-8)
 *   - Error classification via classifyMutationError (FR-VB-062)
 *
 * Layering (NFR-VB-LAYER-001): imports from src/lib/viewspec/, src/hooks/useUserViews,
 * src/auth/, src/components/ui/, src/lib/classifyMutationError, react-router.
 * Does NOT import from src/lib/db/* or src/lib/supabase/client.
 *
 * Test-only escape hatch: __testPanels?: PanelSpec[] — seeds the panel list in RTL tests
 * without requiring modal interaction. Undefined in production usage.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useLocation } from 'react-router';
import {
  ListState,
  ConfirmDialog,
  TextField,
  TextArea,
  SelectField,
  FormGrid,
  FormSection,
  Button,
  useToast,
  type SelectOption,
} from '@/src/components/ui';
import { useUserView, useUserViewMutations } from '@/src/hooks/useUserViews';
import type { UserViewRow } from '@/src/lib/db/userViews';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { ValidationError } from '@/src/lib/viewspec/types';
import { MAX_PANELS_PER_VIEW } from '@/src/lib/viewspec/types';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { PanelSpec, CompositionSpec } from '@/src/lib/viewspec/types';
import { isFeatureEnabled } from '@/src/lib/features';
import PanelEditorForm from '@/src/components/builder/PanelEditorForm';
import PanelList from '@/src/components/builder/PanelList';
import ViewPreview from '@/src/components/builder/ViewPreview';
import AIComposerModal from '@/src/components/builder/AIComposerModal';

export interface ViewBuilderPageProps {
  mode: 'create' | 'edit';
  /** TEST ONLY: seeds the panel list without requiring modal interaction. */
  __testPanels?: PanelSpec[];
}

/** Kept local so the shared shell frame can replace this small heading adapter cleanly. */
const BuilderPageIntro: React.FC<{ title: string; scope?: string; aiDraft?: boolean; aiDraftLabel?: string }> = ({ title, scope, aiDraft, aiDraftLabel }) => (
  <header className="mb-5 flex flex-col gap-1">
    <h1 className="text-2xl font-bold tracking-[-0.02em]">{title}</h1>
    {scope && <p className="text-sm text-muted-foreground">{scope}</p>}
    <div aria-live="polite" aria-atomic="true" className="min-h-5">
      {aiDraft && <p className="text-sm font-medium text-warning-foreground">{aiDraftLabel}</p>}
    </div>
  </header>
);

const ViewBuilderPage: React.FC<ViewBuilderPageProps> = ({ mode, __testPanels }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams<{ viewId: string }>();
  const location = useLocation();
  const viewId = mode === 'edit' ? (params.viewId ?? '') : undefined;

  const { currentUser } = useAuth();
  const realRole = useOptionalRealRole();
  const { toast } = useToast();
  const { create, update } = useUserViewMutations();

  // ── Edit mode: load existing view ────────────────────────────────────────
  const { data: existingView, isPending: viewLoading } = useUserView(viewId);

  // ── Metadata form state ───────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'private' | 'shared_org'>('private');

  // ── Panel list state ──────────────────────────────────────────────────────
  const [panels, setPanels] = useState<PanelSpec[]>(__testPanels ?? []);
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
    if (mode === 'create' && state?.composedSpec && __testPanels === undefined) {
      setPanels(state.composedSpec.panels);
      setAIDraft(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount only

  // ── Save error state ──────────────────────────────────────────────────────
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── Original values ref — populated when edit mode loads (for dirty detection) ──
  const initialValuesRef = useRef({ name: '', description: '', scope: 'private' as 'private' | 'shared_org', panels: [] as PanelSpec[] });

  // ── Pre-populate in edit mode (FR-VB-070) ────────────────────────────────
  useEffect(() => {
    if (mode !== 'edit' || !existingView) return;
    const loadedName = existingView.name;
    const loadedDesc = existingView.description ?? '';
    const loadedScope = (existingView.scope as 'private' | 'shared_org') ?? 'private';
    const raw = existingView.spec as unknown as CompositionSpec;
    const loadedPanels = raw && Array.isArray(raw.panels) ? raw.panels : [];
    setName(loadedName);
    setDescription(loadedDesc);
    setScope(loadedScope);
    setPanels(loadedPanels);
    // Capture initial values so isDirty comparison can detect real changes
    initialValuesRef.current = { name: loadedName, description: loadedDesc, scope: loadedScope, panels: loadedPanels };
  }, [mode, existingView]);

  // ── Seed test panels when __testPanels changes ────────────────────────────
  useEffect(() => {
    if (__testPanels !== undefined) {
      setPanels(__testPanels);
    }
  }, [__testPanels]);

  // ── Dirty detection for useBlocker ───────────────────────────────────────
  // In create mode: any non-empty field or panel counts as dirty.
  // In edit mode: compare against the values loaded from the existing view so
  // navigating away from an unmodified form does NOT trigger the discard dialog.
  const isDirty =
    mode === 'create'
      ? name !== '' || panels.length > 0 || description !== ''
      : name !== initialValuesRef.current.name ||
        description !== initialValuesRef.current.description ||
        scope !== initialValuesRef.current.scope ||
        JSON.stringify(panels) !== JSON.stringify(initialValuesRef.current.panels);

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const scopeOptions: SelectOption[] = [
    { value: 'private', label: t('viewBuilder.privateScope', 'Private — only you') },
    { value: 'shared_org', label: t('viewBuilder.sharedScope', 'Shared with your organisation') },
  ];

  // Guard unsaved changes (OD-VB-8). The app uses BrowserRouter (not a data
  // router), so react-router's useBlocker is unavailable — it throws at render.
  // Browser-level exits (tab close / refresh) warn via beforeunload; in-app exit
  // is guarded explicitly by the Cancel button + the discard dialog below.
  useEffect(() => {
    if (!(isDirty && !isSaving)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty, isSaving]);

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
    setPanels((prev) => prev.filter((_, i) => i !== idx));
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
    toast(t('work:viewBuilder.composedToast', 'View composed'), t('work:viewBuilder.composedToastDetail', 'Review and save when ready'), 'success');
  };

  // ── Compile-before-save + save (FR-VB-040/041) ───────────────────────────

  const spec: CompositionSpec = { version: 1, panels };

  const handleSave = async () => {
    if (!currentUser) return;
    setSaveError(null);

    // Compile-before-save invariant (NFR-VB-SEC-004)
    try {
      const ctx = { userId: currentUser.id, orgId: currentUser.org_id };
      compileCompositionSpec(spec, ctx);
    } catch (err) {
      if (err instanceof ValidationError) {
        setSaveError(`${err.code}${err.detail ? ': ' + err.detail : ''}`);
      } else {
        setSaveError('Validation failed. Please review your panels.');
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
        toast(t('work:viewBuilder.createdToast', 'View created'), name, 'success');
        navigate(`/views/${row.id}`);
      } else if (mode === 'edit' && viewId) {
        await update.mutateAsync({ id: viewId, input });
        setAIDraft(false); // clear draft indicator before navigation (AC-AS-016)
        toast(t('work:viewBuilder.updatedToast', 'View updated'), name, 'success');
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

  // ── Edit-mode guard states (FR-VB-071/072) ───────────────────────────────
  if (mode === 'edit' && viewLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6" aria-busy="true">
        <BuilderPageIntro title={t('viewBuilder.editView', 'Edit view')} />
        <div className="flex flex-col gap-4">
          <div aria-hidden className="skel h-7 w-2/5 rounded" />
          <div aria-hidden className="skel h-5 w-3/5 rounded" />
        </div>
      </div>
    );
  }

  if (mode === 'edit' && !viewLoading && (!existingView || existingView.archived_at !== null)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <BuilderPageIntro title={t('viewBuilder.viewNotFound', 'View not found.')} />
        <ListState
          variant="empty"
          title={t('viewBuilder.viewNotFound', 'View not found.')}
          sub={t('viewBuilder.viewNotFoundDescription', "This view may have been archived or you don't have access.")}
          action={{ label: t('viewBuilder.goToMyViews', 'Go to My Views'), onClick: () => navigate('/views') }}
        />
      </div>
    );
  }

  const canManageExisting = Boolean(
    existingView && (existingView.user_id === currentUser?.id || realRole === 'Admin'),
  );
  if (mode === 'edit' && existingView && !canManageExisting) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6">
        <BuilderPageIntro title={t('work:viewBuilder.editUnavailable', 'View is read-only')} />
        <ListState
          variant="empty"
          title={t('work:viewBuilder.editUnavailable', 'View is read-only')}
          sub={t('work:viewBuilder.editUnavailableDescription', 'Only the owner or an administrator can edit this saved view.')}
          action={{ label: t('viewBuilder.goToMyViews', 'Go to My Views'), onClick: () => navigate('/views') }}
        />
      </div>
    );
  }

  const pageTitle = mode === 'create'
    ? t('viewBuilder.newView', 'New view')
    : existingView?.name ?? t('viewBuilder.editView', 'Edit view');
  const currentScope = scope === 'shared_org'
    ? t('viewBuilder.sharedScope', 'Shared with your organisation')
    : t('viewBuilder.privateScope', 'Private — only you');
  const leaveBuilder = () => {
    if (isDirty) setShowDiscardDialog(true);
    else navigate(mode === 'edit' && viewId ? `/views/${viewId}` : '/views');
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 [&_input]:min-h-11 [&_select]:min-h-11 [&_textarea]:min-h-11">
      <div className="mb-3">
        <Button variant="ghost" className="min-h-11 px-2" onClick={leaveBuilder}>
          {t('work:viewBuilder.backToViews', 'Back to saved views')}
        </Button>
      </div>
      <BuilderPageIntro
        title={pageTitle}
        scope={mode === 'edit' ? currentScope : undefined}
        aiDraft={aiDraft}
        aiDraftLabel={t('viewBuilder.aiDraftReview', 'AI-composed draft — review before saving')}
      />

      {/* Metadata section */}
      <FormSection legend={t('viewBuilder.viewDetails', 'Name and visibility')}>
        <FormGrid>
          <TextField
            label={t('viewBuilder.viewName', 'View name')}
            required
            aria-required="true"
            value={name}
            onChange={setName}
            maxLength={120}
          />
          <SelectField
            label={t('viewBuilder.scope', 'Scope')}
            value={scope}
            options={scopeOptions}
            onChange={(v) => setScope(v as 'private' | 'shared_org')}
          />
          <TextArea
            label={t('viewBuilder.description', 'Description')}
            value={description}
            onChange={setDescription}
          />
        </FormGrid>
      </FormSection>

      {isFeatureEnabled('userViews') && isFeatureEnabled('aiComposer') && (
        <div className="my-4">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setAIComposerOpen(true)}
            aria-label={t('viewBuilder.composeWithAi', 'Compose view with AI')}
          >
            {t('viewBuilder.composeWithAi', 'Compose view with AI')}
          </Button>
        </div>
      )}

      {/* Panel editor section */}
      <FormSection legend={t('viewBuilder.panels', 'Panels')}>
        <PanelList
          panels={panels}
          onEdit={handleEditPanel}
          onRemove={handleRemovePanel}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
        />

        {noPanel && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t('viewBuilder.addAtLeastOnePanel', 'Add at least one panel to save.')}
          </p>
        )}

        {panels.length < MAX_PANELS_PER_VIEW ? (
          <Button type="button" variant="outline" onClick={handleAddPanel} className="mt-3 min-h-11">
            {t('viewBuilder.addPanel', '+ Add panel')}
          </Button>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('viewBuilder.maximumPanelsReached', 'Maximum of {{count}} panels reached.', { count: MAX_PANELS_PER_VIEW })}
          </p>
        )}
      </FormSection>

      {/* Live preview pane */}
      <FormSection legend={t('viewBuilder.livePreview', 'Live preview')}>
        <ViewPreview spec={spec} />
      </FormSection>

      {saveError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-sm text-destructive-text"
        >
          {saveError}
        </div>
      )}

      <div data-testid="builder-actions" className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        {saveDisabled && (
          <p className="mr-auto self-center text-sm text-muted-foreground" role="status">
            {nameIsEmpty
              ? t('work:viewBuilder.nameRequiredToSave', 'Enter a view name to save.')
              : noPanel
                ? t('viewBuilder.addAtLeastOnePanel', 'Add at least one panel to save.')
                : t('work:viewBuilder.saving', 'Saving…')}
          </p>
        )}
        <Button type="button" variant="ghost" className="min-h-11" onClick={leaveBuilder}>
          {t('viewBuilder.cancel', 'Cancel')}
        </Button>
        <Button
          type="button"
          variant="primary"
          className="min-h-11"
          disabled={saveDisabled}
          aria-disabled={saveDisabled}
          onClick={handleSave}
        >
          {mode === 'create' ? t('viewBuilder.saveView', 'Save view') : t('viewBuilder.updateView', 'Update view')}
        </Button>
      </div>

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

      {/* AI Composer modal (FR-AS-015, AC-AS-013, AC-AS-017, AC-AS-018) */}
      {isFeatureEnabled('userViews') && isFeatureEnabled('aiComposer') && (
        <AIComposerModal
          open={aiComposerOpen}
          onClose={() => setAIComposerOpen(false)}
          onComposed={handleComposed}
        />
      )}

      {/* Dirty-discard confirm (FR-VB-063, OD-VB-8) */}
      <ConfirmDialog
        open={showDiscardDialog}
        tone="destructive"
        title={t('viewBuilder.discardChangesTitle', 'Discard unsaved changes?')}
        description={t('viewBuilder.discardChangesDescription', 'Your view details and panel configuration will be lost.')}
        confirmLabel={t('viewBuilder.discard', 'Discard')}
        cancelLabel={t('viewBuilder.keepEditing', 'Keep editing')}
        onConfirm={() => {
          setShowDiscardDialog(false);
          navigate(mode === 'edit' && viewId ? `/views/${viewId}` : '/views');
        }}
        onCancel={() => {
          setShowDiscardDialog(false);
        }}
      />
    </div>
  );
};

export default ViewBuilderPage;
