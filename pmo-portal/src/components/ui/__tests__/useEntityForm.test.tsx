import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { useEntityForm } from '../useEntityForm';

// ---------------------------------------------------------------------------
// useEntityForm — the controlled-form + per-field validation helper that backs
// every CRUD form (crud-components §2.3). Asserts real behavior: value tracking,
// touched/dirty, validate-on-blur, validate-on-submit, submit gating.
// ---------------------------------------------------------------------------

interface Deal {
  name: string;
  value: string;
}

const validate = (values: Deal) => {
  const errors: Partial<Record<keyof Deal, string>> = {};
  if (!values.name.trim()) errors.name = 'Opportunity name is required.';
  if (values.value && Number.isNaN(Number(values.value.replace(/,/g, ''))))
    errors.value = 'Enter a valid number.';
  return errors;
};

const init: Deal = { name: '', value: '' };

describe('useEntityForm: value + dirty tracking', () => {
  it('tracks values via setValue and reports isDirty once changed', () => {
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    expect(result.current.values.name).toBe('');
    expect(result.current.isDirty).toBe(false);

    act(() => result.current.setValue('name', 'Harborside'));
    expect(result.current.values.name).toBe('Harborside');
    expect(result.current.isDirty).toBe(true);
  });

  it('reset restores initial values and clears errors/touched/dirty', () => {
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    act(() => result.current.setValue('name', 'X'));
    act(() => result.current.handleBlur('name'));
    act(() => result.current.reset());
    expect(result.current.values.name).toBe('');
    expect(result.current.isDirty).toBe(false);
    expect(result.current.errors.name).toBeUndefined();
  });
});

describe('CW-7: pristine-form contract (no eager validation; consistent submit gate)', () => {
  it('CW-7: a freshly-opened form surfaces NO errors on a pristine, untouched form', () => {
    // The standard: validation errors appear only after a field is touched OR submit is
    // attempted — never eagerly on a pristine form (no "Fix 1 field" banner on open).
    const { result } = renderHook(() =>
      useEntityForm({ initialValues: init, validate, requiredFields: ['name'] }),
    );
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.hasAttemptedSubmit).toBe(false);
  });

  it('CW-7: a mount-time blur before the first task does NOT mark the field touched or surface an error', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }), {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      });
      act(() => result.current.handleBlur('name'));
      expect(result.current.touched).toEqual({});
      expect(result.current.errors).toEqual({});

      act(() => {
        vi.runAllTimers();
      });
      act(() => result.current.handleBlur('name'));
      expect(result.current.touched.name).toBe(true);
      expect(result.current.errors.name).toBe('Opportunity name is required.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('CW-7: submit gate is consistent — disabled (isComplete=false) while a required field is blank', () => {
    // Every EntityFormModal form wires submitDisabled={!isComplete}; on a pristine create form
    // with a blank required field that gate is consistently CLOSED (submit disabled).
    const { result } = renderHook(() =>
      useEntityForm({ initialValues: init, validate, requiredFields: ['name'] }),
    );
    expect(result.current.isComplete).toBe(false);
    // Filling the required field opens the gate (submit enabled) — still no eager error before blur.
    act(() => result.current.setValue('name', 'Harborside'));
    expect(result.current.isComplete).toBe(true);
    expect(result.current.errors).toEqual({});
  });
});

describe('useEntityForm: validate-on-blur (not per keystroke)', () => {
  it('does NOT surface an error on setValue alone', () => {
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    act(() => result.current.setValue('name', ''));
    expect(result.current.errors.name).toBeUndefined();
  });

  it('surfaces the field error only after blur, and clears it once valid + re-blurred', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
      act(() => {
        vi.runAllTimers();
      });
      act(() => result.current.handleBlur('name'));
      expect(result.current.errors.name).toBe('Opportunity name is required.');

      act(() => result.current.setValue('name', 'Harborside'));
      act(() => result.current.handleBlur('name'));
      expect(result.current.errors.name).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('typing a valid value LIVE-clears an already-shown field error (no extra blur needed)', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
      act(() => {
        vi.runAllTimers();
      });
      // Surface the error via blur.
      act(() => result.current.handleBlur('name'));
      expect(result.current.errors.name).toBe('Opportunity name is required.');

      // Typing a value that satisfies the validator clears the error live.
      act(() => result.current.setValue('name', 'Harborside'));
      expect(result.current.errors.name).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('setValue updater is PURE — no React warning under StrictMode (no setState inside a setState updater)', () => {
    // StrictMode double-invokes updaters; a setState nested inside another
    // setState's updater surfaces as a console.error here. A pure updater stays clean.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }), {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      });
      act(() => {
        vi.runAllTimers();
      });
      act(() => result.current.handleBlur('name'));
      // The setValue that live-clears the already-shown error must not warn.
      act(() => result.current.setValue('name', 'Harborside'));
      expect(result.current.errors.name).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });
});

describe('useEntityForm: submit gating', () => {
  it('handleSubmit validates ALL fields, blocks onValid, and exposes the full error map + canSubmit=false', async () => {
    const onValid = vi.fn();
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    await act(async () => {
      await result.current.handleSubmit(onValid);
    });
    expect(onValid).not.toHaveBeenCalled();
    expect(result.current.errors.name).toBe('Opportunity name is required.');
    expect(result.current.hasAttemptedSubmit).toBe(true);
    expect(result.current.canSubmit).toBe(false);
  });

  it('handleSubmit calls onValid with values once the form is valid', async () => {
    const onValid = vi.fn();
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    act(() => result.current.setValue('name', 'Harborside'));
    await act(async () => {
      await result.current.handleSubmit(onValid);
    });
    expect(onValid).toHaveBeenCalledWith({ name: 'Harborside', value: '' });
    expect(result.current.canSubmit).toBe(true);
  });

  it('isSubmitting is true while an async onValid is in flight then false after', async () => {
    let resolveFn: () => void = () => {};
    const onValid = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveFn = res;
        }),
    );
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    act(() => result.current.setValue('name', 'Harborside'));
    let submitPromise: Promise<void>;
    act(() => {
      submitPromise = result.current.handleSubmit(onValid);
    });
    expect(result.current.isSubmitting).toBe(true);
    await act(async () => {
      resolveFn();
      await submitPromise;
    });
    expect(result.current.isSubmitting).toBe(false);
  });

  // F8 (AC-IXD-FORM-F8): a `requiredFields` list drives `isComplete` — the
  // submit-disabled gate. isComplete is FALSE while any required field is blank
  // and becomes TRUE once all required fields are non-blank. Crucially it is
  // INDEPENDENT of format errors: a non-blank-but-invalid value keeps isComplete
  // true (so the submit can fire, surface the error, and move focus).
  describe('F8: required-field completeness gate (isComplete)', () => {
    it('AC-IXD-FORM-F8: isComplete is false while a required field is blank, true once filled', () => {
      const { result } = renderHook(() =>
        useEntityForm({ initialValues: init, validate, requiredFields: ['name'] }),
      );
      expect(result.current.isComplete).toBe(false);
      act(() => result.current.setValue('name', 'Harborside'));
      expect(result.current.isComplete).toBe(true);
    });

    it('AC-IXD-FORM-F8: whitespace-only does not satisfy a required string field', () => {
      const { result } = renderHook(() =>
        useEntityForm({ initialValues: init, validate, requiredFields: ['name'] }),
      );
      act(() => result.current.setValue('name', '   '));
      expect(result.current.isComplete).toBe(false);
    });

    it('AC-IXD-FORM-F8: a format error on a non-required field keeps isComplete true (focus path stays reachable)', () => {
      const { result } = renderHook(() =>
        useEntityForm({ initialValues: init, validate, requiredFields: ['name'] }),
      );
      act(() => result.current.setValue('name', 'Harborside'));
      act(() => result.current.setValue('value', 'abc')); // invalid number → live error
      expect(result.current.canSubmit).toBe(false); // there IS a live error
      expect(result.current.isComplete).toBe(true); // but all required fields are present
    });

    it('AC-IXD-FORM-F8: a null FK required field counts as incomplete; a value completes it', () => {
      const { result } = renderHook(() =>
        useEntityForm<{ name: string; clientId: string | null }>({
          initialValues: { name: 'X', clientId: null },
          requiredFields: ['name', 'clientId'],
        }),
      );
      expect(result.current.isComplete).toBe(false);
      act(() => result.current.setValue('clientId', 'c-1'));
      expect(result.current.isComplete).toBe(true);
    });

    it('AC-IXD-FORM-F8: with no requiredFields, isComplete is always true (opt-in gate)', () => {
      const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
      expect(result.current.isComplete).toBe(true);
    });
  });

  it('exposes fieldProps wiring id/value/onChange/onBlur/aria-invalid for a field', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
      act(() => {
        vi.runAllTimers();
      });
      act(() => result.current.handleBlur('name'));
      const fp = result.current.fieldProps('name');
      expect(fp.value).toBe('');
      expect(fp.error).toBe('Opportunity name is required.');
      expect(typeof fp.onChange).toBe('function');
      expect(typeof fp.onBlur).toBe('function');
    } finally {
      vi.useRealTimers();
    }
  });
});
