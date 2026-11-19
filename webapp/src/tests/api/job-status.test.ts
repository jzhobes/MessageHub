// @vitest-environment node
import { createMocks } from 'node-mocks-http';
import { describe, expect, it } from 'vitest';

import { jobStore } from '@/lib/jobStore';
import handler from '@/pages/api/job-status';

describe('/api/job-status', () => {
  it('returns 400 when id is missing or an array', () => {
    const missing = createMocks({ method: 'GET', query: {} });
    handler(missing.req, missing.res);
    expect(missing.res._getStatusCode()).toBe(400);
    expect(missing.res._getJSONData()).toEqual({ error: 'Missing job ID' });

    const arrayParam = createMocks({ method: 'GET', query: { id: ['a', 'b'] } });
    handler(arrayParam.req, arrayParam.res);
    expect(arrayParam.res._getStatusCode()).toBe(400);
  });

  it('returns 404 when job does not exist', () => {
    const { req, res } = createMocks({ method: 'GET', query: { id: 'nonexistent-job-id' } });
    handler(req, res);

    expect(res._getStatusCode()).toBe(404);
    expect(res._getJSONData()).toEqual({ error: 'Job not found' });
  });

  it('returns 200 with job details for an existing job', () => {
    const jobId = 'test-job-status-1';
    jobStore.create(jobId);
    jobStore.update(jobId, { status: 'processing', progress: 3, total: 10 });

    const { req, res } = createMocks({ method: 'GET', query: { id: jobId } });
    handler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getJSONData()).toMatchObject({
      id: jobId,
      status: 'processing',
      progress: 3,
      total: 10,
    });
  });
});
