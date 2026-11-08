import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { loginStore } from '../identity/login';

export function CentralReadCard() {
  const session = useSyncExternalStore(loginStore.subscribe, loginStore.getSnapshot);
  return <section className="panel central-read-panel" aria-labelledby="central-read-title">
    <h2 id="central-read-title">Bulut bağlantısı</h2>
    <p>Hesabının buluttaki görev alanına erişimini kontrol et. Bu işlem görevlerini yüklemez; eşitleme henüz açık değil.</p>
    {session.phase === 'signedIn' && session.expiresAt > Date.now()
      ? <ReadCheck key={`${session.userId}:${session.expiresAt}`} />
      : <p>Kontrol etmek için hesabına giriş yap.</p>}
  </section>;
}

function ReadCheck() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Henüz kontrol edilmedi.');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function check() {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage('Hesabınla bulut okuması kontrol ediliyor…');
    try {
      const result = await loginStore.checkCentralTasks(controller.signal);
      if (!controller.signal.aborted) setMessage(result.empty
        ? 'Bulut okuması doğrulandı. Buluttaki görev alanın şu an boş; cihazındaki görevler korunuyor.'
        : 'Bulut okuması doğrulandı. Hesabının buluttaki görev alanına erişilebiliyor.');
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Kontrol tamamlanamadı. Tekrar dene.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <><p role="status">{message}</p>
    <button className="text-button" onClick={() => void check()} disabled={busy}>
      <RefreshCw size={14} className={busy ? 'spin' : ''} /> Bulut okumasını kontrol et
    </button></>;
}
