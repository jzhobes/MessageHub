// @vitest-environment node
import '../helpers/remoteFetchMock';

import fs from 'fs';
import os from 'os';
import path from 'path';

import { createMocks } from 'node-mocks-http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import appConfig from '@/lib/shared/appConfig';
import handler from '@/pages/api/media';

import { createStreamingMocks, waitForStreamEnd } from '../helpers/httpHelpers';

describe('/api/media', () => {
  let originalWorkspace: string;
  let tempDir: string;

  beforeEach(() => {
    originalWorkspace = appConfig.WORKSPACE_PATH;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-media-'));
    appConfig.WORKSPACE_PATH = tempDir;

    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    appConfig.WORKSPACE_PATH = originalWorkspace;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 400 when path or platform is missing', async () => {
    const missingPath = createMocks({ method: 'GET', query: { platform: 'facebook' } });
    await handler(missingPath.req, missingPath.res);
    expect(missingPath.res._getStatusCode()).toBe(400);

    const missingPlatform = createMocks({ method: 'GET', query: { path: 'photo.jpg' } });
    await handler(missingPlatform.req, missingPlatform.res);
    expect(missingPlatform.res._getStatusCode()).toBe(400);
  });

  it.each(['../secret.txt', '%2e%2e/secret.txt', 'subdir/../../etc/passwd'])(
    'returns 400 on path traversal attempt: %s',
    async (badPath) => {
      const { req, res } = createMocks({
        method: 'GET',
        query: { path: badPath, platform: 'facebook' },
      });

      await handler(req, res);

      expect(res._getStatusCode()).toBe(400);
      expect(res._getData()).toBe('Invalid path');
    },
  );

  it.each(['google_mail', 'google_chat', 'facebook'])(
    'blocks symlinks outside the active workspace for %s',
    async (platform) => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'messagehub-media-outside-'));
      try {
        fs.writeFileSync(path.join(outside, 'secret.txt'), 'private');
        fs.symlinkSync(outside, path.join(tempDir, 'escape'), 'dir');
        const { req, res } = createMocks({ query: { path: 'escape/secret.txt', platform } });
        await handler(req, res);
        expect(res._getStatusCode()).toBe(403);
        expect(res._getData()).toBe('Access denied');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it('blocks an extension fallback that is an escaping symlink', async () => {
    fs.symlinkSync(os.tmpdir(), path.join(tempDir, 'photo.jpg'), 'dir');
    const { req, res } = createMocks({ query: { path: 'photo', platform: 'google_mail' } });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(403);
  });

  it('proxies external http URLs and handles upstream failures', async () => {
    const imgBytes = Buffer.from('remote-img');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(imgBytes, { status: 200, headers: { 'Content-Type': 'image/webp' } }))
        .mockResolvedValueOnce(new Response('Not found', { status: 404 }))
        .mockRejectedValueOnce(new Error('Network down')),
    );

    const okCall = createMocks({
      method: 'GET',
      query: { path: 'https://lh3.googleusercontent.com/proxy/img', platform: 'google_mail' },
    });
    await handler(okCall.req, okCall.res);
    expect(okCall.res._getStatusCode()).toBe(200);
    expect(okCall.res._getHeaders()['content-type']).toBe('image/webp');
    expect(Buffer.from(okCall.res._getData())).toEqual(imgBytes);

    const notFoundCall = createMocks({
      method: 'GET',
      query: { path: 'https://example.com/missing.png', platform: 'google_mail' },
    });
    await handler(notFoundCall.req, notFoundCall.res);
    expect(notFoundCall.res._getStatusCode()).toBe(404);

    const errCall = createMocks({
      method: 'GET',
      query: { path: 'https://example.com/err.png', platform: 'google_mail' },
    });
    await handler(errCall.req, errCall.res);
    expect(errCall.res._getStatusCode()).toBe(500);
  });

  it.each(['http://127.0.0.2/admin', 'http://[::ffff:127.0.0.1]/admin', 'http://169.254.169.254/'])(
    'blocks non-public external media: %s',
    async (url) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const { req, res } = createMocks({ method: 'GET', query: { path: url, platform: 'google_mail' } });
      await handler(req, res);
      expect(res._getStatusCode()).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('blocks a public media URL redirecting to an internal address', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/private' } }));
    vi.stubGlobal('fetch', fetchMock);
    const { req, res } = createMocks({
      method: 'GET',
      query: { path: 'https://example.com/image', platform: 'google_mail' },
    });
    await handler(req, res);
    expect(res._getStatusCode()).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves Facebook and Instagram files with and without activity prefix', async () => {
    const fbFile = path.join(tempDir, 'Facebook/your_facebook_activity/messages/inbox/pic.jpg');
    const igFile = path.join(tempDir, 'Instagram/your_instagram_activity/messages/inbox/snap.png');
    fs.mkdirSync(path.dirname(fbFile), { recursive: true });
    fs.mkdirSync(path.dirname(igFile), { recursive: true });
    fs.writeFileSync(fbFile, 'fb-jpg-bytes');
    fs.writeFileSync(igFile, 'ig-png-bytes');

    const fbShort = createStreamingMocks({
      method: 'GET',
      query: { path: 'messages/inbox/pic.jpg', platform: 'facebook' },
    });
    await handler(fbShort.req, fbShort.res);
    await waitForStreamEnd(fbShort.res);
    expect(fbShort.res._getStatusCode()).toBe(200);
    expect(fbShort.res._getHeaders()['content-type']).toBe('image/jpeg');
    expect(fbShort.res._getHeaders()['content-disposition']).toBe('inline; filename="pic.jpg"');
    expect(fbShort.res._getBuffer().toString()).toBe('fb-jpg-bytes');

    const fbPrefixed = createStreamingMocks({
      method: 'GET',
      query: { path: 'your_facebook_activity/messages/inbox/pic.jpg', platform: 'facebook' },
    });
    await handler(fbPrefixed.req, fbPrefixed.res);
    await waitForStreamEnd(fbPrefixed.res);
    expect(fbPrefixed.res._getBuffer().toString()).toBe('fb-jpg-bytes');

    const igShort = createStreamingMocks({
      method: 'GET',
      query: { path: 'messages/inbox/snap.png', platform: 'instagram' },
    });
    await handler(igShort.req, igShort.res);
    await waitForStreamEnd(igShort.res);
    expect(igShort.res._getStatusCode()).toBe(200);
    expect(igShort.res._getHeaders()['content-type']).toBe('image/png');
    expect(igShort.res._getBuffer().toString()).toBe('ig-png-bytes');

    const igPrefixed = createStreamingMocks({
      method: 'GET',
      query: { path: 'your_instagram_activity/messages/inbox/snap.png', platform: 'instagram' },
    });
    await handler(igPrefixed.req, igPrefixed.res);
    await waitForStreamEnd(igPrefixed.res);
    expect(igPrefixed.res._getBuffer().toString()).toBe('ig-png-bytes');
  });

  it('resolves Google Chat Groups vs DMs and strips File- prefix from Content-Disposition', async () => {
    const groupFile = path.join(tempDir, 'Google Chat/Groups/Space1/File-report.pdf');
    const dmFile = path.join(tempDir, 'Google Chat/DMs/DM1/File-notes.txt');
    fs.mkdirSync(path.dirname(groupFile), { recursive: true });
    fs.mkdirSync(path.dirname(dmFile), { recursive: true });
    fs.writeFileSync(groupFile, 'pdf-bytes');
    fs.writeFileSync(dmFile, 'dm-text');

    const groupCall = createStreamingMocks({
      method: 'GET',
      query: { path: 'Space1/File-report.pdf', platform: 'google_chat' },
    });
    await handler(groupCall.req, groupCall.res);
    await waitForStreamEnd(groupCall.res);
    expect(groupCall.res._getStatusCode()).toBe(200);
    expect(groupCall.res._getHeaders()['content-type']).toBe('application/pdf');
    expect(groupCall.res._getHeaders()['content-disposition']).toBe('inline; filename="report.pdf"');

    const dmCall = createStreamingMocks({
      method: 'GET',
      query: { path: 'DM1/File-notes.txt', platform: 'google_chat' },
    });
    await handler(dmCall.req, dmCall.res);
    await waitForStreamEnd(dmCall.res);
    expect(dmCall.res._getStatusCode()).toBe(200);
    expect(dmCall.res._getHeaders()['content-type']).toBe('text/plain');
    expect(dmCall.res._getHeaders()['content-disposition']).toBe('inline; filename="notes.txt"');
  });

  it('resolves Google Voice paths including extension probing and Voice/ prefix', async () => {
    const voiceFile = path.join(tempDir, 'Voice/Calls/photo1.jpg');
    fs.mkdirSync(path.dirname(voiceFile), { recursive: true });
    fs.writeFileSync(voiceFile, 'voice-img');

    const probed = createStreamingMocks({
      method: 'GET',
      query: { path: 'Calls/photo1', platform: 'google_voice' },
    });
    await handler(probed.req, probed.res);
    await waitForStreamEnd(probed.res);
    expect(probed.res._getStatusCode()).toBe(200);
    expect(probed.res._getHeaders()['content-type']).toBe('image/jpeg');
    expect(probed.res._getBuffer().toString()).toBe('voice-img');

    const prefixed = createStreamingMocks({
      method: 'GET',
      query: { path: 'Voice/Calls/photo1.jpg', platform: 'google_voice' },
    });
    await handler(prefixed.req, prefixed.res);
    await waitForStreamEnd(prefixed.res);
    expect(prefixed.res._getStatusCode()).toBe(200);
    expect(prefixed.res._getBuffer().toString()).toBe('voice-img');
  });

  it.each([
    ['anim.gif', 'image/gif', 'inline'],
    ['clip.mp4', 'video/mp4', 'inline'],
    ['clip.mov', 'video/quicktime', 'inline'],
    ['data.csv', 'text/plain', 'inline'],
    ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'attachment'],
    ['doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'attachment'],
    ['archive.zip', 'application/zip', 'attachment'],
    ['blob.bin', 'application/octet-stream', 'attachment'],
  ])('serves Google Mail attachment %s with %s (%s)', async (filename, expectedType, expectedDisp) => {
    const mailFile = path.join(tempDir, 'Mail/attachments', filename);
    fs.mkdirSync(path.dirname(mailFile), { recursive: true });
    fs.writeFileSync(mailFile, `content-${filename}`);

    const { req, res } = createStreamingMocks({
      method: 'GET',
      query: { path: `attachments/${filename}`, platform: 'google_mail' },
    });
    await handler(req, res);
    await waitForStreamEnd(res);

    expect(res._getStatusCode()).toBe(200);
    expect(res._getHeaders()['content-type']).toBe(expectedType);
    expect(res._getHeaders()['content-disposition']).toBe(`${expectedDisp}; filename="${filename}"`);
  });

  it('streams a requested byte range from a Messenger voice message', async () => {
    const uri = 'your_facebook_activity/e2e/media/voice.ogg';
    const file = path.join(tempDir, 'Facebook', uri);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'OggS-voice');

    const { req, res } = createStreamingMocks({
      method: 'GET',
      query: { path: uri, platform: 'facebook' },
      headers: { range: 'bytes=0-3' },
    });
    await handler(req, res);
    await waitForStreamEnd(res);

    expect(res._getStatusCode()).toBe(206);
    expect(res._getHeaders()).toMatchObject({
      'content-type': 'audio/ogg',
      'content-disposition': 'inline; filename="voice.ogg"',
      'accept-ranges': 'bytes',
      'content-range': 'bytes 0-3/10',
      'content-length': 4,
    });
    expect(res._getBuffer().toString()).toBe('OggS');
  });

  it('falls back to raw workspace-relative path and returns 404 when missing', async () => {
    const rawFile = path.join(tempDir, 'direct.txt');
    fs.writeFileSync(rawFile, 'direct-body');

    const found = createStreamingMocks({
      method: 'GET',
      query: { path: 'direct.txt', platform: 'facebook' },
    });
    await handler(found.req, found.res);
    await waitForStreamEnd(found.res);
    expect(found.res._getStatusCode()).toBe(200);
    expect(found.res._getBuffer().toString()).toBe('direct-body');

    const missing = createMocks({
      method: 'GET',
      query: { path: 'does-not-exist.png', platform: 'facebook' },
    });
    await handler(missing.req, missing.res);
    expect(missing.res._getStatusCode()).toBe(404);
    expect(missing.res._getData()).toBe('File not found');
  });
});
