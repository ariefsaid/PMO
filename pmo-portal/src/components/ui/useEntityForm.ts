import { useCallback, useMemo, useRef, useState } from 'react';

/**
 * `useEntityForm` — the tiny controlled-form + per-field validation helper that
 * backs every CRUD form (crud-components §2.3). No new dependency.
 *
 * Behavior contract:
 *  - Tracks `values`, `errors`, `touched`, `isDirty`, `isSubmitting`.
 *  - **Validate on blur** (not per keystroke): `setValue` never surfaces an
 *    error; `handleBlur(field)` runs `validate` and shows only that field's
 *    error (existing errors on other touched fields are preserved).
 *  - **Validate on submit**: `handleSubmit(onValid)` validates every field,
 *    marks all touched, and only calls `onValid(values)` when the error map is
 *    empty; `isSubmitting` brackets an async `onValid`.
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
  isDirty: boolean;
  isSubmitting: boolean;
  /** No outstanding validation errors against the current values. */
  canSubmit: boolean;
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  setValues: (next: Partial<T>) => void;
  handleBlur: (field: keyof T) => void;
  handleSubmit: (onValid: (values: T) => void | Promise<void>) => Promise<void>;
  reset: (next?: T) => void;
  fieldProps: <K extends keyof T>(field: K) => FieldProps<T[K]>;
}

let formSeq = 0;

export function useEntityForm<T extends object>({
  initialValues,
  validate,
  idPrefix,
}: UseEntityFormOptions<T>): UseEntityForm<T> {
  const [values, setValuesState] = useState<T>(initialValues);
  // `surfacedErrors` is the *committed* error map (set on blur/submit). What the
  // UI shows is derived: a surfaced error is suppressed the moment the live
  // values pass validation for that field — so we never re-validate inside a
  // values updater (keeps `setValue` a pure values-only setState).
  const [surfacedErrors, setSurfacedErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setSubmitting] = useState(false);

  // Stable id prefix for this form instance (deterministic, no per-render churn).
  const prefixRef = useRef(idPrefix ?? `ef-${++formSeq}`);
  const initialRef = useRef(initialValues);

  const runValidate = useCallback(
    (v: T): Partial<Record<keyof T, string>> => (validate ? validate(v) : {}),
    [validate],
  );

  // The live validation result for the current values (memoized per values change).
  const liveErrors = useMemo(() => runValidate(values), [runValidate, values]);

  // What the UI shows: a *surfaced* error, but only while the field still fails
  // live validation. The instant a keystroke makes the field valid, its error is
  // suppressed here — a pure derivation, no setState inside a values updater.
  const errors = useMemo(() => {
    const out: Partial<Record<keyof T, string>> = {};
    for (const k of Object.keys(surfacedErrors) as (keyof T)[]) {
      const msg = surfacedErrors[k];
      // Keep showing only if the field is still invalid live.
      if (msg && liveErrors[k]) out[k] = msg;
    }
    return out;
  }, [surfacedErrors, liveErrors]);

  // Pure values-only updater — never schedules a sibling setState.
  const setValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValuesState((prev) => ({ ...prev, [field]: value }));
  }, []);

  const setValues = useCallback((next: Partial<T>) => {
    setValuesState((prev) => ({ ...prev, ...next }));
  }, []);

  const handleBlur = useCallback(
    (field: keyof T) => {
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
    async (onValid: (values: T) => void | Promise<void>) => {
      const allErrors = runValidate(values);
      const allTouched = Object.keys(values).reduce(
        (acc, k) => ({ ...acc, [k]: true }),
        {} as Partial<Record<keyof T, boolean>>,
      );
      setTouched(allTouched);
      setSurfacedErrors(allErrors);
      if (Object.keys(allErrors).length > 0) return;

      setSubmitting(true);
      try {
        await onValid(values);
      } finally {
        setSubmitting(false);
      }
    },
    [runValidate, values],
  );

  const reset = useCallback((next?: T) => {
    const target = next ?? initialRef.current;
    initialRef.current = target;
    setValuesState(target);
    setSurfacedErrors({});
    setTouched({});
    setSubmitting(false);
  }, []);

  const isDirty = useMemo(() => {
    const init = initialRef.current;
    return (Object.keys(values) as (keyof T)[]).some((k) => values[k] !== init[k]);
  }, [values]);

  const canSubmit = useMemo(() => Object.keys(liveErrors).length === 0, [liveErrors]);

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
    isDirty,
    isSubmitting,
    canSubmit,
    setValue,
    setValues,
    handleBlur,
    handleSubmit,
    reset,
    fieldProps,
  };
}
