import { createMocks } from 'node-mocks-http';
import { describe, expect, it, vi } from 'vitest';

import handler from '@/pages/api/content';

// Using Real DB with data from samples
vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn().mockResolvedValue(['Me', 'John Doe']),
}));

describe('/api/content (Integration)', () => {
  it('should split Text+Media into two bubbles', async () => {
    // We added a "Text + Photo" message to 'simulation_theory_888' in the sample build.
    // Content: "Look at this glich in the matrix I found!"
    // Photos: 1

    const { req, res } = createMocks({
      method: 'GET',
      query: { threadId: 'simulation_theory_888' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { records } = res._getJSONData();

    // Find our specific message by content or ID pattern
    const textPart = records.find(
      (m: { content?: string }) => m.content === 'Look at this glich in the matrix I found!',
    );
    expect(textPart).toBeDefined();

    // The text part should NOT have photos
    expect(textPart.photos).toBeUndefined();

    // There should be a corresponding media part (same timestamp)
    const mediaPart = records.find(
      (m: { timestamp_ms?: number; id?: string }) =>
        m.timestamp_ms === textPart.timestamp_ms && m.id?.endsWith('_media'),
    );

    expect(mediaPart).toBeDefined();
    expect(mediaPart.photos).toBeDefined();
    expect(mediaPart.photos.length).toBe(1);
  });

  it('should preserve Link Previews (Text + URL + 1 Photo)', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { threadId: 'simulation_theory_888' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const { records } = res._getJSONData();

    expect(records.length).toBeGreaterThan(0);
    const linkPreviewMsg = records.find((m: { content?: string }) => m.content?.includes('matrix.org/glitch'));
    expect(linkPreviewMsg).toBeDefined();

    expect(linkPreviewMsg.content).toBeDefined();
    expect(linkPreviewMsg.photos).toBeDefined();
    expect(linkPreviewMsg.photos.length).toBe(1);
  });
});
