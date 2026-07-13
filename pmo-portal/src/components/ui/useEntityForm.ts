import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackFormValidationFailed, trackSaveFailed } from '@/src/lib/analytics';

/**
 * `useEntityForm` — the tiny controlled-form + per-field validation helper that
 * backs every CRUD form (crud-components §2.3). No new dependency.
 *
 * Behavior contract:
 *  - Tracks `values`, `errors`, `touched`, `hasAttemptedSubmit`, `isDirty`,
 *    `isSubmitting`.
 *  - **Validate on blur** (not per keystroke): `setValue` never surfaces an
 *    error; `handleBlur(field)` runs `validate` and shows only that field's
 *    error (existing errors on other touched fields are preserved).
 *  - **Validate on submit**: `handleSubmit(onValid)` validates every field,
 *    marks `hasAttemptedSubmit`, and only calls `onValid(values)` when the
 *    error map is empty; `isSubmitting` brackets an async `onValid`.
 *  - `fieldProps(field)` returns the props a `<TextField>`/`<Combobox>`
 *    consumes ({ id, value, onChange, onBlur, error }).
 */

export type ValidateFn<T> = (values: T) => Partial<Record<keyof T, string>>;

export interface UseEntityFormOptions<T> {
  initialValues: T;
  /** Pure synchronous validator returning a sparse error map. */
  validate?: ValidateFn<T>;
  /** Optional id prefix so field ids are stable + unique across forms. */
  idPrefix?: string;
  /**
   * F8 (AC-IXD-FORM-F8): the fields that must be present for the form to submit.
   * Drives `isComplete` (the submit-disabled gate). A required string field is
   * satisfied when non-blank (trimmed); any other type when non-null/undefined.
   * Independent of `validate` — a non-blank-but-invalid value keeps `isComplete`
   * true so a submit can still fire, surface the format error, and move focus.
   */
  requiredFields?: (keyof T)[];
  /**
   * Analytics context for `form_validation_failed` (fired from `handleSubmit`'s
   * validation-fail branch) and `save_failed` (fired from `handleSubmit`'s catch
   * when the caller's `onValid` rejects — 2026-07-13 wiring plan). Both are
   * OPT-IN: omitting `module` (and, for `save_failed`, `entityType`) simply skips
   * tracking, so existing forms that don't pass it are unaffected.
   */
  module?: string;
  /** Required for `save_failed` in addition to `module`; unused otherwise. */
  entityType?: string;
}

export interface FieldProps<V> {
  id: string;
  value: V;
  error?: string;
  onChange: (next: V) => void;
  onBlur: () => void;
}

export interface UseEntityForm<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  hasAttemptedSubmit: boolean;
  isDirty: boolean;
  isSubmitting: boolean;
  /** No outstanding validation errors against the current values. */
  canSubmit: boolean;
  /**
   * F8: every `requiredFields` entry is present (non-blank). Drives the
   * submit-disabled gate. True when no `requiredFields` were given (opt-in).
   * Independent of `canSubmit` — format errors do not flip this false.
   */
  isComplete: boolean;
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  setValues: (next: Partial<T>) => void;
  handleBlur: (field: keyof T) => void;
  /**
   * `operation` (e.g. 'create' | 'update' | 'archive' | 'delete') is optional
   * context for `save_failed` — passed through verbatim as the event's
   * `operation` prop when `onValid` rejects. Defaults to `'save'` when omitted.
   */
  handleSubmit: (
    onValid: (values: T) => void | Promise<void>,
    operation?: string,
  ) => Promise<void>;
  reset: (next?: T) => void;
  fieldProps: <K extends keyof T>(field: K) => FieldProps<T[K]>;
}

let formSeq = 0;

export function useEntityForm<T extends object>({
  initialValues,
  validate,
  idPrefix,
  requiredFields,
  module,
  entityType,
}: UseEntityFormOptions<T>): UseEntityForm<T> {
  const [values, setValuesState] = useState<T>(initialValues);
  // `surfacedErrors` is the *committed* error map (set on blur/submit). What the
  // UI shows is derived: a surfaced error is suppressed the moment the live
  // values pass validation for that field — so we never re-validate inside a
  // values updater (keeps `setValue` a pure values-only setState).
  const [surfacedErrors, setSurfacedErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSubmitting, setSubmitting] = useState(false);

  // Stable id prefix for this form instance (deterministic, no per-render churn).
  const prefixRef = useRef(idPrefix ?? `ef-${++formSeq}`);
  const initialRef = useRef(initialValues);
  const interactionReadyRef = useRef(false);

  const runValidate = useCallback(
    (v: T): Partial<Record<keyof T, string>> => (validate ? validate(v) : {}),
    [validate],
  );

  // Ignore blur events fired during mount-time focus choreography (notably the
  // React StrictMode double-effect cleanup in dev). Real user interaction only
  // begins once the first task after mount has elapsed.
  useEffect(() => {
    interactionReadyRef.current = false;
    const timer = window.setTimeout(() => {
      interactionReadyRef.current = true;
    }, 0);
    return () => {
      window.clearTimeout(timer);
      interactionReadyRef.current = false;
    };
  }, []);

  // The live validation result for the current values (memoized per values change).
  const liveErrors = useMemo(() => runValidate(values), [runValidate, values]);

  // What the UI shows: a *surfaced* error, but only while the field still fails
  // live validation. The instant a keystroke makes the field valid, its error is
  // suppressed here — a pure derivation, no setState inside a values updater.
  const errors = useMemo(() => {
    const out: Partial<Record<keyof T, string>> = {};
    for (const k of Object.keys(surfacedErrors) as (keyof T)[]) {
      const msg = surfacedErrors[k];
      const mayDisplay = touched[k] || hasAttemptedSubmit;
      // Keep showing only if the field is still invalid live AND the field was
      // user-touched or the user has tried to submit the form.
      if (msg && liveErrors[k] && mayDisplay) out[k] = msg;
    }
    return out;
  }, [surfacedErrors, liveErrors, touched, hasAttemptedSubmit]);

  // Pure values-only updater — never schedules a sibling setState.
  const setValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValuesState((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setValues = useCallback((next: Partial<T>) => {
    setValuesState((prev) => ({ ...prev, ...next }));
  }, []);

  const handleBlur = useCallback(
    (field: keyof T) => {
      if (!interactionReadyRef.current) return;
      setTouched((prev) => ({ ...prev, [field]: true }));
      const fieldErrors = runValidate(values);
      setSurfacedErrors((prev) => {
        const next = { ...prev };
        if (fieldErrors[field]) next[field] = fieldErrors[field];
        else delete next[field];
        return next;
      });
    },
    [runValidate, values],
  );

  const handleSubmit = useCallback(
    async (onValid: (values: T) => void | Promise<void>, operation?: string) => {
      const allErrors = runValidate(values);
      setHasAttemptedSubmit(true);
      setSurfacedErrors(allErrors);
      const errorKeys = Object.keys(allErrors);
      if (errorKeys.length > 0) {
        if (module) {
          trackFormValidationFailed(prefixRef.current, errorKeys.length, 'validation', module);
        }
        return;
      }

      setSubmitting(true);
      try {
        await onValid(values);
      } catch (err) {
        // save_failed (2026-07-13 wiring plan): opt-in — only fires when the caller
        // supplied `module`+`entityType`. `reason_code` mirrors classifyMutationError's
        // own structural `.code` extraction (AppError/PostgREST-shaped errors), but
        // this hook stays decoupled from that lib — it only needs a safe enum-ish
        // code, not the human headline/detail.
        if (module && entityType) {
          const code =
            typeof (err as { code?: unknown })?.code === 'string'
              ? (err as { code: string }).code
              : 'unknown';
          trackSaveFailed(entityType, operation ?? 'save', code, module);
        }
        throw err;
      } finally {
        setSubmitting(false);
      }
    },
    [runValidate, values, module, entityType],
  );

  const reset = useCallback((next?: T) => {
    const target = next ?? initialRef.current;
    initialRef.current = target;
    setValuesState(target);
    setSurfacedErrors({});
    setTouched({});
    setHasAttemptedSubmit(false);
    setSubmitting(false);
  }, []);

  const isDirty = useMemo(() => {
    const init = initialRef.current;
    return (Object.keys(values) as (keyof T)[]).some((k) => values[k] !== init[k]);
  }, [values]);

  const canSubmit = useMemo(() => Object.keys(liveErrors).length === 0, [liveErrors]);

  // F8: every required field is present. A string must be non-blank (trimmed);
  // any other value must be non-null/undefined. `requiredFields` may be an inline
  // array (new identity per render), so key the memo on its joined contents.
  const requiredKey = (requiredFields ?? []).join(' ');
  const isComplete = useMemo(() => {
    if (!requiredFields || requiredFields.length === 0) return true;
    return requiredFields.every((k) => {
      const v = values[k];
      if (typeof v === 'string') return v.trim().length > 0;
      return v !== null && v !== undefined;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, requiredKey]);

  const fieldProps = useCallback(
    <K extends keyof T>(field: K): FieldProps<T[K]> => ({
      id: `${prefixRef.current}-${String(field)}`,
      value: values[field],
      error: errors[field],
      onChange: (next: T[K]) => setValue(field, next),
      onBlur: () => handleBlur(field),
    }),
    [values, errors, setValue, handleBlur],
  );

  return {
    values,
    errors,
    touched,
    hasAttemptedSubmit,
    isDirty,
    isSubmitting,
    canSubmit,
    isComplete,
    setValue,
    setValues,
    handleBlur,
    handleSubmit,
    reset,
    fieldProps,
  };
}
