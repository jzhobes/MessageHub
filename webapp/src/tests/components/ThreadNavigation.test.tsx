import React from 'react';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThreadNavigation from '@/components/ThreadNavigation';

import { apiFetch } from '@/lib/client/apiClient';

vi.mock('@/lib/client/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('@/components/Dropdown', () => ({
  Dropdown: ({ children, trigger }: { children: React.ReactNode; trigger: React.ReactNode }) => (
    <div>
      {trigger}
      {children}
    </div>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThreadNavigation', () => {
  it('navigates directly to a page and uses newest-first endpoint shortcuts', async () => {
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    render(<ThreadNavigation threadId="thread" currentPage={2} totalPages={62} onNavigate={onNavigate} />);
    expect(screen.getByLabelText('Jump to date')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Page' }));
    expect(screen.queryByLabelText('Jump to date')).toBeNull();
    const input = screen.getByLabelText('Go to page (1–62)') as HTMLInputElement;
    expect(input.value).toBe('2');
    fireEvent.change(input, { target: { value: '17' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(17, undefined));
    await waitFor(() => expect(screen.getByText('Oldest').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByText('Oldest'));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(62, undefined));
    await waitFor(() => expect(screen.getByText('Newest').hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByText('Newest'));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(1, undefined));
  });

  it('allows the first local message day and rejects earlier days', () => {
    const firstMessageTimestamp = new Date(2024, 0, 2, 23, 59).getTime();
    render(
      <ThreadNavigation
        threadId="thread"
        currentPage={1}
        totalPages={2}
        firstMessageTimestamp={firstMessageTimestamp}
        lastMessageTimestamp={new Date(2024, 0, 3, 0, 1).getTime()}
        onNavigate={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Jump to date') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2024-01-01' } });
    expect(input.validity.rangeUnderflow).toBe(true);
    fireEvent.change(input, { target: { value: '2024-01-02' } });
    expect(input.checkValidity()).toBe(true);
    fireEvent.change(input, { target: { value: '2024-01-03' } });
    expect(input.checkValidity()).toBe(true);
    fireEvent.change(input, { target: { value: '2024-01-04' } });
    expect(input.validity.rangeOverflow).toBe(true);
  });

  it('rejects out-of-range pages', () => {
    const onNavigate = vi.fn();
    render(<ThreadNavigation threadId="thread" currentPage={1} totalPages={3} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page' }));
    const input = screen.getByLabelText('Go to page (1–3)');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.submit(input.closest('form')!);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('uses the date target and explains a nearest-day fallback', async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ page: 8, timestamp: 123, matchedDate: '2026-11-18' }),
    } as Response);
    const onNavigate = vi.fn().mockResolvedValue(undefined);
    render(<ThreadNavigation threadId="thread" currentPage={1} totalPages={10} onNavigate={onNavigate} />);
    const input = screen.getByLabelText('Jump to date');
    fireEvent.change(input, { target: { value: '2026-11-19' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(8, 123));
    expect(await screen.findByText('No messages on 2026-11-19. Showing 2026-11-18.')).toBeTruthy();
  });
});
