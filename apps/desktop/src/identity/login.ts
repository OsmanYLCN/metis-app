import { API_URL } from '../api/health';
import { type LoginConfig, loginSettings } from './config';
import { readIdentityStatus } from './session';

export type LoginView =
  | { phase: 'signedOut'; message?: string }
  | { phase: 'signingIn' | 'signingOut' }
  | { phase: 'signedIn'; userId: string; expiresAt: number };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
class LoginError extends Error { }

// One app-lifetime store, independent of dashboard mounting. No browser/SQLite storage,
// cookies, refresh-token retention, JWT decoding, logging, or automatic token renewal.
export class LoginStore {
  private view: LoginView = { phase: 'signedOut' };
  private listeners = new Set<() => void>();
  private accessToken: string | null = null;
  private pending: AbortController | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly config?: LoginConfig) { }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(view: LoginView) { this.view = view; this.listeners.forEach(listener => listener()); }
  private clear() { this.accessToken = null; clearTimeout(this.timer); this.timer = undefined; }

  async signIn(email: string, password: string) {
    if (this.view.phase !== 'signedOut') return;
    if (!this.config) { this.publish({ phase: 'signedOut', message: 'Hesap bağlantısı henüz ayarlanmadı.' }); return; }
    if (!email.trim() || !password) { this.publish({ phase: 'signedOut', message: 'E-posta ve parolanı gir.' }); return; }
    const attempt = ++this.generation;
    const controller = new AbortController();
    this.pending = controller;
    this.publish({ phase: 'signingIn' });
    let issuedToken: string | null = null;
    try {
      const status = await readIdentityStatus(controller.signal);
      if (status.status !== 'verificationConfigured' || status.issuer !== this.config.issuer)
        throw new LoginError('Uygulama ve hesap servisi aynı projeye bağlı değil. Bağlantı ayarlarını kontrol et.');
      if (controller.signal.aborted) return;
      const startedAt = Date.now();
      const response = await fetch(`${this.config.issuer}/token?grant_type=password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: this.config.publishableKey },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (response.status === 429) throw new LoginError('Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.');
      if (response.status === 400 || response.status === 401 || response.status === 422)
        throw new LoginError('Giriş yapılamadı. E-posta, parola ve hesabının doğrulanmış olduğunu kontrol et.');
      if (!response.ok) throw new LoginError('Hesap sağlayıcısına ulaşılamadı. Daha sonra tekrar dene.');
      const value: unknown = await response.json();
      if (!isObject(value) || typeof value.access_token !== 'string' || value.access_token.length === 0
        || value.access_token.length > 16384 || value.token_type !== 'bearer'
        || typeof value.expires_in !== 'number' || !Number.isSafeInteger(value.expires_in)
        || value.expires_in <= 0 || value.expires_in > 604800)
        throw new LoginError('Hesap sağlayıcısının yanıtı doğrulanamadı.');
      issuedToken = value.access_token;
      const expiresAt = startedAt + value.expires_in * 1000;
      if (controller.signal.aborted) return;
      const verified = await fetch(`${API_URL}/api/v1/auth/session`, {
        headers: { Authorization: `Bearer ${issuedToken}` }, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!verified.ok) throw new LoginError('Metis oturumu doğrulayamadı. API bağlantısını ve hesap ayarlarını kontrol et.');
      const session: unknown = await verified.json();
      if (!isObject(session) || session.authenticated !== true || session.state !== 'signedIn'
        || !isObject(session.user) || typeof session.user.id !== 'string' || !uuid.test(session.user.id))
        throw new LoginError('Metis oturumu doğrulanamadı.');
      if (attempt !== this.generation || controller.signal.aborted) return;
      if (expiresAt <= Date.now()) throw new LoginError('Oturumun süresi doldu. Tekrar giriş yap.');
      this.accessToken = issuedToken;
      issuedToken = null;
      this.publish({ phase: 'signedIn', userId: session.user.id, expiresAt });
      this.timer = setTimeout(() => this.checkExpiry(), expiresAt - Date.now());
    } catch (error) {
      if (attempt === this.generation) {
        this.clear();
        this.publish({ phase: 'signedOut', message: error instanceof LoginError ? error.message
          : 'Giriş tamamlanamadı. Bağlantını kontrol edip tekrar dene.' });
      }
    } finally {
      // A cancelled/rejected attempt must never become a session, even if its reply arrives late.
      if (issuedToken) void this.revoke(issuedToken);
      if (this.pending === controller) this.pending = null;
    }
  }

  cancel() {
    ++this.generation;
    this.pending?.abort();
    this.pending = null;
    this.clear();
    this.publish({ phase: 'signedOut' });
  }

  checkExpiry = () => {
    if (this.view.phase === 'signedIn' && Date.now() >= this.view.expiresAt) {
      this.clear();
      this.publish({ phase: 'signedOut', message: 'Oturumun süresi doldu. Tekrar giriş yap.' });
    }
  };

  async signOut() {
    if (this.view.phase === 'signingOut') return;
    const attempt = ++this.generation;
    this.pending?.abort();
    this.pending = null;
    const token = this.accessToken;
    this.clear(); // Local account access ends immediately, including when the network is down.
    this.publish({ phase: 'signingOut' });
    const revoked = token ? await this.revoke(token) : true;
    if (attempt === this.generation) this.publish({ phase: 'signedOut', message: revoked ? 'Bu cihazdan çıkış yapıldı.'
      : 'Bu cihazdan çıkış yapıldı. Sunucudaki oturumun kapatıldığı doğrulanamadı.' });
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

export const loginStore = new LoginStore(loginSettings.kind === 'ready' ? loginSettings.config : undefined);
