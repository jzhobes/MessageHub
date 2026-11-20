import React from 'react';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Tooltip from '@/components/Tooltip';

describe('Tooltip', () => {
  let showPopoverMock: ReturnType<typeof vi.fn<() => void>>;
  let hidePopoverMock: ReturnType<typeof vi.fn<() => void>>;
  let originalShowPopoverDesc: PropertyDescriptor | undefined;
  let originalHidePopoverDesc: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalShowPopoverDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'showPopover');
    originalHidePopoverDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidePopover');

    showPopoverMock = vi.fn<() => void>();
    hidePopoverMock = vi.fn<() => void>();
    HTMLElement.prototype.showPopover = showPopoverMock;
    HTMLElement.prototype.hidePopover = hidePopoverMock;
  });

  afterEach(() => {
    cleanup();
    if (originalShowPopoverDesc) {
      Object.defineProperty(HTMLElement.prototype, 'showPopover', originalShowPopoverDesc);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'showPopover');
    }
    if (originalHidePopoverDesc) {
      Object.defineProperty(HTMLElement.prototype, 'hidePopover', originalHidePopoverDesc);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'hidePopover');
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sets popover="hint", calls showPopover() on hover after delay, and hidePopover() on mouse leave', () => {
    render(
      <Tooltip content="Helpful tip" delayMs={160}>
        <button type="button">Hover me</button>
      </Tooltip>,
    );

    const trigger = screen.getByText('Hover me').closest('span')!;
    fireEvent.mouseEnter(trigger);

    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(160);
    });

    // Include hidden elements because our mock showPopover never puts the popover in jsdom's open state.
    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.textContent).toBe('Helpful tip');
    expect(tooltip.getAttribute('popover')).toBe('hint');
    expect(showPopoverMock).toHaveBeenCalledTimes(1);

    fireEvent.mouseLeave(trigger);

    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(hidePopoverMock).toHaveBeenCalledTimes(1);
  });

  it('portals inside an open <dialog open> when the trigger is inside that dialog', () => {
    const { container } = render(
      <dialog open>
        <Tooltip content="Inside dialog" delayMs={100}>
          <button type="button">Modal button</button>
        </Tooltip>
      </dialog>,
    );

    const dialog = container.querySelector('dialog')!;
    const trigger = screen.getByText('Modal button').closest('span')!;
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(dialog.contains(tooltip)).toBe(true);
    expect(tooltip.parentElement).toBe(dialog);
  });

  it('portals into document.body when the trigger is outside any open dialog', () => {
    render(
      <div>
        <Tooltip content="Outside dialog" delayMs={100}>
          <button type="button">Page button</button>
        </Tooltip>
      </div>,
    );

    const trigger = screen.getByText('Page button').closest('span')!;
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(100);
    });

    const tooltip = screen.getByRole('tooltip', { hidden: true });
    expect(tooltip.parentElement).toBe(document.body);
  });

  it('dismisses on mousedown and on Escape keydown', () => {
    render(
      <Tooltip content="Dismissible tip" delayMs={100}>
        <button type="button">Action</button>
      </Tooltip>,
    );

    const trigger = screen.getByText('Action').closest('span')!;

    // Dismiss on mousedown
    fireEvent.mouseEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('tooltip', { hidden: true })).toBeTruthy();

    fireEvent.mouseDown(trigger);
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();

    // Dismiss on Escape keydown
    fireEvent.mouseEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole('tooltip', { hidden: true })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
  });
});
