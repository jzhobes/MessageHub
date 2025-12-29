import React from 'react';

import { cleanup, render, screen } from '@testing-library/react';
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
  default: () => <div data-testid="import-step">Import Step</div>,
}));
vi.mock('@/components/modals/setup/ScanStep', () => ({
  __esModule: true,
  default: () => <div data-testid="scan-step">Scan Step</div>,
}));

// Mock global fetch
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve({ workspacePath: '/test/path', resolved: '/test/path' }),
  }),
) as Mock;

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
      ...overrides,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseIngestion();
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
    expect(screen.getByTitle('Close')).toBeTruthy();
    // Sidebar Close button (text) should also be present
    expect(screen.getByText('Close')).toBeTruthy();
  });

  it('disables all close and navigation actions while isInstalling is true', async () => {
    mockUseIngestion({ isInstalling: true });

    // Test Sidebar version
    render(<SetupModal {...defaultProps} isFirstRun={false} />);

    // Top right close button should be disabled (queried by title)
    const topCloseBtn = screen.getByTitle('Close') as HTMLButtonElement;
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
});
