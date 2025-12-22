import { describe, it, expect, vi } from 'vitest';
import { createMocks } from 'node-mocks-http';
import handler from '@/pages/api/search';

// We do NOT mock '@/lib/server/db' anymore, using real one.

// We still mock Identity because that depends on file permissions/user paths
// that might vary even if workspace is fixed.
vi.mock('@/lib/server/identity', () => ({
  getMyNames: vi.fn().mockResolvedValue(['Me', 'John Doe', 'John Ho']),
}));

describe('/api/search (Integration)', () => {
  it('should return 400 if query is missing', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('should find the "Simulation Theory" thread via FTS', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { q: 'matrix glitch' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();

    // We expect to find the message we just added: "Look at this glich in the matrix..."
    expect(data.total).toBeGreaterThan(0);
    const match = data.data.find((m: { content?: string }) => m.content?.toLowerCase().includes('matrix'));
    expect(match).toBeDefined();
    expect(match.thread_id).toBe('simulation_theory_888');
  });

  it('should filter by platform=google_mail', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { q: 'release', platform: 'google_mail' },
    });

    await handler(req, res);
    expect(res._getStatusCode()).toBe(200);
    const data = res._getJSONData();

    // From create_mail_samples.py: "Project Release Update"
    expect(data.total).toBeGreaterThan(0);
    expect(data.data[0].platform).toBe('google_mail');

    // Ensure no facebook results
    const fbMatch = data.data.find((m: { platform?: string }) => m.platform === 'facebook');
    expect(fbMatch).toBeUndefined();
  });

  it('should return correct facets', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: { q: 'the' }, // High frequency word
    });

    await handler(req, res);
    const data = res._getJSONData();

    expect(data.facets.platforms).toHaveProperty('facebook');
    expect(data.facets.platforms).toHaveProperty('google_mail');
    // Ensure counts are numbers
    expect(typeof data.facets.platforms.facebook).toBe('number');
  });
});
