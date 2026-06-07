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

describe('useEntityForm: validate-on-blur (not per keystroke)', () => {
  it('does NOT surface an error on setValue alone', () => {
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    act(() => result.current.setValue('name', ''));
    expect(result.current.errors.name).toBeUndefined();
  });

  it('surfaces the field error only after blur, and clears it once valid + re-blurred', () => {
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    act(() => result.current.handleBlur('name'));
    expect(result.current.errors.name).toBe('Opportunity name is required.');

    act(() => result.current.setValue('name', 'Harborside'));
    act(() => result.current.handleBlur('name'));
    expect(result.current.errors.name).toBeUndefined();
  });

  it('typing a valid value LIVE-clears an already-shown field error (no extra blur needed)', () => {
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    // Surface the error via blur.
    act(() => result.current.handleBlur('name'));
    expect(result.current.errors.name).toBe('Opportunity name is required.');

    // Typing a value that satisfies the validator clears the error live.
    act(() => result.current.setValue('name', 'Harborside'));
    expect(result.current.errors.name).toBeUndefined();
  });

  it('setValue updater is PURE — no React warning under StrictMode (no setState inside a setState updater)', () => {
    // StrictMode double-invokes updaters; a setState nested inside another
    // setState's updater surfaces as a console.error here. A pure updater stays clean.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }), {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      });
      act(() => result.current.handleBlur('name'));
      // The setValue that live-clears the already-shown error must not warn.
      act(() => result.current.setValue('name', 'Harborside'));
      expect(result.current.errors.name).toBeUndefined();
      expect(spy).not.toHaveBeenCalled();
    } finally {
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

  it('exposes fieldProps wiring id/value/onChange/onBlur/aria-invalid for a field', () => {
    const { result } = renderHook(() => useEntityForm({ initialValues: init, validate }));
    act(() => result.current.handleBlur('name'));
    const fp = result.current.fieldProps('name');
    expect(fp.value).toBe('');
    expect(fp.error).toBe('Opportunity name is required.');
    expect(typeof fp.onChange).toBe('function');
    expect(typeof fp.onBlur).toBe('function');
  });
});
