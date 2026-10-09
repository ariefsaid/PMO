import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { MobileActionBar } from '../MobileActionBar';
import { ToastProvider, useToast } from '../Toast';

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  constructor(private readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  trigger(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

const ToastTrigger: React.FC = () => {
  const { toast } = useToast();
  return <button onClick={() => toast('Needs attention', 'Review this item', 'warning')}>Show warning</button>;
};

describe('MobileActionBar #953', () => {
  const priorResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

  beforeEach(() => {
    TestResizeObserver.instances = [];
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: TestResizeObserver,
    });
  });

  afterEach(() => {
    document.documentElement.style.removeProperty('--mobile-action-bar-height');
    if (priorResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', priorResizeObserver);
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });

  it('#953 publishes the tallest active bar, offsets persistent toasts, tracks resizing, and clears on unmount', () => {
    const view = render(
      <ToastProvider>
        <MobileActionBar data-testid="first-bar">First action</MobileActionBar>
        <MobileActionBar data-testid="second-bar">Second action</MobileActionBar>
        <ToastTrigger />
      </ToastProvider>,
    );
    const [first, second] = [screen.getByTestId('first-bar'), screen.getByTestId('second-bar')];
    const firstHeight = 64;
    let secondHeight = 88;
    vi.spyOn(first, 'getBoundingClientRect').mockImplementation(() => ({ height: firstHeight }) as DOMRect);
    vi.spyOn(second, 'getBoundingClientRect').mockImplementation(() => ({ height: secondHeight }) as DOMRect);

    act(() => {
      TestResizeObserver.instances[0].trigger(first);
      TestResizeObserver.instances[1].trigger(second);
    });
    expect(document.documentElement.style.getPropertyValue('--mobile-action-bar-height')).toBe('88px');

    act(() => screen.getByRole('button', { name: 'Show warning' }).click());
    const toast = document.querySelector('[data-toast="visible"]') as HTMLElement;
    expect(toast).toHaveTextContent('Needs attention');
    expect(toast.parentElement).toHaveClass('max-w-[min(360px,calc(100vw-40px))]');
    expect(toast.parentElement?.parentElement?.parentElement).toHaveStyle({
      transform: 'translateY(calc(0px - var(--mobile-action-bar-height, 0px)))',
    });

    secondHeight = 112;
    act(() => TestResizeObserver.instances[1].trigger(second));
    expect(document.documentElement.style.getPropertyValue('--mobile-action-bar-height')).toBe('112px');

    view.unmount();
    expect(document.documentElement.style.getPropertyValue('--mobile-action-bar-height')).toBe('');
  });
});
