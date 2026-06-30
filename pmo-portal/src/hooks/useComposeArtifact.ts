/**
 * useComposeArtifact — client re-validation + save state for a compose_view artifact.
 * FR-CV-012, AC-CV-006, AC-CV-007, FR-CV-018/019/020.
 *
 * Responsibilities:
 * - Client-side re-validate the spec via compileCompositionSpec (defense-in-depth, ADR-0039)
 * - Expose compiledPanels when valid, validationError when not
 * - Manage save state (idle → saving → saved | error)
 * - Route save through useUserViewMutations (I4 path, RLS stamps org_id/owner)
 *
 * Port isolation (NFR-CV-SEC-007): imports only from src/lib/viewspec/* and
 * src/hooks/useUserViews. No adapter, no edge-fn client.
 */
import { useMemo, useState } from 'react';
import { compileCompositionSpec } from '@/src/lib/viewspec/compiler';
import { ValidationError } from '@/src/lib/viewspec/types';
import type { CompiledPanel, CompositionSpec } from '@/src/lib/viewspec/types';
import { useUserViewMutations } from '@/src/hooks/useUserViews';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

export interface UseComposeArtifactResult {
  /** Non-null when the spec passes client-side re-validation. */
  compiledPanels: CompiledPanel[] | null;
  /** Non-null when the spec fails client-side re-validation (defense-in-depth). */
  validationError: ValidationError | null;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  savedViewId: string | null;
  /** Call to persist the composed view to user_views. Never called automatically (FR-CV-019). */
  save: (name: string, scope?: 'private' | 'shared_org') => Promise<void>;
}

/**
 * Manages client-side re-validation and panel-save state for a single compose_view
 * artifact event. Re-validates the spec on every render (pure useMemo — no effect).
 * Save is never automatic: the user MUST call save() explicitly (FR-CV-019).
 */
export function useComposeArtifact(spec: CompositionSpec): UseComposeArtifactResult {
  const { currentUser } = useAuth();
  const { create } = useUserViewMutations();

  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedViewId, setSavedViewId] = useState<string | null>(null);

  // Client-side re-validate the spec (defense-in-depth, ADR-0039 decision 3).
  // useMemo: pure, synchronous, no effects needed — same spec → same result.
  const { compiledPanels, validationError } = useMemo(() => {
    try {
      const ctx = {
        userId: currentUser?.id ?? '',
        orgId: currentUser?.org_id ?? '',
      };
      const panels = compileCompositionSpec(spec, ctx);
      return { compiledPanels: panels, validationError: null };
    } catch (err) {
      if (err instanceof ValidationError) {
        return { compiledPanels: null, validationError: err };
      }
      // Unexpected error — treat as validation failure (unknown error).
      return {
        compiledPanels: null,
        validationError: new ValidationError('UNSUPPORTED_VERSION', String(err)),
      };
    }
  }, [spec, currentUser]);

  const save = async (name: string, scope: 'private' | 'shared_org' = 'private'): Promise<void> => {
    setSaveStatus('saving');
    setSaveError(null);
    try {
      // Cast spec to the opaque Json type the DAL accepts (FR-UV-004: stored verbatim).
      const row = await create.mutateAsync({ name, spec: spec as unknown as Parameters<typeof create.mutateAsync>[0]['spec'], scope });
      setSavedViewId(row.id);
      setSaveStatus('saved');
    } catch (err) {
      const { headline } = classifyMutationError(err);
      setSaveError(headline);
      setSaveStatus('error');
    }
  };

  return { compiledPanels, validationError, saveStatus, saveError, savedViewId, save };
}
