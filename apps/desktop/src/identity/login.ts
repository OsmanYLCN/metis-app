import { API_URL } from '../api/health';
import { type LoginConfig, loginSettings } from './config';
import { readIdentityStatus } from './session';
import { nativeVault, type SessionVault } from './vault';

export type LoginView =
  | { phase: 'signedOut'; message?: string }
  | { phase: 'signingIn' | 'signingOut' }
  | { phase: 'signedIn'; userId: string; expiresAt: number; remembered: boolean };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
class LoginError extends Error { }

export class LoginStore {
  private view: LoginView = { phase: 'signedOut' };
  private listeners = new Set<() => void>();
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private pending: AbortController | null = null;
  private generation = 0;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private renewAt = 0;
  private diskQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly config?: LoginConfig, private readonly vault?: SessionVault) { }
  canRemember = () => !!this.vault;
  getSnapshot = () => this.view;
  // Narrow read-only probe: bearer tokens stay inside the session store.
  async checkCentralTasks(signal: AbortSignal): Promise<{ empty: boolean }> {
    const token = this.accessToken;
    const attempt = this.generation;
    const assertSession = () => {
      if (signal.aborted || attempt !== this.generation || token !== this.accessToken
        || !token || this.view.phase !== 'signedIn' || this.view.expiresAt <= Date.now())
        throw new LoginError('Oturum değişti veya süresi doldu. Tekrar giriş yap.');
    };
    assertSession();
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    const read = async (path: string): Promise<unknown> => {
      assertSession();
      const response = await fetch(`${API_URL}/api/v1/tasks${path}`, {
        method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: deadline,
        credentials: 'omit', cache: 'no-store', redirect: 'error',
      });
      assertSession();
      if (response.status === 401) throw new LoginError('Oturum doğrulanamadı. Çıkış yapıp tekrar giriş yap.');
      if (!response.ok) throw new LoginError('Bulut okuması tamamlanamadı. API ve veritabanı bağlantısını kontrol et.');
      const value: unknown = await response.json();
      assertSession();
      return value;
    };
    try {
      const status = await read('/status');
      if (!isObject(status) || status.storage !== 'ready' || status.readAvailable !== true || status.syncAvailable !== false)
        throw new LoginError('Bulut okuması henüz hazır değil. Bağlantı ayarlarını kontrol et.');
      const page = await read('?limit=1');
      if (!isObject(page) || !Array.isArray(page.items) || page.items.length > 1
        || !(page.nextCursor === null || (typeof page.nextCursor === 'string' && /^[a-f0-9]{32}$/.test(page.nextCursor)))
        || (page.items.length === 0 && page.nextCursor !== null)
        || page.items.some(item => !isObject(item) || typeof item.id !== 'string' || !/^[a-f0-9]{32}$/.test(item.id)
          || typeof item.title !== 'string' || !item.title.trim() || [...item.title].length > 200
          || typeof item.completed !== 'boolean' || typeof item.revision !== 'number' || !Number.isSafeInteger(item.revision) || item.revision < 1
          || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))
          || typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))))
        throw new LoginError('Bulut yanıtı doğrulanamadı. Tekrar dene.');
      return { empty: page.items.length === 0 };
    } catch (error) {
      throw error instanceof LoginError ? error : new LoginError('Bulut okuması tamamlanamadı. Bağlantını kontrol edip tekrar dene.');
    }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(view: LoginView) { this.view = view; this.listeners.forEach(listener => listener()); }
  private clear() { this.accessToken = null; this.refreshToken = null; clearTimeout(this.timer); this.timer = undefined; }
  private disk<T>(action: () => Promise<T>): Promise<T> {
    const result = this.diskQueue.then(action);
    this.diskQueue = result.catch(() => undefined);
    return result;
  }
  start = () => { if (!this.started) { this.started = true; void this.restore(); } };
  async restore() {
    if (!this.config || !this.vault || this.view.phase !== 'signedOut') return;
    await this.exchange('refresh_token', async () => {
      const token = await this.disk(() => this.vault!.read());
      return token ? { refresh_token: token } : null;
    }, true);
  }
  async signIn(email: string, password: string, remember = false) {
    if (this.view.phase !== 'signedOut') return;
    if (!this.config) { this.publish({ phase: 'signedOut', message: 'Hesap bağlantısı henüz ayarlanmadı.' }); return; }
    if (!email.trim() || !password) { this.publish({ phase: 'signedOut', message: 'E-posta ve parolanı gir.' }); return; }
    if (remember && !this.vault) { this.publish({ phase: 'signedOut', message: 'Kalıcı oturum yalnızca Windows uygulamasında kullanılabilir.' }); return; }
    await this.exchange('password', async () => {
      // A new login/account choice supersedes any previously remembered session.
      if (this.vault) await this.disk(() => this.vault!.clear());
      return { email: email.trim(), password };
    }, remember);
  }
  private async exchange(grant: 'password' | 'refresh_token', body: () => Promise<Record<string, string> | null>, remember: boolean) {
    if (!this.config) return;
    const previousUser = this.view.phase === 'signedIn' ? this.view.userId : null;
    const attempt = ++this.generation;
    const controller = new AbortController();
    this.pending = controller;
    this.clear();
    this.publish({ phase: 'signingIn' });
    let issuedToken: string | null = null;
    let refreshAttempted = false;
    try {
      const status = await readIdentityStatus(controller.signal);
      if (status.status !== 'verificationConfigured' || status.issuer !== this.config.issuer)
        throw new LoginError('Uygulama ve hesap servisi aynı projeye bağlı değil. Bağlantı ayarlarını kontrol et.');
      if (controller.signal.aborted) return;
      const payload = await body();
      if (controller.signal.aborted || attempt !== this.generation) return;
      if (!payload) { this.publish({ phase: 'signedOut' }); return; }
      const startedAt = Date.now();
      refreshAttempted = grant === 'refresh_token';
      const response = await fetch(`${this.config.issuer}/token?grant_type=${grant}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: this.config.publishableKey },
        body: JSON.stringify(payload), credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (response.status === 429) throw new LoginError('Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.');
      if ([400, 401, 422].includes(response.status)) throw new LoginError(grant === 'password'
        ? 'Giriş yapılamadı. E-posta, parola ve hesabının doğrulanmış olduğunu kontrol et.' : 'Kayıtlı oturum yenilenemedi. Tekrar giriş yap.');
      if (!response.ok) throw new LoginError('Hesap sağlayıcısına ulaşılamadı. Daha sonra tekrar dene.');
      const value: unknown = await response.json();
      if (!isObject(value) || typeof value.access_token !== 'string' || !value.access_token.length
        || value.access_token.length > 16384 || value.token_type !== 'bearer'
        || typeof value.expires_in !== 'number' || !Number.isSafeInteger(value.expires_in)
        || value.expires_in <= 0 || value.expires_in > 604800) throw new LoginError('Hesap sağlayıcısının yanıtı doğrulanamadı.');
      issuedToken = value.access_token;
      const refresh = value.refresh_token;
      if (remember && (typeof refresh !== 'string' || !refresh.length || refresh.length > 8192))
        throw new LoginError('Kalıcı oturum bilgisi doğrulanamadı.');
      const expiresAt = startedAt + value.expires_in * 1000;
      if (controller.signal.aborted) return;
      const verified = await fetch(`${API_URL}/api/v1/auth/session`, {
        headers: { Authorization: `Bearer ${issuedToken}` }, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!verified.ok) throw new LoginError('Metis oturumu doğrulayamadı. API bağlantısını ve hesap ayarlarını kontrol et.');
      const session: unknown = await verified.json();
      if (!isObject(session) || session.authenticated !== true || session.state !== 'signedIn'
        || !isObject(session.user) || typeof session.user.id !== 'string' || !uuid.test(session.user.id)
        || (previousUser !== null && session.user.id !== previousUser)) throw new LoginError('Metis oturumu doğrulanamadı.');
      if (attempt !== this.generation || controller.signal.aborted) return;
      if (expiresAt <= Date.now()) throw new LoginError('Oturumun süresi doldu. Tekrar giriş yap.');
      if (remember) await this.disk(async () => {
        if (attempt === this.generation && !controller.signal.aborted) await this.vault!.write(refresh as string);
      });
      if (attempt !== this.generation || controller.signal.aborted) return;
      this.accessToken = issuedToken;
      issuedToken = null;
      this.refreshToken = remember ? refresh as string : null;
      this.renewAt = remember ? expiresAt - Math.min(60000, value.expires_in * 500) : expiresAt;
      this.publish({ phase: 'signedIn', userId: session.user.id, expiresAt, remembered: remember });
      this.timer = setTimeout(this.checkExpiry, Math.max(0, this.renewAt - Date.now()));
    } catch (error) {
      if (attempt === this.generation) {
        this.clear();
        let cleanupFailed = false;
        // A refresh may already have rotated the server token. Never retry an ambiguous old token.
        if ((refreshAttempted || issuedToken) && this.vault) {
          try { await this.disk(() => this.vault!.clear()); } catch { cleanupFailed = true; }
        }
        if (attempt === this.generation) this.publish({ phase: 'signedOut', message: cleanupFailed
          ? 'Kayıtlı oturum silinemedi. Çıkışı tekrar dene; cihazdaki kayıt kalmış olabilir.'
          : error instanceof LoginError ? error.message : 'Giriş tamamlanamadı. Bağlantıyı ve cihazdaki oturum alanını kontrol edip tekrar dene.' });
      }
    } finally {
      if (issuedToken) void this.revoke(issuedToken);
      if (this.pending === controller) this.pending = null;
    }
  }
  // Page closure forgets process memory without revoking the explicitly remembered session.
  suspend = () => { ++this.generation; this.pending?.abort(); this.pending = null; this.clear(); this.publish({ phase: 'signedOut' }); };
  cancel() {
    this.suspend();
    if (this.vault) {
      const attempt = this.generation;
      void this.disk(() => this.vault!.clear()).catch(() => {
        if (attempt === this.generation) this.publish({ phase: 'signedOut', message: 'Kayıtlı oturum silinemedi. Çıkışı tekrar dene.' });
      });
    }
  }
  checkExpiry = () => {
    if (this.view.phase !== 'signedIn' || Date.now() < this.renewAt) return;
    const refresh = this.refreshToken;
    if (refresh) { void this.exchange('refresh_token', async () => ({ refresh_token: refresh }), true); }
    else { this.clear(); this.publish({ phase: 'signedOut', message: 'Oturumun süresi doldu. Tekrar giriş yap.' }); }
  };
  async signOut() {
    if (this.view.phase === 'signingOut') return;
    const token = this.accessToken;
    this.suspend();
    const attempt = this.generation;
    this.publish({ phase: 'signingOut' });
    let cleared = true;
    try { if (this.vault) await this.disk(() => this.vault!.clear()); } catch { cleared = false; }
    const revoked = token ? await this.revoke(token) : true;
    if (attempt === this.generation) this.publish({ phase: 'signedOut', message: !cleared
      ? 'Kayıtlı oturum silinemedi. Çıkışı tekrar dene; cihazdaki kayıt kalmış olabilir.'
      : revoked ? 'Bu cihazdan çıkış yapıldı.' : 'Bu cihazdan çıkış yapıldı. Sunucudaki oturumun kapatıldığı doğrulanamadı.' });
  }
  private async revoke(token: string): Promise<boolean> {
    if (!this.config) return false;
    try {
      const response = await fetch(`${this.config.issuer}/logout?scope=local`, {
        method: 'POST', headers: { apikey: this.config.publishableKey, Authorization: `Bearer ${token}` },
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch { return false; }
  }
}
const config = loginSettings.kind === 'ready' ? loginSettings.config : undefined;
export const loginStore = new LoginStore(config, config ? nativeVault(config.issuer) : undefined);
