import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { readIdentityStatus, type IdentityStatus } from './session';
import { loginSettings } from './config';
import { loginStore } from './login';

type State = { kind: 'checking' } | { kind: 'unavailable' } | { kind: 'available'; value: IdentityStatus };

export function AccountCard() {
  const login = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  const [state, setState] = useState<State>({ kind: 'checking' });
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ kind: 'checking' });
    try {
      const value = await readIdentityStatus(controller.signal);
      if (!controller.signal.aborted) setState({ kind: 'available', value });
    } catch {
      if (!controller.signal.aborted) setState({ kind: 'unavailable' });
    }
  }, []);
  useEffect(() => { void refresh(); return () => pending.current?.abort(); }, [refresh]);

  const configured = loginSettings.kind === 'ready' && state.kind === 'available'
    && state.value.status === 'verificationConfigured' && state.value.issuer === loginSettings.config.issuer;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const passwordField = form.elements.namedItem('password') as HTMLInputElement;
    passwordField.value = '';
    void loginStore.signIn(String(fields.get('email') ?? ''), String(fields.get('password') ?? ''));
  }

  const title = state.kind === 'checking' ? 'Hesap durumu kontrol ediliyor'
    : state.kind === 'unavailable' ? 'Hesap servisine ulaşılamıyor'
      : state.value.status === 'notConfigured' ? 'Hesap bağlantısı kurulmadı'
        : state.value.status === 'verificationConfigured' ? 'Hesap ayarları hazır' : 'Hesap bağlantısı bekliyor';
  const description = state.kind === 'unavailable'
    ? 'Hesap durumu alınamadı. Yerel veri alanı bağımsız çalışır.'
    : state.kind === 'checking' ? 'Yerel API üzerinden hesap durumu okunuyor.'
      : state.value.status === 'verificationConfigured'
        ? configured ? 'Mevcut hesabınla giriş yap. Oturum yalnızca uygulama açıkken korunur.'
          : 'Bu cihazın giriş ayarları eksik veya hesap servisiyle eşleşmiyor.'
        : 'Oturum açık değil. Gerçek giriş ve cihazlar arası eşitleme sonraki dilimlerde.';

  return <article className="status-card" aria-label="Hesap ve oturum">
    <span className="card-icon sand"><ShieldCheck size={19} /></span>
    <span className="card-caption">Hesap & oturum</span>
    <h3 aria-live="polite">{login.phase === 'signedIn' ? 'Oturum açık'
      : login.phase === 'signingIn' ? 'Giriş doğrulanıyor'
        : login.phase === 'signingOut' ? 'Çıkış yapılıyor' : configured ? 'Metis’e giriş yap' : title}</h3>
    <p>{login.phase === 'signedIn' ? 'Hesabın doğrulandı. Uygulamayı kapattığında yeniden giriş yapman gerekir.'
      : login.phase === 'signingIn' ? 'Hesabın ve Metis bağlantın kontrol ediliyor.'
        : login.phase === 'signingOut' ? 'Bu cihazdaki oturum kapatıldı; sunucuya bildiriliyor.' : description}</p>
    {login.phase === 'signedOut' && login.message && <p role="status" className="account-message">{login.message}</p>}
    {login.phase === 'signedOut' && configured && <form className="login-form" onSubmit={submit}>
      <label htmlFor="account-email">E-posta</label>
      <input id="account-email" name="email" type="email" autoComplete="username" maxLength={254} required />
      <label htmlFor="account-password">Parola</label>
      <input id="account-password" name="password" type="password" autoComplete="current-password" maxLength={1024} required />
      <button className="primary-button" type="submit">Giriş yap</button>
    </form>}
    {login.phase === 'signedIn' && <button className="text-button" onClick={() => void loginStore.signOut()}>Bu cihazdan çıkış yap</button>}
    {login.phase === 'signingIn' && <button className="text-button" onClick={() => loginStore.cancel()}>Girişi iptal et</button>}
    {login.phase === 'signedOut' && <button className="text-button" onClick={() => void refresh()} disabled={state.kind === 'checking'}>
      <RefreshCw size={14} className={state.kind === 'checking' ? 'spin' : ''} /> Hesap durumunu kontrol et
    </button>}
  </article>;
}
