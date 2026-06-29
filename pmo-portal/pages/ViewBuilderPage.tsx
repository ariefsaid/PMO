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
 * src/auth/, src/components/ui/, src/lib/classifyMutationError, react-router-dom.
 * Does NOT import from src/lib/db/* or src/lib/supabase/client.
 *
 * Test-only escape hatch: __testPanels?: PanelSpec[] — seeds the panel list in RTL tests
 * without requiring modal interaction. Undefined in production usage.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useBlocker } from 'react-router-dom';
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
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { ValidationError } from '@/src/lib/viewspec/types';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import type { PanelSpec, CompositionSpec } from '@/src/lib/viewspec/types';
import PanelEditorForm from '@/src/components/builder/PanelEditorForm';
import PanelList from '@/src/components/builder/PanelList';
import ViewPreview from '@/src/components/builder/ViewPreview';

/** Maximum panels per view — mirrors UserViewRenderer's constant (FR-VB-038). */
const MAX_PANELS_PER_VIEW = 20;

export interface ViewBuilderPageProps {
  mode: 'create' | 'edit';
  /** TEST ONLY: seeds the panel list without requiring modal interaction. */
  __testPanels?: PanelSpec[];
}

const SCOPE_OPTIONS: SelectOption[] = [
  { value: 'private', label: 'Private — only you' },
  { value: 'shared_org', label: 'Shared with your organisation' },
];

const ViewBuilderPage: React.FC<ViewBuilderPageProps> = ({ mode, __testPanels }) => {
  const navigate = useNavigate();
  const params = useParams<{ viewId: string }>();
  const viewId = mode === 'edit' ? (params.viewId ?? '') : undefined;

  const { currentUser } = useAuth();
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

  // useBlocker fires when the user navigates away with unsaved changes (OD-VB-8)
  const blocker = useBlocker(isDirty && !isSaving);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setShowDiscardDialog(true);
    }
  }, [blocker.state]);

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
        toast('View created', name, 'success');
        navigate(`/views/${row.id}`);
      } else if (mode === 'edit' && viewId) {
        await update.mutateAsync({ id: viewId, input });
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

  // ── Edit-mode guard states (FR-VB-071/072) ───────────────────────────────
  if (mode === 'edit' && viewLoading) {
    return (
      <div className="flex flex-col gap-4 p-6" aria-busy="true">
        <div aria-hidden className="skel h-7 w-2/5 rounded" />
        <div aria-hidden className="skel h-5 w-3/5 rounded" />
      </div>
    );
  }

  if (mode === 'edit' && !viewLoading && (!existingView || existingView.archived_at !== null)) {
    return (
      <ListState
        variant="empty"
        title="View not found."
        sub="This view may have been archived or you don't have access."
        action={{ label: 'Go to My Views', onClick: () => navigate('/views') }}
      />
    );
  }

  const pageTitle = mode === 'create' ? 'New View' : `Edit: ${existingView?.name ?? ''}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-[24px] font-bold tracking-[-0.02em]">{pageTitle}</h1>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              if (isDirty) setShowDiscardDialog(true);
              else navigate('/views');
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saveDisabled}
            aria-disabled={saveDisabled}
            onClick={handleSave}
          >
            {mode === 'create' ? 'Save view' : 'Update view'}
          </Button>
        </div>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/[0.07] px-3.5 py-3 text-[13px] text-destructive"
        >
          {saveError}
        </div>
      )}

      {/* Metadata section */}
      <FormSection legend="View details">
        <FormGrid>
          <TextField
            label="View name"
            required
            aria-required="true"
            value={name}
            onChange={setName}
            maxLength={120}
          />
          <TextArea
            label="Description"
            value={description}
            onChange={setDescription}
          />
          <SelectField
            label="Scope"
            value={scope}
            options={SCOPE_OPTIONS}
            onChange={(v) => setScope(v as 'private' | 'shared_org')}
          />
        </FormGrid>
      </FormSection>

      {/* Panel editor section */}
      <FormSection legend="Panels">
        <PanelList
          panels={panels}
          onEdit={handleEditPanel}
          onRemove={handleRemovePanel}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
        />

        {noPanel && (
          <p className="mt-2 text-[12.5px] text-muted-foreground">
            Add at least one panel to save.
          </p>
        )}

        {panels.length < MAX_PANELS_PER_VIEW ? (
          <Button variant="outline" onClick={handleAddPanel} className="mt-3">
            + Add panel
          </Button>
        ) : (
          <p className="mt-3 text-[12.5px] text-muted-foreground">
            Maximum of {MAX_PANELS_PER_VIEW} panels reached.
          </p>
        )}
      </FormSection>

      {/* Live preview pane */}
      <FormSection legend="Live preview">
        <ViewPreview spec={spec} />
      </FormSection>

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

      {/* Dirty-discard confirm (FR-VB-063, OD-VB-8) */}
      <ConfirmDialog
        open={showDiscardDialog}
        tone="destructive"
        title="Discard unsaved changes?"
        description="Your panel configuration and name will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        onConfirm={() => {
          setShowDiscardDialog(false);
          if (blocker.state === 'blocked') blocker.proceed?.();
          else navigate('/views');
        }}
        onCancel={() => {
          setShowDiscardDialog(false);
          if (blocker.state === 'blocked') blocker.reset?.();
        }}
      />
    </div>
  );
};

export default ViewBuilderPage;
