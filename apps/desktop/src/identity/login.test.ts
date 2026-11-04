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
afterEach(() => { store.cancel(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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
