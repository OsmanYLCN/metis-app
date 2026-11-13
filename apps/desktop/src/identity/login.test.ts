import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginStore } from './login';
import { parseLoginSettings } from './config';

const config = { url: 'https://test-project.supabase.co', issuer: 'https://test-project.supabase.co/auth/v1', publishableKey: 'sb_publishable_test' };
const status = { status: 'verificationConfigured', provider: 'supabase', signInAvailable: false, sessionPersistence: 'none', issuer: config.issuer };
const tokenReply = { access_token: 'test-access-token', refresh_token: 'must-not-retain', token_type: 'bearer', expires_in: 3600 };
const session = { authenticated: true, state: 'signedIn', user: { id: '11111111-1111-4111-8111-111111111111', displayName: null } };
const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });
let store: LoginStore;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  store = new LoginStore(config);
  fetcher = vi.fn().mockImplementation(async (url: string) => {
    if (url.endsWith('/status')) return json(status);
    if (url.includes('/token?')) return json(tokenReply);
    if (url.endsWith('/session')) return json(session);
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { store.cancel(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('central read check', () => {
  const ready = { storage: 'ready', readAvailable: true, syncAvailable: false };
  it('requires an open session before making any request', async () => {
    await expect(store.checkCentralTasks(new AbortController().signal)).rejects.toThrow('Oturum');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('checks readiness then a bounded list with the current bearer, without exposing it', async () => {
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(json(ready)).mockResolvedValueOnce(json({ items: [], nextCursor: null }));
    await expect(store.checkCentralTasks(new AbortController().signal)).resolves.toEqual({ empty: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenLastCalledWith('http://127.0.0.1:5080/api/v1/tasks?limit=1', expect.objectContaining({
      method: 'GET', headers: { Authorization: 'Bearer test-access-token' }, redirect: 'error', credentials: 'omit', cache: 'no-store',
    }));
  });
  it('rejects unavailable readiness and never requests tasks', async () => {
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    fetcher.mockResolvedValue(json({ ...ready, storage: 'unavailable', readAvailable: false }));
    await expect(store.checkCentralTasks(new AbortController().signal)).rejects.toThrow('hazır değil');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('discards a delayed response after logout', async () => {
    await store.signIn('user@example.test', 'password');
    let finish!: (response: Response) => void;
    fetcher.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
    const check = expect(store.checkCentralTasks(new AbortController().signal)).rejects.toThrow('Oturum');
    store.suspend(); finish(json(ready)); await check;
  });
  it('rejects malformed list responses instead of claiming success', async () => {
    await store.signIn('user@example.test', 'password');
    fetcher.mockResolvedValueOnce(json(ready)).mockResolvedValueOnce(json({ items: [{ id: 'bad' }], nextCursor: null }));
    await expect(store.checkCentralTasks(new AbortController().signal)).rejects.toThrow('yanıtı doğrulanamadı');
  });
  it('does not show server details for rejected or failed requests', async () => {
    await store.signIn('user@example.test', 'password');
    fetcher.mockResolvedValueOnce(json({ secret: 'private' }, 401));
    await expect(store.checkCentralTasks(new AbortController().signal)).rejects.toThrow('Oturum doğrulanamadı');
    fetcher.mockRejectedValueOnce(Error('private connection string'));
    await expect(store.checkCentralTasks(new AbortController().signal)).rejects.toThrow('Bağlantını kontrol');
  });
});

describe('central writer check', () => {
  it('requires an open session before creating a synthetic task', async () => {
    await expect(store.checkCentralTaskWriter(new AbortController().signal)).rejects.toThrow('Oturum');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('creates one task, verifies replay, renames it and reads the committed revision', async () => {
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    const ids = [
      'aaaaaaaa-0000-4000-8000-000000000001',
      'bbbbbbbb-0000-4000-8000-000000000001',
      'cccccccc-0000-4000-8000-000000000001',
    ];
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => ids.shift() as `${string}-${string}-${string}-${string}-${string}`);
    const taskId = 'aaaaaaaa000040008000000000000001';
    fetcher
      .mockResolvedValueOnce(json({ outcome: 'applied', taskId, revision: 1 }, 201))
      .mockResolvedValueOnce(json({ outcome: 'replayed', taskId, revision: 1 }))
      .mockResolvedValueOnce(json({ outcome: 'applied', taskId, revision: 2 }))
      .mockResolvedValueOnce(json({ id: taskId, title: 'Metis bağlantı kontrolü tamamlandı', completed: false, revision: 2 }));
    await expect(store.checkCentralTaskWriter(new AbortController().signal)).resolves.toEqual({ taskId });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:5080/api/v1/tasks', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ operationId: 'bbbbbbbb000040008000000000000001', taskId, title: 'Metis bağlantı kontrolü' }),
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
    }));
    expect(fetcher).toHaveBeenNthCalledWith(3, `http://127.0.0.1:5080/api/v1/tasks/${taskId}`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ operationId: 'cccccccc000040008000000000000001', expectedRevision: 1, title: 'Metis bağlantı kontrolü tamamlandı' }),
    }));
  });
  it('rejects malformed receipts without exposing server details', async () => {
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(json({ outcome: 'applied', taskId: 'wrong', revision: 1 }, 201));
    await expect(store.checkCentralTaskWriter(new AbortController().signal)).rejects.toThrow('yanıtı doğrulanamadı');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('one local task delivery', () => {
  const operation = { operationId: 'aaaaaaaa000040008000000000000001', taskId: 'bbbbbbbb000040008000000000000001', kind: 'create', expectedRevision: 0, title: 'One local task' };
  it('uses the private bearer and accepts only a matching receipt', async () => {
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(json({ outcome: 'applied', taskId: operation.taskId, revision: 1 }, 201));
    await expect(store.sendOneLocalCreate(operation, new AbortController().signal)).resolves.toEqual({ outcome: 'applied', revision: 1 });
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:5080/api/v1/tasks', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ operationId: operation.operationId, taskId: operation.taskId, title: operation.title }),
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
    }));
    fetcher.mockResolvedValueOnce(json({ outcome: 'replayed', taskId: operation.taskId, revision: 1 }));
    await expect(store.sendOneLocalCreate(operation, new AbortController().signal)).resolves.toEqual({ outcome: 'replayed', revision: 1 });
  });
  it('rejects missing login, wrong task and uncertain response', async () => {
    await expect(store.sendOneLocalCreate(operation, new AbortController().signal)).rejects.toThrow('Oturum');
    expect(fetcher).not.toHaveBeenCalled();
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(json({ outcome: 'applied', taskId: 'wrong', revision: 1 }, 201));
    await expect(store.sendOneLocalCreate(operation, new AbortController().signal)).rejects.toThrow('yanıtı doğrulanamadı');
    fetcher.mockRejectedValueOnce(Error('secret transport detail'));
    await expect(store.sendOneLocalCreate(operation, new AbortController().signal)).rejects.toThrow('sonucu belirsiz');
  });
});

describe('one local title change delivery', () => {
  const operation = { operationId: 'aaaaaaaa000040008000000000000001', taskId: 'bbbbbbbb000040008000000000000001', kind: 'rename', expectedRevision: 1, title: 'Updated title' };
  it('sends a revision-bound PATCH and accepts its matching replay', async () => {
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(json({ outcome: 'applied', taskId: operation.taskId, revision: 2 }));
    await expect(store.sendOneLocalRename(operation, new AbortController().signal)).resolves.toEqual({ outcome: 'applied', revision: 2 });
    expect(fetcher).toHaveBeenCalledWith(`http://127.0.0.1:5080/api/v1/tasks/${operation.taskId}`, expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ operationId: operation.operationId, expectedRevision: 1, title: operation.title }),
      headers: { Authorization: 'Bearer test-access-token', 'Content-Type': 'application/json' },
    }));
    fetcher.mockResolvedValueOnce(json({ outcome: 'replayed', taskId: operation.taskId, revision: 2 }));
    await expect(store.sendOneLocalRename(operation, new AbortController().signal)).resolves.toEqual({ outcome: 'replayed', revision: 2 });
  });
  it('rejects a conflicting or mismatched receipt without acknowledging it', async () => {
    await store.signIn('user@example.test', 'password'); fetcher.mockClear();
    fetcher.mockResolvedValueOnce(json({ code: 'task_revision_conflict' }, 409));
    await expect(store.sendOneLocalRename(operation, new AbortController().signal)).rejects.toThrow('sürüm çatışması');
    fetcher.mockResolvedValueOnce(json({ outcome: 'applied', taskId: operation.taskId, revision: 3 }));
    await expect(store.sendOneLocalRename(operation, new AbortController().signal)).rejects.toThrow('yanıtı doğrulanamadı');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('public login configuration', () => {
  it('keeps an unconfigured build offline', () => expect(parseLoginSettings()).toEqual({ kind: 'missing' }));
  it('accepts only a hosted HTTPS project and publishable key', () => {
    expect(parseLoginSettings(config.url, config.publishableKey)).toEqual({ kind: 'ready', config });
    for (const url of ['http://test-project.supabase.co', 'https://evil.example', 'https://test-project.supabase.co.evil.example',
      'https://user:secret@test-project.supabase.co', config.url + '/path', config.url + '?key=secret', config.url + '#fragment']) {
      expect(parseLoginSettings(url, config.publishableKey).kind).toBe('invalid');
    }
    for (const key of ['', 'sb_secret_private', 'eyJlegacy.jwt.token']) expect(parseLoginSettings(config.url, key).kind).toBe('invalid');
  });
});

describe('memory-only login', () => {
  it('sends credentials only to the configured HTTPS provider, then verifies the token with the API', async () => {
    await store.signIn(' user@example.test ', 'test-password');
    expect(fetcher).toHaveBeenNthCalledWith(2, config.issuer + '/token?grant_type=password', expect.objectContaining({
      body: JSON.stringify({ email: 'user@example.test', password: 'test-password' }), credentials: 'omit', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', apikey: config.publishableKey },
    }));
    expect(fetcher).toHaveBeenNthCalledWith(3, 'http://127.0.0.1:5080/api/v1/auth/session', expect.objectContaining({ headers: { Authorization: 'Bearer test-access-token' } }));
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedIn', userId: session.user.id });
    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/test-access-token|must-not-retain|test-password/);
    expect(new LoginStore(config).getSnapshot().phase).toBe('signedOut');
  });
  it('never touches localStorage or sessionStorage', async () => {
    const storage = { getItem: vi.fn(() => { throw Error('storage forbidden'); }), setItem: vi.fn(() => { throw Error('storage forbidden'); }) };
    vi.stubGlobal('localStorage', storage); vi.stubGlobal('sessionStorage', storage);
    await store.signIn('user@example.test', 'password');
    await store.signOut();
    expect(storage.getItem).not.toHaveBeenCalled(); expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('does not send a password when the API points to another project', async () => {
    fetcher.mockResolvedValue(json({ ...status, issuer: 'https://other.supabase.co/auth/v1' }));
    await store.signIn('user@example.test', 'password');
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedOut', message: expect.stringContaining('aynı projeye') });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not send a password when the API is offline', async () => {
    fetcher.mockRejectedValue(Error('raw error with private data'));
    await store.signIn('user@example.test', 'password');
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedOut' });
    expect(JSON.stringify(store.getSnapshot())).not.toContain('private data');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 422, 429, 503])('handles provider failure %s without trusting its error text', async code => {
    fetcher.mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({ error: 'private provider detail' }, code));
    await store.signIn('user@example.test', 'password');
    expect(store.getSnapshot().phase).toBe('signedOut');
    expect(JSON.stringify(store.getSnapshot())).not.toContain('private provider detail');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('requires successful API verification even when Supabase issued a token', async () => {
    fetcher.mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json(tokenReply)).mockResolvedValueOnce(json({}, 401));
    await store.signIn('user@example.test', 'password');
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedOut', message: expect.stringContaining('doğrulayamadı') });
    expect(fetcher).toHaveBeenLastCalledWith(config.issuer + '/logout?scope=local', expect.anything());
  });
  it('rejects malformed provider and API success responses', async () => {
    fetcher.mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json({ ...tokenReply, expires_in: -1 }));
    await store.signIn('user@example.test', 'password');
    expect(store.getSnapshot().phase).toBe('signedOut');
    fetcher.mockResolvedValueOnce(json(status)).mockResolvedValueOnce(json(tokenReply)).mockResolvedValueOnce(json({ authenticated: true, user: {} }));
    await store.signIn('user@example.test', 'password');
    expect(store.getSnapshot().phase).toBe('signedOut');
  });
  it('prevents duplicate simultaneous sign-ins', async () => {
    const attempt = store.signIn('user@example.test', 'password');
    await store.signIn('user@example.test', 'password');
    await attempt;
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('/token?'))).toHaveLength(1);
  });
  it('ignores a late successful response after cancellation', async () => {
    let finish!: (response: Response) => void;
    fetcher.mockResolvedValueOnce(json(status)).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const attempt = store.signIn('user@example.test', 'password');
    await vi.waitFor(() => expect(finish).toBeDefined());
    store.cancel();
    finish(json(tokenReply));
    await attempt;
    expect(store.getSnapshot().phase).toBe('signedOut');
    expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/session'))).toBe(false);
  });
  it('expires automatically without refreshing credentials', async () => {
    await store.signIn('user@example.test', 'password');
    await vi.advanceTimersByTimeAsync(3600_000);
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedOut', message: expect.stringContaining('süresi doldu') });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('checks expiry on resume even when timers were suspended', async () => {
    await store.signIn('user@example.test', 'password');
    vi.setSystemTime(Date.now() + 3600_001);
    store.checkExpiry();
    expect(store.getSnapshot().phase).toBe('signedOut');
  });
  it('clears local access even when provider logout fails', async () => {
    await store.signIn('user@example.test', 'password');
    fetcher.mockRejectedValueOnce(Error('offline'));
    const logout = store.signOut();
    expect(store.getSnapshot().phase).toBe('signingOut');
    await logout;
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedOut', message: expect.stringContaining('doğrulanamadı') });
  });
});
