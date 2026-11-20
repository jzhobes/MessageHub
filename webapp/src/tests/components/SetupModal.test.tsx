import React from 'react';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import SetupModal from '@/components/modals/SetupModal';

import { useIngestion } from '@/hooks/useIngestion';

// Mock the ingestion hook
vi.mock('@/hooks/useIngestion', () => ({
  useIngestion: vi.fn(),
}));

// Mock the sub-components using absolute paths to ensure they are correctly intercepted
vi.mock('@/components/modals/setup/DataPathStep', () => ({
  __esModule: true,
  default: () => <div data-testid="path-step">Path Step</div>,
}));
vi.mock('@/components/modals/setup/ImportStep', () => ({
  __esModule: true,
  default: ({
    setRemoteFiles,
    onConfirm,
  }: {
    setRemoteFiles?: (files: string[], totalSize: number) => void;
    onConfirm?: () => void;
  }) => (
    <div data-testid="import-step">
      Import Step
      <button onClick={() => setRemoteFiles?.(['/import/next.zip'], 128)}>Select Archive</button>
      <button onClick={() => onConfirm?.()}>Confirm Import</button>
    </div>
  ),
}));
vi.mock('@/components/modals/setup/ScanStep', () => ({
  __esModule: true,
  default: () => <div data-testid="scan-step">Scan Step</div>,
}));

describe('SetupModal Component', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onCompleted: vi.fn(),
  };

  const mockUseIngestion = (overrides = {}) => {
    (useIngestion as Mock).mockReturnValue({
      isInstalling: false,
      isComplete: false,
      logs: [],
      status: '',
      progress: 0,
      error: null,
      activeTransfers: {},
      runInstall: vi.fn(),
      reset: vi.fn(),
      ...overrides,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIngestion();
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ workspacePath: '/test/path', resolved: '/test/path' }),
      }),
    ) as Mock;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the Welcome screen initially when isFirstRun is true', () => {
    render(<SetupModal {...defaultProps} isFirstRun={true} />);

    expect(screen.getByText('Welcome to MessageHub')).toBeTruthy();
    expect(screen.getByText('Get Started')).toBeTruthy();
    // Close button (top right) should NOT be present in FirstRun Welcome
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('shows the Sidebar version when isFirstRun is false', () => {
    render(<SetupModal {...defaultProps} isFirstRun={false} />);

    // Sidebar title
    expect(screen.getByText(/Setup/i)).toBeTruthy();
    // Close button (top right) should be present
    expect(screen.getByLabelText('Close')).toBeTruthy();
    // Sidebar Close button (text) should also be present
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('disables all close and navigation actions while isInstalling is true', async () => {
    mockUseIngestion({ isInstalling: true });

    // Test Sidebar version
    render(<SetupModal {...defaultProps} isFirstRun={false} />);

    // Top right close button should be disabled (queried by aria-label)
    const topCloseBtn = screen.getByLabelText('Close') as HTMLButtonElement;
    expect(topCloseBtn.disabled).toBe(true);

    // Sidebar close button should be disabled (queried by text)
    const sidebarCloseBtn = screen.getByText('Close') as HTMLButtonElement;
    expect(sidebarCloseBtn.disabled).toBe(true);

    // Sidebar buttons should be disabled
    const sidebarItems = screen
      .getAllByRole('button')
      .filter((btn) => ['Overview', 'Import', 'Workspace'].includes(btn.textContent || '')) as HTMLButtonElement[];

    sidebarItems.forEach((btn) => {
      expect(btn.disabled).toBe(true);
    });

    // Test Wizard version footer buttons
    cleanup();
    mockUseIngestion({ isInstalling: false }); // Start with install off so we can navigate
    render(<SetupModal {...defaultProps} isFirstRun={true} />);

    // 1. Navigate to 'path' step
    screen.getByText('Get Started').click();
    expect(await screen.findByTestId('path-step')).toBeTruthy();

    // 2. Now trigger installation state
    // We mount a fresh instance at the correct step to verify footer buttons
    cleanup();
    mockUseIngestion({ isInstalling: true });
    render(<SetupModal {...defaultProps} isFirstRun={true} initialStep={1} />); // initialStep 1 is 'import', initialStep 0 is 'welcome' (or 'path' if not first run... let's check)

    // In FirstRun, steps are ['path', 'import', 'scan'].
    // If we want 'path' with footer, we need a way to get there.
    // Actually SetupModal.tsx:
    // const stepTab = initialStep === 0 ? 'welcome' : initialStep === 1 ? 'import' : initialStep === 2 ? 'scan' : 'path';
    // Let's use initialStep={3} to get to 'path' (the fallback 'else' condition)
    cleanup();
    render(<SetupModal {...defaultProps} isFirstRun={true} initialStep={3} />);

    const backBtn = (await screen.findByRole('button', { name: /Back/i })) as HTMLButtonElement;
    expect(backBtn.disabled).toBe(true);
  });

  it('verifies progress steps order for FirstRun (Welcome -> Path -> Import -> Scan)', async () => {
    render(<SetupModal {...defaultProps} isFirstRun={true} />);

    // 1. Welcome
    expect(screen.getByText('Welcome to MessageHub')).toBeTruthy();
    screen.getByText('Get Started').click();

    // 2. Path
    // Use findBy to wait for re-render
    expect(await screen.findByTestId('path-step')).toBeTruthy();

    // For wizard layout, check the index of dots
    const dots = screen.getAllByRole('generic').filter((el) => el.className.includes('dot'));
    expect(dots[0].className).toContain('dotActive');

    screen.getByRole('button', { name: /Next|Skip/i }).click();

    // 3. Import
    expect(await screen.findByTestId('import-step')).toBeTruthy();
    expect(dots[1].className).toContain('dotActive');

    screen.getByRole('button', { name: /Next|Skip/i }).click();

    // 4. Scan
    expect(await screen.findByTestId('scan-step')).toBeTruthy();
    expect(dots[2].className).toContain('dotActive');
  });

  it('stays on Path step when saving workspace config fails during FirstRun', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = vi.fn().mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Permission denied' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ workspacePath: '/test/path', resolved: '/test/path' }),
      });
    }) as Mock;

    try {
      render(<SetupModal {...defaultProps} isFirstRun={true} initialStep={3} />);

      expect(await screen.findByTestId('path-step')).toBeTruthy();

      const nextButton = screen.getByRole('button', { name: /Next/i }) as HTMLButtonElement;
      await waitFor(() => {
        expect(nextButton.disabled).toBe(false);
      });

      nextButton.click();

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/setup/config', expect.objectContaining({ method: 'POST' }));
      });

      expect(screen.getByTestId('path-step')).toBeTruthy();
      expect(screen.queryByTestId('import-step')).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('resets completed ingestion state when selecting another archive in ImportStep', async () => {
    const reset = vi.fn();
    mockUseIngestion({ isComplete: true, progress: 100, status: 'Complete', reset });

    render(<SetupModal {...defaultProps} isFirstRun={false} initialStep={1} />);

    expect(screen.getByTestId('import-step')).toBeTruthy();
    screen.getByText('Select Archive').click();

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
