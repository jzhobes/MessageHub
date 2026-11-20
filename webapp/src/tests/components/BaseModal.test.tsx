import React from 'react';

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BaseModal from '@/components/modals/BaseModal';

describe('BaseModal', () => {
  let showModalMock: ReturnType<typeof vi.fn<() => void>>;
  let closeMock: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    showModalMock = vi.fn<() => void>(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    closeMock = vi.fn<() => void>(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    HTMLDialogElement.prototype.showModal = showModalMock;
    HTMLDialogElement.prototype.close = closeMock;
  });

  afterEach(() => {
    cleanup();
  });

  it('attaches cancel listener when opening after mounting closed with a stable onClose', () => {
    const onClose = vi.fn();
    const { rerender, container } = render(
      <BaseModal isOpen={false} dismissible={false} onClose={onClose}>
        <div>Content</div>
      </BaseModal>,
    );

    expect(container.querySelector('dialog')).toBeNull();

    rerender(
      <BaseModal isOpen={true} dismissible={false} onClose={onClose}>
        <div>Content</div>
      </BaseModal>,
    );

    const dialog = container.querySelector('dialog') as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute('closedby')).toBe('none');

    const cancelEvent = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancelEvent);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('re-opens a non-dismissible dialog if the browser force-closes it while isOpen is true', () => {
    const onClose = vi.fn();
    const { container } = render(
      <BaseModal isOpen={true} dismissible={false} onClose={onClose}>
        <div>Content</div>
      </BaseModal>,
    );

    const dialog = container.querySelector('dialog') as HTMLDialogElement;
    expect(showModalMock).toHaveBeenCalledTimes(1);

    // Simulate Chromium CloseWatcher force-closing the native dialog
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));

    expect(onClose).not.toHaveBeenCalled();
    expect(showModalMock).toHaveBeenCalledTimes(2);
    expect(dialog.open).toBe(true);
  });

  it('calls onClose if a dismissible dialog closes natively while isOpen is true', () => {
    const onClose = vi.fn();
    const { container } = render(
      <BaseModal isOpen={true} dismissible={true} onClose={onClose}>
        <div>Content</div>
      </BaseModal>,
    );

    const dialog = container.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.getAttribute('closedby')).toBe('closerequest');
    dialog.removeAttribute('open');
    dialog.dispatchEvent(new Event('close'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
