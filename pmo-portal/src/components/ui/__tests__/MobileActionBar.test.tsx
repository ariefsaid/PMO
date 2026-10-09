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

  it('#953 keeps a shorter bar published when the tallest bar is hidden', () => {
    render(
      <>
        <MobileActionBar data-testid="short-bar">Short</MobileActionBar>
        <MobileActionBar data-testid="tall-bar">Tall</MobileActionBar>
      </>,
    );
    const shortBar = screen.getByTestId('short-bar');
    const tallBar = screen.getByTestId('tall-bar');
    vi.spyOn(shortBar, 'getBoundingClientRect').mockReturnValue({ height: 64 } as DOMRect);
    vi.spyOn(tallBar, 'getBoundingClientRect').mockReturnValue({ height: 88 } as DOMRect);

    act(() => {
      TestResizeObserver.instances[0].trigger(shortBar);
      TestResizeObserver.instances[1].trigger(tallBar);
    });
    expect(document.documentElement.style.getPropertyValue('--mobile-action-bar-height')).toBe('88px');

    vi.spyOn(tallBar, 'getBoundingClientRect').mockReturnValue({ height: 0 } as DOMRect);
    act(() => TestResizeObserver.instances[1].trigger(tallBar));
    expect(document.documentElement.style.getPropertyValue('--mobile-action-bar-height')).toBe('64px');
  });

  it('#953 republishes the remaining maximum when the tallest bar unmounts', () => {
    const view = render(
      <>
        <MobileActionBar data-testid="remaining-bar">Remaining</MobileActionBar>
        <MobileActionBar data-testid="removed-bar">Removed</MobileActionBar>
      </>,
    );
    const remainingBar = screen.getByTestId('remaining-bar');
    const removedBar = screen.getByTestId('removed-bar');
    vi.spyOn(remainingBar, 'getBoundingClientRect').mockReturnValue({ height: 64 } as DOMRect);
    vi.spyOn(removedBar, 'getBoundingClientRect').mockReturnValue({ height: 88 } as DOMRect);

    act(() => {
      TestResizeObserver.instances[0].trigger(remainingBar);
      TestResizeObserver.instances[1].trigger(removedBar);
    });
    expect(document.documentElement.style.getPropertyValue('--mobile-action-bar-height')).toBe('88px');

    view.rerender(<MobileActionBar data-testid="remaining-bar">Remaining</MobileActionBar>);
    expect(document.documentElement.style.getPropertyValue('--mobile-action-bar-height')).toBe('64px');
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
