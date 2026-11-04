import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_URL, checkHealth } from './health';

afterEach(() => vi.unstubAllGlobals());

describe('health connection', () => {
  it('accepts the actual API contract without credentials', async () => {
    const body = { status: 'Healthy', service: 'personal-os-api', scope: 'process-only' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkHealth()).resolves.toEqual(body);
    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/health`, expect.objectContaining({ credentials: 'omit' }));
  });
  it('does not show a failed service as connected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(checkHealth()).rejects.toThrow();
  });
  it('rejects an unrelated service on the same port', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"status":"Healthy"}')));
    await expect(checkHealth()).rejects.toThrow('Beklenmeyen');
  });
  it('reports network failures without a fake healthy fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(checkHealth()).rejects.toThrow();
  });
  it('passes cancellation through to the request', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockImplementation((_url, init) => {
      expect(init.signal.aborted).toBe(true);
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(checkHealth(controller.signal)).rejects.toThrow('Aborted');
  });
});
