import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { readIdentityStatus, type IdentityStatus } from './session';

type State = { kind: 'checking' } | { kind: 'unavailable' } | { kind: 'available'; value: IdentityStatus };

export function AccountCard() {
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

  const title = state.kind === 'checking' ? 'Hesap durumu kontrol ediliyor'
    : state.kind === 'unavailable' ? 'Hesap servisine ulaşılamıyor'
      : state.value.status === 'notConfigured' ? 'Hesap bağlantısı kurulmadı'
        : state.value.status === 'verificationConfigured' ? 'Hesap ayarları hazır' : 'Hesap bağlantısı bekliyor';
  const description = state.kind === 'unavailable'
    ? 'Hesap durumu alınamadı. Yerel veri alanı bağımsız çalışır.'
    : state.kind === 'checking' ? 'Yerel API üzerinden hesap durumu okunuyor.'
      : state.value.status === 'verificationConfigured'
        ? 'Hesap sağlayıcısı tanımlandı. Bağlantı henüz sınanmadı; giriş ekranı sonraki adımda.'
        : 'Oturum açık değil. Gerçek giriş ve cihazlar arası eşitleme sonraki dilimlerde.';

  return <article className="status-card" aria-label="Hesap ve oturum">
    <span className="card-icon sand"><ShieldCheck size={19} /></span>
    <span className="card-caption">Hesap & oturum</span>
    <h3 aria-live="polite">{title}</h3>
    <p>{description}</p>
    <button className="text-button" onClick={() => void refresh()} disabled={state.kind === 'checking'}>
      <RefreshCw size={14} className={state.kind === 'checking' ? 'spin' : ''} /> Hesap durumunu kontrol et
    </button>
  </article>;
}
