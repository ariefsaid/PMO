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
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setSubmitting] = useState(false);

  // Stable id prefix for this form instance (deterministic, no per-render churn).
  const prefixRef = useRef(idPrefix ?? `ef-${++formSeq}`);
  const initialRef = useRef(initialValues);

  const runValidate = useCallback(
    (v: T): Partial<Record<keyof T, string>> => (validate ? validate(v) : {}),
    [validate],
  );

  const setValue = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValuesState((prev) => {
        const next: T = { ...prev, [field]: value };
        // If the field already showed an error, clear it live so the user sees
        // their fix take effect (re-validated fully on the next blur/submit).
        setErrors((prevErrors) => {
          if (!prevErrors[field]) return prevErrors;
          const fieldErrors = runValidate(next);
          if (fieldErrors[field]) return prevErrors;
          const { [field]: _drop, ...rest } = prevErrors;
          return rest as Partial<Record<keyof T, string>>;
        });
        return next;
      });
    },
    [runValidate],
  );

  const setValues = useCallback((next: Partial<T>) => {
    setValuesState((prev) => ({ ...prev, ...next }));
  }, []);

  const handleBlur = useCallback(
    (field: keyof T) => {
      setTouched((prev) => ({ ...prev, [field]: true }));
      setValuesState((current) => {
        const fieldErrors = runValidate(current);
        setErrors((prev) => {
          const next = { ...prev };
          if (fieldErrors[field]) next[field] = fieldErrors[field];
          else delete next[field];
          return next;
        });
        return current;
      });
    },
    [runValidate],
  );

  const handleSubmit = useCallback(
    async (onValid: (values: T) => void | Promise<void>) => {
      const allErrors = runValidate(values);
      const allTouched = Object.keys(values).reduce(
        (acc, k) => ({ ...acc, [k]: true }),
        {} as Partial<Record<keyof T, boolean>>,
      );
      setTouched(allTouched);
      setErrors(allErrors);
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
    setErrors({});
    setTouched({});
    setSubmitting(false);
  }, []);

  const isDirty = useMemo(() => {
    const init = initialRef.current;
    return (Object.keys(values) as (keyof T)[]).some((k) => values[k] !== init[k]);
  }, [values]);

  const canSubmit = useMemo(
    () => Object.keys(runValidate(values)).length === 0,
    [runValidate, values],
  );

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
