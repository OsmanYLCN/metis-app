import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginStore } from './login';
import { SessionVaultBusyError, type SessionVault } from './vault';
const config = { url: 'https://test-project.supabase.co', issuer: 'https://test-project.supabase.co/auth/v1', publishableKey: 'sb_publishable_test' };
const userId = '11111111-1111-4111-8111-111111111111';
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let saved: string | null;
let vault: SessionVault;
let store: LoginStore;
let fetcher: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
let revision: number;
beforeEach(() => {
  vi.useFakeTimers(); saved = null; revision = 0;
  vault = { read: vi.fn(async () => saved), write: vi.fn(async token => { saved = token; }), clear: vi.fn(async () => { saved = null; }) };
  store = new LoginStore(config, vault);
  fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/status')) return json({ status: 'verificationConfigured', provider: 'supabase', signInAvailable: false, sessionPersistence: 'none', issuer: config.issuer });
    if (url.includes('/token?')) return json({ access_token: `access-${++revision}`, refresh_token: `refresh-${revision}`, token_type: 'bearer', expires_in: 120 });
    if (url.endsWith('/session')) return json({ authenticated: true, state: 'signedIn', user: { id: userId } });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { store.suspend(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('remembered desktop sessions', () => {
  it('persists only the refresh token after API verification, with explicit opt-in', async () => {
    await store.signIn('test@example.test', 'fake', true);
    expect(saved).toBe('refresh-1');
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedIn', remembered: true });
    expect(JSON.stringify(store.getSnapshot())).not.toMatch(/access-1|refresh-1/);
  });
  it('a non-remembered login clears an old remembered account and stores nothing', async () => {
    saved = 'old-account'; await store.signIn('test@example.test', 'fake');
    expect(saved).toBeNull(); expect(vault.write).not.toHaveBeenCalled();
  });
  it('explains that another Metis window must be closed before login', async () => {
    vi.mocked(vault.clear).mockRejectedValueOnce(new SessionVaultBusyError());
    await store.signIn('test@example.test', 'fake');
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedOut', message: expect.stringContaining('başka bir pencerede') });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('restores only by exchanging the saved token and verifying the fresh access token', async () => {
    saved = 'previous'; await store.restore();
    expect(fetcher).toHaveBeenCalledWith(config.issuer + '/token?grant_type=refresh_token', expect.objectContaining({ body: JSON.stringify({ refresh_token: 'previous' }) }));
    expect(saved).toBe('refresh-1'); expect(store.getSnapshot().phase).toBe('signedIn');
  });
  it('does not exchange anything when the vault is empty', async () => {
    await store.restore(); expect(revision).toBe(0); expect(store.getSnapshot().phase).toBe('signedOut');
  });
  it('rotates once on expiry approach, even with duplicate wake-up events', async () => {
    await store.signIn('test@example.test', 'fake', true);
    vi.setSystemTime(Date.now() + 61000); store.checkExpiry(); store.checkExpiry();
    await vi.waitFor(() => expect(saved).toBe('refresh-2'));
    expect(revision).toBe(2); expect(store.getSnapshot().phase).toBe('signedIn');
  });
  it('preserves ciphertext on preflight network outage without claiming a session', async () => {
    saved = 'previous'; fetcher.mockRejectedValueOnce(Error('offline'));
    await store.restore(); expect(saved).toBe('previous'); expect(store.getSnapshot().phase).toBe('signedOut');
  });
  it('removes rejected or ambiguous refresh credentials and requires a new login', async () => {
    saved = 'revoked'; const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async url => String(url).includes('/token?') ? json({}, 400) : original(url));
    await store.restore(); expect(saved).toBeNull(); expect(store.getSnapshot().phase).toBe('signedOut');
  });
  it('does not present a remembered session if disk persistence fails', async () => {
    vault.write = vi.fn(async () => { throw Error('disk full'); });
    await store.signIn('test@example.test', 'fake', true);
    expect(saved).toBeNull(); expect(store.getSnapshot().phase).toBe('signedOut');
  });
  it('logout waits for an in-flight write then erases it; late completion never signs in', async () => {
    let finish!: () => void;
    vault.write = vi.fn(token => new Promise<void>(resolve => { finish = () => { saved = token; resolve(); }; }));
    const login = store.signIn('test@example.test', 'fake', true);
    await vi.waitFor(() => expect(finish).toBeDefined());
    const logout = store.signOut(); finish(); await login; await logout;
    expect(saved).toBeNull(); expect(store.getSnapshot().phase).toBe('signedOut');
  });
  it('reports a deletion failure and allows explicit deletion retry', async () => {
    await store.signIn('test@example.test', 'fake', true);
    vi.mocked(vault.clear).mockRejectedValueOnce(Error('locked'));
    await store.signOut(); expect(saved).toBe('refresh-1');
    expect(store.getSnapshot()).toMatchObject({ phase: 'signedOut', message: expect.stringContaining('silinemedi') });
    await store.signOut(); expect(saved).toBeNull();
  });
  it('closing preserves explicit remembered consent; a new store can restore', async () => {
    await store.signIn('test@example.test', 'fake', true); store.suspend();
    expect(saved).toBe('refresh-1');
    store = new LoginStore(config, vault); await store.restore();
    expect(store.getSnapshot().phase).toBe('signedIn'); expect(saved).toBe('refresh-2');
  });
  it('rejects changing user identity during renewal', async () => {
    await store.signIn('test@example.test', 'fake', true);
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async url => String(url).endsWith('/session')
      ? json({ authenticated: true, state: 'signedIn', user: { id: '22222222-2222-4222-8222-222222222222' } }) : original(url));
    vi.setSystemTime(Date.now() + 61000); store.checkExpiry();
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe('signedOut'));
    expect(saved).toBeNull();
  });
});
