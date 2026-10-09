/**
 * #879 — Tabs keyboard contract (WAI-ARIA tabs pattern, automatic activation).
 *
 * The component-level contract for arrow-key tab navigation: focus FOLLOWS the
 * activation (roving tabindex) and the full key set is supported — ArrowRight,
 * ArrowLeft (with wrap-around), Home, End. ProjectDetail.tabFocus.test.tsx owns
 * the user-journey AC; this file pins the component contract all Tabs consumers get.
 *
 * Owning layer: Vitest/RTL — pure FE component, no DB required.
 */
import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../Tabs';

const ITEMS = [
  { value: 'overview', label: 'Overview' },
  { value: 'budget', label: 'Budget' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'work-orders', label: 'Work orders' },
  { value: 'billing', label: 'Billing' },
  { value: 'documents', label: 'Documents' },
  { value: 'history', label: 'History' },
] as const;

/** Stateful wrapper mirroring real usage (ProjectDetail wires value to the URL). */
function Harness({ onChange, initialValue = 'overview' }: { onChange?: (v: string) => void; initialValue?: string }) {
  const [value, setValue] = useState<string>(initialValue);
  return (
    <Tabs
      items={[...ITEMS]}
      value={value}
      onChange={(v) => {
        onChange?.(v);
        setValue(v);
      }}
      ariaLabel="Project sections"
      idBase="proj"
    />
  );
}

const tabNames = () =>
  screen.getByRole('tablist', { name: 'Project sections' })
    .querySelectorAll('[role="tab"]');
// toContainElement's matcher param is typed for HTMLElement — narrow activeElement.
const activeEl = () => document.activeElement as HTMLElement | null;

describe('#879 Tabs keyboard contract (WAI-ARIA tabs pattern)', () => {
  it('AC #879: ArrowRight activates the next tab and focus moves to it, staying in the tab bar', () => {
    render(<Harness />);
    const tabs = tabNames();
    (tabs[0] as HTMLElement).focus();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });

    // Activation moved…
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveAttribute('aria-selected', 'true');
    // …and DOM focus followed it (roving tabindex) — still inside the tab bar.
    expect(screen.getByRole('tab', { name: 'Budget' })).toHaveFocus();
    expect(screen.getByRole('tablist', { name: 'Project sections' })).toContainElement(
      activeEl(),
    );
  });

  it('AC #879: modified ArrowRight does not intercept browser navigation shortcuts', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight', altKey: true });
    fireEvent.keyDown(overview, { key: 'ArrowRight', metaKey: true });
    fireEvent.keyDown(overview, { key: 'ArrowRight', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(overview).toHaveAttribute('aria-selected', 'true');
    expect(overview).toHaveFocus();
  });

  it('AC #879: ArrowLeft activates the previous tab and focus moves to it', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    // Real journey: focus starts on the ACTIVE tab, one ArrowRight lands on Budget,
    // then ArrowLeft walks back to Overview.
    (tabNames()[0] as HTMLElement).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Budget' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('AC #879: ArrowRight on the last tab wraps to the first tab (and keeps focus in the bar)', () => {
    // Deep-link state: /projects/p1/history — active tab is the LAST tab.
    render(<Harness initialValue="history" />);
    (tabNames()[tabNames().length - 1] as HTMLElement).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('AC #879: ArrowLeft on the first tab wraps to the last tab', () => {
    render(<Harness />);
    (tabNames()[0] as HTMLElement).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();
  });

  it('AC #879: Home activates the first tab (WAI-ARIA tabs pattern)', () => {
    render(<Harness />);
    const tabs = tabNames();
    (tabs[3] as HTMLElement).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Tasks' }), { key: 'Home' });
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
  });

  it('AC #879: End activates the last tab (WAI-ARIA tabs pattern)', () => {
    render(<Harness />);
    const tabs = tabNames();
    (tabs[0] as HTMLElement).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Overview' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'History' })).toHaveFocus();
  });

  it('AC #879: a run of ArrowRight presses walks the whole bar — focus never leaves the tab list', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    (tabNames()[0] as HTMLElement).focus();
    const list = screen.getByRole('tablist', { name: 'Project sections' });
    const labels = ITEMS.map((i) => i.label);
    for (let step = 1; step < ITEMS.length; step++) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
      const expected = screen.getByRole('tab', { name: labels[step] });
      expect(expected).toHaveAttribute('aria-selected', 'true');
      expect(expected).toHaveFocus();
      expect(list).toContainElement(activeEl());
    }
    expect(onChange).toHaveBeenCalledTimes(ITEMS.length - 1);
  });
});
