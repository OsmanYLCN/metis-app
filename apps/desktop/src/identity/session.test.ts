import { afterEach, describe, expect, it, vi } from 'vitest';
import { readIdentityStatus } from './session';

afterEach(() => vi.unstubAllGlobals());
const disabled = { status: 'notConfigured', provider: null, signInAvailable: false, sessionPersistence: 'none' };

describe('identity foundation client', () => {
  it('reads the disabled state without credentials or browser caching', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(disabled)));
    vi.stubGlobal('fetch', fetcher);
    await expect(readIdentityStatus()).resolves.toEqual(disabled);
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:5080/api/v1/auth/status',
      expect.objectContaining({ credentials: 'omit', cache: 'no-store' }));
  });
  it('distinguishes configured-but-disconnected from available login', async () => {
    const value = { ...disabled, status: 'connectionPending', provider: 'supabase' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    await expect(readIdentityStatus()).resolves.toEqual(value);
  });
  it('rejects an unexpected claim that sign-in is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...disabled, signInAvailable: true }))));
    await expect(readIdentityStatus()).rejects.toThrow('doğrulanamadı');
  });
  it('accepts configured verification without claiming a live connection or sign-in', async () => {
    const value = { ...disabled, status: 'verificationConfigured', provider: 'supabase' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    await expect(readIdentityStatus()).resolves.toEqual(value);
  });
  it('rejects configured verification for an unknown provider', async () => {
    const value = { ...disabled, status: 'verificationConfigured', provider: 'other' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(value))));
    await expect(readIdentityStatus()).rejects.toThrow();
  });
  it('rejects an unrelated or malformed response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"authenticated":true,"user":{"id":"fake"}}')));
    await expect(readIdentityStatus()).rejects.toThrow();
  });
  it('does not invent an account state when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(readIdentityStatus()).rejects.toThrow('erişilemiyor');
  });
  it('does not turn a network error into a configured state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(readIdentityStatus()).rejects.toThrow();
  });
  it('passes cancellation to the request', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      expect(init.signal.aborted).toBe(true);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }));
    await expect(readIdentityStatus(controller.signal)).rejects.toThrow('Aborted');
  });
});
